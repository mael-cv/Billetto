# Billetto

Billetterie événementielle full-stack construite autour d'un cours de SQL avancé PostgreSQL :
PostgreSQL calcule, contrôle et protège ; l'API et le front restent fins.

- **Front** : React 19 / TypeScript / Vite / Tailwind (conçu avec Figma Make) — `apps/web`
- **API** : NestJS + Fastify, Prisma — `apps/api`
- **Base** : PostgreSQL 17, SQL versionné — `database/`
- **Outils** : Docker Compose, pgAdmin

> Avancement : voir [doc/phases](doc/phases/README.md). Phases 01 (bootstrap, schéma, seed), 02 (SQL avancé, vues), 03 (index, EXPLAIN) et 04 (fonctions, triggers) livrées.

## Prérequis
- Docker Desktop
- Node.js 22 et pnpm 10 (voir `.mise.toml`)

## Démarrage

```bash
cp .env.example .env              # puis changer les mots de passe
docker compose up -d --wait postgres pgadmin
pnpm install
pnpm db:migrate
pnpm db:seed:small
pnpm dev                          # web :3000 + api :3001
```

Seed volumineux pour les benchmarks (1,8 M de billets) :

```bash
pnpm db:seed:full
```

Stack complète en conteneurs : `docker compose up -d --wait`.

## Services

| Service    | URL                          |
|------------|------------------------------|
| Web        | http://localhost:3000        |
| API        | http://localhost:3001/api/v1 |
| pgAdmin    | http://localhost:8080        |
| PostgreSQL | localhost:5433               |

Le port hôte PostgreSQL est 5433 pour ne pas entrer en conflit avec une installation locale (modifiable via `POSTGRES_PORT`).
Dans pgAdmin, le serveur « Billetto (docker) » est préconfiguré ; le mot de passe est celui de `POSTGRES_PASSWORD`.

## Commandes

| Commande | Rôle |
|----------|------|
| `pnpm infra:up` / `pnpm infra:down` | Démarrer / arrêter PostgreSQL et pgAdmin |
| `pnpm db:migrate` | Appliquer les migrations SQL |
| `pnpm db:reset` | Supprimer le schéma et réappliquer les migrations |
| `pnpm db:seed:small` / `pnpm db:seed:full` | Charger les données (`SEED=20260916` par défaut) |
| `pnpm db:test` | Tests SQL (requêtes, vues, MV, fonctions, triggers) + test de concurrence d'achat |
| `pnpm db:refresh-mv` | Rafraîchir la vue matérialisée (`--blocking` pour le mode classique) |
| `pnpm db:benchmark before\|after\|compare` | Plans `EXPLAIN (ANALYZE, BUFFERS)` avant/après index (seed FULL) |
| `pnpm db:pull` | Régénérer `prisma/schema.prisma` depuis la base |
| `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm test` | Développement et qualité |

## Structure

```text
apps/web        front React (Figma Make)
apps/api        API NestJS + Fastify
database/
  migrations/   SQL versionné (source de vérité du schéma)
  queries/      requêtes d'analyse du cours (Q1–Q8)
  tests/        tests SQL
  benchmarks/   requêtes, plans avant/après, comparatif
  seed/         seed set-based déterministe
  scripts/      migrate / seed / checksum
prisma/         schema.prisma généré par db pull
infra/pgadmin   configuration pgAdmin
doc/            documentation et phases
```

## Documentation
- [Phases : objectifs, spécifications, critères d'acceptation](doc/phases/README.md)
- [Base de données](doc/database.md)
- [Performance](doc/performance.md)
- [Décisions](doc/decisions.md)

## Démonstration SQL avancé
Les démonstrations sont ajoutées phase par phase : CTE, `NOT EXISTS`, `WITH RECURSIVE`, vues, vue matérialisée, `EXPLAIN ANALYZE`, index, fonctions, procédures, triggers, `GRANT`/`REVOKE`, `SECURITY DEFINER`, RLS.
