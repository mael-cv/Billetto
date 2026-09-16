-- B4 — Prochains événements publiés (page d'accueil)
-- Index visé : idx_evenements_debut
SELECT e.id, e.nom, e.slug, e.debut
FROM evenements e
WHERE e.statut = 'published'
  AND e.debut >= timestamptz '2026-09-16 12:00:00+02'
  AND e.debut <  timestamptz '2026-09-16 12:00:00+02' + interval '7 days'
ORDER BY e.debut
LIMIT 20;
