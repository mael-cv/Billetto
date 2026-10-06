# Décisions d'architecture

Le cours fournit la liste des tables, pas toutes leurs colonnes. Les choix ci-dessous complètent le modèle pour que l'application puisse exister.

## D1 — SQL versionné comme source de vérité, Prisma en `db pull`
Les migrations sont des fichiers `database/migrations/NNN_*.sql` appliqués par `database/scripts/migrate.mjs` (une transaction par fichier, table `schema_migrations`).
`prisma migrate` n'est pas utilisé : il ne sait pas exprimer proprement vues, MV, fonctions, triggers, RLS et GRANT, et générerait ses propres noms de contraintes.
`prisma/schema.prisma` est régénéré par `pnpm db:pull` après chaque migration.

## D2 — `psql` exécuté dans le conteneur
Les scripts appellent `docker compose exec postgres psql`. Aucun client PostgreSQL local n'est nécessaire et la version de `psql` correspond à celle du serveur. `database/` est monté en lecture seule sur `/database`.

## D3 — Port hôte 5433
Un PostgreSQL Windows peut déjà écouter sur 5432. Le port hôte est donc `5433` par défaut (`POSTGRES_PORT`). À l'intérieur du réseau Docker, le port reste 5432.

## D4 — Clés `bigint GENERATED ALWAYS AS IDENTITY`
Plutôt que `serial` (obsolète) ou UUID (index plus gros, moins lisible en TP). `billets.code` est un UUID : c'est l'identifiant exposé au client, non devinable.

## D5 — Statuts en `text` + `CHECK`
Plutôt qu'un type `ENUM` : ajouter une valeur à un `CHECK` est une migration simple et transactionnelle, et Prisma les lit comme `String`.

## D6 — Colonnes ajoutées au modèle du cours
| Table | Colonne | Raison |
|-------|---------|--------|
| `utilisateurs` | `organisateur_id` | Relier un compte `organizer` à son organisateur, nécessaire à la RLS (« ne voit que ses événements »). `CHECK` : présent si et seulement si `role_app = 'organizer'`. |
| `paiements` | `type` (`charge`/`refund`) | Un remboursement est un paiement négatif ; `CHECK` sur le signe du montant selon le type. |
| `journal_tarifs` | `auteur` | Savoir quel rôle PostgreSQL a modifié le tarif. Pas de FK vers `tarifs` pour conserver l'historique après suppression. |
| `evenements` | `type_evenement_id` | Extension pédagogique pour `WITH RECURSIVE`. |
| `amities` | `statut` | `pending` / `accepted` / `blocked`. |

## D7 — Montants en `numeric`
`numeric(10,2)` pour les prix, `numeric(12,2)` pour les totaux : pas d'erreurs d'arrondi de `float`.

## D8 — Seed déterministe sans `random()`
`setseed()` + `random()` dépend de l'ordre d'exécution (parallélisme, plan). Les valeurs sont dérivées de `hashtextextended(sel || n, SEED)`, identiques quel que soit le plan. Toutes les dates partent d'une référence fixe (`2026-09-16 12:00+02`) et non de `now()`.

## D9 — Règles du seed
- 2 billets par commande, un seul tarif par commande.
- Commandes : 90 % `paid`, 4 % `pending`, 3 % `cancelled`, 3 % `refunded`.
- Événements `id % 20 = 0` publiés mais sans vente ; `id % 25 = 0` en `draft`, `id % 31 = 0` en `cancelled`.
- Les 10 % d'utilisateurs aux identifiants les plus élevés ne commandent jamais.
- Le quota de chaque tarif est calculé après les billets (vendus + marge) : aucune survente.
- Les comptes seedés ont un hash invalide (`!seed-no-login`) : pas de connexion possible. Les comptes de démonstration arrivent en phase 06.

## D10 — Documentation dans `doc/`
Un seul dossier de documentation, `doc/`, avec `doc/phases/` (un fichier par phase : objectifs, spécifications, critères d'acceptation).

## D11 — Erreurs métier en SQLSTATE `BTxxx`
Les fonctions lèvent des codes dédiés (`BT001`…`BT020`, liste dans `database.md`). La classe `BT` n'est pas utilisée par PostgreSQL. L'API mappe le code vers un statut HTTP sans analyser le texte, qui peut évoluer.

## D12 — Verrou pessimiste pour l'achat
`SELECT … FOR UPDATE` sur la ligne du tarif, en `READ COMMITTED`. Simple, sans compteur dénormalisé ni logique de rejeu côté API (contrairement à `SERIALIZABLE`). Contention limitée aux acheteurs d'un même tarif.

## D13 — Places occupées = commandes `paid` + `pending`
Une commande en attente réserve ses places ; `cancelled` et `refunded` les libèrent. Le paiement est simulé : `acheter_billet` crée directement une commande `paid` et un paiement `succeeded`. Une intégration réelle créerait une commande `pending` confirmée par un webhook du prestataire.

## D14 — Remboursement uniquement avant le début de l'événement
Règle métier ajoutée (`BT012`) : un billet pour un événement commencé ou passé n'est plus remboursable.

## D15 — Trigger de date basé sur `billets.created_at`
Comparer à `now()` empêcherait de charger un historique de ventes (seed). La garantie « pas de billet après le début » repose sur `created_at` ; les écritures directes dans `billets` seront retirées à l'application en phase 05, et `acheter_billet` laisse `created_at = now()`.

## D16 — Index `billets.utilisateur_id` ajouté en 004
Non créé en 003 faute de requête le justifiant ; mesuré avant/après avec le benchmark B10 (corps de `billets_utilisateur`) : 129 ms → 1,2 ms.

## D17 — Un compte technique unique + SET LOCAL ROLE
L'API se connecte avec `billetto_app`, membre des rôles métier **avec l'option SET mais sans INHERIT** (syntaxe PostgreSQL 16+). Hors `SET ROLE`, il n'a aucun droit. Chaque requête endosse le rôle correspondant à `utilisateurs.role_app` et positionne `app.user_id`, le tout local à la transaction. Alternative écartée : un rôle PostgreSQL par utilisateur final (incompatible avec un pool de connexions, gestion des comptes en double).

## D18 — Contexte utilisateur par `set_config('app.user_id', …, true)`
Recommandé par le cours pour une connexion technique partagée. Le troisième argument `true` limite la valeur à la transaction.

## D19 — Policies `col = ANY (ARRAY(SELECT …))` pour l'organisateur
Mesuré : 820–1 010 ms → 18–28 ms sur la vue de ventes (seed FULL). `EXISTS` conservé pour le visiteur, dont l'ensemble autorisé est grand. Détails dans `security.md`.

## D20 — Contrôle d'identité dans les fonctions SECURITY DEFINER
`controler_acteur()` (`BT013`). La maintenance sans contexte reste possible pour une session superutilisateur, ce qui garde seed, scripts et tests des phases précédentes inchangés.

## D21 — Remboursement administrateur = procédure séparée
`admin_rembourser_commande` (EXECUTE admin seulement) plutôt qu'un paramètre booléen : le droit est porté par PostgreSQL, pas par une valeur que l'appelant contrôle.

## D22 — `billets_utilisateur` passe en SECURITY DEFINER
Sous RLS, un acheteur ne verrait plus ses billets d'un tarif désactivé ou d'un événement annulé (policies du catalogue). La fonction contrôle l'identité et lit sans RLS.

## D23 — Événements `finished` visibles des visiteurs
La policy visiteur autorise `published` et `finished` (historique consultable), pas `draft` ni `cancelled`.

## D24 — RLS aussi sur `utilisateurs`
Le filtrage de colonnes ne suffisait pas : un visiteur pouvait lister les noms de tous les comptes. Chaque visiteur ou organisateur ne voit que sa ligne.

## D25 — Session JWT HS256 signée avec `node:crypto`, en cookie HttpOnly
Pas de bibliothèque JWT : `jose` 6 est ESM-only (incompatible avec Jest en CommonJS) et le besoin se limite à HS256. En-tête fixe comparé octet par octet (pas de `alg: none` ni de confusion d'algorithme), signature comparée en temps constant, charge validée par Zod, expiration obligatoire. Jeton sans état : la révocation immédiate n'est pas possible avant expiration (2 h) — compromis accepté pour le projet ; une table de sessions permettrait la révocation.

## D26 — CSRF « double submit » en plus de SameSite=Strict
Cookie `billetto_csrf` lisible + en-tête `X-CSRF-Token` identique, exigé sur toute méthode modifiante, login et register compris (protection contre le « login CSRF »). Rotation du jeton à l'ouverture de session.

## D27 — `set_config('role', …, true)` plutôt que `SET LOCAL ROLE`
Équivalent, mais paramétrable : le nom du rôle n'est jamais interpolé dans le SQL (liste blanche + paramètre). Vérifié : l'appartenance de `billetto_app` est contrôlée de la même façon (`42501` pour `billetto_readonly`).

## D28 — Données d'acheteur toujours sous `billetto_visiteur`
Les policies acheteur (commandes, billets, paiements) ne s'appliquent qu'au rôle visiteur. Un organisateur ou un admin qui achète passe par ce rôle pour ses données personnelles ; ses droits d'organisateur restent utilisés pour la gestion.

## D29 — `places_restantes()` (migration 006)
Le catalogue public doit afficher la disponibilité, mais un visiteur ne peut pas compter les billets d'autrui. Fonction `SECURITY DEFINER` qui ne renvoie qu'un entier agrégé, avec la même règle que `acheter_billet` (commandes `paid` + `pending`).

## D30 — Admin : totaux depuis la vue matérialisée
Sur 1,8 M de billets, agréger les vues à chaque affichage du tableau de bord admin coûte ≈ 1,5 s. Le résumé et les ventes quotidiennes de l'admin lisent `mv_ventes_quotidiennes` (fraîcheur = dernier `REFRESH`). L'organisateur, filtré par RLS, lit les vues (≈ 20 ms, voir `security.md`).

## D31 — 404 pour une ressource invisible
Une ressource filtrée par la RLS ou appartenant à autrui répond 404, pas 403, pour ne pas révéler son existence. `rembourser_commande` d'autrui est d'abord vérifiée comme visible.

## D32 — Hash Argon2id factice pour les comptes inconnus
Le login vérifie un vrai hash Argon2id même quand l'e-mail n'existe pas : même message et temps de réponse comparable, pas d'énumération des comptes par chronométrage. L'inscription révèle en revanche qu'un e-mail existe (409) — compromis d'ergonomie courant.

## D33 — Tests e2e : `--experimental-vm-modules`
@fastify/cookie 11 charge `cookie` par `import()` dynamique, refusé par Jest sans cette option Node. Le code applicatif n'est pas concerné.

## D34 — Routeur front par hash sans dépendance
Le front utilise un routeur par hash (`window.location.hash`) implémenté dans `apps/web/src/router.tsx` avec extraction des paramètres dynamiques (`:id`, `:slug`), querystrings (`useQueryParams`), navigation programmatique et composants de garde (`<RequireAuth>`). Aucun composant ou paquet lourd tiers (`react-router`) n'est requis ; compatible avec tout serveur de fichiers statiques.

## D35 — Négociation et retry transparent du jeton CSRF
Le client HTTP (`apps/web/src/api/http.ts`) lit le jeton CSRF depuis le cookie `billetto_csrf` ou appelle `GET /auth/csrf` avant toute requête modifiante (`POST`, `PUT`, `PATCH`, `DELETE`). En cas d'erreur 403 `CSRF_INVALIDE` (jeton périmé ou désynchronisé), le client renouvelle le jeton une fois et rejoue automatiquement la requête avant de propager l'erreur.

## D36 — Conteneur Nginx pour le web avec reverse proxy `/api`
Le build de production du front est servi par un conteneur Nginx léger (`infra/nginx/nginx.conf`). Nginx sert les assets statiques avec gzip et cache immutable, applique le fallback SPA (`try_files $uri $uri/ /index.html;`), et relaie les requêtes `/api/` vers le conteneur API (`http://api:3001/api/`), éliminant tout enjeu CORS et exposant un port unique pour les déploiements conteneurisés.

## D37 — Isolation des sessions et purge du cache de requêtes
Les routes protégées sont gardées par `<RequireAuth>`. Lors de la déconnexion (`POST /auth/logout`), le store d'authentification réinitialise l'état et vide l'intégralité du cache TanStack Query (`queryClient.clear()`). Aucune donnée sensible d'un organisateur ou administrateur ne persiste en mémoire lors d'une reconnexion ultérieure.

## D38 — Suppression totale des mocks
Le fichier `apps/web/src/data.ts` et toutes les listes de fausses données ont été supprimés. 100 % des composants, filtres, graphiques de vente, audits et listes de billets interrogent l'API REST connectée à PostgreSQL.
