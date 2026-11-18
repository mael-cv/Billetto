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
| Base relationnelle | PostgreSQL 17 — SQL versionné (18 migrations), seed set-based, tests SQL et de concurrence, benchmarks `EXPLAIN` | `database/migrations`, `database/seed`, `database/tests`, `database/benchmarks` |
| Base documentaire | MongoDB 7 — 5 collections avec validateurs `$jsonSchema` et index (unique, partiel, texte, TTL), seed déterministe, requêtes `mongosh` | `database/nosql` |
| Infrastructure | Docker Compose (bootstrap, postgres, mongodb, init, seeder, api, web en HTTPS, relais de webhooks Stripe), surcouche de développement (mailpit, pgadmin), CI GitHub Actions | `docker-compose.yml`, `docker-compose.dev.yml`, `Dockerfile`, `.github/workflows` |

## Démarrage

Prérequis : Docker Desktop ≥ 24 (Compose v2). Rien d'autre : aucun fichier à créer, aucun script à lancer.

```bash
git clone https://github.com/mael-cv/Billetto.git && cd Billetto
docker compose up -d
docker compose logs bootstrap        # affiche le jeton d'installation
```

Ouvrir ensuite <https://localhost:3000> : l'**assistant de premier démarrage** s'affiche (le certificat est auto-signé, le navigateur demande de l'accepter une fois).

1. **Jeton d'installation** — celui affiché par `docker compose logs bootstrap`. Il prouve que vous êtes la personne qui a lancé les conteneurs ; il ne sert qu'une fois. Après 5 saisies erronées, un nouveau jeton est émis dans `docker compose logs api`.
2. **Mode**
   - **Test** : charge le jeu de démonstration (100 événements, 10 000 billets, avis, activité) et utilise les clés Stripe de test du dépôt (`infra/stripe/test-keys.env`). Aucune carte réelle n'est débitée ; carte de test `4242 4242 4242 4242`, date future et cryptogramme quelconques.
   - **Réel** : base vide (seul le référentiel des types d'événements est créé), paiements réels avec vos clés Stripe (`sk_live_…` et `whsec_…`), saisies dans l'assistant et vérifiées auprès de Stripe.
3. **Premier administrateur** — e-mail et mot de passe (12 caractères minimum). C'est le seul compte existant au départ ; il attribue ensuite les rôles d'organisateur depuis la page d'administration.

L'application charge ses données, crée le compte, redémarre l'API puis affiche la page de connexion (moins d'une minute). L'assistant est alors définitivement fermé : le rejouer est refusé par l'API et par la base.

**Aucun secret n'existe dans le dépôt ni sur votre machine.** Au premier démarrage, le conteneur `bootstrap` génère tous les mots de passe dans deux volumes Docker : `secrets` (administration des bases, jamais lisible par l'API) et `config` (configuration de l'API, complétée par l'assistant). `docker compose down -v` efface tout et permet de recommencer.

| Service | Accès | Rôle |
|---|---|---|
| Front + API | <https://localhost:3000> (API sous `/api/v1`, santé : `/api/v1/health`) | **seul port publié**, en HTTPS |
| API, PostgreSQL, MongoDB | réseau interne de Compose uniquement | non joignables depuis l'hôte ni le réseau |
| `bootstrap`, `init`, `seeder` | s'exécutent puis s'arrêtent | secrets, migrations et certificat, données et premier administrateur |
| Relais Stripe (`stripe-cli`) | réseau interne | transmet les webhooks Stripe du mode test à l'API |

Vérifier les données chargées (les identifiants sont lus dans les conteneurs, jamais saisis) :

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM billets"'
docker compose exec mongodb sh -c 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$(cat "$MONGO_INITDB_ROOT_PASSWORD_FILE")" --authenticationDatabase admin billetto_nosql --eval "db.activites.countDocuments()"'
```

### Paiement

Les billets ne sont émis que lorsque l'API reçoit le webhook Stripe signé **et** a relu auprès de Stripe que la session est payée, pour le bon montant et la bonne réservation. Un paiement par virement est validé par l'organisateur de l'événement (ou un administrateur) depuis son tableau de bord.

- **Mode test** : les clés viennent de `infra/stripe/test-keys.env`, versionné pour que le projet démarre sans saisie. N'y mettre que des clés de test, de préférence restreintes (`rk_test_…`), et les révoquer après usage. Si le fichier est vide, tout fonctionne sauf le paiement par carte, qui répond « non configuré » ; le virement reste disponible.
- **Mode réel** : Stripe doit pouvoir joindre `https://<votre-domaine>/api/v1/payments/webhook` ; le point de terminaison se déclare dans le tableau de bord Stripe (événement `checkout.session.completed`).

## Endpoints principaux

Liste complète, codes d'erreur et exemples `curl` : [`doc/api.md`](doc/api.md). Base de chaque endpoint : **SQL**, **Mongo** ou **croisé**.

| Méthode | Chemin | Base | Description |
|---|---|---|---|
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | SQL (+ journal Mongo) | comptes et sessions (cookie HttpOnly, CSRF, verrouillage après échecs, révocation à la déconnexion) |
| GET | `/events?q=&ville=&typeId=&from=&to=&prixMax=&sort=` | SQL (+ journal Mongo) | catalogue paginé, filtre par type **et sous-types** (`WITH RECURSIVE`), RLS |
| GET | `/events/:ref` | **croisé** | détail SQL + template MongoDB ; `ref` = id ou slug |
| POST / PATCH / DELETE | `/events`, `/events/:id`, `/events/:id/prices`, `/prices/:id` | SQL | gestion par l'organisateur (RLS : ses événements seulement) |
| POST | `/orders/hold` `{ tarifId, quantite, modePaiement }` | SQL | réservation atomique par `creer_reservation` (verrou, quotas, plafond par compte, codes `BTxxx`) |
| POST | `/orders/holds/:id/checkout` · `/payments/webhook` | SQL (+ journal Mongo) | paiement Stripe (mode test) ; billets émis uniquement par le webhook signé, après relecture de la session et contrôle du montant |
| POST | `/orders/holds/:id/validate-transfer` | SQL (+ journal Mongo) | virement validé par l'organisateur de l'événement ou un admin |
| GET / POST / DELETE | `/tickets/me`, `/orders/me`, `/orders/:id/refund`, `/orders/holds/me`, `/orders/holds/:id` | SQL | billets, commandes, remboursement, suivi et annulation d'une réservation |
| POST | `/waitlist` · `/checkin/scan`, `/checkin/scan/batch` | SQL (+ journal Mongo) | liste d'attente FIFO (une offre se règle comme une réservation), check-in signé HMAC, rejeu offline idempotent |
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

Pour lancer l'API, le front et les tests directement sur la machine (hors conteneurs) :

```bash
pnpm install
pnpm infra:up      # bases et Mailpit publiés sur 127.0.0.1 uniquement, migrations appliquées
pnpm env:pull      # copie la configuration générée dans les volumes vers ./.env (ignoré par git)
pnpm db:init       # jeu de démonstration SQL et MongoDB
pnpm dev           # web :3000 + api :3001, en mode test, sans assistant
```

`pnpm infra:up` ajoute la surcouche `docker-compose.dev.yml` : PostgreSQL (`127.0.0.1:5433`), MongoDB (`127.0.0.1:27017`) et Mailpit (<http://localhost:8025>). pgAdmin est disponible à la demande (`docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile pgadmin up -d pgadmin`, connexion obligatoire avec le compte écrit dans `./.env`, compte SQL en lecture seule `billetto_bi`). Ces outils ne font pas partie de l'instance livrée. Les tests créent leurs propres comptes, avec un mot de passe aléatoire à chaque exécution.

| Commande | Rôle |
|---|---|
| `pnpm test` | tests unitaires (API Jest, web Vitest, outil d'audit) |
| `pnpm db:test` | tests SQL (requêtes, vues, fonctions, triggers, RLS), concurrence (40 achats simultanés), **tests NoSQL** (validateurs, index, explain, requêtes mongosh) |
| `pnpm test:e2e` | tests de bout en bout de l'API sur les deux bases (dont paiement par webhook, virement, plafonds, pages, avis, tendances) ; Stripe y est remplacé par un double en mémoire |
| `pnpm test:e2e:web` | parcours Playwright contre l'instance déployée par `docker compose up -d` (`https://localhost:3000`) : assistant de premier démarrage, visiteur, organisateur, admin, NoSQL, et suite d'attaque dans le navigateur (XSS, redirections, cookies, gardes). Autre instance : `BASE_URL=… COMPOSE_PROJECT=…` |
| `./scripts/pentest.sh` | campagne d'attaque en boîte noire avec `curl` contre l'instance déployée (assistant, authentification, CSRF, accès aux données, paiement, injections, exposition) ; résultats dans [`doc/pentest.md`](doc/pentest.md) |
| `pnpm db:queries:nosql` | exécute les 5 requêtes MongoDB de démonstration dans `mongosh` |
| `pnpm db:benchmark before\|after\|compare` | plans `EXPLAIN (ANALYZE, BUFFERS)` avant/après index (seed FULL) |
| `pnpm db:seed:full` | jeu de données volumineux (1,8 M billets) |
| `./scripts/backup.sh`, `./scripts/restore.sh <dossier>` | sauvegarde / restauration des deux bases (voir `docs/presentation.md` §8) |

Documentation détaillée : [base de données](doc/database.md) · [performance](doc/performance.md).

## Sécurité et secrets

- **Aucun secret par défaut, aucun identifiant en dur.** Le dépôt ne contient ni mot de passe ni compte prédéfini : tous les secrets sont générés au premier démarrage dans des volumes Docker, les identifiants d'administration des bases ne sont jamais montés dans l'API, et les tests créent leurs comptes à la volée. Seule exception, assumée : `infra/stripe/test-keys.env`, des clés Stripe de test. L'API refuse toute valeur publique connue comme secret de session, et une clé Stripe qui ne correspond pas au mode choisi.
- **Premier démarrage protégé.** L'assistant exige un jeton à usage unique visible uniquement dans les journaux Docker, limité en débit et remplacé après 5 erreurs. Tant que l'application n'est pas initialisée, aucune autre route ne répond. Le premier administrateur est créé par un conteneur dédié, jamais par l'API, et la base refuse toute seconde initialisation.
- **Surface exposée minimale.** Seul le front est publié, en HTTPS (HSTS, CSP, en-têtes de sécurité). L'API, PostgreSQL et MongoDB ne sont joignables que sur le réseau interne. pgAdmin et Mailpit n'existent que dans la surcouche de développement, liés à `127.0.0.1`, pgAdmin avec authentification.
- **Moindre privilège en base.** L'API ne se connecte jamais en superutilisateur : compte `billetto_app` + `SET LOCAL ROLE` par transaction, RLS forcée sur toutes les tables métier, `GRANT` colonne par colonne. Côté MongoDB, l'API utilise un compte limité à `readWrite` sur sa seule base.
- **Paiement.** Aucune route ne permet à un acheteur de créer une commande payée. Les billets sont émis par le webhook Stripe signé (horodatage contrôlé, rejeu refusé), après relecture de la session auprès de Stripe et contrôle du montant en base, sous un rôle PostgreSQL dédié qui ne peut rien faire d'autre. Un virement est validé par l'organisateur de l'événement.
- **Abus.** Plafond de places réservées sans paiement par compte, limites de débit par adresse réelle du client (compteurs stricts sur l'authentification et les actions sensibles), verrouillage temporaire d'un compte après des échecs répétés, déconnexion qui révoque les sessions côté serveur, inscription qui ne révèle pas si une adresse a déjà un compte.

Détail des corrections issues de l'audit de sécurité : [`doc/database.md`](doc/database.md) (migrations 017 et 018) et [`doc/api.md`](doc/api.md). Résultats de la campagne d'attaque : [`doc/pentest.md`](doc/pentest.md).

## Outils d'IA utilisés

- **Figma Make** : génération initiale de la maquette et des composants React du front.
- **Claude Code (Anthropic)** : assistance au développement (modules API, scripts de seed et de tests, documentation), relecture de sécurité et mise en conformité avec la grille du projet.

Chaque fichier livré a été relu, exécuté et testé par l'auteur, qui en assume et peut en expliquer chaque ligne (commandes de vérification ci-dessus).

## Publier les images (facultatif)

`./scripts/publish-dockerhub.sh <pseudo>` (ou `.ps1` sous Windows) construit et pousse `billetto-init`, `billetto-api`, `billetto-web`. Pour tirer ces images au lieu de les construire, définir `INIT_IMAGE`, `API_IMAGE` et `WEB_IMAGE` dans l'environnement avant `docker compose up -d`.
