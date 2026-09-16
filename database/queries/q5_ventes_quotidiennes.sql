-- Q5 — Ventes quotidiennes
-- Jour calculé en heure de Paris (created_at est un timestamptz).

SELECT (c.created_at AT TIME ZONE 'Europe/Paris')::date AS jour,
       count(DISTINCT c.id)                             AS commandes,
       count(*)                                         AS billets,
       sum(b.prix_paye)                                 AS ca
FROM commandes c
JOIN billets b ON b.commande_id = c.id
WHERE c.statut = 'paid'
GROUP BY jour
ORDER BY jour DESC
LIMIT 60;
