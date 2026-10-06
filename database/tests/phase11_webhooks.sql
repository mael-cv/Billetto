-- =============================================================================
-- Tests phase 11 — idempotence des webhooks de paiement.
-- Tout est annulé par ROLLBACK, indépendamment des données de démonstration.
-- =============================================================================

BEGIN;

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_code text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_code THEN
            RAISE NOTICE 'OK % → %', p_label, SQLSTATE;
            RETURN;
        END IF;
        RAISE EXCEPTION '% : SQLSTATE % attendu, obtenu %', p_label, p_code, SQLSTATE;
    END;
    RAISE EXCEPTION '% : une erreur était attendue', p_label;
END;
$$;

CREATE TEMP TABLE fx (cle text PRIMARY KEY, id bigint) ON COMMIT DROP;
CREATE FUNCTION pg_temp.fx(p_cle text) RETURNS bigint LANGUAGE sql STABLE AS
    $$ SELECT id FROM fx WHERE cle = p_cle $$;

DO $$
DECLARE
    v_org bigint; v_lieu bigint; v_type bigint; v_user bigint; v_evt bigint; v_tarif bigint;
    v_hold bigint; v_other_hold bigint;
BEGIN
    INSERT INTO organisateurs (nom, email, slug)
    VALUES ('Webhooks test', 'webhook-' || txid_current() || '@billetto.test', 'webhook-' || txid_current())
    RETURNING id INTO v_org;
    INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
    VALUES ('Lieu webhook ' || txid_current(), '1 rue du Test', 'Testville', '99000', 30)
    RETURNING id INTO v_lieu;
    SELECT min(id) INTO v_type FROM type_evenements;
    INSERT INTO utilisateurs (email, password_hash, prenom, nom)
    VALUES ('acheteur-webhook-' || txid_current() || '@billetto.test', 'x', 'Test', 'Webhook')
    RETURNING id INTO v_user;
    INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
    VALUES (v_org, v_lieu, v_type, 'Événement webhook', 'webhook-' || txid_current(),
            now() + interval '30 days', now() + interval '31 days', 'published')
    RETURNING id INTO v_evt;
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
    VALUES (v_evt, 'Standard', 25, 10, now() - interval '1 day', now() + interval '29 days')
    RETURNING id INTO v_tarif;

    SELECT reservation_id INTO v_hold FROM creer_reservation(v_user, v_tarif, 2, 'carte');
    SELECT reservation_id INTO v_other_hold FROM creer_reservation(v_user, v_tarif, 1, 'carte');
    INSERT INTO fx VALUES ('user', v_user), ('tarif', v_tarif), ('hold', v_hold), ('other_hold', v_other_hold);
END $$;

-- Premier paiement réussi : journal, commande et billets sont créés.
DO $$
DECLARE r record; n bigint;
BEGIN
    SELECT * INTO r FROM traiter_paiement_webhook(
        'evt-phase11-success', 'payment.succeeded', pg_temp.fx('hold'),
        jsonb_build_object('eventId', 'evt-phase11-success', 'type', 'payment.succeeded', 'reservationId', pg_temp.fx('hold'))
    );
    ASSERT NOT r.duplique AND r.commande_id IS NOT NULL, 'premier événement traité';
    ASSERT array_length(r.billet_ids, 1) = 2, 'deux billets renvoyés';
    SELECT count(*) INTO n FROM billets WHERE commande_id = r.commande_id;
    ASSERT n = 2, 'deux billets créés';
    ASSERT (SELECT statut FROM reservations WHERE id = pg_temp.fx('hold')) = 'confirmee', 'hold confirmé';
    RAISE NOTICE 'OK paiement réussi : commande %, billets %', r.commande_id, n;
END $$;

-- Le même identifiant externe est acquitté sans rappeler la confirmation.
DO $$
DECLARE r record; n bigint;
BEGIN
    SELECT * INTO r FROM traiter_paiement_webhook(
        'evt-phase11-success', 'payment.succeeded', pg_temp.fx('hold'),
        jsonb_build_object('eventId', 'evt-phase11-success', 'type', 'payment.succeeded', 'reservationId', pg_temp.fx('hold'))
    );
    ASSERT r.duplique AND r.commande_id IS NULL, 'rejeu signalé comme doublon';
    SELECT count(*) INTO n FROM billets WHERE commande_id = (SELECT commande_id FROM reservations WHERE id = pg_temp.fx('hold'));
    ASSERT n = 2, 'le rejeu ne crée aucun billet supplémentaire';
    ASSERT (SELECT count(*) FROM paiement_webhooks WHERE evenement_externe_id = 'evt-phase11-success') = 1,
        'un seul événement enregistré';
    RAISE NOTICE 'OK rejeu : aucun billet supplémentaire';
END $$;

-- Les autres types sont journalisés sans confirmer la réservation.
DO $$
DECLARE r record;
BEGIN
    SELECT * INTO r FROM traiter_paiement_webhook(
        'evt-phase11-failed', 'payment.failed', pg_temp.fx('other_hold'),
        jsonb_build_object('eventId', 'evt-phase11-failed', 'type', 'payment.failed', 'reservationId', pg_temp.fx('other_hold'))
    );
    ASSERT NOT r.duplique AND r.commande_id IS NULL, 'événement échec journalisé';
    ASSERT (SELECT statut FROM reservations WHERE id = pg_temp.fx('other_hold')) = 'active', 'hold laissé actif';
    RAISE NOTICE 'OK payment.failed : événement journalisé sans confirmer le hold';
END $$;

-- Un échec métier annule aussi l'insertion d'idempotence.
DO $$
DECLARE v_hold bigint;
BEGIN
    SELECT reservation_id INTO v_hold FROM creer_reservation(pg_temp.fx('user'), pg_temp.fx('tarif'), 1, 'carte');
    UPDATE reservations SET expire_a = now() - interval '1 second' WHERE id = v_hold;
    PERFORM pg_temp.expect_error(
        format($q$SELECT * FROM traiter_paiement_webhook('evt-phase11-expired', 'payment.succeeded', %s, '{}'::jsonb)$q$, v_hold),
        'BT033', 'confirmation webhook d''une réservation expirée'
    );
    ASSERT NOT EXISTS (SELECT 1 FROM paiement_webhooks WHERE evenement_externe_id = 'evt-phase11-expired'),
        'échec métier : événement annulé avec la transaction';
END $$;

DO $$
BEGIN
    ASSERT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'paiement_webhooks'::regclass),
        'RLS activée et forcée';
    ASSERT NOT has_table_privilege('billetto_visiteur', 'paiement_webhooks', 'INSERT'),
        'aucune écriture directe par le rôle visiteur';
    ASSERT NOT has_function_privilege('public', 'traiter_paiement_webhook(text, text, bigint, jsonb)', 'EXECUTE'),
        'fonction inaccessible à PUBLIC';
    RAISE NOTICE 'OK sécurité : RLS et privilèges restrictifs';
END $$;

ROLLBACK;
