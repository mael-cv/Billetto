# Phase 08 — Documentation, Docker final, CI

## Objectifs
- Rendre le projet reproductible depuis zéro et démontrable en soutenance.

## Spécifications
- `doc/` : architecture, database, security, performance, api, decisions.
- README : démarrage, services, comptes de démonstration, section « Démonstration SQL avancé » (CTE → RLS).
- Stack Docker complète (`postgres`, `pgadmin`, `api`, `web`) démarrant avec `docker compose up -d --wait`.
- GitHub Actions : install, lint, build, tests (avec un service PostgreSQL).

## Critères d'acceptation
- [ ] Un clone neuf suit le README sans étape manquante.
- [ ] La CI est verte.
- [ ] Les 20 points de la Definition of Done sont cochés.
- [ ] Les 6 démonstrations de soutenance sont scriptées.
