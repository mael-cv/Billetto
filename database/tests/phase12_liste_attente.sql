-- =============================================================================
-- Tests phase 12 — liste d'attente
-- Jeu d'essai propre, indépendant du seed, annulé par ROLLBACK.
-- Dans une transaction now() est figé : l'expiration d'une offre est simulée
-- en reculant expire_a de sa réservation. La concurrence (appels simultanés
-- de traiter_liste_attente) est testée par database/scripts/concurrency.mjs.
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
-- Jeu d'essai : un événement, 3 tarifs, 4 utilisateurs
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE fx (cle text PRIMARY KEY, id bigint) ON COMMIT DROP;
CREATE FUNCTION pg_temp.fx(p_cle text) RETURNS bigint LANGUAGE sql STABLE AS
    $$ SELECT id FROM fx WHERE cle = p_cle $$;

DO $$
DECLARE
    v_orga bigint; v_lieu bigint; v_evt bigint; v_id bigint; i int; d record;
BEGIN
    INSERT INTO organisateurs (nom, email, slug) VALUES ('Test Orga Attente', 'test-orga-attente@billetto.test', 'test-orga-attente')
    RETURNING id INTO v_orga;
    INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
    VALUES ('Test Salle Attente', '1 rue du Test', 'Testville', '99000', 500)
    RETURNING id INTO v_lieu;
    INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
    VALUES (v_orga, v_lieu, (SELECT min(id) FROM type_evenements), 'Test attente', 'test-attente',
            now() + interval '30 days', now() + interval '31 days', 'published')
    RETURNING id INTO v_evt;

    FOR d IN SELECT * FROM (VALUES ('t_wait', 2), ('t_free', 5), ('t_big', 2)) AS v(cle, quota) LOOP
        INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
        VALUES (v_evt, d.cle, 20, d.quota, now() - interval '1 day', now() + interval '29 days')
        RETURNING id INTO v_id;
        INSERT INTO fx VALUES (d.cle, v_id);
    END LOOP;

    FOR i IN 1..4 LOOP
        INSERT INTO utilisateurs (email, password_hash, prenom, nom)
        VALUES ('test-attente-' || i || '@billetto.test', 'x', 'Test', 'Attente ' || i)
        RETURNING id INTO v_id;
        INSERT INTO fx VALUES ('u' || i, v_id);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Inscription
-- -----------------------------------------------------------------------------
SELECT pg_temp.expect_error(format('SELECT inscrire_liste_attente(%s, %s, 1)', pg_temp.fx('u1'), pg_temp.fx('t_free')),
                            'BT040', 'places disponibles sans file → achat direct');
SELECT pg_temp.expect_error(format('SELECT inscrire_liste_attente(%s, %s, 0)', pg_temp.fx('u1'), pg_temp.fx('t_wait')),
                            'BT007', 'quantité invalide');
SELECT pg_temp.expect_error(format('SELECT inscrire_liste_attente(%s, 999999999, 1)', pg_temp.fx('u1')),
                            'BT001', 'tarif introuvable');

-- t_wait complet : deux commandes d'un billet (désistements indépendants).
DO $$
BEGIN
    INSERT INTO fx SELECT 'cmd1', commande_id FROM acheter_billet(pg_temp.fx('u1'), pg_temp.fx('t_wait'), 1);
    INSERT INTO fx SELECT 'cmd2', commande_id FROM acheter_billet(pg_temp.fx('u1'), pg_temp.fx('t_wait'), 1);
    INSERT INTO fx VALUES ('w2', inscrire_liste_attente(pg_temp.fx('u2'), pg_temp.fx('t_wait'), 1));
    INSERT INTO fx VALUES ('w3', inscrire_liste_attente(pg_temp.fx('u3'), pg_temp.fx('t_wait'), 1));
    INSERT INTO fx VALUES ('w4', inscrire_liste_attente(pg_temp.fx('u4'), pg_temp.fx('t_wait'), 1));
END $$;

SELECT pg_temp.expect_error(format('SELECT inscrire_liste_attente(%s, %s, 1)', pg_temp.fx('u2'), pg_temp.fx('t_wait')),
                            'BT042', 'double inscription');
SELECT pg_temp.check(
    position_liste_attente(pg_temp.fx('w2')) = 1 AND position_liste_attente(pg_temp.fx('w3')) = 2
        AND position_liste_attente(pg_temp.fx('w4')) = 3,
    'positions FIFO 1, 2, 3');
SELECT pg_temp.check((SELECT count(*) = 3 FROM liste_attente WHERE tarif_id = pg_temp.fx('t_wait') AND statut = 'en_attente'),
                     'aucune offre tant que le tarif est complet');

-- -----------------------------------------------------------------------------
-- Désistement → notifie la tête de file, et elle seule
-- -----------------------------------------------------------------------------
CALL rembourser_commande(pg_temp.fx('cmd1'));

SELECT pg_temp.check(
    (SELECT statut FROM liste_attente WHERE id = pg_temp.fx('w2')) = 'notifiee'
        AND (SELECT statut FROM liste_attente WHERE id = pg_temp.fx('w3')) = 'en_attente'
        AND (SELECT statut FROM liste_attente WHERE id = pg_temp.fx('w4')) = 'en_attente',
    'remboursement : le 1er inscrit (et lui seul) est notifié');

-- Pas de fuite : la place offerte est bloquée pour tous les autres chemins.
SELECT pg_temp.check(places_restantes(pg_temp.fx('t_wait')) = 0, 'offre en cours : 0 place restante');
SELECT pg_temp.expect_error(format('SELECT acheter_billet(%s, %s, 1)', pg_temp.fx('u1'), pg_temp.fx('t_wait')),
                            'BT006', 'offre en cours : achat direct refusé');
SELECT pg_temp.expect_error(format('SELECT creer_reservation(%s, %s, 1, ''carte'')', pg_temp.fx('u1'), pg_temp.fx('t_wait')),
                            'BT006', 'offre en cours : hold refusé');

-- Idempotence du déclencheur canonique.
SELECT pg_temp.check(traiter_liste_attente(pg_temp.fx('t_wait')) = 0 AND traiter_liste_attente(pg_temp.fx('t_wait')) = 0,
                     'traiter_liste_attente répété : aucune offre supplémentaire');
SELECT pg_temp.check((SELECT count(*) = 1 FROM liste_attente WHERE tarif_id = pg_temp.fx('t_wait') AND statut = 'notifiee'),
                     'une seule offre pour une place libérée');

-- -----------------------------------------------------------------------------
-- Non-réponse → l'offre passe au suivant
-- -----------------------------------------------------------------------------
UPDATE reservations SET expire_a = now() - interval '1 second'
WHERE id = (SELECT reservation_id FROM liste_attente WHERE id = pg_temp.fx('w2'));

SELECT pg_temp.check(places_restantes(pg_temp.fx('t_wait')) = 1, 'offre expirée : la place est libre (lazy)');
SELECT pg_temp.check(traiter_liste_attente(pg_temp.fx('t_wait')) = 1, 'balayage : une nouvelle offre');
SELECT pg_temp.check(
    (SELECT statut FROM liste_attente WHERE id = pg_temp.fx('w2')) = 'expiree'
        AND (SELECT statut FROM liste_attente WHERE id = pg_temp.fx('w3')) = 'notifiee'
        AND (SELECT statut FROM liste_attente WHERE id = pg_temp.fx('w4')) = 'en_attente',
    'non-réponse : le 1er expire, le 2e est notifié');
SELECT pg_temp.expect_error(format('SELECT confirmer_liste_attente(%s, %s)', pg_temp.fx('w2'), pg_temp.fx('u2')),
                            'BT043', 'offre expirée non confirmable');

-- -----------------------------------------------------------------------------
-- Confirmation
-- -----------------------------------------------------------------------------
SELECT set_config('app.user_id', pg_temp.fx('u4')::text, true);
SELECT pg_temp.expect_error(format('SELECT confirmer_liste_attente(%s, %s)', pg_temp.fx('w3'), pg_temp.fx('u4')),
                            'BT013', 'confirmation de l''offre d''un autre');
SELECT set_config('app.user_id', '', true);

SELECT pg_temp.expect_error(format('SELECT confirmer_liste_attente(%s, %s)', pg_temp.fx('w4'), pg_temp.fx('u4')),
                            'BT043', 'pas d''offre pour une inscription en_attente');
SELECT pg_temp.expect_error(format('SELECT confirmer_liste_attente(999999999, %s)', pg_temp.fx('u4')),
                            'BT041', 'inscription introuvable');

SELECT pg_temp.check(
    (SELECT array_length(billet_ids, 1) = 1 FROM confirmer_liste_attente(pg_temp.fx('w3'), pg_temp.fx('u3'))),
    'confirmation : 1 billet émis');
SELECT pg_temp.check(
    (SELECT statut FROM liste_attente WHERE id = pg_temp.fx('w3')) = 'confirmee'
        AND (SELECT count(*) FROM billets WHERE tarif_id = pg_temp.fx('t_wait') AND utilisateur_id = pg_temp.fx('u3')) = 1,
    'confirmation : inscription confirmee, billet au nom du 2e');
SELECT pg_temp.check(
    (SELECT count(*) FROM billets b JOIN commandes c ON c.id = b.commande_id
     WHERE b.tarif_id = pg_temp.fx('t_wait') AND c.statut = 'paid') = 2,
    'quota respecté : 2 billets payés pour un quota de 2');

-- -----------------------------------------------------------------------------
-- Désinscription pendant une offre → place rendue au suivant (ici personne)
-- -----------------------------------------------------------------------------
CALL rembourser_commande(pg_temp.fx('cmd2'));
SELECT pg_temp.check((SELECT statut FROM liste_attente WHERE id = pg_temp.fx('w4')) = 'notifiee',
                     'second désistement : le 3e est notifié');
SELECT annuler_liste_attente(pg_temp.fx('w4'), pg_temp.fx('u4'));
SELECT pg_temp.check(
    (SELECT statut FROM liste_attente WHERE id = pg_temp.fx('w4')) = 'annulee'
        AND (SELECT r.statut FROM reservations r JOIN liste_attente la ON la.reservation_id = r.id
             WHERE la.id = pg_temp.fx('w4')) = 'annulee'
        AND places_restantes(pg_temp.fx('t_wait')) = 1,
    'désinscription : offre rendue, place libre');
SELECT pg_temp.expect_error(format('SELECT annuler_liste_attente(%s, %s)', pg_temp.fx('w4'), pg_temp.fx('u4')),
                            'BT043', 'désinscription déjà close');

-- -----------------------------------------------------------------------------
-- FIFO strict : une tête trop grosse n'est pas doublée
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    INSERT INTO fx SELECT 'big1', commande_id FROM acheter_billet(pg_temp.fx('u1'), pg_temp.fx('t_big'), 1);
    PERFORM acheter_billet(pg_temp.fx('u1'), pg_temp.fx('t_big'), 1);
    INSERT INTO fx VALUES ('b2', inscrire_liste_attente(pg_temp.fx('u2'), pg_temp.fx('t_big'), 2));
    INSERT INTO fx VALUES ('b3', inscrire_liste_attente(pg_temp.fx('u3'), pg_temp.fx('t_big'), 1));
END $$;
CALL rembourser_commande(pg_temp.fx('big1'));
SELECT pg_temp.check(
    (SELECT statut FROM liste_attente WHERE id = pg_temp.fx('b2')) = 'en_attente'
        AND (SELECT statut FROM liste_attente WHERE id = pg_temp.fx('b3')) = 'en_attente',
    'FIFO strict : 1 place libre, tête à 2 places → personne n''est notifié');

ROLLBACK;
