-- =============================================================================
-- Tests phase 14 — dashboard temps réel : vendu / réservé / liste d'attente
-- Jeu d'essai propre, annulé par ROLLBACK. Les identifiants sont passés par
-- set_config('test.*') : la table temporaire fx n'est pas lisible une fois
-- passé sous le rôle billetto_organisateur.
-- La cohérence sous charge est testée par database/scripts/concurrency.mjs.
-- =============================================================================

BEGIN;

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
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO billetto_organisateur;

-- -----------------------------------------------------------------------------
-- Jeu d'essai : collectif A (quota 10) et collectif B
--   A : 3 vendus, 1 remboursé, hold actif de 2, hold expiré de 4,
--       offre de liste d'attente (1, notifiee → réservé), 2 inscrits en_attente (1 + 3)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_lieu bigint; v_orga_a bigint; v_orga_b bigint; v_evt_a bigint; v_evt_b bigint;
    v_tarif_a bigint; v_tarif_b bigint; v_user bigint; v_u2 bigint; v_u3 bigint; v_cmd bigint; v_res bigint;
BEGIN
    INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
    VALUES ('Test Salle Live', '1 rue du Test', 'Testville', '99000', 500) RETURNING id INTO v_lieu;
    INSERT INTO organisateurs (nom, email, slug) VALUES ('Test Live A', 'test-live-a@billetto.test', 'test-live-a')
    RETURNING id INTO v_orga_a;
    INSERT INTO organisateurs (nom, email, slug) VALUES ('Test Live B', 'test-live-b@billetto.test', 'test-live-b')
    RETURNING id INTO v_orga_b;
    INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
    VALUES (v_orga_a, v_lieu, (SELECT min(id) FROM type_evenements), 'Live A', 'test-live-a',
            now() + interval '30 days', now() + interval '31 days', 'published') RETURNING id INTO v_evt_a;
    INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
    VALUES (v_orga_b, v_lieu, (SELECT min(id) FROM type_evenements), 'Live B', 'test-live-b',
            now() + interval '30 days', now() + interval '31 days', 'published') RETURNING id INTO v_evt_b;
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
    VALUES (v_evt_a, 'Standard', 20, 10, now() - interval '1 day', now() + interval '29 days') RETURNING id INTO v_tarif_a;
    INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
    VALUES (v_evt_b, 'Standard', 20, 10, now() - interval '1 day', now() + interval '29 days') RETURNING id INTO v_tarif_b;

    INSERT INTO utilisateurs (email, password_hash, prenom, nom) VALUES ('test-live-1@billetto.test', 'x', 'T', 'Un')
    RETURNING id INTO v_user;
    INSERT INTO utilisateurs (email, password_hash, prenom, nom) VALUES ('test-live-2@billetto.test', 'x', 'T', 'Deux')
    RETURNING id INTO v_u2;
    INSERT INTO utilisateurs (email, password_hash, prenom, nom) VALUES ('test-live-3@billetto.test', 'x', 'T', 'Trois')
    RETURNING id INTO v_u3;

    PERFORM set_config('test.evt_a', v_evt_a::text, true);
    PERFORM set_config('test.evt_b', v_evt_b::text, true);
    INSERT INTO utilisateurs (email, password_hash, prenom, nom, role_app, organisateur_id)
    VALUES ('test-live-orga-a@billetto.test', 'x', 'Orga', 'A', 'organizer', v_orga_a) RETURNING id INTO v_res;
    PERFORM set_config('test.orga_a', v_res::text, true);
    INSERT INTO utilisateurs (email, password_hash, prenom, nom, role_app, organisateur_id)
    VALUES ('test-live-orga-b@billetto.test', 'x', 'Orga', 'B', 'organizer', v_orga_b) RETURNING id INTO v_res;
    PERFORM set_config('test.orga_b', v_res::text, true);

    -- Ventes : 3 payés + 1 remboursé (non compté). B : 5 vendus.
    PERFORM acheter_billet(v_user, v_tarif_a, 3);
    SELECT commande_id INTO v_cmd FROM acheter_billet(v_user, v_tarif_a, 1);
    CALL rembourser_commande(v_cmd);
    PERFORM acheter_billet(v_user, v_tarif_b, 5);

    -- Holds : 2 actifs ; 4 expirés (lazy, statut encore 'active').
    PERFORM creer_reservation(v_user, v_tarif_a, 2, 'carte');
    SELECT reservation_id INTO v_res FROM creer_reservation(v_user, v_tarif_a, 4, 'carte');
    UPDATE reservations SET expire_a = now() - interval '1 second' WHERE id = v_res;

    -- Liste d'attente : une offre (1 place, réservée) + deux inscrits en attente.
    -- Insertion directe : le tarif n'est pas complet, l'inscription normale lèverait BT040.
    INSERT INTO reservations (tarif_id, utilisateur_id, quantite, statut, mode_paiement, prix_unitaire, expire_a)
    VALUES (v_tarif_a, v_u2, 1, 'active', 'carte', 20, now() + interval '30 minutes') RETURNING id INTO v_res;
    INSERT INTO liste_attente (tarif_id, utilisateur_id, quantite_souhaitee, statut, reservation_id, notifie_a, expire_a)
    VALUES (v_tarif_a, v_u2, 1, 'notifiee', v_res, now(), now() + interval '30 minutes');
    INSERT INTO liste_attente (tarif_id, utilisateur_id, quantite_souhaitee) VALUES (v_tarif_a, v_u3, 1);
    INSERT INTO liste_attente (tarif_id, utilisateur_id, quantite_souhaitee) VALUES (v_tarif_a, v_user, 3);
END $$;

-- -----------------------------------------------------------------------------
-- Chiffres (superutilisateur, sans RLS)
-- -----------------------------------------------------------------------------
SELECT pg_temp.check(
    (SELECT billets_vendus = 3 AND billets_reserves = 3 AND places_liste_attente = 4
     FROM v_ventes_par_evenement WHERE evenement_id = current_setting('test.evt_a')::bigint),
    'v_ventes_par_evenement : 3 vendus, 3 réservés (hold 2 + offre 1, hold expiré exclu), 4 en attente');
SELECT pg_temp.check(
    (SELECT places = 10 AND taux_remplissage = 0.3 AND taux_occupation = 0.6
     FROM v_remplissage WHERE evenement_id = current_setting('test.evt_a')::bigint),
    'v_remplissage : taux de remplissage 0,3, taux d''occupation 0,6');
SELECT pg_temp.check(
    (SELECT billets_reserves = 0 AND places_liste_attente = 0
     FROM v_remplissage WHERE evenement_id = current_setting('test.evt_b')::bigint),
    'événement sans hold ni file : 0 / 0');
SELECT pg_temp.check(
    (SELECT (SELECT billets_reserves FROM v_remplissage WHERE evenement_id = current_setting('test.evt_a')::bigint)
            = (SELECT p.n FROM (SELECT places_occupees(t.id) - 3 AS n FROM tarifs t
                                WHERE t.evenement_id = current_setting('test.evt_a')::bigint) p)),
    'réservé = places_occupees - vendus (même règle que le quota)');

-- -----------------------------------------------------------------------------
-- Isolation multi-tenant (RLS, rôle organisateur)
-- -----------------------------------------------------------------------------
SET LOCAL ROLE billetto_organisateur;
SELECT set_config('app.user_id', current_setting('test.orga_a'), true);
SELECT pg_temp.check(
    (SELECT billets_vendus = 3 AND billets_reserves = 3 AND places_liste_attente = 4
     FROM v_remplissage WHERE evenement_id = current_setting('test.evt_a')::bigint),
    'organisateur A : ses chiffres complets');
SELECT pg_temp.check(
    NOT EXISTS (SELECT 1 FROM v_remplissage WHERE evenement_id = current_setting('test.evt_b')::bigint),
    'organisateur A : événement de B invisible');
SELECT pg_temp.check(
    (SELECT bool_and(organisateur_id = (SELECT organisateur_id FROM v_remplissage
                                        WHERE evenement_id = current_setting('test.evt_a')::bigint))
     FROM v_remplissage),
    'organisateur A : uniquement son collectif dans la vue');

SELECT set_config('app.user_id', current_setting('test.orga_b'), true);
SELECT pg_temp.check(
    NOT EXISTS (SELECT 1 FROM v_remplissage WHERE evenement_id = current_setting('test.evt_a')::bigint),
    'organisateur B : événement de A invisible');
SELECT pg_temp.check(
    (SELECT billets_vendus = 5 AND billets_reserves = 0 FROM v_remplissage
     WHERE evenement_id = current_setting('test.evt_b')::bigint),
    'organisateur B : ses propres chiffres');
RESET ROLE;

ROLLBACK;
