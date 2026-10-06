-- =============================================================================
-- Tests phase 15 — annulation self-service, fuseaux, outbox e-mails, export
-- Jeu d'essai propre, annulé par ROLLBACK.
-- =============================================================================

BEGIN;

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_code text, p_label text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_code THEN
            RAISE NOTICE 'OK % → % (%)', p_label, SQLSTATE, SQLERRM;
            RETURN;
        END IF;
        RAISE EXCEPTION '% : SQLSTATE % attendu, obtenu % (%)', p_label, p_code, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION '% : une erreur % était attendue, aucune levée', p_label, p_code;
END;
$$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'ÉCHEC %', p_label;
    END IF;
    RAISE NOTICE 'OK %', p_label;
END;
$$;

CREATE TEMP TABLE fx (cle text PRIMARY KEY, id bigint) ON COMMIT DROP;
CREATE FUNCTION pg_temp.fx(p_cle text) RETURNS bigint LANGUAGE sql STABLE AS
    $$ SELECT id FROM fx WHERE cle = p_cle $$;

-- -----------------------------------------------------------------------------
-- Jeu d'essai : événement lointain (délai 48 h par défaut) et événement dans
-- 24 h avec un délai de 72 h (annulation déjà fermée).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_orga bigint; v_orga2 bigint; v_lieu bigint; v_loin bigint; v_proche bigint; v_t_loin bigint; v_t_proche bigint;
    v_user bigint; v_autre bigint; v_id bigint;
BEGIN
    INSERT INTO organisateurs (nom, email, slug) VALUES ('Test Orga P15', 'test-orga-p15@billetto.test', 'test-orga-p15')
    RETURNING id INTO v_orga;
    INSERT INTO organisateurs (nom, email, slug) VALUES ('Test Orga P15 bis', 'test-orga-p15b@billetto.test', 'test-orga-p15b')
    RETURNING id INTO v_orga2;
    INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
    VALUES ('Test Salle P15', '1 rue du Test', 'Testville', '99000', 500) RETURNING id INTO v_lieu;
    INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
    VALUES (v_orga, v_lieu, (SELECT min(id) FROM type_evenements), 'P15 loin', 'test-p15-loin',
            now() + interval '30 days', now() + interval '31 days', 'published') RETURNING id INTO v_loin;
    INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut,
                            delai_annulation, en_ligne, fuseau_horaire)
    VALUES (v_orga, v_lieu, (SELECT min(id) FROM type_evenements), 'P15 proche', 'test-p15-proche',
            now() + interval '24 hours', now() + interval '26 hours', 'published',
            interval '72 hours', true, 'America/New_York') RETURNING id INTO v_proche;
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
    VALUES (v_loin, 'Standard', 20, 10, now() - interval '1 day', now() + interval '29 days') RETURNING id INTO v_t_loin;
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
    VALUES (v_proche, 'Standard', 20, 10, now() - interval '1 day', now() + interval '23 hours') RETURNING id INTO v_t_proche;

    INSERT INTO utilisateurs (email, password_hash, prenom, nom) VALUES ('test-p15@billetto.test', 'x', 'Alix', 'Durand')
    RETURNING id INTO v_user;
    INSERT INTO utilisateurs (email, password_hash, prenom, nom) VALUES ('test-p15-b@billetto.test', 'x', 'Bao', 'Martin')
    RETURNING id INTO v_autre;
    INSERT INTO utilisateurs (email, password_hash, prenom, nom, role_app, organisateur_id)
    VALUES ('test-p15-orga2@billetto.test', 'x', 'Orga', 'Deux', 'organizer', v_orga2) RETURNING id INTO v_id;
    INSERT INTO fx VALUES ('loin', v_loin), ('proche', v_proche), ('t_loin', v_t_loin), ('t_proche', v_t_proche),
                          ('user', v_user), ('autre', v_autre), ('orga2', v_id);

    INSERT INTO fx SELECT 'cmd_loin', commande_id FROM acheter_billet(v_user, v_t_loin, 2);
    INSERT INTO fx SELECT 'cmd_proche', commande_id FROM acheter_billet(v_user, v_t_proche, 1);
    INSERT INTO fx SELECT 'cmd_proche2', commande_id FROM acheter_billet(v_autre, v_t_proche, 1);
END $$;

-- -----------------------------------------------------------------------------
-- Annulation self-service et délai
-- -----------------------------------------------------------------------------
SELECT set_config('app.user_id', pg_temp.fx('user')::text, true);
SELECT pg_temp.check(
    limite_annulation(pg_temp.fx('cmd_loin')) = (SELECT debut - interval '48 hours' FROM evenements WHERE id = pg_temp.fx('loin')),
    'limite d''annulation = début - délai (48 h par défaut)');
SELECT pg_temp.check(limite_annulation(pg_temp.fx('cmd_proche2')) IS NULL,
                     'limite d''annulation d''une commande d''autrui : NULL');
SELECT pg_temp.expect_error(format('CALL rembourser_commande(%s)', pg_temp.fx('cmd_proche')),
                            'BT014', 'annulation refusée après le délai');
CALL rembourser_commande(pg_temp.fx('cmd_loin'));
SELECT pg_temp.check((SELECT statut = 'refunded' FROM commandes WHERE id = pg_temp.fx('cmd_loin')),
                     'annulation self-service acceptée avant le délai');
SELECT set_config('app.user_id', '', true);

-- L'admin n'est pas soumis au délai (seulement au début de l'événement).
CALL admin_rembourser_commande(pg_temp.fx('cmd_proche'));
SELECT pg_temp.check((SELECT statut = 'refunded' FROM commandes WHERE id = pg_temp.fx('cmd_proche')),
                     'admin : remboursement possible après le délai d''annulation');

-- -----------------------------------------------------------------------------
-- Fuseaux horaires
-- -----------------------------------------------------------------------------
SELECT pg_temp.expect_error(format('UPDATE evenements SET fuseau_horaire = ''Mars/Olympus'' WHERE id = %s', pg_temp.fx('loin')),
                            'BT015', 'fuseau inconnu refusé');
SELECT pg_temp.check(
    (SELECT to_char(debut AT TIME ZONE fuseau_horaire, 'HH24:MI') = to_char((debut AT TIME ZONE 'UTC') - interval '4 hours', 'HH24:MI')
          OR to_char(debut AT TIME ZONE fuseau_horaire, 'HH24:MI') = to_char((debut AT TIME ZONE 'UTC') - interval '5 hours', 'HH24:MI')
     FROM evenements WHERE id = pg_temp.fx('proche')),
    'instant stocké en UTC, converti vers le fuseau de l''événement (New York, UTC-4/-5)');
SELECT pg_temp.check(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'
                  AND table_name IN (SELECT table_name FROM information_schema.tables
                                     WHERE table_schema = 'public' AND table_type = 'BASE TABLE')),
    'aucune colonne timestamp sans fuseau dans les tables');

-- -----------------------------------------------------------------------------
-- Outbox e-mails
-- -----------------------------------------------------------------------------
SELECT pg_temp.check(
    (SELECT count(*) = 3 FROM emails_sortants
     WHERE type = 'commande_confirmee'
       AND commande_id IN (pg_temp.fx('cmd_loin'), pg_temp.fx('cmd_proche'), pg_temp.fx('cmd_proche2'))),
    'un e-mail de confirmation par commande payée');
SELECT pg_temp.check(
    NOT EXISTS (SELECT 1 FROM emails_sortants e JOIN commandes c ON c.id = e.commande_id
                WHERE c.id = pg_temp.fx('cmd_loin') AND e.utilisateur_id <> c.utilisateur_id),
    'e-mail adressé à l''acheteur');

DO $$
DECLARE v_res bigint; v_cmd bigint;
BEGIN
    SELECT reservation_id INTO v_res FROM creer_reservation(pg_temp.fx('autre'), pg_temp.fx('t_loin'), 1, 'virement');
    PERFORM pg_temp.check((SELECT count(*) = 1 FROM emails_sortants WHERE utilisateur_id = pg_temp.fx('autre')),
                          'hold (virement en attente) : pas encore d''e-mail');
    SELECT commande_id INTO v_cmd FROM confirmer_reservation(v_res, pg_temp.fx('autre'));
    PERFORM pg_temp.check((SELECT count(*) = 1 FROM emails_sortants WHERE commande_id = v_cmd),
                          'confirmer_reservation : un e-mail de confirmation');
    -- Passage à paid d'une commande existante : pas de second e-mail pour la même commande.
    UPDATE commandes SET statut = 'pending' WHERE id = v_cmd;
    UPDATE commandes SET statut = 'paid' WHERE id = v_cmd;
    PERFORM pg_temp.check((SELECT count(*) = 1 FROM emails_sortants WHERE commande_id = v_cmd),
                          'repassage à paid : pas de doublon d''e-mail');
END $$;

DO $$
DECLARE v_entree bigint; v_res bigint;
BEGIN
    INSERT INTO liste_attente (tarif_id, utilisateur_id, quantite_souhaitee)
    VALUES (pg_temp.fx('t_loin'), pg_temp.fx('user'), 1) RETURNING id INTO v_entree;
    INSERT INTO reservations (tarif_id, utilisateur_id, quantite, statut, mode_paiement, prix_unitaire, expire_a)
    VALUES (pg_temp.fx('t_loin'), pg_temp.fx('user'), 1, 'active', 'carte', 20, now() + interval '30 minutes')
    RETURNING id INTO v_res;
    UPDATE liste_attente SET statut = 'notifiee', reservation_id = v_res, notifie_a = now(), expire_a = now() + interval '30 minutes'
    WHERE id = v_entree;
    PERFORM pg_temp.check(
        (SELECT count(*) = 1 FROM emails_sortants WHERE type = 'offre_liste_attente' AND liste_attente_id = v_entree),
        'offre de liste d''attente : un e-mail « une place vous attend »');
END $$;

-- Prise des e-mails par le job : bail, contenu, résultat.
DO $$
DECLARE r record; v_n integer := 0;
BEGIN
    FOR r IN SELECT * FROM emails_a_envoyer(100) WHERE destinataire = 'test-p15@billetto.test' LOOP
        v_n := v_n + 1;
        IF r.type = 'commande_confirmee' THEN
            PERFORM pg_temp.check(jsonb_array_length(r.donnees -> 'billets') >= 1
                                  AND (r.donnees -> 'billets' -> 0 ->> 'qrPayload') LIKE 'BT1.%',
                                  'contenu : billets avec QR signé');
        END IF;
        PERFORM marquer_email(r.email_id, true);
    END LOOP;
    PERFORM pg_temp.check(v_n = 3, 'emails_a_envoyer : 3 e-mails pour l''utilisateur (2 commandes + 1 offre)');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM emails_a_envoyer(100) WHERE destinataire = 'test-p15@billetto.test'),
        'e-mails envoyés : plus repris');
END $$;

DO $$
DECLARE r record;
BEGIN
    -- Le lot précédent a aussi pris (bail de 5 min) les e-mails de cet utilisateur.
    UPDATE emails_sortants SET prochain_essai = now(), tentatives = 0 WHERE utilisateur_id = pg_temp.fx('autre');
    SELECT * INTO r FROM emails_a_envoyer(100) WHERE destinataire = 'test-p15-b@billetto.test' LIMIT 1;
    PERFORM marquer_email(r.email_id, false, 'SMTP indisponible');
    PERFORM pg_temp.check(
        (SELECT statut = 'a_envoyer' AND tentatives = 1 AND prochain_essai > now() AND derniere_erreur = 'SMTP indisponible'
         FROM emails_sortants WHERE id = r.email_id),
        'échec d''envoi : nouvel essai planifié (backoff)');
    UPDATE emails_sortants SET tentatives = 5, prochain_essai = now() WHERE id = r.email_id;
    PERFORM marquer_email(r.email_id, false, 'SMTP indisponible');
    PERFORM pg_temp.check((SELECT statut = 'echec' FROM emails_sortants WHERE id = r.email_id),
                          'échec définitif après 5 tentatives');
END $$;

-- -----------------------------------------------------------------------------
-- Export participants
-- -----------------------------------------------------------------------------
SELECT pg_temp.check(
    (SELECT count(*) = 2 AND bool_and(prenom = 'Alix' AND nom = 'Durand') AND bool_and(statut_commande = 'refunded')
     FROM participants_evenement(pg_temp.fx('loin')) WHERE commande_id = pg_temp.fx('cmd_loin')),
    'participants : billets, titulaire et statut de commande');
SELECT pg_temp.check(
    (SELECT count(*) FROM participants_evenement(pg_temp.fx('loin')))
        = (SELECT count(*) FROM billets b JOIN tarifs t ON t.id = b.tarif_id WHERE t.evenement_id = pg_temp.fx('loin')),
    'participants : un par billet de l''événement');
SELECT set_config('app.user_id', pg_temp.fx('orga2')::text, true);
SELECT pg_temp.expect_error(format('SELECT * FROM participants_evenement(%s)', pg_temp.fx('loin')),
                            'BT013', 'participants : organisateur d''un autre événement refusé');
SELECT set_config('app.user_id', '', true);

ROLLBACK;
