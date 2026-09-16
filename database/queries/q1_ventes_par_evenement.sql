-- Q1 — Ventes par événement
-- Outils : CTE + LEFT JOIN
--
-- Une vente = un billet dont la commande est au statut 'paid'.
-- Le LEFT JOIN part de evenements : les événements sans vente sont conservés
-- avec 0 billet et un CA de 0 (COALESCE). Un INNER JOIN les ferait disparaître.

WITH ventes AS (
    SELECT t.evenement_id,
           count(*)         AS billets_vendus,
           sum(b.prix_paye) AS ca
    FROM billets b
    JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
    JOIN tarifs t    ON t.id = b.tarif_id
    GROUP BY t.evenement_id
)
SELECT e.id,
       e.nom,
       e.debut,
       e.statut,
       coalesce(v.billets_vendus, 0) AS billets_vendus,
       coalesce(v.ca, 0)             AS ca
FROM evenements e
LEFT JOIN ventes v ON v.evenement_id = e.id
ORDER BY ca DESC, e.id
LIMIT 50;
