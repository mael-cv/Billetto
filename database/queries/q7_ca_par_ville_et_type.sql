-- Q7 — CA par ville, ventilé par type d'événement racine
-- Outils : WITH RECURSIVE (rattacher chaque type à sa racine) + agrégats FILTER
--
-- FILTER (WHERE …) remplace SUM(CASE WHEN … THEN x END) : plus lisible,
-- et un seul parcours des données produit plusieurs agrégats.

WITH RECURSIVE racines AS (
    SELECT id, id AS racine_id, nom AS racine
    FROM type_evenements
    WHERE parent_id IS NULL
    UNION ALL
    SELECT t.id, r.racine_id, r.racine
    FROM type_evenements t
    JOIN racines r ON t.parent_id = r.id
),
ventes AS (
    SELECT l.ville,
           r.racine,
           t.evenement_id,
           b.prix_paye
    FROM billets b
    JOIN commandes c   ON c.id = b.commande_id AND c.statut = 'paid'
    JOIN tarifs t      ON t.id = b.tarif_id
    JOIN evenements e  ON e.id = t.evenement_id
    JOIN lieux l       ON l.id = e.lieu_id
    JOIN racines r     ON r.id = e.type_evenement_id
)
SELECT ville,
       count(DISTINCT evenement_id)                               AS nb_evenements_vendus,
       sum(prix_paye)                                             AS ca_total,
       coalesce(sum(prix_paye) FILTER (WHERE racine = 'Musique'), 0)          AS ca_musique,
       coalesce(sum(prix_paye) FILTER (WHERE racine = 'Sport'), 0)            AS ca_sport,
       coalesce(sum(prix_paye) FILTER (WHERE racine = 'Arts de la scène'), 0) AS ca_scene,
       coalesce(sum(prix_paye) FILTER (WHERE racine = 'Conférence'), 0)       AS ca_conference,
       count(*) FILTER (WHERE prix_paye >= 100)                   AS billets_premium
FROM ventes
GROUP BY ville
HAVING sum(prix_paye) > 0
ORDER BY ca_total DESC;
