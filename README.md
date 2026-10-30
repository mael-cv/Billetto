# Billetto

https://canva.link/6j4o04nwduhqlv1

Billetterie événementielle full-stack construite autour d'un cours de SQL avancé PostgreSQL :
PostgreSQL calcule, contrôle et protège ; l'API et le front restent fins.

- **Front** : React 19 / TypeScript / Vite / Tailwind (conçu avec Figma Make) — `apps/web`
- **API** : NestJS + Fastify, Prisma & Driver MongoDB — `apps/api`
- **Base SQL (Relationnelle)** : PostgreSQL 17, SQL versionné (données transactionnelles, RLS, quotas) — `database/`
- **Base NoSQL (Documentaire)** : MongoDB 7.0 (templates visuels et structurels des événements et des billets)
- **Outils** : Docker Compose, pgAdmin, Mailpit

> **Architecture hybride SQL / NoSQL** : PostgreSQL stocke les données critiques (tarifs, stocks, réservations, utilisateurs, paiements, check-in) ; MongoDB stocke les documents de templates (thèmes, couleurs, sections, FAQ, instructions de sécurité, filigranes des billets). L'API fusionne le template NoSQL avec les données en temps réel issues du SQL.

## Démarrage rapide (Tout automatisé via Docker Compose)

Le conteneur `init` vérifie automatiquement l'état des bases au lancement : il applique les migrations SQL, peuple PostgreSQL (`seed:small` + `seed:demo`) et injecte les templates NoSQL dans MongoDB si les bases sont neuves, puis démarre l'API et le Web :

```bash
docker compose up -d
```

### Démarrage en développement local (sans conteneurs applicatifs)

```bash
cp .env.example .env              # puis adapter les mots de passe si nécessaire
docker compose up -d --wait postgres mongodb mailpit pgadmin
pnpm install
pnpm db:init                      # vérifie et applique migrations, seeds SQL et MongoDB
pnpm dev                          # Web :3000 + API :3001
```

## Rendu pour le professeur

Pour rendre le projet, seuls deux fichiers sont requis :
1. Le fichier `docker-compose.yml`
2. Le fichier `.env` configuré avec votre `DOCKER_USER`

Le professeur exécute simplement :
```bash
docker compose up -d
```
Docker Compose télécharge automatiquement toutes les images depuis Docker Hub, exécute l'initialisation automatique, puis met à disposition tous les services.

### Publier vos images sur Docker Hub avant le rendu :
- **Sous Windows (PowerShell) :**
  ```powershell
  ./scripts/publish-dockerhub.ps1 -DockerUser votre_pseudo_dockerhub
  ```
- **Sous Linux / macOS :**
  ```bash
  ./scripts/publish-dockerhub.sh votre_pseudo_dockerhub
  ```

## Services

| Service       | URL                          | Rôle |
|---------------|------------------------------|------|
| **Web**       | http://localhost:3000        | Interface React 19 / Tailwind |
| **API**       | http://localhost:3001/api/v1 | Backend NestJS (PostgreSQL + MongoDB) |
| **Mailpit**   | http://localhost:8025        | Boîte SMTP de développement |
| **pgAdmin**   | http://localhost:8080        | Administration PostgreSQL |
| **PostgreSQL**| localhost:5433               | Base SQL relationnelle 3NF |
| **MongoDB**   | localhost:27017              | Base NoSQL documents (templates) |

Le port hôte PostgreSQL est 5433 pour ne pas entrer en conflit avec une installation locale (modifiable via `POSTGRES_PORT`).
Dans pgAdmin, le serveur « Billetto (lecture seule) » est préconfiguré avec le compte `billetto_bi` (lecture seule, sans données personnelles) ; le mot de passe est celui de `READONLY_DB_PASSWORD`, posé par `pnpm db:migrate`. Pour administrer la base, ajouter manuellement une connexion `billetto_owner` (`POSTGRES_PASSWORD`).

## Commandes

| Commande | Rôle |
|----------|------|
| `pnpm infra:up` / `pnpm infra:down` | Démarrer / arrêter PostgreSQL et pgAdmin |
| `pnpm db:migrate` | Appliquer les migrations SQL et activer la connexion `billetto_app` (`APP_DB_PASSWORD`) |
| `pnpm db:reset` | Supprimer le schéma et réappliquer les migrations |
| `pnpm db:seed:small` / `pnpm db:seed:full` | Charger les données (`SEED=20260916` par défaut) |
| `pnpm db:test` | Tests SQL (requêtes, vues, MV, fonctions, triggers, sécurité) + connexion réelle `billetto_app` + concurrence d'achat |
| `pnpm db:refresh-mv` | Rafraîchir la vue matérialisée (`--blocking` pour le mode classique) |
| `pnpm db:benchmark before\|after\|compare` | Plans `EXPLAIN (ANALYZE, BUFFERS)` avant/après index (seed FULL) |
| `pnpm db:seed:demo` | (Re)créer les comptes de démonstration |
| `pnpm test` | Tests unitaires et d'intégration de tous les packages (API + Web) |
| `pnpm test:e2e` | Tests de bout en bout de l'API sur la base |
| `pnpm test:e2e:web` | Tests de bout en bout du front Playwright (visiteur, achat, orga, admin, sécurité) |
| `pnpm db:pull` | Régénérer `prisma/schema.prisma` depuis la base |
| `pnpm dev` / `pnpm build` / `pnpm lint` | Développement, build de production et qualité |

## Webhook de paiement (phase 11)

L’API expose `POST /api/v1/payments/webhook`. Le corps JSON attendu contient `eventId`, `type` et `reservationId`. La signature est le HMAC-SHA256 hexadécimal du corps brut exact, transmis dans `X-Billetto-Signature`. Le secret partagé `PAYMENTS_WEBHOOK_SECRET` doit contenir au moins 32 caractères aléatoires ; configurez-le dans `.env` (voir `.env.example`) : `docker compose` refuse de démarrer sans lui. Une API lancée hors compose sans secret répond `503`.

Le type `payment.succeeded` confirme la réservation. Les autres types, comme `payment.failed`, sont journalisés sans créer de billets. L’identifiant externe est unique : un rejeu concurrent ou ultérieur ne confirme pas une deuxième fois la réservation. Le journal webhook et la confirmation sont dans la même transaction.

Générez le secret avec :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
## Comptes de démonstration

| E-mail | Rôle |
|--------|------|
| `demo-visiteur@billetto.test` | visiteur |
| `demo-organisateur@billetto.test` | organisateur |
| `demo-admin@billetto.test` | administrateur |

Mot de passe : valeur de `DEMO_PASSWORD` dans `.env` (développement uniquement).

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
- [Sécurité](doc/security.md)
- [Prompt d’audit général de sécurité](doc/prompt-audit-securite.md) — revue en lecture seule à lancer avant toute modification
- [Analyse d’architecture orientée sécurité](doc/analyse-architecture-securite.md) — frontières de confiance et invariants à préserver lors d’une évolution
- [Autorisation et RBAC](doc/authorization-rbac.md) — accès fermé par défaut, rôles API et isolation par ressource
- [Sécurité de l’API](doc/api-security.md) — contrôles serveur indépendants du frontend et limites de déploiement
- [API](doc/api.md)
- [Décisions](doc/decisions.md)

## Démonstration SQL avancé
Les démonstrations sont ajoutées phase par phase : CTE, `NOT EXISTS`, `WITH RECURSIVE`, vues, vue matérialisée, `EXPLAIN ANALYZE`, index, fonctions, procédures, triggers, `GRANT`/`REVOKE`, `SECURITY DEFINER`, RLS.
