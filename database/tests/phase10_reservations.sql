-- =============================================================================
-- Tests phase 10 — réservation temporaire (hold) + TTL différencié
-- Jeu d'essai propre (dates relatives à now()), indépendant du seed.
-- Tout est annulé par ROLLBACK. La concurrence (holds simultanés, libération
-- après expiration) est testée par database/scripts/concurrency.mjs.
-- =============================================================================

BEGIN;

-- Vérifie qu'une instruction échoue avec le SQLSTATE attendu.
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

-- -----------------------------------------------------------------------------
-- Jeu d'essai
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE fx (cle text PRIMARY KEY, id bigint) ON COMMIT DROP;

DO $$
DECLARE
    v_orga bigint; v_lieu bigint; v_type bigint; v_evt bigint; d record;
BEGIN
    INSERT INTO organisateurs (nom, email, slug) VALUES ('Test Orga Holds', 'test-orga-holds@billetto.test', 'test-orga-holds')
    RETURNING id INTO v_orga;
    INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
    VALUES ('Test Salle Holds', '1 rue du Test', 'Testville', '99000', 500)
    RETURNING id INTO v_lieu;
    SELECT min(id) INTO v_type FROM type_evenements;
    INSERT INTO fx VALUES ('orga', v_orga), ('lieu', v_lieu);

    INSERT INTO utilisateurs (email, password_hash, prenom, nom)
    VALUES ('test-reservataire@billetto.test', 'x', 'Test', 'Reservataire')
    RETURNING id INTO v_evt;
    INSERT INTO fx VALUES ('user', v_evt);

    INSERT INTO utilisateurs (email, password_hash, prenom, nom)
    VALUES ('test-autre@billetto.test', 'x', 'Test', 'Autre')
    RETURNING id INTO v_evt;
    INSERT INTO fx VALUES ('autre_user', v_evt);

    -- Événements : à venir / commencé / brouillon
    FOR d IN SELECT * FROM (VALUES
        ('evt_futur',    'Test futur holds',    'test-futur-holds',    interval '30 days', interval '3 hours', 'published'),
        ('evt_commence', 'Test commencé holds', 'test-commence-holds', interval '-1 hour', interval '3 hours', 'published'),
        ('evt_draft',    'Test brouillon holds', 'test-brouillon-holds', interval '30 days', interval '1 day', 'draft')
    ) AS v(cle, nom, slug, decalage, duree, statut)
    LOOP
        INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
        VALUES (v_orga, v_lieu, v_type, d.nom, d.slug, now() + d.decalage, now() + d.decalage + d.duree, d.statut)
        RETURNING id INTO v_evt;
        INSERT INTO fx VALUES (d.cle, v_evt);
    END LOOP;

    -- Tarifs (fenêtres de vente relatives à now())
    FOR d IN SELECT * FROM (VALUES
        ('t_ok',       'evt_futur',    'Standard',   25.00, 5, interval '-1 day',   interval '29 days', true),
        ('t_inactif',  'evt_futur',    'Inactif',    25.00, 5, interval '-1 day',   interval '29 days', false),
        ('t_ferme',    'evt_futur',    'Pas ouvert', 25.00, 5, interval '1 day',    interval '29 days', true),
        ('t_commence', 'evt_commence', 'Standard',   25.00, 5, interval '-10 days', interval '-2 hours', true),
        ('t_draft',    'evt_draft',    'Standard',   25.00, 5, interval '-1 day',   interval '29 days', true)
    ) AS v(cle, evt, nom, prix, quota, debut_vente, fin_vente, actif)
    LOOP
        INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente, actif)
        VALUES ((SELECT id FROM fx WHERE cle = d.evt), d.nom, d.prix, d.quota,
                now() + d.debut_vente, now() + d.fin_vente, d.actif)
        RETURNING id INTO v_evt;
        INSERT INTO fx VALUES (d.cle, v_evt);
    END LOOP;
END $$;

-- Accès rapide aux identifiants dans les blocs DO
CREATE FUNCTION pg_temp.fx(p_cle text) RETURNS bigint LANGUAGE sql STABLE AS
    $$ SELECT id FROM fx WHERE cle = p_cle $$;

-- -----------------------------------------------------------------------------
-- creer_reservation : cas nominaux
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    r record; v_statut text; v_mode text;
BEGIN
    SELECT * INTO r FROM creer_reservation(pg_temp.fx('user'), pg_temp.fx('t_ok'), 2, 'carte');

    ASSERT r.reservation_id IS NOT NULL, 'reservation_id renvoyé';
    ASSERT r.montant_total = 50.00, format('montant 50.00 attendu, %s', r.montant_total);
    ASSERT r.expire_a BETWEEN now() + interval '14 minutes' AND now() + interval '16 minutes',
        format('TTL carte ≈ 15 min, obtenu %s', r.expire_a - now());

    SELECT statut, mode_paiement INTO v_statut, v_mode FROM reservations WHERE id = r.reservation_id;
    ASSERT v_statut = 'active' AND v_mode = 'carte', 'réservation active, mode carte';
    RAISE NOTICE 'OK hold carte : réservation % (expire %)', r.reservation_id, r.expire_a;
END $$;

DO $$
DECLARE
    r record;
BEGIN
    SELECT * INTO r FROM creer_reservation(pg_temp.fx('user'), pg_temp.fx('t_ok'), 1, 'virement');

    ASSERT r.expire_a BETWEEN now() + interval '71 hours' AND now() + interval '73 hours',
        format('TTL virement ≈ 72h, obtenu %s', r.expire_a - now());
    RAISE NOTICE 'OK hold virement : réservation % (expire %)', r.reservation_id, r.expire_a;
END $$;

-- t_ok : quota 5, déjà 2 (carte) + 1 (virement) réservés actifs = 3 pris.

-- -----------------------------------------------------------------------------
-- creer_reservation : erreurs métier
-- -----------------------------------------------------------------------------
SELECT pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 1, ''especes'')', pg_temp.fx('user'), pg_temp.fx('t_ok')),
                            'BT030', 'mode de paiement invalide');
SELECT pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 0, ''carte'')', pg_temp.fx('user'), pg_temp.fx('t_ok')),
                            'BT007', 'quantité 0');
SELECT pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 11, ''carte'')', pg_temp.fx('user'), pg_temp.fx('t_ok')),
                            'BT007', 'quantité 11');
SELECT pg_temp.expect_error(format('SELECT creer_reservation(-1, %s, 1, ''carte'')', pg_temp.fx('t_ok')),
                            'BT008', 'utilisateur inexistant');
SELECT pg_temp.expect_error(format('SELECT creer_reservation(%s, -1, 1, ''carte'')', pg_temp.fx('user')),
                            'BT001', 'tarif inexistant');
SELECT pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 1, ''carte'')', pg_temp.fx('user'), pg_temp.fx('t_inactif')),
                            'BT002', 'tarif inactif');
SELECT pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 1, ''carte'')', pg_temp.fx('user'), pg_temp.fx('t_draft')),
                            'BT003', 'événement non publié');
SELECT pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 1, ''carte'')', pg_temp.fx('user'), pg_temp.fx('t_ferme')),
                            'BT004', 'vente pas encore ouverte');
SELECT pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 1, ''carte'')', pg_temp.fx('user'), pg_temp.fx('t_commence')),
                            'BT005', 'événement commencé');
SELECT pg_temp.expect_error(format('SELECT creer_reservation(-1, %s, 1, ''carte'')', pg_temp.fx('t_ok')),
                            'BT008', 'utilisateur inexistant (avant verrou tarif)');

-- BT006 : quota consommé uniquement par des réservations actives (aucun
-- billet vendu) — preuve que la requête de quota étendue fonctionne.
-- t_ok : quota 5, déjà 3 réservés (2 carte + 1 virement). 2 restent.
SELECT pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 3, ''carte'')', pg_temp.fx('user'), pg_temp.fx('t_ok')),
                            'BT006', 'quota épuisé par des réservations actives (2 restants, 3 demandés)');
DO $$
BEGIN
    PERFORM creer_reservation(pg_temp.fx('user'), pg_temp.fx('t_ok'), 2, 'carte');
    RAISE NOTICE 'OK hold jusqu''au quota exact (5/5, tout en réservations actives)';
END $$;
SELECT pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 1, ''carte'')', pg_temp.fx('user'), pg_temp.fx('t_ok')),
                            'BT006', 'quota atteint exactement (5/5 en réservations actives)');

-- -----------------------------------------------------------------------------
-- confirmer_reservation : cas nominal, prix figé au moment du hold
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_tarif bigint;
BEGIN
    -- Tarif dédié, non touché par les tests de quota ci-dessus.
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente, actif)
    VALUES (pg_temp.fx('evt_futur'), 'Prix figé', 40.00, 5, now() - interval '1 day', now() + interval '29 days', true)
    RETURNING id INTO v_tarif;
    INSERT INTO fx VALUES ('t_libre', v_tarif);
END $$;

DO $$
DECLARE
    hold record; conf record; v_statut text; v_commande bigint; n_billets bigint;
BEGIN
    SELECT * INTO hold FROM creer_reservation(pg_temp.fx('user'), pg_temp.fx('t_libre'), 2, 'virement');

    -- Le tarif change de prix après le hold : confirmer_reservation doit
    -- facturer le prix figé au moment du hold (40.00), pas le nouveau (60.00).
    UPDATE tarifs SET prix = 60.00 WHERE id = pg_temp.fx('t_libre');

    SELECT * INTO conf FROM confirmer_reservation(hold.reservation_id, pg_temp.fx('user'));

    ASSERT conf.montant_total = 80.00, format('montant figé 80.00 (2×40.00) attendu, %s', conf.montant_total);
    ASSERT array_length(conf.billet_ids, 1) = 2, 'deux billets créés';

    SELECT count(*) INTO n_billets FROM billets WHERE commande_id = conf.commande_id AND prix_paye = 40.00;
    ASSERT n_billets = 2, 'billets facturés au prix figé lors du hold (40.00), pas au nouveau prix (60.00)';

    SELECT statut, commande_id INTO v_statut, v_commande FROM reservations WHERE id = hold.reservation_id;
    ASSERT v_statut = 'confirmee' AND v_commande = conf.commande_id, 'réservation confirmée, commande liée';

    SELECT statut INTO v_statut FROM commandes WHERE id = conf.commande_id;
    ASSERT v_statut = 'paid', 'commande paid';

    RAISE NOTICE 'OK confirmer_reservation : commande % au prix figé', conf.commande_id;
END $$;

-- -----------------------------------------------------------------------------
-- confirmer_reservation : erreurs métier
-- -----------------------------------------------------------------------------
SELECT pg_temp.expect_error(format('SELECT confirmer_reservation(-1, %s)', pg_temp.fx('user')),
                            'BT031', 'réservation introuvable');

-- Chaque cas ci-dessous utilise son propre tarif (quota 5) pour ne pas
-- dépendre de l'état laissé par les tests précédents sur t_libre.
DO $$
DECLARE
    v_tarif bigint; hold record;
BEGIN
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente, actif)
    VALUES (pg_temp.fx('evt_futur'), 'BT032', 20.00, 5, now() - interval '1 day', now() + interval '29 days', true)
    RETURNING id INTO v_tarif;

    SELECT * INTO hold FROM creer_reservation(pg_temp.fx('user'), v_tarif, 1, 'carte');

    -- Confirmée une première fois...
    PERFORM confirmer_reservation(hold.reservation_id, pg_temp.fx('user'));
    -- ... la reconfirmer échoue.
    PERFORM pg_temp.expect_error(format('SELECT confirmer_reservation(%s, %s)', hold.reservation_id, pg_temp.fx('user')),
                                 'BT032', 'réservation déjà confirmée');
END $$;

-- Confirmation par un autre utilisateur que le titulaire de la réservation.
DO $$
DECLARE
    v_tarif bigint; hold record;
BEGIN
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente, actif)
    VALUES (pg_temp.fx('evt_futur'), 'BT013 confirm', 20.00, 5, now() - interval '1 day', now() + interval '29 days', true)
    RETURNING id INTO v_tarif;

    SELECT * INTO hold FROM creer_reservation(pg_temp.fx('user'), v_tarif, 1, 'carte');
    PERFORM pg_temp.expect_error(format('SELECT confirmer_reservation(%s, %s)', hold.reservation_id, pg_temp.fx('autre_user')),
                                 'BT013', 'confirmation par un autre utilisateur');
END $$;

-- Réservation expirée : confirmer_reservation la refuse même si son statut
-- est encore 'active' (expiration lazy, pas de dépendance à la purge), et
-- le quota qu'elle occupait redevient disponible pour un nouveau hold.
DO $$
DECLARE
    v_tarif bigint; hold record; v_libres bigint;
BEGIN
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente, actif)
    VALUES (pg_temp.fx('evt_futur'), 'BT033 expire', 20.00, 5, now() - interval '1 day', now() + interval '29 days', true)
    RETURNING id INTO v_tarif;

    SELECT * INTO hold FROM creer_reservation(pg_temp.fx('user'), v_tarif, 3, 'carte');
    UPDATE reservations SET expire_a = now() - interval '1 second' WHERE id = hold.reservation_id;

    PERFORM pg_temp.expect_error(format('SELECT confirmer_reservation(%s, %s)', hold.reservation_id, pg_temp.fx('user')),
                                 'BT033', 'réservation expirée (statut encore actif)');

    -- Quota 5, rien d'autre de réservé sur ce tarif : les 3 places du hold
    -- expiré doivent être de nouveau disponibles, la 5e demandée doit échouer.
    SELECT count(*) INTO v_libres FROM creer_reservation(pg_temp.fx('user'), v_tarif, 5, 'carte');
    ASSERT v_libres = 1, 'les places du hold expiré sont de nouveau disponibles (5/5 dispo)';
    PERFORM pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 1, ''carte'')', pg_temp.fx('user'), v_tarif),
                                 'BT006', 'quota de nouveau plein après le hold de contrôle');
    RAISE NOTICE 'OK expiration lazy : quota libéré sans dépendre de la purge';
END $$;

-- -----------------------------------------------------------------------------
-- Interaction quota : billets confirmés comptent comme acheter_billet
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_tarif bigint; hold record;
BEGIN
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente, actif)
    VALUES (pg_temp.fx('evt_futur'), 'Quota strict', 15.00, 2, now() - interval '1 day', now() + interval '29 days', true)
    RETURNING id INTO v_tarif;
    INSERT INTO fx VALUES ('t_strict', v_tarif);

    SELECT * INTO hold FROM creer_reservation(pg_temp.fx('user'), pg_temp.fx('t_strict'), 2, 'carte');
    PERFORM confirmer_reservation(hold.reservation_id, pg_temp.fx('user'));

    PERFORM pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 1, ''carte'')', pg_temp.fx('user'), pg_temp.fx('t_strict')),
                                 'BT006', 'quota épuisé par des billets confirmés (comme acheter_billet)');
    RAISE NOTICE 'OK quota : billets issus d''une réservation confirmée comptent comme acheter_billet';
END $$;

-- -----------------------------------------------------------------------------
-- purger_reservations_expirees : reporting uniquement, sans effet sur la correction
-- -----------------------------------------------------------------------------
-- Sonde le quota disponible sans laisser de trace : creer_reservation dans un
-- sous-bloc, puis RAISE forcé pour annuler son insertion (savepoint implicite
-- du bloc EXCEPTION), en vérifiant que l'appel a bien réussi avant l'annulation.
DO $$
DECLARE
    v_tarif bigint; hold record; v_statut text;
BEGIN
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente, actif)
    VALUES (pg_temp.fx('evt_futur'), 'Purge', 12.00, 3, now() - interval '1 day', now() + interval '29 days', true)
    RETURNING id INTO v_tarif;

    SELECT * INTO hold FROM creer_reservation(pg_temp.fx('user'), v_tarif, 2, 'carte');
    UPDATE reservations SET expire_a = now() - interval '1 second' WHERE id = hold.reservation_id;

    -- Avant purge : le hold expiré, encore 'active', ne doit déjà plus compter.
    BEGIN
        PERFORM creer_reservation(pg_temp.fx('user'), v_tarif, 3, 'carte');
        RAISE EXCEPTION 'sonde_ok';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM <> 'sonde_ok' THEN
                RAISE EXCEPTION 'quota non libéré avant purge (hold expiré encore actif) : %', SQLERRM;
            END IF;
    END;

    CALL purger_reservations_expirees();
    SELECT statut INTO v_statut FROM reservations WHERE id = hold.reservation_id;
    ASSERT v_statut = 'expiree', 'purge : statut passé à expiree';

    -- Après purge : même résultat qu'avant (aucun impact sur la correction).
    BEGIN
        PERFORM creer_reservation(pg_temp.fx('user'), v_tarif, 3, 'carte');
        RAISE EXCEPTION 'sonde_ok';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM <> 'sonde_ok' THEN
                RAISE EXCEPTION 'quota non libéré après purge : %', SQLERRM;
            END IF;
    END;

    RAISE NOTICE 'OK purge : reporting uniquement, aucun effet sur l''anti-survente';
END $$;

-- -----------------------------------------------------------------------------
-- Métadonnées : SECURITY DEFINER, search_path, EXECUTE retiré à PUBLIC, commentaires
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    ASSERT (SELECT prosecdef FROM pg_proc WHERE proname = 'creer_reservation'), 'creer_reservation SECURITY DEFINER';
    ASSERT (SELECT prosecdef FROM pg_proc WHERE proname = 'confirmer_reservation'), 'confirmer_reservation SECURITY DEFINER';
    ASSERT NOT has_function_privilege('public', 'creer_reservation(bigint, bigint, integer, text, interval)', 'EXECUTE'),
        'EXECUTE retiré à PUBLIC sur creer_reservation';
    ASSERT NOT has_function_privilege('public', 'confirmer_reservation(bigint, bigint)', 'EXECUTE'),
        'EXECUTE retiré à PUBLIC sur confirmer_reservation';
    ASSERT NOT has_function_privilege('public', 'purger_reservations_expirees()', 'EXECUTE'),
        'EXECUTE retiré à PUBLIC sur purger_reservations_expirees';
    ASSERT obj_description((SELECT oid FROM pg_trigger WHERE tgname = 'trg_reservations_updated_at'), 'pg_trigger') IS NOT NULL,
        'trigger updated_at commenté';
    RAISE NOTICE 'OK métadonnées de sécurité';
END $$;

ROLLBACK;
