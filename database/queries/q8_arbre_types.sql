-- Q8 — Arbre des types d'événements
-- Outil : WITH RECURSIVE
--
--   ancre      : les racines (parent_id IS NULL), niveau 1
--   UNION ALL  : pas de dédoublonnage (inutile dans un arbre, et plus rapide)
--   récursion  : on joint les enfants de la ligne précédente
--   arrêt      : la récursion s'arrête quand plus aucun enfant n'est trouvé.
--                Garde-fous en plus : pas de cycle (id déjà dans le chemin)
--                et profondeur maximale.

WITH RECURSIVE arbre AS (
    -- ancre
    SELECT t.id,
           t.parent_id,
           t.nom,
           1                  AS niveau,
           t.nom::text        AS chemin,
           ARRAY[t.id]        AS ids
    FROM type_evenements t
    WHERE t.parent_id IS NULL

    UNION ALL

    -- partie récursive
    SELECT enfant.id,
           enfant.parent_id,
           enfant.nom,
           a.niveau + 1,
           a.chemin || ' > ' || enfant.nom,
           a.ids || enfant.id
    FROM type_evenements enfant
    JOIN arbre a ON enfant.parent_id = a.id
    WHERE enfant.id <> ALL (a.ids)   -- protection contre les cycles
      AND a.niveau < 10              -- profondeur maximale
)
SELECT id,
       nom,
       niveau,
       chemin,
       repeat('  ', niveau - 1) || nom AS affichage
FROM arbre
ORDER BY ids;
