# Phase 01 — Bootstrap, schéma, seed

## Objectifs
- Mettre en place le monorepo (front, API, base) et l'infrastructure Docker locale.
- Poser un schéma PostgreSQL en 3FN où PostgreSQL garantit l'intégrité (contraintes déclaratives).
- Disposer d'un jeu de données reproductible, en petit volume (dev) et en volume réel (benchmarks).

## Spécifications

### Monorepo (pnpm workspaces)
- `apps/web` : front Figma Make (React 19, Vite, Tailwind v4), déplacé depuis la racine.
- `apps/api` : NestJS 11 + Fastify, TypeScript strict, ESLint, Prettier, `PrismaService` global, `GET /api/v1/health` (vérifie la base).
- `database/` : migrations SQL versionnées, seed, scripts d'exécution.
- `prisma/schema.prisma` : **généré par `prisma db pull`** depuis la base (le SQL reste la source de vérité).

### Infrastructure
- `docker-compose.yml` : `postgres` (17, healthcheck, volume), `pgadmin` (8080, serveur préconfiguré sans mot de passe), `api` (3001), `web` (3000).
- Port hôte PostgreSQL : `5433` par défaut (`POSTGRES_PORT`) pour éviter un conflit avec un PostgreSQL installé localement.
- Secrets uniquement via `.env` (ignoré par git) ; `.env.example` fourni.

### Schéma (`database/migrations/001_schema.sql`)
- 12 tables : `organisateurs`, `lieux`, `type_evenements`, `evenements`, `evenement_attributs`, `tarifs`, `utilisateurs`, `amities`, `commandes`, `billets`, `paiements`, `journal_tarifs`.
- Nommage : snake_case, `pk_` / `fk_` / `uq_` / `ck_`.
- Contraintes : `NOT NULL`, `CHECK` (prix ≥ 0, quota > 0, fin > debut, statuts, auto-amitié interdite, signe des paiements…), `UNIQUE`, `FOREIGN KEY` avec `ON DELETE` explicite.
- **Aucun index pédagogique** : seuls ceux induits par PK/UNIQUE (les index de FK arrivent en phase 03).
- Migrations appliquées une par une en transaction, tracées dans `schema_migrations`.

### Seed (`database/seed/seed.sql`)
- 100 % set-based (`generate_series` + `INSERT … SELECT`), exécuté dans le conteneur via `psql`.
- Déterministe : valeurs dérivées de `hashtextextended(sel, SEED)`, date de référence fixe `2026-09-16`.

| Mode  | Événements | Tarifs | Utilisateurs | Billets   |
|-------|-----------:|-------:|-------------:|----------:|
| small | 100        | 300    | 1 000        | 10 000    |
| full  | 5 001      | 15 001 | 100 000      | 1 800 000 |

- Cas pédagogiques garantis : événements sans vente (Q2), utilisateurs sans commande (Q6), commandes non payées / remboursées, arbre de types sur 3 niveaux.

## Critères d'acceptation
- [ ] `docker compose up -d --wait postgres pgadmin` démarre et les services sont `healthy`.
- [ ] `pnpm install` puis `pnpm db:migrate` crée les 12 tables ; relancer `db:migrate` ne fait rien.
- [ ] `pnpm db:reset` recrée un schéma vide et réapplique les migrations.
- [ ] `pnpm db:seed:small` produit exactement 100 / 300 / 1 000 / 10 000 lignes.
- [ ] `pnpm db:seed:full` produit 5 001 / 15 001 / 100 000 / 1 800 000 lignes.
- [ ] Deux seeds successifs avec la même `SEED` donnent la même empreinte (`database/scripts/checksum.sql`).
- [ ] Aucun billet n'excède le quota de son tarif ; aucun billet n'est créé après le début de l'événement.
- [ ] pgAdmin (http://localhost:8080) affiche la base avec tables et contraintes.
- [ ] `pnpm db:pull` génère `prisma/schema.prisma` ; `pnpm build` et `pnpm lint` passent.
- [ ] `GET http://localhost:3001/api/v1/health` renvoie `{"status":"ok","database":"up"}`.
- [ ] Aucun secret versionné.
