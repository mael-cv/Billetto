-- =============================================================================
-- Tests phase 05 — rôles, privilèges, RLS, vues security_invoker
--
-- Simule le parcours de l'API : SET LOCAL ROLE billetto_app, puis SET LOCAL
-- ROLE <rôle métier>, puis set_config('app.user_id', …, true).
-- Les assistants de test sont dans un schéma temporaire accessible à tous les
-- rôles ; tout est annulé par ROLLBACK.
-- Le cas « connexion réelle billetto_app sans contexte » est couvert par
-- database/scripts/security-login.mjs (nécessite une session non superutilisateur).
-- =============================================================================

BEGIN;

CREATE SCHEMA test_securite;
GRANT USAGE ON SCHEMA test_securite TO PUBLIC;

CREATE TABLE test_securite.fx (cle text PRIMARY KEY, id bigint);
GRANT SELECT ON test_securite.fx TO PUBLIC;

CREATE FUNCTION test_securite.id(p_cle text) RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT id FROM test_securite.fx WHERE cle = p_cle $$;

-- Endosse un rôle métier comme le fait l'API.
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

-- Échec attendu avec un SQLSTATE précis (exécuté avec le rôle courant).
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

-- Nombre de lignes renvoyées par une requête, avec le rôle courant.
CREATE FUNCTION test_securite.nb(p_sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
    EXECUTE format('SELECT count(*) FROM (%s) s', p_sql) INTO n;
    RETURN n;
END $$;

-- La migration 005 retire EXECUTE à PUBLIC par défaut sur toute nouvelle fonction.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test_securite TO PUBLIC;

-- -----------------------------------------------------------------------------
-- Jeu d'essai (superutilisateur)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_orga_a bigint; v_orga_b bigint; v_user_a bigint; v_user_b bigint;
    v_visiteur bigint; v_autre bigint; v_evt bigint; v_tarif bigint;
BEGIN
    -- Deux organisateurs du seed ayant chacun des événements
    SELECT u.id, u.organisateur_id INTO v_user_a, v_orga_a
    FROM utilisateurs u
    WHERE u.role_app = 'organizer'
      AND EXISTS (SELECT 1 FROM evenements e WHERE e.organisateur_id = u.organisateur_id)
    ORDER BY u.id LIMIT 1;
    SELECT u.id, u.organisateur_id INTO v_user_b, v_orga_b
    FROM utilisateurs u
    WHERE u.role_app = 'organizer' AND u.organisateur_id <> v_orga_a
      AND EXISTS (SELECT 1 FROM evenements e WHERE e.organisateur_id = u.organisateur_id)
    ORDER BY u.id LIMIT 1;

    -- Deux visiteurs ayant des commandes
    SELECT min(c.utilisateur_id) INTO v_visiteur
    FROM commandes c JOIN utilisateurs u ON u.id = c.utilisateur_id WHERE u.role_app = 'visitor';
    SELECT min(c.utilisateur_id) INTO v_autre
    FROM commandes c JOIN utilisateurs u ON u.id = c.utilisateur_id
    WHERE u.role_app = 'visitor' AND c.utilisateur_id > v_visiteur;

    -- Événement à venir de l'organisateur A, en vente
    INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
    VALUES (v_orga_a, (SELECT min(id) FROM lieux), (SELECT min(id) FROM type_evenements),
            'Sécurité futur', 'securite-futur', now() + interval '30 days', now() + interval '31 days', 'published')
    RETURNING id INTO v_evt;
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
    VALUES (v_evt, 'Standard', 15, 100, now() - interval '1 day', now() + interval '29 days')
    RETURNING id INTO v_tarif;

    INSERT INTO test_securite.fx VALUES
        ('orga_a', v_orga_a), ('orga_b', v_orga_b), ('user_a', v_user_a), ('user_b', v_user_b),
        ('visiteur', v_visiteur), ('autre', v_autre), ('admin', (SELECT min(id) FROM utilisateurs WHERE role_app = 'admin')),
        ('evt_a', v_evt), ('tarif_a', v_tarif),
        ('evt_b', (SELECT min(id) FROM evenements WHERE organisateur_id = v_orga_b)),
        ('commande_autre', (SELECT min(id) FROM commandes WHERE utilisateur_id = v_autre));

    ASSERT v_user_a IS NOT NULL AND v_user_b IS NOT NULL AND v_visiteur IS NOT NULL AND v_autre IS NOT NULL,
        'jeu d''essai incomplet';
END $$;

-- Valeurs attendues calculées sans restriction
CREATE TABLE test_securite.attendu AS
SELECT
    (SELECT count(*) FROM evenements) AS evenements_total,
    (SELECT count(*) FROM evenements WHERE statut IN ('published', 'finished')) AS evenements_publics,
    (SELECT count(*) FROM evenements WHERE organisateur_id = test_securite.id('orga_a')) AS evenements_a,
    (SELECT count(*) FROM tarifs t JOIN evenements e ON e.id = t.evenement_id
     WHERE e.organisateur_id = test_securite.id('orga_a')) AS tarifs_a,
    (SELECT count(*) FROM billets b JOIN tarifs t ON t.id = b.tarif_id JOIN evenements e ON e.id = t.evenement_id
     WHERE e.organisateur_id = test_securite.id('orga_a')) AS billets_a,
    (SELECT coalesce(sum(v.ca), 0) FROM v_ventes_par_evenement v
     WHERE v.organisateur_id = test_securite.id('orga_a')) AS ca_a,
    (SELECT count(*) FROM commandes WHERE utilisateur_id = test_securite.id('visiteur')) AS commandes_visiteur,
    (SELECT count(*) FROM billets WHERE utilisateur_id = test_securite.id('visiteur')) AS billets_visiteur,
    (SELECT count(*) FROM paiements p JOIN commandes c ON c.id = p.commande_id
     WHERE c.utilisateur_id = test_securite.id('visiteur')) AS paiements_visiteur,
    (SELECT count(*) FROM commandes) AS commandes_total;
GRANT SELECT ON test_securite.attendu TO PUBLIC;

-- =============================================================================
-- billetto_app seul : aucun droit
-- =============================================================================
DO $$
BEGIN
    RESET ROLE;
    SET LOCAL ROLE billetto_app;
    PERFORM test_securite.refuse('SELECT * FROM evenements', '42501', 'billetto_app sans SET ROLE : lecture evenements');
    PERFORM test_securite.refuse('SELECT * FROM lieux', '42501', 'billetto_app sans SET ROLE : lecture lieux');
    PERFORM test_securite.refuse(
        format('INSERT INTO billets (tarif_id, commande_id, utilisateur_id, prix_paye) VALUES (%s, 1, 1, 0)', test_securite.id('tarif_a')),
        '42501', 'billetto_app : INSERT billets');
    PERFORM test_securite.refuse('SELECT acheter_billet(1, 1, 1)', '42501', 'billetto_app : acheter_billet sans rôle métier');

    ASSERT (SELECT count(*) FROM authentification_utilisateur('user1@billetto.test')) = 1,
        'billetto_app : authentification_utilisateur autorisée';
    RAISE NOTICE 'OK [billetto_app] authentification_utilisateur autorisée';
    PERFORM test_securite.reprendre();
END $$;

-- =============================================================================
-- Visiteur
-- =============================================================================
DO $$
DECLARE
    a test_securite.attendu%ROWTYPE;
    v_achat record;
BEGIN
    SELECT * INTO a FROM test_securite.attendu;
    PERFORM test_securite.endosser('billetto_visiteur', test_securite.id('visiteur'));

    -- Catalogue : uniquement publié / terminé
    ASSERT test_securite.nb('SELECT 1 FROM evenements') = a.evenements_publics,
        format('visiteur : %s événements publics attendus', a.evenements_publics);
    ASSERT test_securite.nb('SELECT 1 FROM evenements WHERE statut IN (''draft'', ''cancelled'')') = 0,
        'visiteur : aucun brouillon ni annulé';
    ASSERT test_securite.nb('SELECT 1 FROM tarifs t WHERE NOT t.actif') = 0, 'visiteur : aucun tarif inactif';
    RAISE NOTICE 'OK [visiteur] catalogue limité aux événements publiés (%)', a.evenements_publics;

    -- Ses données uniquement
    ASSERT test_securite.nb('SELECT 1 FROM commandes') = a.commandes_visiteur, 'visiteur : ses commandes';
    ASSERT test_securite.nb('SELECT 1 FROM billets') = a.billets_visiteur, 'visiteur : ses billets';
    ASSERT test_securite.nb('SELECT 1 FROM paiements') = a.paiements_visiteur, 'visiteur : ses paiements';
    ASSERT test_securite.nb('SELECT 1 FROM utilisateurs') = 1, 'visiteur : sa seule ligne utilisateur';
    ASSERT test_securite.nb(format('SELECT 1 FROM commandes WHERE utilisateur_id = %s', test_securite.id('autre'))) = 0,
        'visiteur : aucune commande d''un autre';
    RAISE NOTICE 'OK [visiteur] commandes %, billets %, paiements % : uniquement les siens',
        a.commandes_visiteur, a.billets_visiteur, a.paiements_visiteur;

    -- Colonnes et écritures interdites
    PERFORM test_securite.refuse('SELECT email FROM utilisateurs', '42501', 'lecture utilisateurs.email');
    PERFORM test_securite.refuse('SELECT password_hash FROM utilisateurs', '42501', 'lecture utilisateurs.password_hash');
    PERFORM test_securite.refuse('SELECT email FROM organisateurs', '42501', 'lecture organisateurs.email');
    PERFORM test_securite.refuse(format('UPDATE evenements SET nom = ''pirate'' WHERE id = %s', test_securite.id('evt_a')),
                                 '42501', 'modification d''un événement');
    PERFORM test_securite.refuse('DELETE FROM tarifs', '42501', 'suppression de tarifs');
    PERFORM test_securite.refuse(
        format('INSERT INTO billets (tarif_id, commande_id, utilisateur_id, prix_paye) VALUES (%s, 1, %s, 0)',
               test_securite.id('tarif_a'), test_securite.id('visiteur')),
        '42501', 'INSERT direct dans billets');
    PERFORM test_securite.refuse(format('UPDATE commandes SET statut = ''refunded'' WHERE utilisateur_id = %s', test_securite.id('visiteur')),
                                 '42501', 'UPDATE direct de ses commandes');
    PERFORM test_securite.refuse('SELECT * FROM mv_ventes_quotidiennes', '42501', 'lecture de la vue matérialisée');
    PERFORM test_securite.refuse('SELECT * FROM v_ventes_par_evenement', '42501', 'lecture des vues de ventes');
    PERFORM test_securite.refuse('SELECT ca_evenement(1)', '42501', 'ca_evenement');
    PERFORM test_securite.refuse('SELECT * FROM journal_tarifs', '42501', 'lecture du journal d''audit');
    PERFORM test_securite.refuse('SELECT * FROM authentification_utilisateur(''user1@billetto.test'')', '42501',
                                 'authentification_utilisateur réservée à billetto_app');
    PERFORM test_securite.refuse(format('CALL admin_rembourser_commande(%s)', test_securite.id('commande_autre')),
                                 '42501', 'admin_rembourser_commande');

    -- Fonctions métier : pour soi uniquement
    SELECT * INTO v_achat FROM acheter_billet(test_securite.id('visiteur'), test_securite.id('tarif_a'), 2);
    ASSERT array_length(v_achat.billet_ids, 1) = 2, 'visiteur : achat pour soi';
    ASSERT test_securite.nb(format('SELECT 1 FROM billets WHERE commande_id = %s', v_achat.commande_id)) = 2,
        'visiteur : voit les billets qu''il vient d''acheter';
    RAISE NOTICE 'OK [visiteur] achat pour soi : commande %', v_achat.commande_id;

    PERFORM test_securite.refuse(format('SELECT acheter_billet(%s, %s, 1)', test_securite.id('autre'), test_securite.id('tarif_a')),
                                 'BT013', 'achat pour le compte d''un autre');
    PERFORM test_securite.refuse(format('SELECT * FROM billets_utilisateur(%s)', test_securite.id('autre')),
                                 'BT013', 'billets_utilisateur d''un autre');
    ASSERT (SELECT count(*) FROM billets_utilisateur(test_securite.id('visiteur'))) = a.billets_visiteur + 2,
        'visiteur : billets_utilisateur pour soi';
    PERFORM test_securite.refuse(format('CALL rembourser_commande(%s)', test_securite.id('commande_autre')),
                                 'BT013', 'remboursement de la commande d''un autre');

    EXECUTE format('CALL rembourser_commande(%s)', v_achat.commande_id);
    ASSERT (SELECT statut FROM commandes WHERE id = v_achat.commande_id) = 'refunded', 'visiteur : remboursement de sa commande';
    RAISE NOTICE 'OK [visiteur] remboursement de sa propre commande';

    PERFORM test_securite.reprendre();
END $$;

-- Visiteur sans contexte utilisateur : catalogue seulement
DO $$
BEGIN
    PERFORM test_securite.endosser('billetto_visiteur', NULL);
    ASSERT test_securite.nb('SELECT 1 FROM commandes') = 0, 'sans app.user_id : aucune commande';
    ASSERT test_securite.nb('SELECT 1 FROM billets') = 0, 'sans app.user_id : aucun billet';
    ASSERT test_securite.nb('SELECT 1 FROM utilisateurs') = 0, 'sans app.user_id : aucun utilisateur';
    ASSERT test_securite.nb('SELECT 1 FROM evenements WHERE statut NOT IN (''published'', ''finished'')') = 0,
        'sans app.user_id : aucun événement non publié';
    RAISE NOTICE 'OK [visiteur anonyme] catalogue public uniquement';
    PERFORM test_securite.reprendre();
END $$;

-- =============================================================================
-- Organisateur
-- =============================================================================
DO $$
DECLARE
    a test_securite.attendu%ROWTYPE;
    n bigint; v_evt bigint; v_ca numeric;
BEGIN
    SELECT * INTO a FROM test_securite.attendu;
    -- Recalcul : le bloc visiteur a acheté des billets sur un événement de A.
    SELECT count(*) INTO a.billets_a
    FROM billets b JOIN tarifs t ON t.id = b.tarif_id JOIN evenements e ON e.id = t.evenement_id
    WHERE e.organisateur_id = test_securite.id('orga_a');
    SELECT coalesce(sum(v.ca), 0) INTO a.ca_a
    FROM v_ventes_par_evenement v WHERE v.organisateur_id = test_securite.id('orga_a');
    PERFORM test_securite.endosser('billetto_organisateur', test_securite.id('user_a'));

    ASSERT test_securite.nb('SELECT 1 FROM evenements') = a.evenements_a,
        format('organisateur A : %s événements attendus, %s', a.evenements_a, test_securite.nb('SELECT 1 FROM evenements'));
    ASSERT test_securite.nb(format('SELECT 1 FROM evenements WHERE organisateur_id <> %s', test_securite.id('orga_a'))) = 0,
        'organisateur A : aucun événement d''un autre';
    ASSERT test_securite.nb('SELECT 1 FROM tarifs') = a.tarifs_a, 'organisateur A : tarifs de ses événements';
    ASSERT test_securite.nb('SELECT 1 FROM billets') = a.billets_a, 'organisateur A : billets de ses événements';
    RAISE NOTICE 'OK [organisateur A] événements %, tarifs %, billets % : uniquement les siens',
        a.evenements_a, a.tarifs_a, a.billets_a;

    -- Vues de ventes (security_invoker) : ses chiffres uniquement
    ASSERT test_securite.nb('SELECT 1 FROM v_ventes_par_evenement') = a.evenements_a, 'v_ventes : ses événements';
    SELECT coalesce(sum(ca), 0) INTO v_ca FROM v_ventes_par_evenement;
    ASSERT v_ca = a.ca_a, format('v_ventes : CA %s attendu, %s', a.ca_a, v_ca);
    ASSERT test_securite.nb('SELECT 1 FROM v_remplissage') = a.evenements_a, 'v_remplissage : ses événements';
    ASSERT ca_evenement(test_securite.id('evt_b')) = 0, 'ca_evenement d''un autre organisateur : 0 (RLS)';
    RAISE NOTICE 'OK [organisateur A] vues de ventes filtrées (CA %)', v_ca;

    -- Écritures sur ses événements
    INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
    VALUES (test_securite.id('orga_a'), (SELECT min(id) FROM lieux), (SELECT min(id) FROM type_evenements),
            'Créé par A', 'cree-par-a', now() + interval '60 days', now() + interval '61 days', 'draft')
    RETURNING id INTO v_evt;
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
    VALUES (v_evt, 'Standard', 30, 50, now(), now() + interval '59 days');
    UPDATE tarifs SET prix = 35 WHERE evenement_id = v_evt;
    INSERT INTO evenement_attributs (evenement_id, cle, valeur) VALUES (v_evt, 'parking', 'oui');
    UPDATE evenements SET statut = 'published' WHERE id = v_evt;
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 1, 'organisateur A : publication de son événement';
    RAISE NOTICE 'OK [organisateur A] création événement + tarif + attribut, modification, publication';

    -- Écritures sur les événements d'un autre
    UPDATE evenements SET nom = 'piraté' WHERE id = test_securite.id('evt_b');
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'UPDATE de l''événement de B : 0 ligne (invisible via RLS)';
    DELETE FROM evenements WHERE id = test_securite.id('evt_b');
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'DELETE de l''événement de B : 0 ligne';
    RAISE NOTICE 'OK [organisateur A] UPDATE/DELETE sur les événements de B : 0 ligne affectée';

    PERFORM test_securite.refuse(
        format('INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin) VALUES (%s, 1, 1, ''x'', ''usurpation'', now() + interval ''1 day'', now() + interval ''2 days'')',
               test_securite.id('orga_b')),
        '42501', 'création d''un événement au nom de B (WITH CHECK)');
    PERFORM test_securite.refuse(
        format('INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente) VALUES (%s, ''Intrus'', 1, 1, now(), now() + interval ''1 day'')',
               test_securite.id('evt_b')),
        '42501', 'ajout d''un tarif à l''événement de B');
    PERFORM test_securite.refuse(format('UPDATE evenements SET organisateur_id = %s WHERE id = %s', test_securite.id('orga_b'), v_evt),
                                 '42501', 'changement de propriétaire (pas de GRANT UPDATE sur la colonne)');
    PERFORM test_securite.refuse('INSERT INTO commandes (utilisateur_id) VALUES (1)', '42501', 'INSERT direct dans commandes');
    PERFORM test_securite.refuse('SELECT * FROM paiements', '42501', 'lecture des paiements');
    PERFORM test_securite.refuse('SELECT email FROM utilisateurs', '42501', 'lecture des e-mails');
    PERFORM test_securite.refuse('SELECT * FROM mv_ventes_quotidiennes', '42501', 'vue matérialisée globale');

    PERFORM test_securite.reprendre();

    -- L'audit a enregistré l'organisateur comme auteur (trigger SECURITY DEFINER)
    ASSERT EXISTS (SELECT 1 FROM journal_tarifs j JOIN tarifs t ON t.id = j.tarif_id
                   WHERE t.evenement_id = v_evt AND j.auteur = test_securite.id('user_a')::text
                     AND j.ancien_prix = 30 AND j.nouveau_prix = 35),
        'journal_tarifs : auteur = utilisateur applicatif de l''organisateur';
    RAISE NOTICE 'OK audit : modification de prix par l''organisateur journalisée avec son identifiant';
END $$;

-- Organisateur B ne voit pas les données de A
DO $$
BEGIN
    PERFORM test_securite.endosser('billetto_organisateur', test_securite.id('user_b'));
    ASSERT test_securite.nb(format('SELECT 1 FROM evenements WHERE organisateur_id = %s', test_securite.id('orga_a'))) = 0,
        'organisateur B : aucun événement de A';
    ASSERT test_securite.nb(format('SELECT 1 FROM tarifs WHERE id = %s', test_securite.id('tarif_a'))) = 0,
        'organisateur B : aucun tarif de A';
    RAISE NOTICE 'OK [organisateur B] événements et tarifs de A invisibles';
    PERFORM test_securite.reprendre();
END $$;

-- Organisateur sans contexte : rien
DO $$
BEGIN
    PERFORM test_securite.endosser('billetto_organisateur', NULL);
    ASSERT test_securite.nb('SELECT 1 FROM evenements') = 0, 'organisateur sans app.user_id : aucun événement';
    ASSERT test_securite.nb('SELECT 1 FROM billets') = 0, 'organisateur sans app.user_id : aucun billet';
    RAISE NOTICE 'OK [organisateur sans contexte] aucune ligne';
    PERFORM test_securite.reprendre();
END $$;

-- Un visiteur qui se fait passer pour organisateur (mauvais rôle métier)
DO $$
BEGIN
    PERFORM test_securite.endosser('billetto_organisateur', test_securite.id('visiteur'));
    ASSERT test_securite.nb('SELECT 1 FROM evenements') = 0,
        'utilisateur visitor sous le rôle organisateur : app_organisateur_id() NULL → aucun événement';
    RAISE NOTICE 'OK [organisateur usurpé] un compte visitor n''obtient aucun événement';
    PERFORM test_securite.reprendre();
END $$;

-- =============================================================================
-- Fuite via une vue sans security_invoker
-- =============================================================================
DO $$
DECLARE
    a test_securite.attendu%ROWTYPE;
    n_fuite bigint; n_corrige bigint;
BEGIN
    SELECT * INTO a FROM test_securite.attendu;

    -- Comportement par défaut d'une vue : droits de son propriétaire (superutilisateur → RLS ignorée)
    ALTER VIEW v_ventes_par_evenement SET (security_invoker = false);
    PERFORM test_securite.endosser('billetto_organisateur', test_securite.id('user_a'));
    n_fuite := test_securite.nb('SELECT 1 FROM v_ventes_par_evenement');
    PERFORM test_securite.reprendre();

    ALTER VIEW v_ventes_par_evenement SET (security_invoker = true);
    PERFORM test_securite.endosser('billetto_organisateur', test_securite.id('user_a'));
    n_corrige := test_securite.nb('SELECT 1 FROM v_ventes_par_evenement');
    PERFORM test_securite.reprendre();

    -- evenements_total inclut l'événement créé par le jeu d'essai (+1 pour celui de l'organisateur A créé plus haut)
    ASSERT n_fuite >= a.evenements_total, format('fuite attendue : %s lignes visibles', n_fuite);
    ASSERT n_corrige = a.evenements_a + 1, format('après correction : %s lignes attendues, %s', a.evenements_a + 1, n_corrige);
    RAISE NOTICE 'OK fuite démontrée : security_invoker=false → % événements (tous) ; security_invoker=true → % (les siens)',
        n_fuite, n_corrige;
END $$;

-- =============================================================================
-- Administrateur
-- =============================================================================
DO $$
DECLARE
    a test_securite.attendu%ROWTYPE;
    v_cmd bigint;
BEGIN
    SELECT * INTO a FROM test_securite.attendu;

    -- Commande d'un visiteur sur l'événement à venir (remboursable)
    SELECT commande_id INTO v_cmd FROM acheter_billet(test_securite.id('autre'), test_securite.id('tarif_a'), 1);

    PERFORM test_securite.endosser('billetto_admin', test_securite.id('admin'));
    ASSERT test_securite.nb('SELECT 1 FROM evenements') >= a.evenements_total, 'admin : tous les événements';
    ASSERT test_securite.nb('SELECT 1 FROM commandes') >= a.commandes_total, 'admin : toutes les commandes';
    ASSERT test_securite.nb('SELECT email FROM utilisateurs') > 1, 'admin : lecture des e-mails';
    PERFORM test_securite.refuse('SELECT password_hash FROM utilisateurs', '42501', 'admin : lecture des mots de passe');
    PERFORM test_securite.refuse('INSERT INTO billets (tarif_id, commande_id, utilisateur_id, prix_paye) VALUES (1, 1, 1, 0)',
                                 '42501', 'admin : INSERT direct dans billets');
    PERFORM test_securite.refuse(format('CALL rembourser_commande(%s)', v_cmd), 'BT013',
                                 'admin : rembourser_commande reste limité au propriétaire');

    EXECUTE format('CALL admin_rembourser_commande(%s)', v_cmd);
    ASSERT (SELECT statut FROM commandes WHERE id = v_cmd) = 'refunded', 'admin : remboursement d''une commande quelconque';
    RAISE NOTICE 'OK [admin] accès global, pas de mots de passe, admin_rembourser_commande';
    PERFORM test_securite.reprendre();
END $$;

-- =============================================================================
-- Lecture seule (reporting)
-- =============================================================================
DO $$
DECLARE
    a test_securite.attendu%ROWTYPE;
BEGIN
    SELECT * INTO a FROM test_securite.attendu;
    RESET ROLE;
    SET LOCAL ROLE billetto_readonly;
    ASSERT test_securite.nb('SELECT 1 FROM evenements') >= a.evenements_total, 'readonly : tous les événements';
    ASSERT test_securite.nb('SELECT 1 FROM mv_ventes_quotidiennes') > 0, 'readonly : vue matérialisée';
    PERFORM test_securite.refuse('SELECT email FROM utilisateurs', '42501', 'readonly : e-mails');
    PERFORM test_securite.refuse('INSERT INTO lieux (nom, adresse, ville, code_postal, capacite) VALUES (''x'', ''x'', ''x'', ''00000'', 1)',
                                 '42501', 'readonly : écriture');
    PERFORM test_securite.refuse('SELECT acheter_billet(1, 1, 1)', '42501', 'readonly : achat');
    RAISE NOTICE 'OK [readonly] lecture globale sans données personnelles ni écriture';
    RESET ROLE;
END $$;

-- =============================================================================
-- Métadonnées
-- =============================================================================
DO $$
DECLARE
    n bigint;
BEGIN
    SELECT count(*) INTO n FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('evenements', 'tarifs', 'evenement_attributs', 'commandes', 'billets', 'paiements', 'amities', 'utilisateurs')
      AND relrowsecurity AND relforcerowsecurity;
    ASSERT n = 8, format('RLS ENABLE + FORCE attendu sur 8 tables, %s', n);

    SELECT count(*) INTO n FROM pg_roles
    WHERE rolname IN ('billetto_visiteur', 'billetto_organisateur', 'billetto_admin', 'billetto_readonly', 'billetto_app')
      AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb);
    ASSERT n = 0, 'aucun rôle billetto_* privilégié';

    SELECT count(*) INTO n FROM pg_roles
    WHERE rolname IN ('billetto_visiteur', 'billetto_organisateur', 'billetto_admin', 'billetto_readonly') AND rolcanlogin;
    ASSERT n = 0, 'rôles métier NOLOGIN';

    SELECT count(*) INTO n FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND has_function_privilege('public', p.oid, 'EXECUTE');
    ASSERT n = 0, format('%s fonction(s) exécutable(s) par PUBLIC', n);

    SELECT count(*) INTO n FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND NOT coalesce('search_path=public, pg_temp' = ANY (p.proconfig), false);
    ASSERT n = 0, format('%s fonction(s) SECURITY DEFINER sans search_path figé', n);

    SELECT count(*) INTO n FROM pg_class
    WHERE relname IN ('v_ventes_par_evenement', 'v_remplissage', 'v_classement_lieux')
      AND 'security_invoker=true' = ANY (reloptions);
    ASSERT n = 3, 'security_invoker=true sur les 3 vues';

    ASSERT NOT has_table_privilege('public', 'utilisateurs', 'SELECT'), 'PUBLIC sans SELECT sur utilisateurs';
    ASSERT NOT has_database_privilege('public', current_database(), 'CONNECT'), 'PUBLIC sans CONNECT';
    RAISE NOTICE 'OK métadonnées : RLS forcée, rôles non privilégiés, PUBLIC sans droits, search_path figé, vues invoker';
END $$;

ROLLBACK;
