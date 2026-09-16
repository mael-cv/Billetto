-- =============================================================================
-- Tests phase 02 — requêtes, vues, vue matérialisée
-- Indépendants du volume (small ou full). Tout est annulé par ROLLBACK.
-- Un échec lève une exception : psql (ON_ERROR_STOP) sort en erreur.
-- =============================================================================

BEGIN;

-- Vente de référence recalculée à partir des tables
CREATE TEMP TABLE attendu ON COMMIT DROP AS
SELECT t.evenement_id, count(*) AS billets, sum(b.prix_paye) AS ca
FROM billets b
JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
JOIN tarifs t    ON t.id = b.tarif_id
GROUP BY t.evenement_id;

-- -----------------------------------------------------------------------------
-- v_ventes_par_evenement (Q1)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    n_vue bigint; n_evt bigint; ecarts bigint; sans_vente_ko bigint;
BEGIN
    SELECT count(*) INTO n_vue FROM v_ventes_par_evenement;
    SELECT count(*) INTO n_evt FROM evenements;
    ASSERT n_vue = n_evt,
        format('v_ventes_par_evenement : %s lignes, %s événements attendus', n_vue, n_evt);

    SELECT count(*) INTO ecarts
    FROM v_ventes_par_evenement v
    LEFT JOIN attendu a ON a.evenement_id = v.evenement_id
    WHERE v.billets_vendus <> coalesce(a.billets, 0) OR v.ca <> coalesce(a.ca, 0);
    ASSERT ecarts = 0, format('v_ventes_par_evenement : %s événements avec un total faux', ecarts);

    SELECT count(*) INTO sans_vente_ko
    FROM v_ventes_par_evenement v
    WHERE NOT EXISTS (SELECT 1 FROM attendu a WHERE a.evenement_id = v.evenement_id)
      AND (v.billets_vendus <> 0 OR v.ca <> 0);
    ASSERT sans_vente_ko = 0, 'événements sans vente : billets et CA doivent valoir 0';

    ASSERT EXISTS (SELECT 1 FROM v_ventes_par_evenement WHERE billets_vendus = 0),
        'le jeu de données doit contenir des événements sans vente';
    RAISE NOTICE 'OK v_ventes_par_evenement';
END $$;

-- -----------------------------------------------------------------------------
-- Q2 — événements sans vente + piège NOT IN
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    n_not_exists bigint; n_attendu bigint; n_not_in bigint; n_feuilles bigint;
BEGIN
    SELECT count(*) INTO n_not_exists
    FROM evenements e
    WHERE NOT EXISTS (
        SELECT 1 FROM tarifs t
        JOIN billets b   ON b.tarif_id = t.id
        JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
        WHERE t.evenement_id = e.id);
    SELECT count(*) INTO n_attendu FROM v_ventes_par_evenement WHERE billets_vendus = 0;
    ASSERT n_not_exists = n_attendu,
        format('Q2 NOT EXISTS : %s, attendu %s', n_not_exists, n_attendu);

    SELECT count(*) INTO n_not_in
    FROM type_evenements t WHERE t.id NOT IN (SELECT parent_id FROM type_evenements);
    SELECT count(*) INTO n_feuilles
    FROM type_evenements t
    WHERE NOT EXISTS (SELECT 1 FROM type_evenements c WHERE c.parent_id = t.id);
    ASSERT n_not_in = 0, 'piège NOT IN : 0 ligne attendue à cause des parent_id NULL';
    ASSERT n_feuilles = 12, format('NOT EXISTS : 12 feuilles attendues, %s obtenues', n_feuilles);
    RAISE NOTICE 'OK Q2 (NOT IN = %, NOT EXISTS = %)', n_not_in, n_feuilles;
END $$;

-- -----------------------------------------------------------------------------
-- v_remplissage (Q3)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    ecarts bigint; hors_bornes bigint;
BEGIN
    SELECT count(*) INTO ecarts
    FROM v_remplissage r
    LEFT JOIN (SELECT evenement_id, sum(quota) AS places FROM tarifs WHERE actif GROUP BY 1) p
           ON p.evenement_id = r.evenement_id
    WHERE r.places <> coalesce(p.places, 0);
    ASSERT ecarts = 0, format('v_remplissage : %s événements avec des places fausses', ecarts);

    SELECT count(*) INTO hors_bornes
    FROM v_remplissage
    WHERE taux_remplissage < 0 OR taux_remplissage > 1;
    ASSERT hors_bornes = 0, format('v_remplissage : %s taux hors [0, 1]', hors_bornes);

    ASSERT (SELECT count(*) FROM v_remplissage) = (SELECT count(*) FROM evenements),
        'v_remplissage : une ligne par événement attendue';
    RAISE NOTICE 'OK v_remplissage';
END $$;

-- -----------------------------------------------------------------------------
-- v_classement_lieux (Q4)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    n_lieux bigint; n_vue bigint; ca_vue numeric; ca_total numeric;
BEGIN
    SELECT count(*) INTO n_lieux FROM lieux;
    SELECT count(*), sum(ca) INTO n_vue, ca_vue FROM v_classement_lieux;
    SELECT coalesce(sum(ca), 0) INTO ca_total FROM attendu;
    ASSERT n_vue = n_lieux, format('v_classement_lieux : %s lignes, %s lieux', n_vue, n_lieux);
    ASSERT ca_vue = ca_total, format('v_classement_lieux : CA %s, attendu %s', ca_vue, ca_total);
    ASSERT (SELECT min(rang) FROM v_classement_lieux) = 1, 'le classement doit commencer à 1';
    RAISE NOTICE 'OK v_classement_lieux';
END $$;

-- Lieu sans aucun événement : doit apparaître avec CA = 0
INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
VALUES ('Test lieu vide', '1 rue du Test', 'Testville', '99999', 100);

DO $$
BEGIN
    ASSERT EXISTS (SELECT 1 FROM v_classement_lieux
                   WHERE nom = 'Test lieu vide' AND ca = 0 AND nb_evenements = 0),
        'un lieu sans événement doit apparaître avec CA = 0';
    RAISE NOTICE 'OK lieu sans vente conservé';
END $$;

-- -----------------------------------------------------------------------------
-- Q6 — les trois formulations donnent le même résultat
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    a bigint; b bigint; c bigint; piege bigint;
BEGIN
    SELECT count(*) INTO a FROM (
        SELECT u.id FROM utilisateurs u
        LEFT JOIN commandes c ON c.utilisateur_id = u.id
        GROUP BY u.id HAVING count(c.id) = 0) s;
    SELECT count(*) INTO c FROM utilisateurs u
    WHERE NOT EXISTS (SELECT 1 FROM commandes c WHERE c.utilisateur_id = u.id);
    SELECT count(*) INTO piege FROM (
        SELECT u.id FROM utilisateurs u
        LEFT JOIN commandes c ON c.utilisateur_id = u.id
        GROUP BY u.id HAVING count(*) = 0) s;

    ASSERT a = c, format('Q6 : LEFT JOIN/COUNT = %s, NOT EXISTS = %s', a, c);
    ASSERT c > 0, 'le jeu de données doit contenir des utilisateurs sans commande';
    ASSERT piege = 0, 'piège COUNT(*) après LEFT JOIN : ne vaut jamais 0';
    RAISE NOTICE 'OK Q6 (% utilisateurs sans commande ; COUNT(*) piégé = %)', c, piege;
END $$;

-- -----------------------------------------------------------------------------
-- Q8 — WITH RECURSIVE
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE arbre ON COMMIT DROP AS
WITH RECURSIVE a AS (
    SELECT id, nom, 1 AS niveau, nom::text AS chemin, ARRAY[id] AS ids
    FROM type_evenements WHERE parent_id IS NULL
    UNION ALL
    SELECT t.id, t.nom, a.niveau + 1, a.chemin || ' > ' || t.nom, a.ids || t.id
    FROM type_evenements t JOIN a ON t.parent_id = a.id
    WHERE t.id <> ALL (a.ids) AND a.niveau < 10
)
SELECT * FROM a;

DO $$
BEGIN
    ASSERT (SELECT count(*) FROM arbre) = (SELECT count(*) FROM type_evenements),
        'l''arbre doit contenir tous les types';
    ASSERT (SELECT max(niveau) FROM arbre) = 3, 'profondeur maximale attendue : 3';
    ASSERT EXISTS (SELECT 1 FROM arbre WHERE chemin = 'Musique > Concert > Rock' AND niveau = 3),
        'chemin Musique > Concert > Rock attendu';
    RAISE NOTICE 'OK WITH RECURSIVE';
END $$;

-- -----------------------------------------------------------------------------
-- Dépendances : DROP VIEW de la vue parente refusé
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        EXECUTE 'DROP VIEW v_ventes_par_evenement';
        RAISE EXCEPTION 'DROP VIEW v_ventes_par_evenement aurait dû échouer';
    EXCEPTION WHEN dependent_objects_still_exist THEN
        RAISE NOTICE 'OK DROP VIEW bloqué : %', SQLERRM;
    END;
END $$;

-- -----------------------------------------------------------------------------
-- Vue vs vue matérialisée : fraîcheur
-- -----------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW mv_ventes_quotidiennes;

CREATE TEMP TABLE avant ON COMMIT DROP AS
SELECT
    (SELECT billets_vendus FROM v_ventes_par_evenement WHERE evenement_id = t.evenement_id) AS vue,
    coalesce((SELECT billets FROM mv_ventes_quotidiennes WHERE jour = date '2030-01-01'), 0) AS mv,
    t.id AS tarif_id, t.prix
FROM tarifs t
ORDER BY t.id
LIMIT 1;

WITH u AS (SELECT id FROM utilisateurs ORDER BY id DESC LIMIT 1),
     cmd AS (
        INSERT INTO commandes (utilisateur_id, statut, montant_total, created_at)
        SELECT u.id, 'paid', a.prix * 3, timestamptz '2030-01-01 12:00:00+01'
        FROM u, avant a
        RETURNING id, utilisateur_id)
INSERT INTO billets (tarif_id, commande_id, utilisateur_id, prix_paye, created_at)
SELECT a.tarif_id, cmd.id, cmd.utilisateur_id, a.prix, timestamptz '2030-01-01 12:00:00+01'
FROM cmd, avant a, generate_series(1, 3);

DO $$
DECLARE
    r record; vue_apres bigint; mv_apres bigint;
BEGIN
    SELECT * INTO r FROM avant;
    SELECT billets_vendus INTO vue_apres
    FROM v_ventes_par_evenement v JOIN tarifs t ON t.evenement_id = v.evenement_id
    WHERE t.id = r.tarif_id;
    SELECT coalesce((SELECT billets FROM mv_ventes_quotidiennes WHERE jour = date '2030-01-01'), 0)
    INTO mv_apres;

    ASSERT vue_apres = r.vue + 3, format('la vue doit voir la vente immédiatement (%s → %s)', r.vue, vue_apres);
    ASSERT mv_apres = r.mv, 'la vue matérialisée ne doit pas changer avant REFRESH';
    RAISE NOTICE 'OK avant refresh : vue % → %, MV inchangée (%)', r.vue, vue_apres, mv_apres;
END $$;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ventes_quotidiennes;

DO $$
DECLARE
    r record; mv_apres bigint; ecarts bigint;
BEGIN
    SELECT * INTO r FROM avant;
    SELECT billets INTO mv_apres FROM mv_ventes_quotidiennes WHERE jour = date '2030-01-01';
    ASSERT mv_apres = r.mv + 3, format('après REFRESH CONCURRENTLY : %s billets attendus, %s', r.mv + 3, mv_apres);

    -- La MV rafraîchie correspond exactement au calcul direct
    SELECT count(*) INTO ecarts FROM (
        SELECT (c.created_at AT TIME ZONE 'Europe/Paris')::date AS jour,
               count(DISTINCT c.id) AS commandes, count(*) AS billets, sum(b.prix_paye) AS ca
        FROM commandes c JOIN billets b ON b.commande_id = c.id
        WHERE c.statut = 'paid' GROUP BY 1
        EXCEPT
        SELECT jour, commandes, billets, ca FROM mv_ventes_quotidiennes
    ) d;
    ASSERT ecarts = 0, format('mv_ventes_quotidiennes : %s jours incohérents', ecarts);
    RAISE NOTICE 'OK après REFRESH CONCURRENTLY : MV = %', mv_apres;
END $$;

ROLLBACK;
