# Billetto

Billetterie événementielle complète (organisateurs, événements, tarifs, achats sans survente, réservations, liste d'attente, check-in QR, avis, tendances) construite sur **deux familles de bases de données** :

- **PostgreSQL 17** (relationnelle) : tout ce qui engage de l'argent ou des droits — utilisateurs, événements, tarifs, quotas, commandes, billets, paiements, réservations, check-in. Transactions, contraintes, fonctions, triggers, RLS, rôle applicatif restreint.
- **MongoDB 7** (documentaire) : tout ce qui décrit, commente ou mesure — pages éditoriales des événements (programme, médias, FAQ), avis des acheteurs avec réponse de l'organisateur, journal d'activité (vues, recherches, achats, scans) avec index TTL, templates visuels.

L'API croise les deux bases : la fiche d'un événement vient de PostgreSQL et sa page de MongoDB ; le classement « Tendances » est calculé par un pipeline MongoDB puis filtré par le catalogue PostgreSQL ; un avis n'est accepté dans MongoDB qu'après vérification d'un billet payé dans PostgreSQL.

📄 **Document de présentation** : [`docs/presentation.md`](docs/presentation.md) (architecture, MCD/MLD/MPD, modèle documentaire, justification des choix, requêtes, index, sauvegarde).
🎬 **Vidéo** : [`docs/video/`](docs/video/README.md).
📘 Référence API : [`doc/api.md`](doc/api.md).

## Pile technique

| Couche | Technologie | Dossier |
|---|---|---|
| Front (bonus) | React 19, TypeScript, Vite, Tailwind v4 (maquette Figma Make), servi par nginx | `apps/web` |
| API | NestJS + Fastify, Prisma (`$queryRaw`) pour PostgreSQL, driver officiel `mongodb`, Zod, cookies HttpOnly + CSRF, rate-limit | `apps/api` |
| Base relationnelle | PostgreSQL 17 — SQL versionné (16 migrations), seed set-based, tests SQL et de concurrence, benchmarks `EXPLAIN` | `database/migrations`, `database/seed`, `database/tests`, `database/benchmarks` |
| Base documentaire | MongoDB 7 — 5 collections avec validateurs `$jsonSchema` et index (unique, partiel, texte, TTL), seed déterministe, requêtes `mongosh` | `database/nosql` |
| Infrastructure | Docker Compose (postgres, mongodb, init, api, web, mailpit, pgadmin), CI GitHub Actions | `docker-compose.yml`, `Dockerfile`, `.github/workflows` |

## Démarrage en une commande

Prérequis : Docker Desktop ≥ 24 (Compose v2). Aucun autre outil, aucun fichier `.env` à créer : `docker-compose.yml` contient des valeurs de démonstration, remplacées par un `.env` s'il existe (voir `.env.example`).

```bash
git clone https://github.com/mael-cv/Billetto.git && cd Billetto
docker compose up -d
```

Le conteneur `init` applique les migrations SQL, charge le jeu de données (10 000 billets), crée le schéma MongoDB (validateurs, index) et le peuple (100 pages, ≈ 2 100 avis, ≈ 20 000 activités), puis l'API et le front démarrent. Suivre : `docker compose logs -f init`. Premier lancement ≈ 2 min (build des images) ; relances en quelques secondes (les seeds ne sont rejoués que si une base est vide).

| Service | URL | Rôle |
|---|---|---|
| Front | <http://localhost:3000> | application React |
| API | <http://localhost:3001/api/v1> — santé : [`/health`](http://localhost:3001/api/v1/health) | REST, PostgreSQL + MongoDB |
| pgAdmin | <http://localhost:8080> (`admin@billetto.org` / `billetto-pgadmin`) | serveur « Billetto (lecture seule) » préconfiguré, compte `billetto_bi` (mot de passe `billetto_bi_pass`) |
| Mailpit | <http://localhost:8025> | boîte SMTP de développement |
| PostgreSQL | `localhost:5433` (`billetto_owner` / `billetto_owner_pass`, base `billetto`) | 5433 pour ne pas gêner une instance locale |
| MongoDB | `localhost:27017` (`billetto_mongo` / `billetto_mongo_pass`, base `billetto_nosql`, `authSource=admin`) | |

Comptes de démonstration (mot de passe `Billetto-Demo-2026!`) : `demo-visiteur@billetto.test` (visiteur), `demo-organisateur@billetto.test` (organisateur), `demo-admin@billetto.test` (administrateur).

Vérifier les données chargées :

```bash
docker compose exec postgres psql -U billetto_owner -d billetto -c "SELECT count(*) FROM billets"
docker compose exec mongodb mongosh -u billetto_mongo -p billetto_mongo_pass --authenticationDatabase admin billetto_nosql --eval "db.activites.countDocuments()"
```

Arrêt : `docker compose down` (garde les données) ou `docker compose down -v` (repart de zéro).

## Endpoints principaux

Liste complète, codes d'erreur et exemples `curl` : [`doc/api.md`](doc/api.md). Base de chaque endpoint : **SQL**, **Mongo** ou **croisé**.

| Méthode | Chemin | Base | Description |
|---|---|---|---|
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | SQL (+ journal Mongo) | comptes et sessions (cookie HttpOnly, CSRF) |
| GET | `/events?q=&ville=&typeId=&from=&to=&prixMax=&sort=` | SQL (+ journal Mongo) | catalogue paginé, filtre par type **et sous-types** (`WITH RECURSIVE`), RLS |
| GET | `/events/:ref` | **croisé** | détail SQL + template MongoDB ; `ref` = id ou slug |
| POST / PATCH / DELETE | `/events`, `/events/:id`, `/events/:id/prices`, `/prices/:id` | SQL | gestion par l'organisateur (RLS : ses événements seulement) |
| POST | `/tickets/purchase` `{ tarifId, quantite }` | SQL (+ journal Mongo) | achat atomique par `acheter_billet` (verrou, quotas, codes `BTxxx`) |
| GET / POST | `/tickets/me`, `/orders/me`, `/orders/:id/refund`, `/orders/hold`, `/orders/:id/confirm` | SQL | billets, commandes, remboursement, réservation TTL |
| POST | `/waitlist`, `/waitlist/:id/confirm` · `/checkin/scan`, `/checkin/scan/batch` | SQL (+ journal Mongo) | liste d'attente FIFO, check-in signé HMAC, rejeu offline idempotent |
| GET | `/analytics/summary`, `/analytics/live`, `/analytics/daily-sales` | SQL | vues `v_ventes_par_evenement`, `v_remplissage`, `mv_ventes_quotidiennes` |
| GET / PUT / DELETE | `/events/:ref/page` | **croisé** | page éditoriale (programme, médias, sections, FAQ) ; écriture réservée au propriétaire |
| GET / POST | `/events/:ref/avis`, `/events/:id/avis` | **croisé** | avis paginés + stats (pipeline `$group`) ; création si billet payé (403 sinon), un avis par acheteur (409) |
| PATCH / DELETE / POST | `/avis/:id`, `/avis/:id/reponse` · GET `/organizer/avis` | Mongo / croisé | modification par l'auteur, réponse imbriquée de l'organisateur |
| GET | `/events/tendances?jours=7&limit=8` | **croisé** | score MongoDB (vues, achats, scans) → événements publiés PostgreSQL |
| POST / GET / DELETE | `/activites`, `/activites/evenements/:id`, `/activites?avant=` | Mongo / croisé | journal d'activité (TTL 90 j), série `$dateTrunc` pour l'organisateur, purge admin |
| GET | `/health` | les deux | `{ status, database, mongodb }`, 503 si l'une manque |

## Structure du dépôt

L'arborescence suit l'esprit de la consigne (`docker/`, `init-sql`, `init-nosql`, `api`, `front`, `docs`) avec les noms d'un monorepo pnpm :

```text
docker-compose.yml, Dockerfile     la pile complète (équivalent de /docker)
database/
  migrations/                      création du schéma relationnel, commentée (équivalent /docker/init-sql)
  seed/seed.sql                    peuplement PostgreSQL déterministe (small : 10 000 billets ; full : 1,8 M)
  nosql/                           création + peuplement MongoDB (équivalent /docker/init-nosql)
    schema.mjs                     collections, validateurs $jsonSchema, index (unique, partiel, texte, TTL)
    seed-nosql.mjs                 pages, avis, activités générés à partir des identifiants SQL
    queries/*.mongodb.js           5 requêtes mongosh commentées (pipelines, filtres imbriqués, texte, séries)
    tests/                         tests NoSQL (validateurs, index, volume, explain)
  queries/                         8 requêtes SQL commentées (CTE, LEFT JOIN, HAVING, FILTER, NOT EXISTS, WITH RECURSIVE)
  tests/, benchmarks/              tests SQL + concurrence ; plans EXPLAIN avant/après index
  scripts/                         migrate, seed, init-auto (conteneur init), test, benchmark
apps/api/                          API NestJS (équivalent /api) — src/modules/{events,tickets,…,event-pages,reviews,activity}
apps/web/                          front React (équivalent /front, bonus)
docs/                              presentation.md, schemas/ (MCD, MLD, architecture : .mmd + .png), video/
doc/                               documentation technique détaillée (base, performance, sécurité, API, décisions, phases)
scripts/                           backup.sh / restore.sh, render-schemas.mjs, publication Docker Hub
infra/                             nginx, pgAdmin
```

## Développement et tests

```bash
cp .env.example .env                                     # facultatif : surcharger les défauts
docker compose up -d --wait postgres mongodb mailpit     # bases seules
pnpm install && pnpm db:init                             # migrations + seeds SQL et MongoDB
pnpm dev                                                 # web :3000 + api :3001
```

| Commande | Rôle |
|---|---|
| `pnpm test` | tests unitaires (API Jest, web Vitest, outil d'audit) |
| `pnpm db:test` | tests SQL (requêtes, vues, fonctions, triggers, RLS), concurrence (40 achats simultanés), **tests NoSQL** (validateurs, index, explain, requêtes mongosh) |
| `pnpm test:e2e` | 72 tests de bout en bout de l'API sur les deux bases (dont pages, avis, tendances) |
| `pnpm test:e2e:web` | parcours Playwright (visiteur, organisateur, admin, sécurité, NoSQL) — si le port 3000 est pris : `WEB_PORT=3100 CORS_ORIGIN=http://localhost:3100 pnpm test:e2e:web` |
| `pnpm db:queries:nosql` | exécute les 5 requêtes MongoDB de démonstration dans `mongosh` |
| `pnpm db:benchmark before\|after\|compare` | plans `EXPLAIN (ANALYZE, BUFFERS)` avant/après index (seed FULL) |
| `pnpm db:seed:full` | jeu de données volumineux (1,8 M billets) |
| `./scripts/backup.sh`, `./scripts/restore.sh <dossier>` | sauvegarde / restauration des deux bases (voir `docs/presentation.md` §8) |

Documentation détaillée : [base de données](doc/database.md) · [performance](doc/performance.md).

## Sécurité et secrets

Aucun secret réel n'est versionné : les valeurs du `docker-compose.yml` et de `.env.example` sont des défauts de démonstration (l'init affiche un avertissement quand ils sont utilisés). Pour tout autre usage, créer un `.env` avec des secrets générés (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`). L'API ne se connecte jamais en superutilisateur : compte `billetto_app` + `SET LOCAL ROLE` par transaction, RLS, `GRANT` colonne par colonne ; le webhook de paiement est signé HMAC-SHA256 (`PAYMENTS_WEBHOOK_SECRET`) et idempotent.

## Outils d'IA utilisés

- **Figma Make** : génération initiale de la maquette et des composants React du front.
- **Claude Code (Anthropic)** : assistance au développement (modules API, scripts de seed et de tests, documentation), relecture de sécurité et mise en conformité avec la grille du projet.

Chaque fichier livré a été relu, exécuté et testé par l'auteur, qui en assume et peut en expliquer chaque ligne (commandes de vérification ci-dessus).

## Publier les images (facultatif)

`./scripts/publish-dockerhub.sh <pseudo>` (ou `.ps1` sous Windows) construit et pousse `billetto-init`, `billetto-api`, `billetto-web` ; `DOCKER_USER=<pseudo>` dans `.env` permet alors à `docker compose up -d` de tirer les images sans build.
