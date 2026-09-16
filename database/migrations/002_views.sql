-- =============================================================================
-- 002_views.sql — Vues d'analyse et vue matérialisée
--
-- Chaîne de dépendances :
--
--   evenements, tarifs, billets, commandes
--        │
--        └── v_ventes_par_evenement
--                 ├── v_remplissage
--                 └── v_classement_lieux
--
--   commandes, billets ── mv_ventes_quotidiennes (matérialisée)
--
-- Conséquence : DROP VIEW v_ventes_par_evenement échoue tant que les vues
-- dépendantes existent (ERROR 2BP01 dependent_objects_still_exist).
-- DROP … CASCADE supprimerait silencieusement les vues filles : à éviter.
-- Modifier la vue parente : CREATE OR REPLACE VIEW ne permet que d'AJOUTER des
-- colonnes en fin de liste ; renommer/retirer une colonne impose de recréer la chaîne.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_ventes_par_evenement — source des autres vues
-- Tous les événements, y compris sans vente (LEFT JOIN, CA = 0).
-- -----------------------------------------------------------------------------
CREATE VIEW v_ventes_par_evenement AS
WITH ventes AS (
    SELECT t.evenement_id,
           count(*)         AS billets_vendus,
           sum(b.prix_paye) AS ca
    FROM billets b
    JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
    JOIN tarifs t    ON t.id = b.tarif_id
    GROUP BY t.evenement_id
)
SELECT e.id                          AS evenement_id,
       e.nom,
       e.slug,
       e.statut,
       e.debut,
       e.organisateur_id,
       e.lieu_id,
       e.type_evenement_id,
       coalesce(v.billets_vendus, 0) AS billets_vendus,
       coalesce(v.ca, 0)::numeric(14,2) AS ca
FROM evenements e
LEFT JOIN ventes v ON v.evenement_id = e.id;

COMMENT ON VIEW v_ventes_par_evenement IS
    'Billets vendus (commandes paid) et CA par événement ; événements sans vente inclus. Source de v_remplissage et v_classement_lieux.';

-- -----------------------------------------------------------------------------
-- v_remplissage — dépend de v_ventes_par_evenement
-- -----------------------------------------------------------------------------
CREATE VIEW v_remplissage AS
WITH places AS (
    SELECT evenement_id, sum(quota) AS places
    FROM tarifs
    WHERE actif
    GROUP BY evenement_id
)
SELECT v.evenement_id,
       v.nom,
       v.statut,
       v.debut,
       v.organisateur_id,
       coalesce(p.places, 0)  AS places,
       v.billets_vendus,
       round(v.billets_vendus::numeric / nullif(p.places, 0), 4) AS taux_remplissage
FROM v_ventes_par_evenement v
LEFT JOIN places p ON p.evenement_id = v.evenement_id;

COMMENT ON VIEW v_remplissage IS
    'Taux de remplissage = billets vendus / somme des quotas des tarifs actifs. NULL si aucune place.';

-- -----------------------------------------------------------------------------
-- v_classement_lieux — dépend de v_ventes_par_evenement
-- -----------------------------------------------------------------------------
CREATE VIEW v_classement_lieux AS
SELECT l.id                                   AS lieu_id,
       l.nom,
       l.ville,
       count(v.evenement_id)                  AS nb_evenements,
       coalesce(sum(v.billets_vendus), 0)     AS billets_vendus,
       coalesce(sum(v.ca), 0)::numeric(14,2)  AS ca,
       rank() OVER (ORDER BY coalesce(sum(v.ca), 0) DESC)                    AS rang,
       rank() OVER (PARTITION BY l.ville ORDER BY coalesce(sum(v.ca), 0) DESC) AS rang_ville
FROM lieux l
LEFT JOIN v_ventes_par_evenement v ON v.lieu_id = l.id
GROUP BY l.id, l.nom, l.ville;

COMMENT ON VIEW v_classement_lieux IS
    'Classement des lieux par CA (global et par ville) ; lieux sans vente inclus.';

-- -----------------------------------------------------------------------------
-- mv_ventes_quotidiennes — données stockées, rafraîchies explicitement
-- -----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_ventes_quotidiennes AS
SELECT (c.created_at AT TIME ZONE 'Europe/Paris')::date AS jour,
       count(DISTINCT c.id)                             AS commandes,
       count(*)                                         AS billets,
       sum(b.prix_paye)::numeric(14,2)                  AS ca
FROM commandes c
JOIN billets b ON b.commande_id = c.id
WHERE c.statut = 'paid'
GROUP BY 1
WITH DATA;

-- Obligatoire pour REFRESH MATERIALIZED VIEW CONCURRENTLY : un index UNIQUE
-- simple (sans WHERE ni expression) couvrant toutes les lignes.
CREATE UNIQUE INDEX uq_mv_ventes_quotidiennes_jour ON mv_ventes_quotidiennes (jour);

COMMENT ON MATERIALIZED VIEW mv_ventes_quotidiennes IS
    'Ventes par jour (Europe/Paris). Non temps réel : rafraîchir avec pnpm db:refresh-mv.';
