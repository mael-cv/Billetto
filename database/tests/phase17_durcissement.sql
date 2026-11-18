-- =============================================================================
-- Tests phase 17 — durcissement issu de l'audit de sécurité (migration 017).
-- Jeu d'essai propre, tout est annulé par ROLLBACK.
--   1. privilèges : plus aucune commande payée créée par l'acheteur
--   2. plafond de réservations par utilisateur, TTL non modifiable par l'API
--   3. webhook : montant vérifié, rôle dédié, contexte rétabli
--   4. virement validé par l'organisateur de l'événement uniquement
--   5. réservation gratuite, annulation, préparation du paiement
--   6. check-in : cloisonnement par événement, heure bornée
--   7. places_restantes, reporting sans codes de billets
--   8. authentification : verrouillage, révocation des sessions, dernier admin
-- =============================================================================

BEGIN;

CREATE SCHEMA test_p17;
GRANT USAGE ON SCHEMA test_p17 TO PUBLIC;

CREATE TABLE test_p17.fx (cle text PRIMARY KEY, id bigint);
GRANT SELECT ON test_p17.fx TO PUBLIC;

CREATE FUNCTION test_p17.id(p_cle text) RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT id FROM test_p17.fx WHERE cle = p_cle $$;

-- Endosse un rôle métier comme le fait l'API.
CREATE FUNCTION test_p17.endosser(p_role text, p_utilisateur bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    RESET ROLE;
    SET LOCAL ROLE billetto_app;
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    PERFORM set_config('app.user_id', coalesce(p_utilisateur::text, ''), true);
END $$;

CREATE FUNCTION test_p17.reprendre() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    RESET ROLE;
    PERFORM set_config('app.user_id', '', true);
END $$;

CREATE FUNCTION test_p17.refuse(p_sql text, p_code text, p_label text) RETURNS void
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

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test_p17 TO PUBLIC;

-- -----------------------------------------------------------------------------
-- Jeu d'essai : deux collectifs (A, B), un événement publié chacun, un brouillon
-- chez B, un acheteur, un second acheteur, un admin.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_lieu bigint; v_type bigint; r record; v_orga bigint; v_evt bigint; v_tarif bigint; v_id bigint;
BEGIN
    INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
    VALUES ('Test Salle P17', '1 rue du Test', 'Testville', '99000', 500) RETURNING id INTO v_lieu;
    SELECT min(id) INTO v_type FROM type_evenements;

    FOR r IN SELECT * FROM (VALUES ('a'), ('b')) v(k) LOOP
        INSERT INTO organisateurs (nom, email, slug)
        VALUES ('Test P17 ' || r.k, 'test-p17-' || r.k || '@billetto.test', 'test-p17-' || r.k) RETURNING id INTO v_orga;
        INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
        VALUES (v_orga, v_lieu, v_type, 'P17 ' || r.k, 'test-p17-' || r.k,
                now() + interval '30 days', now() + interval '31 days', 'published') RETURNING id INTO v_evt;
        INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
        VALUES (v_evt, 'Standard', 20, 100, now() - interval '1 day', now() + interval '29 days') RETURNING id INTO v_tarif;
        INSERT INTO utilisateurs (email, password_hash, prenom, nom, role_app, organisateur_id)
        VALUES ('test-p17-staff-' || r.k || '@billetto.test', 'x', 'Staff', upper(r.k), 'organizer', v_orga) RETURNING id INTO v_id;
        INSERT INTO test_p17.fx VALUES
            ('orga_' || r.k, v_orga), ('evt_' || r.k, v_evt), ('tarif_' || r.k, v_tarif), ('staff_' || r.k, v_id);
    END LOOP;

    -- Tarifs supplémentaires chez A : gratuit, et trois autres pour le plafond global.
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
    VALUES (test_p17.id('evt_a'), 'Invitation', 0, 50, now() - interval '1 day', now() + interval '29 days')
    RETURNING id INTO v_tarif;
    INSERT INTO test_p17.fx VALUES ('tarif_gratuit', v_tarif);
    FOR r IN SELECT * FROM generate_series(1, 3) g(i) LOOP
        INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
        VALUES (test_p17.id('evt_a'), 'Extra ' || r.i, 10, 100, now() - interval '1 day', now() + interval '29 days')
        RETURNING id INTO v_tarif;
        INSERT INTO test_p17.fx VALUES ('tarif_extra' || r.i, v_tarif);
    END LOOP;

    -- Brouillon de B, avec un tarif.
    INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
    VALUES (test_p17.id('orga_b'), v_lieu, v_type, 'P17 brouillon', 'test-p17-brouillon',
            now() + interval '40 days', now() + interval '41 days', 'draft') RETURNING id INTO v_evt;
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
    VALUES (v_evt, 'Secret', 15, 40, now() - interval '1 day', now() + interval '39 days') RETURNING id INTO v_tarif;
    INSERT INTO test_p17.fx VALUES ('evt_brouillon', v_evt), ('tarif_brouillon', v_tarif);

    INSERT INTO utilisateurs (email, password_hash, prenom, nom)
    VALUES ('test-p17-acheteur@billetto.test', 'x', 'Camille', 'Acheteur') RETURNING id INTO v_id;
    INSERT INTO test_p17.fx VALUES ('acheteur', v_id);
    INSERT INTO utilisateurs (email, password_hash, prenom, nom)
    VALUES ('test-p17-autre@billetto.test', 'x', 'Bao', 'Autre') RETURNING id INTO v_id;
    INSERT INTO test_p17.fx VALUES ('autre', v_id);
    INSERT INTO utilisateurs (email, password_hash, prenom, nom, role_app)
    VALUES ('test-p17-admin@billetto.test', 'x', 'Inès', 'Admin', 'admin') RETURNING id INTO v_id;
    INSERT INTO test_p17.fx VALUES ('admin', v_id);
END $$;

-- =============================================================================
-- 1. Privilèges
-- =============================================================================
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['billetto_visiteur', 'billetto_organisateur', 'billetto_admin'] LOOP
        ASSERT NOT has_function_privilege(r, 'confirmer_reservation(bigint, bigint)', 'EXECUTE'),
            format('%s : confirmer_reservation retirée', r);
        ASSERT NOT has_function_privilege(r, 'acheter_billet(bigint, bigint, integer)', 'EXECUTE'),
            format('%s : acheter_billet retirée', r);
        ASSERT NOT has_function_privilege(r, 'confirmer_liste_attente(bigint, bigint)', 'EXECUTE'),
            format('%s : confirmer_liste_attente retirée', r);
        ASSERT NOT has_function_privilege(r, 'traiter_paiement_webhook(text, text, bigint, jsonb, bigint)', 'EXECUTE'),
            format('%s : webhook de paiement inaccessible', r);
        ASSERT NOT has_function_privilege(r, 'finaliser_reservation(bigint)', 'EXECUTE'),
            format('%s : finaliser_reservation interne', r);
    END LOOP;
    ASSERT has_function_privilege('billetto_paiement', 'traiter_paiement_webhook(text, text, bigint, jsonb, bigint)', 'EXECUTE'),
        'billetto_paiement : webhook';
    ASSERT NOT has_function_privilege('billetto_paiement', 'finaliser_reservation(bigint)', 'EXECUTE'),
        'billetto_paiement : pas d''accès direct à finaliser_reservation';
    ASSERT NOT has_table_privilege('billetto_paiement', 'reservations', 'SELECT'), 'billetto_paiement : aucune table';
    ASSERT NOT has_table_privilege('billetto_paiement', 'utilisateurs', 'SELECT'), 'billetto_paiement : aucune table';
    ASSERT NOT has_function_privilege('billetto_visiteur', 'valider_virement(bigint)', 'EXECUTE'),
        'visiteur : pas de validation de virement';
    ASSERT (SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin FROM pg_roles WHERE rolname = 'billetto_paiement'),
        'billetto_paiement : rôle de groupe non privilégié';
    ASSERT NOT has_function_privilege('public', 'session_maintenance()', 'EXECUTE'), 'session_maintenance : pas PUBLIC';
    RAISE NOTICE 'OK privilèges : aucune commande payée possible depuis un rôle acheteur';
END $$;

-- =============================================================================
-- 2. Plafond de réservations, TTL
-- =============================================================================
DO $$
DECLARE
    v_user bigint := test_p17.id('acheteur');
    r record;
BEGIN
    PERFORM test_p17.endosser('billetto_visiteur', v_user);

    -- 10 places par tarif : 6 + 4 passent, la 11e est refusée.
    PERFORM creer_reservation(v_user, test_p17.id('tarif_a'), 6, 'carte');
    PERFORM creer_reservation(v_user, test_p17.id('tarif_a'), 4, 'virement');
    PERFORM test_p17.refuse(format('SELECT creer_reservation(%s, %s, 1, ''carte'')', v_user, test_p17.id('tarif_a')),
        'BT034', 'plafond de 10 places par tarif');

    -- 30 places au total : 10 + 10 + 10 déjà prises, un quatrième tarif est refusé.
    PERFORM creer_reservation(v_user, test_p17.id('tarif_extra1'), 10, 'carte');
    PERFORM creer_reservation(v_user, test_p17.id('tarif_extra2'), 10, 'carte');
    PERFORM test_p17.refuse(format('SELECT creer_reservation(%s, %s, 1, ''carte'')', v_user, test_p17.id('tarif_extra3')),
        'BT034', 'plafond de 30 places au total');

    -- Le plafond est par utilisateur : un autre acheteur n'est pas bloqué.
    PERFORM test_p17.endosser('billetto_visiteur', test_p17.id('autre'));
    PERFORM creer_reservation(test_p17.id('autre'), test_p17.id('tarif_a'), 2, 'carte');

    -- p_ttl_override ignoré hors maintenance : un acheteur ne peut pas s'offrir un hold d'un an.
    SELECT * INTO r FROM creer_reservation(test_p17.id('autre'), test_p17.id('tarif_b'), 1, 'virement', interval '365 days');
    ASSERT r.expire_a BETWEEN now() + interval '23 hours' AND now() + interval '25 hours',
        format('TTL virement imposé à 24 h, obtenu %s', r.expire_a - now());
    PERFORM test_p17.reprendre();
    INSERT INTO test_p17.fx VALUES ('hold_virement_b', r.reservation_id);
    RAISE NOTICE 'OK plafond de réservations par utilisateur et TTL non modifiable';
END $$;

-- Annuler un hold rend les places et lève le plafond.
DO $$
DECLARE
    v_user bigint := test_p17.id('acheteur');
    v_hold bigint;
BEGIN
    SELECT id INTO v_hold FROM reservations
    WHERE utilisateur_id = v_user AND tarif_id = test_p17.id('tarif_a') AND quantite = 6;

    PERFORM test_p17.endosser('billetto_visiteur', test_p17.id('autre'));
    PERFORM test_p17.refuse(format('SELECT annuler_reservation(%s, %s)', v_hold, test_p17.id('autre')),
        'BT013', 'annulation du hold d''un autre');

    PERFORM test_p17.endosser('billetto_visiteur', v_user);
    PERFORM annuler_reservation(v_hold, v_user);
    PERFORM test_p17.refuse(format('SELECT annuler_reservation(%s, %s)', v_hold, v_user), 'BT032', 'hold déjà annulé');
    PERFORM creer_reservation(v_user, test_p17.id('tarif_a'), 6, 'carte');
    PERFORM test_p17.reprendre();

    ASSERT (SELECT statut FROM reservations WHERE id = v_hold) = 'annulee', 'hold annulé';
    RAISE NOTICE 'OK annulation d''un hold par son auteur';
END $$;

-- =============================================================================
-- 3. Webhook de paiement
-- =============================================================================
DO $$
DECLARE
    v_user bigint := test_p17.id('autre');
    v_hold bigint;
    r record;
BEGIN
    SELECT id INTO v_hold FROM reservations
    WHERE utilisateur_id = v_user AND tarif_id = test_p17.id('tarif_a') AND statut = 'active';

    PERFORM test_p17.endosser('billetto_paiement', NULL);

    -- Montant absent ou différent du prix figé (2 × 20,00 € = 4 000 centimes) : refusé.
    PERFORM test_p17.refuse(format(
        $q$SELECT * FROM traiter_paiement_webhook('evt-p17-sans-montant', 'payment.succeeded', %s, '{}'::jsonb)$q$, v_hold),
        'BT035', 'webhook sans montant');
    PERFORM test_p17.refuse(format(
        $q$SELECT * FROM traiter_paiement_webhook('evt-p17-moins', 'payment.succeeded', %s, '{}'::jsonb, 100)$q$, v_hold),
        'BT035', 'webhook avec un montant inférieur');
    PERFORM test_p17.refuse(format(
        $q$SELECT * FROM traiter_paiement_webhook('evt-p17-plus', 'payment.succeeded', %s, '{}'::jsonb, 4001)$q$, v_hold),
        'BT035', 'webhook avec un montant supérieur');

    -- Montant exact : commande créée, contexte de l'appelant rétabli (pas d'identité résiduelle).
    SELECT * INTO r FROM traiter_paiement_webhook('evt-p17-ok', 'payment.succeeded', v_hold, '{}'::jsonb, 4000);
    ASSERT NOT r.duplique AND r.commande_id IS NOT NULL AND array_length(r.billet_ids, 1) = 2, 'paiement exact : 2 billets';
    ASSERT coalesce(current_setting('app.user_id', true), '') = '', 'contexte rétabli après le webhook';
    ASSERT current_user = 'billetto_paiement', 'rôle inchangé après le webhook';

    -- Rejeu du même événement : doublon, rien de plus.
    SELECT * INTO r FROM traiter_paiement_webhook('evt-p17-ok', 'payment.succeeded', v_hold, '{}'::jsonb, 4000);
    ASSERT r.duplique AND r.commande_id IS NULL, 'rejeu : doublon';

    -- Autre identifiant d'événement pour le même hold déjà confirmé : refusé (BT032).
    PERFORM test_p17.refuse(format(
        $q$SELECT * FROM traiter_paiement_webhook('evt-p17-bis', 'payment.succeeded', %s, '{}'::jsonb, 4000)$q$, v_hold),
        'BT032', 'second paiement du même hold');

    PERFORM test_p17.reprendre();
    ASSERT (SELECT count(*) FROM paiement_webhooks WHERE evenement_externe_id LIKE 'evt-p17-%') = 1,
        'un seul événement journalisé (les refus sont annulés)';
    ASSERT (SELECT count(*) FROM billets b JOIN reservations res ON res.commande_id = b.commande_id WHERE res.id = v_hold) = 2,
        'exactement 2 billets pour ce hold';
    RAISE NOTICE 'OK webhook : montant vérifié, idempotent, contexte rétabli';
END $$;

-- =============================================================================
-- 4. Virement : validé par l'organisateur de l'événement uniquement
-- =============================================================================
DO $$
DECLARE
    v_hold bigint := test_p17.id('hold_virement_b');
    v_hold_carte bigint;
    r record;
BEGIN
    -- L'acheteur ne peut pas valider son propre virement.
    PERFORM test_p17.endosser('billetto_visiteur', test_p17.id('autre'));
    PERFORM test_p17.refuse(format('SELECT * FROM valider_virement(%s)', v_hold), '42501', 'validation par l''acheteur');

    -- L'organisateur d'un AUTRE collectif non plus.
    PERFORM test_p17.endosser('billetto_organisateur', test_p17.id('staff_a'));
    PERFORM test_p17.refuse(format('SELECT * FROM valider_virement(%s)', v_hold), 'BT013', 'validation par un autre organisateur');
    PERFORM test_p17.refuse('SELECT * FROM valider_virement(-1)', 'BT031', 'réservation inconnue');

    -- Un hold « carte » ne se valide pas comme un virement.
    SELECT id INTO v_hold_carte FROM reservations
    WHERE tarif_id = test_p17.id('tarif_extra1') AND statut = 'active' LIMIT 1;
    PERFORM test_p17.refuse(format('SELECT * FROM valider_virement(%s)', v_hold_carte), 'BT030', 'hold carte validé comme virement');

    -- L'organisateur de l'événement valide : commande pour l'acheteur, contexte rétabli.
    PERFORM test_p17.endosser('billetto_organisateur', test_p17.id('staff_b'));
    SELECT * INTO r FROM valider_virement(v_hold);
    ASSERT r.commande_id IS NOT NULL AND array_length(r.billet_ids, 1) = 1, 'virement validé : 1 billet';
    ASSERT current_setting('app.user_id', true) = test_p17.id('staff_b')::text, 'contexte de l''organisateur rétabli';
    PERFORM test_p17.refuse(format('SELECT * FROM valider_virement(%s)', v_hold), 'BT032', 'double validation');

    PERFORM test_p17.reprendre();
    ASSERT (SELECT utilisateur_id FROM commandes WHERE id = r.commande_id) = test_p17.id('autre'),
        'la commande appartient à l''acheteur, pas à l''organisateur';
    RAISE NOTICE 'OK virement : validation réservée à l''organisateur de l''événement';
END $$;

-- =============================================================================
-- 5. Réservation gratuite et préparation du paiement
-- =============================================================================
DO $$
DECLARE
    v_user bigint := test_p17.id('autre');
    v_gratuit bigint; v_payant bigint; v_virement bigint;
    r record;
BEGIN
    PERFORM test_p17.endosser('billetto_visiteur', v_user);
    SELECT reservation_id INTO v_gratuit FROM creer_reservation(v_user, test_p17.id('tarif_gratuit'), 2, 'carte');
    SELECT reservation_id INTO v_payant FROM creer_reservation(v_user, test_p17.id('tarif_extra3'), 3, 'carte');
    SELECT reservation_id INTO v_virement FROM creer_reservation(v_user, test_p17.id('tarif_extra3'), 1, 'virement');

    -- Un hold payant ne se confirme jamais « gratuitement ».
    PERFORM test_p17.refuse(format('SELECT * FROM confirmer_reservation_gratuite(%s, %s)', v_payant, v_user),
        'BT035', 'confirmation gratuite d''un hold payant');

    -- Préparation du paiement : montant en centimes, hold prolongé pour couvrir la session.
    SELECT * INTO r FROM preparer_paiement_reservation(v_payant, v_user);
    ASSERT r.montant_centimes = 3000 AND r.quantite = 3 AND r.evenement_id = test_p17.id('evt_a'),
        format('montant dû : 3000 centimes attendus, %s obtenus', r.montant_centimes);
    ASSERT r.expire_a BETWEEN now() + interval '31 minutes' AND now() + interval '33 minutes',
        format('hold prolongé à ≈ 32 min, obtenu %s', r.expire_a - now());
    PERFORM test_p17.refuse(format('SELECT * FROM preparer_paiement_reservation(%s, %s)', v_virement, v_user),
        'BT030', 'paiement carte d''un hold virement');

    -- Gratuit : confirmé par son auteur, sans paiement.
    SELECT * INTO r FROM preparer_paiement_reservation(v_gratuit, v_user);
    ASSERT r.montant_centimes = 0, 'hold gratuit : rien à payer';
    SELECT * INTO r FROM confirmer_reservation_gratuite(v_gratuit, v_user);
    ASSERT array_length(r.billet_ids, 1) = 2, 'hold gratuit : 2 billets';

    -- Jamais pour le compte d'un autre.
    PERFORM test_p17.endosser('billetto_visiteur', test_p17.id('acheteur'));
    PERFORM test_p17.refuse(format('SELECT * FROM preparer_paiement_reservation(%s, %s)', v_payant, test_p17.id('acheteur')),
        'BT013', 'paiement du hold d''un autre');
    PERFORM test_p17.refuse(format('SELECT * FROM confirmer_reservation_gratuite(%s, %s)', v_payant, v_user),
        'BT013', 'usurpation de l''identifiant de l''acheteur');

    -- Un hold ne s'entretient pas indéfiniment : plus d'une heure après sa création, le paiement est refusé.
    PERFORM test_p17.reprendre();
    UPDATE reservations SET created_at = now() - interval '50 minutes' WHERE id = v_payant;
    PERFORM test_p17.endosser('billetto_visiteur', v_user);
    PERFORM test_p17.refuse(format('SELECT * FROM preparer_paiement_reservation(%s, %s)', v_payant, v_user),
        'BT033', 'hold trop ancien pour ouvrir un paiement');

    PERFORM test_p17.reprendre();
    RAISE NOTICE 'OK réservation gratuite et préparation du paiement';
END $$;

-- =============================================================================
-- 6. Check-in : cloisonnement par événement
-- =============================================================================
DO $$
DECLARE
    v_billet_a bigint; v_qr_a text; v_scan uuid := gen_random_uuid();
    r record;
BEGIN
    -- Billet de l'événement A (émis par le webhook plus haut).
    SELECT b.id, 'BT1.' || b.code || '.' || b.code_verification INTO v_billet_a, v_qr_a
    FROM billets b WHERE b.tarif_id = test_p17.id('tarif_a') LIMIT 1;

    -- L'organisateur B scanne ce billet sur SON événement : aucune donnée du billet ni du titulaire.
    PERFORM test_p17.endosser('billetto_organisateur', test_p17.id('staff_b'));
    SELECT * INTO r FROM scanner_billet(gen_random_uuid(), v_qr_a, test_p17.id('evt_b'));
    ASSERT r.resultat = 'mauvais_evenement', 'billet d''un autre événement : mauvais_evenement';
    ASSERT r.billet_id IS NULL AND r.tarif IS NULL AND r.titulaire IS NULL,
        'mauvais_evenement : ni billet, ni tarif, ni titulaire';

    -- L'organisateur A scanne son billet avec une heure fantaisiste : heure bornée.
    PERFORM test_p17.endosser('billetto_organisateur', test_p17.id('staff_a'));
    SELECT * INTO r FROM scanner_billet(v_scan, v_qr_a, test_p17.id('evt_a'), timestamptz '1970-01-01 00:00:00+00');
    ASSERT r.resultat = 'ok' AND r.billet_id = v_billet_a AND r.titulaire IS NOT NULL, 'scan légitime : ok avec titulaire';
    ASSERT r.scanne_a >= now() - interval '7 days 1 minute', format('heure passée bornée à -7 j, obtenu %s', r.scanne_a);
    SELECT * INTO r FROM scanner_billet(gen_random_uuid(), v_qr_a, test_p17.id('evt_a'), now() + interval '10 years');
    ASSERT r.resultat = 'doublon' AND r.scanne_a <= now() + interval '6 minutes',
        format('heure future bornée à +5 min, obtenu %s', r.scanne_a);

    -- L'organisateur B rejoue l'identifiant de scan de A : refusé, la réponse de A n'est pas divulguée.
    PERFORM test_p17.endosser('billetto_organisateur', test_p17.id('staff_b'));
    PERFORM test_p17.refuse(format('SELECT * FROM scanner_billet(%L, %L, %s)', v_scan, 'x', test_p17.id('evt_b')),
        'BT052', 'rejeu d''un identifiant de scan d''un autre événement');

    PERFORM test_p17.reprendre();
    RAISE NOTICE 'OK check-in : aucune fuite entre événements, heure de scan bornée';
END $$;

-- =============================================================================
-- 7. places_restantes et reporting
-- =============================================================================
DO $$
BEGIN
    PERFORM test_p17.endosser('billetto_visiteur', test_p17.id('acheteur'));
    ASSERT places_restantes(test_p17.id('tarif_brouillon')) IS NULL, 'visiteur : tarif d''un brouillon invisible';
    ASSERT places_restantes(test_p17.id('tarif_b')) IS NOT NULL, 'visiteur : tarif publié visible';

    PERFORM test_p17.endosser('billetto_organisateur', test_p17.id('staff_a'));
    ASSERT places_restantes(test_p17.id('tarif_brouillon')) IS NULL, 'organisateur A : brouillon de B invisible';

    PERFORM test_p17.endosser('billetto_organisateur', test_p17.id('staff_b'));
    ASSERT places_restantes(test_p17.id('tarif_brouillon')) = 40, 'organisateur B : son brouillon';

    PERFORM test_p17.endosser('billetto_admin', test_p17.id('admin'));
    ASSERT places_restantes(test_p17.id('tarif_brouillon')) = 40, 'admin : tous les tarifs';

    PERFORM test_p17.reprendre();
    ASSERT places_restantes(test_p17.id('tarif_brouillon')) = 40, 'maintenance : tous les tarifs';

    ASSERT NOT has_column_privilege('billetto_readonly', 'billets', 'code', 'SELECT'), 'reporting : pas de code de billet';
    ASSERT NOT has_column_privilege('billetto_readonly', 'billets', 'code_verification', 'SELECT'),
        'reporting : pas de signature de billet';
    ASSERT NOT has_column_privilege('billetto_bi', 'billets', 'code_verification', 'SELECT'), 'BI : pas de signature de billet';
    ASSERT has_column_privilege('billetto_readonly', 'billets', 'prix_paye', 'SELECT'), 'reporting : montants lisibles';
    RAISE NOTICE 'OK places_restantes limitée aux tarifs visibles ; reporting sans codes de billets';
END $$;

-- =============================================================================
-- 8. Authentification
-- =============================================================================
DO $$
DECLARE
    v_email text := 'test-p17-acheteur@billetto.test';
    v_user bigint := test_p17.id('acheteur');
    v_version integer;
    i integer;
BEGIN
    ASSERT NOT (SELECT verrouille FROM authentification_utilisateur(v_email)), 'compte non verrouillé au départ';

    -- 9 échecs : toujours ouvert ; le 10e verrouille 5 minutes.
    FOR i IN 1..9 LOOP PERFORM enregistrer_echec_connexion(v_email); END LOOP;
    ASSERT NOT (SELECT verrouille FROM authentification_utilisateur(v_email)), '9 échecs : pas encore verrouillé';
    PERFORM enregistrer_echec_connexion(upper(v_email));
    ASSERT (SELECT verrouille FROM authentification_utilisateur(v_email)), '10 échecs : verrouillé';
    ASSERT (SELECT verrouille_jusqu_a BETWEEN now() + interval '4 minutes' AND now() + interval '6 minutes'
            FROM utilisateurs WHERE id = v_user), 'verrou de 5 minutes';

    -- Une adresse inconnue ne provoque ni erreur ni effet.
    PERFORM enregistrer_echec_connexion('inconnu-p17@billetto.test');

    -- Le verrou expire de lui-même, et une connexion réussie remet le compteur à zéro.
    UPDATE utilisateurs SET verrouille_jusqu_a = now() - interval '1 second' WHERE id = v_user;
    ASSERT NOT (SELECT verrouille FROM authentification_utilisateur(v_email)), 'verrou expiré';
    PERFORM enregistrer_echec_connexion(v_email);
    PERFORM reinitialiser_echecs_connexion(v_user);
    ASSERT (SELECT echecs_connexion = 0 AND verrouille_jusqu_a IS NULL FROM utilisateurs WHERE id = v_user),
        'compteur remis à zéro';

    -- Révocation des sessions : pour soi uniquement.
    SELECT auth_version INTO v_version FROM utilisateurs WHERE id = v_user;
    PERFORM test_p17.endosser('billetto_visiteur', v_user);
    PERFORM revoquer_sessions(v_user);
    PERFORM test_p17.refuse(format('SELECT revoquer_sessions(%s)', test_p17.id('autre')), 'BT013',
        'révocation des sessions d''un autre');
    PERFORM test_p17.refuse('SELECT enregistrer_echec_connexion(''x@billetto.test'')', '42501',
        'verrouillage réservé à billetto_app');
    PERFORM test_p17.refuse('SELECT echecs_connexion FROM utilisateurs', '42501', 'compteur d''échecs illisible');
    PERFORM test_p17.reprendre();
    ASSERT (SELECT auth_version FROM utilisateurs WHERE id = v_user) = v_version + 1, 'sessions révoquées (auth_version + 1)';

    ASSERT has_function_privilege('billetto_app', 'enregistrer_echec_connexion(text)', 'EXECUTE')
       AND has_function_privilege('billetto_app', 'reinitialiser_echecs_connexion(bigint)', 'EXECUTE')
       AND has_function_privilege('billetto_app', 'authentification_utilisateur(text)', 'EXECUTE'),
        'billetto_app : fonctions d''authentification';
    RAISE NOTICE 'OK authentification : verrouillage temporaire et révocation des sessions';
END $$;

-- Dernier administrateur : la rétrogradation est refusée tant qu'il est seul.
DO $$
BEGIN
    UPDATE utilisateurs SET role_app = 'visitor' WHERE role_app = 'admin' AND id <> test_p17.id('admin');
    PERFORM test_p17.refuse(format('UPDATE utilisateurs SET role_app = ''visitor'' WHERE id = %s', test_p17.id('admin')),
        'BT060', 'rétrogradation du dernier administrateur');
    UPDATE utilisateurs SET role_app = 'admin' WHERE id = test_p17.id('autre');
    UPDATE utilisateurs SET role_app = 'visitor' WHERE id = test_p17.id('admin');
    ASSERT (SELECT role_app FROM utilisateurs WHERE id = test_p17.id('admin')) = 'visitor',
        'rétrogradation possible quand un autre administrateur existe';
    RAISE NOTICE 'OK dernier administrateur protégé';
END $$;

ROLLBACK;
