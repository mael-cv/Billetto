-- Q3 — Taux de remplissage par événement
-- Outils : deux CTE indépendants, agrégés séparément puis joints
--
-- Agréger places et ventes dans le même GROUP BY après jointure tarifs × billets
-- multiplierait les quotas par le nombre de billets (fan-out). D'où deux CTE.

WITH places AS (
    SELECT evenement_id, sum(quota) AS places
    FROM tarifs
    GROUP BY evenement_id
),
vendus AS (
    SELECT t.evenement_id, count(*) AS vendus
    FROM billets b
    JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
    JOIN tarifs t    ON t.id = b.tarif_id
    GROUP BY t.evenement_id
)
SELECT e.id,
       e.nom,
       p.places,
       coalesce(v.vendus, 0) AS vendus,
       round(coalesce(v.vendus, 0)::numeric / nullif(p.places, 0), 4) AS taux_remplissage
FROM evenements e
JOIN places p      ON p.evenement_id = e.id
LEFT JOIN vendus v ON v.evenement_id = e.id
ORDER BY taux_remplissage DESC NULLS LAST, e.id
LIMIT 50;
