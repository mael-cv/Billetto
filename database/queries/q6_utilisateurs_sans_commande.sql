-- Q6 — Utilisateurs n'ayant jamais commandé
-- Comparaison : LEFT JOIN + GROUP BY + COUNT = 0  vs  NOT EXISTS

-- Version A : LEFT JOIN + COUNT(c.id) = 0
-- Piège : COUNT(*) compterait la ligne produite par le LEFT JOIN (valeurs NULL)
-- et vaudrait 1, jamais 0. Il faut compter une colonne du côté optionnel.
-- Coût : la jointure matérialise toutes les commandes avant d'agréger.
SELECT u.id, u.email
FROM utilisateurs u
LEFT JOIN commandes c ON c.utilisateur_id = u.id
GROUP BY u.id, u.email
HAVING count(c.id) = 0
ORDER BY u.id;

-- Version B : sous-requête corrélée COUNT(*) = 0
-- Correcte, mais compte TOUTES les commandes de chaque utilisateur
-- alors qu'une seule suffit à répondre. Sans index sur commandes.utilisateur_id
-- (phase 03), c'est un parcours complet de commandes PAR utilisateur :
-- inutilisable sur le seed FULL (100 000 × 900 000 lignes).
SELECT u.id, u.email
FROM utilisateurs u
WHERE (SELECT count(*) FROM commandes c WHERE c.utilisateur_id = u.id) = 0
ORDER BY u.id;

-- Version C : NOT EXISTS — recommandée
-- Planifiée en Hash Anti Join / Nested Loop Anti Join : s'arrête à la
-- première commande trouvée. Intention explicite, robuste aux NULL.
SELECT u.id, u.email
FROM utilisateurs u
WHERE NOT EXISTS (SELECT 1 FROM commandes c WHERE c.utilisateur_id = u.id)
ORDER BY u.id;

-- Pour comparer les plans :
-- EXPLAIN (ANALYZE, BUFFERS) <requête>;
