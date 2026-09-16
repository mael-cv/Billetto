-- Q2 — Événements sans aucune vente
-- Outil : NOT EXISTS (anti-jointure)

SELECT e.id, e.nom, e.statut, e.debut
FROM evenements e
WHERE NOT EXISTS (
    SELECT 1
    FROM tarifs t
    JOIN billets b   ON b.tarif_id = t.id
    JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
    WHERE t.evenement_id = e.id
)
ORDER BY e.id;

-- -----------------------------------------------------------------------------
-- Piège NOT IN + NULL
--
-- Question : quels types d'événements n'ont aucun sous-type (feuilles) ?
-- parent_id vaut NULL pour les types racines.
--
-- x NOT IN (a, b, NULL) équivaut à x <> a AND x <> b AND x <> NULL.
-- x <> NULL vaut NULL (inconnu), donc la condition n'est jamais vraie :
-- la requête NOT IN renvoie 0 ligne, sans erreur.
-- -----------------------------------------------------------------------------

-- ❌ 0 ligne
SELECT 'NOT IN' AS methode, count(*) AS feuilles
FROM type_evenements t
WHERE t.id NOT IN (SELECT parent_id FROM type_evenements)

UNION ALL

-- ✅ résultat correct
SELECT 'NOT EXISTS', count(*)
FROM type_evenements t
WHERE NOT EXISTS (SELECT 1 FROM type_evenements c WHERE c.parent_id = t.id);
