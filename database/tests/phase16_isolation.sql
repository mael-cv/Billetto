-- =============================================================================
-- Tests phase 16 — isolation RLS rejouée sur les tables des phases 10 à 15
--
-- Même harnais que phase09_multi_tenant.sql (schéma test_securite,
-- endosser()/reprendre()/refuse()/nb()), jeu d'essai propre : deux collectifs
-- A et B, un acheteur par collectif, des données dans chaque table récente
-- (reservations, liste_attente, billets_scans, emails_sortants) et les vues
-- étendues (v_ventes_par_evenement, v_remplissage). Pour chaque rôle :
--   - visiteur : uniquement ses lignes ;
--   - organisateur : uniquement son collectif ;
--   - aucune écriture directe (42501) : tout passe par les fonctions ;
--   - fonctions SECURITY DEFINER refusées hors de son collectif (BT013) ;
--   - tables internes (emails_sortants, checkin_secret) illisibles.
-- Garde-fou final : toute table lisible par un rôle visiteur/organisateur
-- doit avoir la RLS activée ET forcée (sauf référentiels publics listés).
-- =============================================================================

BEGIN;

CREATE SCHEMA test_securite;
GRANT USAGE ON SCHEMA test_securite TO PUBLIC;

CREATE TABLE test_securite.fx (cle text PRIMARY KEY, id bigint);
GRANT SELECT ON test_securite.fx TO PUBLIC;

CREATE FUNCTION test_securite.id(p_cle text) RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT id FROM test_securite.fx WHERE cle = p_cle $$;

CREATE FUNCTION test_securite.endosser(p_role text, p_utilisateur bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    RESET ROLE;
    SET LOCAL ROLE billetto_app;
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    PERFORM set_config('app.user_id', coalesce(p_utilisateur::text, ''), true);
END $$;

CREATE FUNCTION test_securite.reprendre() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    RESET ROLE;
    PERFORM set_config('app.user_id', '', true);
END $$;

CREATE FUNCTION test_securite.refuse(p_sql text, p_code text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_code THEN
            RAISE NOTICE 'OK [%] % → %', current_user, p_label, SQLSTATE;
            RETURN;
        END IF;
        RAISE EXCEPTION '[%] % : SQLSTATE % attendu, obtenu % (%)', current_user, p_label, p_code, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION '[%] % : erreur % attendue, aucune levée', current_user, p_label, p_code;
END $$;

CREATE FUNCTION test_securite.nb(p_sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
    EXECUTE format('SELECT count(*) FROM (%s) s', p_sql) INTO n;
    RETURN n;
END $$;

-- Vérifie un nombre de lignes visibles avec le rôle courant.
CREATE FUNCTION test_securite.voit(p_sql text, p_attendu bigint, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n bigint := test_securite.nb(p_sql);
BEGIN
    IF n <> p_attendu THEN
        RAISE EXCEPTION '[%] % : % ligne(s) attendue(s), % visible(s)', current_user, p_label, p_attendu, n;
    END IF;
    RAISE NOTICE 'OK [%] % (% ligne(s))', current_user, p_label, n;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test_securite TO PUBLIC;

-- -----------------------------------------------------------------------------
-- Jeu d'essai : collectifs A et B, chacun avec un événement, un tarif, un
-- acheteur ; achats, hold, inscription en liste d'attente, scan.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_lieu bigint; r record; v_orga bigint; v_evt bigint; v_tarif bigint; v_acheteur bigint; v_staff bigint;
    v_cmd bigint; v_billet bigint; v_entree bigint;
BEGIN
    INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
    VALUES ('Test Salle P16', '1 rue du Test', 'Testville', '99000', 500) RETURNING id INTO v_lieu;

    FOR r IN SELECT * FROM (VALUES ('a'), ('b')) v(k) LOOP
        INSERT INTO organisateurs (nom, email, slug)
        VALUES ('Test P16 ' || r.k, 'test-p16-' || r.k || '@billetto.test', 'test-p16-' || r.k) RETURNING id INTO v_orga;
        INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
        VALUES (v_orga, v_lieu, (SELECT min(id) FROM type_evenements), 'P16 ' || r.k, 'test-p16-' || r.k,
                now() + interval '30 days', now() + interval '31 days', 'published') RETURNING id INTO v_evt;
        -- Quota 3 : 2 vendus + 1 hold → complet, l'inscription en liste d'attente est possible.
        INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
        VALUES (v_evt, 'Standard', 20, 3, now() - interval '1 day', now() + interval '29 days') RETURNING id INTO v_tarif;
        INSERT INTO utilisateurs (email, password_hash, prenom, nom)
        VALUES ('test-p16-acheteur-' || r.k || '@billetto.test', 'x', 'Acheteur', upper(r.k)) RETURNING id INTO v_acheteur;
        INSERT INTO utilisateurs (email, password_hash, prenom, nom, role_app, organisateur_id)
        VALUES ('test-p16-staff-' || r.k || '@billetto.test', 'x', 'Staff', upper(r.k), 'organizer', v_orga) RETURNING id INTO v_staff;

        SELECT commande_id, billet_ids[1] INTO v_cmd, v_billet FROM acheter_billet(v_acheteur, v_tarif, 2);
        PERFORM creer_reservation(v_acheteur, v_tarif, 1, 'virement');
        -- L'acheteur de l'autre collectif s'inscrira plus bas ; ici une inscription « maison ».
        INSERT INTO test_securite.fx VALUES
            ('orga_' || r.k, v_orga), ('evt_' || r.k, v_evt), ('tarif_' || r.k, v_tarif),
            ('acheteur_' || r.k, v_acheteur), ('staff_' || r.k, v_staff), ('cmd_' || r.k, v_cmd), ('billet_' || r.k, v_billet);
    END LOOP;

    -- Chaque acheteur s'inscrit en liste d'attente sur le tarif de l'AUTRE collectif :
    -- l'organisateur voit donc l'inscription d'un acheteur qui n'est pas « à lui ».
    v_entree := inscrire_liste_attente(test_securite.id('acheteur_a'), test_securite.id('tarif_b'), 1);
    INSERT INTO test_securite.fx VALUES ('attente_a_sur_b', v_entree);
    v_entree := inscrire_liste_attente(test_securite.id('acheteur_b'), test_securite.id('tarif_a'), 1);
    INSERT INTO test_securite.fx VALUES ('attente_b_sur_a', v_entree);

    -- Un scan par collectif.
    PERFORM scanner_billet(gen_random_uuid(),
        (SELECT 'BT1.' || code || '.' || code_verification FROM billets WHERE id = test_securite.id('billet_a')),
        test_securite.id('evt_a'));
    PERFORM scanner_billet(gen_random_uuid(),
        (SELECT 'BT1.' || code || '.' || code_verification FROM billets WHERE id = test_securite.id('billet_b')),
        test_securite.id('evt_b'));
END $$;

-- =============================================================================
-- 1. Visiteur (acheteur A) : uniquement ses propres lignes
-- =============================================================================
DO $$
BEGIN
    PERFORM test_securite.endosser('billetto_visiteur', test_securite.id('acheteur_a'));

    PERFORM test_securite.voit(format('SELECT 1 FROM reservations WHERE tarif_id IN (%s, %s)',
        test_securite.id('tarif_a'), test_securite.id('tarif_b')), 1, 'reservations : seulement son hold');
    PERFORM test_securite.voit(format('SELECT 1 FROM reservations WHERE utilisateur_id = %s', test_securite.id('acheteur_b')),
        0, 'reservations : hold de B invisible');
    PERFORM test_securite.voit(format('SELECT 1 FROM liste_attente WHERE id IN (%s, %s)',
        test_securite.id('attente_a_sur_b'), test_securite.id('attente_b_sur_a')), 1, 'liste_attente : seulement son inscription');
    PERFORM test_securite.refuse('SELECT 1 FROM billets_scans', '42501', 'billets_scans : aucun accès visiteur');
    PERFORM test_securite.refuse('SELECT 1 FROM emails_sortants', '42501', 'emails_sortants : aucun accès');
    PERFORM test_securite.refuse('SELECT 1 FROM checkin_secret', '42501', 'checkin_secret : aucun accès');

    -- Écritures directes refusées : tout passe par les fonctions métier.
    PERFORM test_securite.refuse(format(
        'INSERT INTO reservations (tarif_id, utilisateur_id, quantite, mode_paiement, prix_unitaire, expire_a)
         VALUES (%s, %s, 1, ''carte'', 0, now() + interval ''1 day'')', test_securite.id('tarif_a'), test_securite.id('acheteur_a')),
        '42501', 'reservations : INSERT direct refusé');
    PERFORM test_securite.refuse(format('UPDATE liste_attente SET statut = ''notifiee'' WHERE id = %s', test_securite.id('attente_a_sur_b')),
        '42501', 'liste_attente : UPDATE direct refusé (sauter la file)');
    PERFORM test_securite.refuse(format('DELETE FROM reservations WHERE utilisateur_id = %s', test_securite.id('acheteur_a')),
        '42501', 'reservations : DELETE direct refusé');

    -- Fonctions : on n'agit que pour soi.
    PERFORM test_securite.refuse(format('SELECT inscrire_liste_attente(%s, %s, 1)', test_securite.id('acheteur_b'), test_securite.id('tarif_b')),
        'BT013', 'inscrire_liste_attente au nom d''un autre');
    PERFORM test_securite.refuse(format('SELECT * FROM manifeste_checkin(%s)', test_securite.id('evt_a')),
        '42501', 'manifeste_checkin : pas d''EXECUTE visiteur');
    PERFORM test_securite.refuse(format('SELECT * FROM participants_evenement(%s)', test_securite.id('evt_a')),
        '42501', 'participants_evenement : pas d''EXECUTE visiteur');
    PERFORM test_securite.refuse('SELECT * FROM emails_a_envoyer(10)', '42501', 'emails_a_envoyer : réservé au job (admin)');

    PERFORM test_securite.reprendre();
END $$;

-- =============================================================================
-- 2. Organisateur A : uniquement son collectif
-- =============================================================================
DO $$
BEGIN
    PERFORM test_securite.endosser('billetto_organisateur', test_securite.id('staff_a'));

    PERFORM test_securite.voit(format('SELECT 1 FROM reservations WHERE tarif_id IN (%s, %s)',
        test_securite.id('tarif_a'), test_securite.id('tarif_b')), 1, 'reservations : holds de son tarif seulement');
    -- L'inscription de B sur le tarif de A est visible (son tarif), celle de A sur le tarif de B non.
    PERFORM test_securite.voit(format('SELECT 1 FROM liste_attente WHERE id = %s', test_securite.id('attente_b_sur_a')),
        1, 'liste_attente : inscription sur son tarif visible');
    PERFORM test_securite.voit(format('SELECT 1 FROM liste_attente WHERE id = %s', test_securite.id('attente_a_sur_b')),
        0, 'liste_attente : inscription sur le tarif de B invisible');
    PERFORM test_securite.voit(format('SELECT 1 FROM billets_scans WHERE evenement_id IN (%s, %s)',
        test_securite.id('evt_a'), test_securite.id('evt_b')), 1, 'billets_scans : scans de son événement seulement');
    PERFORM test_securite.voit(format('SELECT 1 FROM v_remplissage WHERE evenement_id = %s', test_securite.id('evt_b')),
        0, 'v_remplissage : événement de B invisible');
    PERFORM test_securite.voit(format(
        'SELECT 1 FROM v_remplissage WHERE evenement_id = %s AND billets_vendus = 2 AND billets_reserves = 1 AND places_liste_attente = 1',
        test_securite.id('evt_a')), 1, 'v_remplissage : ses chiffres vendu/réservé/attente');
    PERFORM test_securite.refuse('SELECT 1 FROM emails_sortants', '42501', 'emails_sortants : aucun accès');

    -- Écritures directes refusées.
    PERFORM test_securite.refuse(format(
        'INSERT INTO billets_scans (client_scan_id, evenement_id, payload, resultat, scanne_a)
         VALUES (gen_random_uuid(), %s, ''x'', ''ok'', now())', test_securite.id('evt_a')),
        '42501', 'billets_scans : INSERT direct refusé (forger un scan)');
    PERFORM test_securite.refuse(format('DELETE FROM billets_scans WHERE evenement_id = %s', test_securite.id('evt_a')),
        '42501', 'billets_scans : DELETE direct refusé (effacer un passage)');

    -- Fonctions SECURITY DEFINER : collectif de B refusé.
    PERFORM test_securite.refuse(format('SELECT * FROM manifeste_checkin(%s)', test_securite.id('evt_b')),
        'BT013', 'manifeste_checkin sur l''événement de B');
    PERFORM test_securite.refuse(format('SELECT * FROM participants_evenement(%s)', test_securite.id('evt_b')),
        'BT013', 'participants_evenement sur l''événement de B');
    PERFORM test_securite.refuse(format(
        'SELECT * FROM scanner_billet(gen_random_uuid(), %L, %s)',
        (SELECT 'BT1.' || code || '.' || code_verification FROM billets WHERE id = test_securite.id('billet_b')),
        test_securite.id('evt_b')), 'BT013', 'scanner_billet sur l''événement de B');
    PERFORM test_securite.voit(format('SELECT 1 FROM manifeste_checkin(%s)', test_securite.id('evt_a')),
        2, 'manifeste_checkin : ses 2 billets');

    PERFORM test_securite.reprendre();
END $$;

-- =============================================================================
-- 3. Organisateur B : symétrique
-- =============================================================================
DO $$
BEGIN
    PERFORM test_securite.endosser('billetto_organisateur', test_securite.id('staff_b'));
    PERFORM test_securite.voit(format('SELECT 1 FROM reservations WHERE tarif_id = %s', test_securite.id('tarif_a')),
        0, 'reservations de A invisibles');
    PERFORM test_securite.voit(format('SELECT 1 FROM billets_scans WHERE evenement_id = %s', test_securite.id('evt_a')),
        0, 'scans de A invisibles');
    PERFORM test_securite.voit(format('SELECT 1 FROM liste_attente WHERE tarif_id = %s', test_securite.id('tarif_a')),
        0, 'liste d''attente de A invisible');
    PERFORM test_securite.voit('SELECT 1 FROM v_ventes_par_evenement WHERE organisateur_id <> ' || test_securite.id('orga_b'),
        0, 'v_ventes_par_evenement : uniquement son collectif');
    PERFORM test_securite.reprendre();
END $$;

-- =============================================================================
-- 4. Lecture seule (reporting) : tout lire, rien écrire, rien d'interne
-- =============================================================================
DO $$
BEGIN
    PERFORM test_securite.endosser('billetto_readonly', NULL);
    PERFORM test_securite.voit(format('SELECT 1 FROM reservations WHERE tarif_id IN (%s, %s)',
        test_securite.id('tarif_a'), test_securite.id('tarif_b')), 2, 'reservations : lecture globale');
    PERFORM test_securite.refuse(format('UPDATE reservations SET statut = ''annulee'' WHERE tarif_id = %s', test_securite.id('tarif_a')),
        '42501', 'reservations : UPDATE refusé');
    PERFORM test_securite.refuse('SELECT 1 FROM emails_sortants', '42501', 'emails_sortants : aucun accès');
    PERFORM test_securite.refuse('SELECT 1 FROM checkin_secret', '42501', 'checkin_secret : aucun accès');
    PERFORM test_securite.reprendre();
END $$;

-- =============================================================================
-- 5. Garde-fou générique : toute table lisible par un rôle visiteur ou
--    organisateur a la RLS activée ET forcée. Une table future oubliée fait
--    échouer ce test. Exceptions : référentiels publics (catalogue).
-- =============================================================================
DO $$
DECLARE r record; v_fautes text := '';
BEGIN
    FOR r IN
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname NOT IN ('lieux', 'organisateurs', 'type_evenements', 'schema_migrations')
          AND (has_table_privilege('billetto_visiteur', c.oid, 'SELECT')
               OR has_table_privilege('billetto_organisateur', c.oid, 'SELECT'))
        ORDER BY c.relname
    LOOP
        IF NOT (r.relrowsecurity AND r.relforcerowsecurity) THEN
            v_fautes := v_fautes || ' ' || r.relname;
        END IF;
    END LOOP;
    ASSERT v_fautes = '', 'tables lisibles par un rôle applicatif sans RLS forcée :' || v_fautes;

    -- Les tables internes n'ont aucun droit applicatif.
    ASSERT NOT has_table_privilege('billetto_admin', 'checkin_secret', 'SELECT'), 'checkin_secret : aucun GRANT';
    ASSERT NOT has_table_privilege('billetto_admin', 'emails_sortants', 'SELECT'), 'emails_sortants : aucun GRANT direct';
    RAISE NOTICE 'OK garde-fou : toutes les tables lisibles par visiteur/organisateur ont une RLS forcée';
END $$;

ROLLBACK;
