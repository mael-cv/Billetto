-- Q4 — Chiffre d'affaires par lieu
-- Outil : LEFT JOIN en chaîne depuis lieux
--
-- Les conditions sur commandes (statut paid) sont dans le ON et non dans le
-- WHERE : un WHERE c.statut = 'paid' éliminerait les lignes NULL produites par
-- le LEFT JOIN et transformerait la requête en INNER JOIN (lieux sans vente perdus).

SELECT l.id,
       l.nom,
       l.ville,
       count(DISTINCT e.id)          AS nb_evenements,
       count(c.id)                   AS billets_vendus,
       coalesce(sum(b.prix_paye) FILTER (WHERE c.id IS NOT NULL), 0) AS ca
FROM lieux l
LEFT JOIN evenements e ON e.lieu_id = l.id
LEFT JOIN tarifs t     ON t.evenement_id = e.id
LEFT JOIN billets b    ON b.tarif_id = t.id
LEFT JOIN commandes c  ON c.id = b.commande_id AND c.statut = 'paid'
GROUP BY l.id, l.nom, l.ville
ORDER BY ca DESC, l.id;
