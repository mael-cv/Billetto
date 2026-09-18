-- =============================================================================
-- 007_multi_tenant.sql — Phase 09 : pages vitrine par collectif
--
-- Le modèle multi-tenant existe déjà depuis 001/005 : chaque organisateur est
-- un tenant isolé par organisateur_id (RLS en cascade sur evenements → tarifs
-- → billets/commandes, voir 005_security.sql §8). Cette migration ajoute
-- uniquement ce qui manquait pour des pages vitrine séparées par collectif :
-- un identifiant public stable (slug) sur organisateurs.
--
-- Règle à suivre pour les phases 10-14 (holds, webhooks, liste d'attente,
-- scans) : toute nouvelle table doit être rattachable à un seul organisateur
-- (directement ou en cascade via evenement_id/tarif_id) ET recevoir sa policy
-- RLS dans la même migration que sa création — jamais une table métier sans
-- RLS ajoutée après coup.
-- =============================================================================

ALTER TABLE organisateurs ADD COLUMN slug text;

-- Backfill : un slug dérivé de nom, unique, avant de poser NOT NULL.
-- Même forme que ck_evenements_slug_format (001_schema.sql) : minuscules,
-- chiffres, mots séparés par un tiret simple.
WITH slugs AS (
    SELECT id,
           row_number() OVER (PARTITION BY base ORDER BY id) AS rang,
           base
    FROM (
        SELECT id,
               regexp_replace(
                   regexp_replace(lower(nom), '[^a-z0-9]+', '-', 'g'),
                   '(^-+|-+$)', '', 'g'
               ) AS base
        FROM organisateurs
    ) AS bases
)
UPDATE organisateurs o
SET slug = CASE WHEN s.rang = 1 THEN s.base ELSE s.base || '-' || s.rang END
FROM slugs s
WHERE s.id = o.id;

ALTER TABLE organisateurs
    ALTER COLUMN slug SET NOT NULL,
    ADD CONSTRAINT uq_organisateurs_slug UNIQUE (slug),
    ADD CONSTRAINT ck_organisateurs_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

COMMENT ON COLUMN organisateurs.slug IS
    'Identifiant public stable du collectif, utilisé pour sa page vitrine séparée.';

-- Lecture publique du slug, même règle de colonnes que (id, nom) : email
-- jamais exposé hors admin.
GRANT SELECT (slug) ON organisateurs TO billetto_visiteur, billetto_organisateur, billetto_readonly;
