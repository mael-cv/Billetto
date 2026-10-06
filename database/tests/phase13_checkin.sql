-- =============================================================================
-- Tests phase 13 — check-in QR, doublons, rejeux offline
-- Jeu d'essai propre, annulé par ROLLBACK. La concurrence (scans simultanés
-- du même billet) est testée par database/scripts/concurrency.mjs.
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

-- -----------------------------------------------------------------------------
-- Jeu d'essai : 2 organisateurs, 2 événements, 3 billets
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE fx (cle text PRIMARY KEY, id bigint) ON COMMIT DROP;
CREATE FUNCTION pg_temp.fx(p_cle text) RETURNS bigint LANGUAGE sql STABLE AS
    $$ SELECT id FROM fx WHERE cle = p_cle $$;
-- QR d'un billet, tel qu'imprimé.
CREATE FUNCTION pg_temp.qr(p_billet bigint) RETURNS text LANGUAGE sql STABLE AS
    $$ SELECT 'BT1.' || code || '.' || code_verification FROM billets WHERE id = p_billet $$;
CREATE FUNCTION pg_temp.scan(p_client uuid, p_payload text, p_evt bigint, p_appareil text DEFAULT 'test')
RETURNS TABLE (resultat text, rejeu boolean, premier_appareil text, titulaire text) LANGUAGE sql AS
    $$ SELECT resultat, rejeu, premier_appareil, titulaire FROM scanner_billet(p_client, p_payload, p_evt, now(), p_appareil) $$;

DO $$
DECLARE
    v_orga bigint; v_orga2 bigint; v_lieu bigint; v_evt bigint; v_evt2 bigint; v_tarif bigint; v_tarif2 bigint;
    v_user bigint; v_id bigint;
BEGIN
    INSERT INTO organisateurs (nom, email, slug) VALUES ('Test Orga Checkin', 'test-orga-checkin@billetto.test', 'test-orga-checkin')
    RETURNING id INTO v_orga;
    INSERT INTO organisateurs (nom, email, slug) VALUES ('Test Orga Checkin 2', 'test-orga-checkin2@billetto.test', 'test-orga-checkin2')
    RETURNING id INTO v_orga2;
    INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
    VALUES ('Test Salle Checkin', '1 rue du Test', 'Testville', '99000', 500) RETURNING id INTO v_lieu;
    INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
    VALUES (v_orga, v_lieu, (SELECT min(id) FROM type_evenements), 'Test checkin', 'test-checkin',
            now() + interval '30 days', now() + interval '31 days', 'published') RETURNING id INTO v_evt;
    INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
    VALUES (v_orga, v_lieu, (SELECT min(id) FROM type_evenements), 'Test checkin autre', 'test-checkin-autre',
            now() + interval '30 days', now() + interval '31 days', 'published') RETURNING id INTO v_evt2;
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
    VALUES (v_evt, 'Standard', 20, 10, now() - interval '1 day', now() + interval '29 days') RETURNING id INTO v_tarif;
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
    VALUES (v_evt2, 'Standard', 20, 10, now() - interval '1 day', now() + interval '29 days') RETURNING id INTO v_tarif2;
    INSERT INTO utilisateurs (email, password_hash, prenom, nom)
    VALUES ('test-checkin-porteur@billetto.test', 'x', 'Camille', 'Porteur') RETURNING id INTO v_user;
    INSERT INTO fx VALUES ('evt', v_evt), ('evt2', v_evt2), ('user', v_user);

    INSERT INTO utilisateurs (email, password_hash, prenom, nom, role_app, organisateur_id)
    VALUES ('test-checkin-orga@billetto.test', 'x', 'Orga', 'Un', 'organizer', v_orga) RETURNING id INTO v_id;
    INSERT INTO fx VALUES ('u_orga', v_id);
    INSERT INTO utilisateurs (email, password_hash, prenom, nom, role_app, organisateur_id)
    VALUES ('test-checkin-orga2@billetto.test', 'x', 'Orga', 'Deux', 'organizer', v_orga2) RETURNING id INTO v_id;
    INSERT INTO fx VALUES ('u_orga2', v_id);

    INSERT INTO fx SELECT 'b1', billet_ids[1] FROM acheter_billet(v_user, v_tarif, 1);
    INSERT INTO fx SELECT 'b2', billet_ids[1] FROM acheter_billet(v_user, v_tarif, 1);
    INSERT INTO fx SELECT 'cmd3', commande_id FROM acheter_billet(v_user, v_tarif, 1);
    INSERT INTO fx SELECT 'b3', id FROM billets WHERE commande_id = pg_temp.fx('cmd3');
    INSERT INTO fx SELECT 'b_autre', billet_ids[1] FROM acheter_billet(v_user, v_tarif2, 1);
END $$;

-- -----------------------------------------------------------------------------
-- Signature
-- -----------------------------------------------------------------------------
SELECT pg_temp.check(
    (SELECT bool_and(char_length(code_verification) = 22) FROM billets WHERE id IN (pg_temp.fx('b1'), pg_temp.fx('b2'))),
    'code_verification calculé à l''insertion (22 caractères)');
SELECT pg_temp.check(
    (SELECT code_verification = signature_billet(code) FROM billets WHERE id = pg_temp.fx('b1')),
    'code_verification = HMAC du code');
DO $$
BEGIN
    UPDATE billets SET code_verification = 'forge-forge-forge-forg' WHERE id = pg_temp.fx('b1');
    PERFORM pg_temp.check((SELECT code_verification = signature_billet(code) FROM billets WHERE id = pg_temp.fx('b1')),
                          'signature non modifiable (recalculée par trigger)');
END $$;

-- -----------------------------------------------------------------------------
-- Scan, doublon
-- -----------------------------------------------------------------------------
SELECT pg_temp.check(
    (SELECT resultat = 'ok' AND NOT rejeu AND titulaire = 'Camille P.'
     FROM pg_temp.scan('00000000-0000-4000-8000-000000000001', pg_temp.qr(pg_temp.fx('b1')), pg_temp.fx('evt'), 'porte A')),
    'premier scan : ok, titulaire abrégé');
SELECT pg_temp.check(
    (SELECT resultat = 'doublon' AND NOT rejeu AND premier_appareil = 'porte A'
     FROM pg_temp.scan('00000000-0000-4000-8000-000000000002', pg_temp.qr(pg_temp.fx('b1')), pg_temp.fx('evt'), 'porte B')),
    'second scan du même billet : doublon, avec l''appareil du premier');
SELECT pg_temp.check(
    (SELECT premier_scan_id = (SELECT id FROM billets_scans WHERE client_scan_id = '00000000-0000-4000-8000-000000000001')
     FROM billets_scans WHERE client_scan_id = '00000000-0000-4000-8000-000000000002'),
    'doublon relié au premier scan (premier_scan_id)');

-- -----------------------------------------------------------------------------
-- Rejeux : même client_scan_id → même réponse, aucune nouvelle ligne
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE nb AS SELECT count(*) AS n FROM billets_scans;
SELECT pg_temp.check(
    (SELECT resultat = 'ok' AND rejeu
     FROM pg_temp.scan('00000000-0000-4000-8000-000000000001', pg_temp.qr(pg_temp.fx('b1')), pg_temp.fx('evt'))),
    'rejeu du premier scan : toujours ok (marqué rejeu)');
SELECT pg_temp.check(
    (SELECT resultat = 'doublon' AND rejeu
     FROM pg_temp.scan('00000000-0000-4000-8000-000000000002', pg_temp.qr(pg_temp.fx('b1')), pg_temp.fx('evt'))),
    'rejeu du doublon : toujours doublon');
SELECT pg_temp.check((SELECT count(*) FROM billets_scans) = (SELECT n FROM nb), 'rejeux : aucune nouvelle ligne');

-- Scans hors ligne rejoués dans le désordre (B avant A, puis A, B, A).
SELECT pg_temp.scan('00000000-0000-4000-8000-0000000000b0', pg_temp.qr(pg_temp.fx('b2')), pg_temp.fx('evt'));
SELECT pg_temp.scan('00000000-0000-4000-8000-0000000000a0', pg_temp.qr(pg_temp.fx('b2')), pg_temp.fx('evt'));
SELECT pg_temp.scan('00000000-0000-4000-8000-0000000000b0', pg_temp.qr(pg_temp.fx('b2')), pg_temp.fx('evt'));
SELECT pg_temp.scan('00000000-0000-4000-8000-0000000000a0', pg_temp.qr(pg_temp.fx('b2')), pg_temp.fx('evt'));
SELECT pg_temp.check(
    (SELECT count(*) = 2 AND count(*) FILTER (WHERE resultat = 'ok') = 1 AND count(*) FILTER (WHERE resultat = 'doublon') = 1
     FROM billets_scans WHERE billet_id = pg_temp.fx('b2')),
    'rejeux dans le désordre : 2 lignes, exactement 1 ok et 1 doublon');

-- -----------------------------------------------------------------------------
-- Rejets
-- -----------------------------------------------------------------------------
SELECT pg_temp.check(
    (SELECT resultat = 'invalide' FROM pg_temp.scan(gen_random_uuid(),
        left(pg_temp.qr(pg_temp.fx('b3')), -1) || 'x', pg_temp.fx('evt'))),
    'signature altérée : invalide');
SELECT pg_temp.check(
    (SELECT resultat = 'invalide' FROM pg_temp.scan(gen_random_uuid(), 'n''importe quoi', pg_temp.fx('evt'))),
    'QR étranger : invalide');
SELECT pg_temp.check(
    (SELECT resultat = 'mauvais_evenement' FROM pg_temp.scan(gen_random_uuid(), pg_temp.qr(pg_temp.fx('b_autre')), pg_temp.fx('evt'))),
    'billet d''un autre événement : mauvais_evenement');
CALL rembourser_commande(pg_temp.fx('cmd3'));
SELECT pg_temp.check(
    (SELECT resultat = 'annule' FROM pg_temp.scan(gen_random_uuid(), pg_temp.qr(pg_temp.fx('b3')), pg_temp.fx('evt'))),
    'billet remboursé : annule');
SELECT pg_temp.expect_error(format('SELECT scanner_billet(gen_random_uuid(), '''', %s)', pg_temp.fx('evt')),
                            'BT051', 'contenu vide');
SELECT pg_temp.expect_error('SELECT scanner_billet(gen_random_uuid(), ''x'', 999999999)', 'BT050', 'événement introuvable');

-- -----------------------------------------------------------------------------
-- Contrôle d'accès
-- -----------------------------------------------------------------------------
SELECT set_config('app.user_id', pg_temp.fx('u_orga2')::text, true);
SELECT pg_temp.expect_error(format('SELECT scanner_billet(gen_random_uuid(), %L, %s)', pg_temp.qr(pg_temp.fx('b2')), pg_temp.fx('evt')),
                            'BT013', 'organisateur d''un autre événement : scan refusé');
SELECT pg_temp.expect_error(format('SELECT manifeste_checkin(%s)', pg_temp.fx('evt')),
                            'BT013', 'organisateur d''un autre événement : manifeste refusé');
SELECT set_config('app.user_id', pg_temp.fx('user')::text, true);
SELECT pg_temp.expect_error(format('SELECT scanner_billet(gen_random_uuid(), %L, %s)', pg_temp.qr(pg_temp.fx('b2')), pg_temp.fx('evt')),
                            'BT013', 'simple visiteur : scan refusé');
SELECT set_config('app.user_id', pg_temp.fx('u_orga')::text, true);
SELECT pg_temp.check(
    (SELECT resultat = 'doublon' FROM pg_temp.scan(gen_random_uuid(), pg_temp.qr(pg_temp.fx('b1')), pg_temp.fx('evt'))),
    'organisateur de l''événement : scan autorisé');
SELECT pg_temp.check(
    (SELECT scanne_par = pg_temp.fx('u_orga') FROM billets_scans ORDER BY id DESC LIMIT 1),
    'scanne_par = acteur courant');

-- -----------------------------------------------------------------------------
-- Manifeste : billets payés seulement, statut de scan
-- -----------------------------------------------------------------------------
SELECT pg_temp.check(
    (SELECT count(*) = 2 AND bool_and(deja_scanne) FROM manifeste_checkin(pg_temp.fx('evt'))),
    'manifeste : 2 billets payés (le remboursé exclu), tous deux scannés');
SELECT set_config('app.user_id', '', true);

ROLLBACK;
