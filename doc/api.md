# API REST

Base : `http://localhost:3001/api/v1` — JSON — NestJS 11 + Fastify 5 — code : `apps/api`.

## Principes
- La validation, l’authentification, l’autorisation, le CSRF et les limites d’entrée sont appliqués par l’API ; le frontend n’est jamais une frontière de confiance.
- **Accès fermé par défaut.** Chaque route porte `@Authenticated(...)`, `@OptionalAuth()` ou `@Public()` ; sans déclaration explicite, le guard refuse la requête. Le rôle ne remplace pas les contrôles de propriété et de tenant appliqués par RLS.
- **PostgreSQL décide.** L'API se connecte en `billetto_app` et, pour chaque requête, endosse le rôle PostgreSQL de l'utilisateur dans une transaction (`set_config('role', …, true)` + `set_config('app.user_id', …, true)`). Visibilité des lignes (RLS), droits (GRANT) et règles métier (`acheter_billet`, `rembourser_commande`) sont appliqués par la base ; l'API ne réimplémente ni quota, ni prix, ni filtre « ses événements ».
- **Données d'acheteur sous le rôle visiteur.** Commandes, billets, achats et remboursements personnels passent toujours par `billetto_visiteur`, quel que soit le rôle applicatif : un organisateur qui achète un billet est un acheteur comme un autre.
- **Invisible = inexistant.** Une ressource masquée par la RLS répond `404`, jamais `403` : l'API ne révèle pas son existence.

## Authentification et CSRF
Session : cookie `billetto_session` (JWT HS256 signé, `HttpOnly`, `Secure`, `SameSite=Strict`, 2 h). Aucun jeton n'est accessible au JavaScript du front. Le jeton porte une version (`auth_version`) vérifiée en base à chaque requête : la déconnexion, un changement de mot de passe ou de rôle l'incrémentent, ce qui révoque immédiatement toutes les sessions du compte.

Protections contre la force brute : 10 requêtes/min par adresse sur login / register / password (compteur indexé sur la route résolue, pas sur l'URL brute), et verrouillage du compte 5 minutes après 10 échecs consécutifs. La réponse reste `401 Identifiants invalides` dans tous les cas (compte inconnu, mauvais mot de passe, compte verrouillé).

Toute requête `POST`/`PATCH`/`DELETE` (y compris login et register) exige l'en-tête `X-CSRF-Token` égal au cookie `billetto_csrf` :

```text
GET  /auth/csrf                         → { csrfToken } + cookie billetto_csrf
POST /auth/login   X-CSRF-Token: <jeton> → cookie de session + nouveau csrfToken (rotation)
```

Le front lit le cookie `billetto_csrf` (non HttpOnly, même origine) ou la valeur `csrfToken` renvoyée, et la renvoie en en-tête.

## Format des réponses
**Pagination** (`page` ≥ 1, `pageSize` 1–100, défaut 20) :
```json
{ "items": [], "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
```
**Erreur** (jamais de stacktrace) :
```json
{ "statusCode": 409, "error": "QUOTA_EPUISE", "message": "quota épuisé pour le tarif 12 : 0 restant(s), 1 demandé(s)", "requestId": "req-3f" }
```
Erreur de validation : `400`, `error: "VALIDATION"`, `details: [{ champ, message }]`. Les corps sont validés par des schémas Zod **stricts** : un champ inconnu (`role`, `organisateurId`, `prix`…) est refusé.

**Montants** : chaînes à deux décimales (`"25.00"`), pas de flottants. **Identifiants** : nombres. **Dates** : ISO 8601.

### Codes d'erreur
| HTTP | `error` | Origine |
|------|---------|---------|
| 400 | `VALIDATION`, `VALEUR_INVALIDE`, `REQUETE_INVALIDE` | Zod, PostgreSQL `22P02`/`22007`, Fastify |
| 401 | `NON_AUTHENTIFIE` | session absente / invalide, identifiants invalides |
| 403 | `CSRF_INVALIDE` | jeton CSRF |
| 403 | `ACCES_REFUSE` | rôle applicatif insuffisant, PostgreSQL `42501` |
| 403 | `ACTION_INTERDITE` | `BT013` (action pour autrui) |
| 404 | `INTROUVABLE`, `TARIF_INTROUVABLE`, `COMMANDE_INTROUVABLE` | ressource absente ou invisible, `BT001`, `BT010` |
| 409 | `QUOTA_EPUISE`, `VENTE_FERMEE`, `EVENEMENT_COMMENCE`, `EVENEMENT_NON_PUBLIE`, `TARIF_INACTIF` | `BT006`, `BT004`, `BT005`, `BT003`, `BT002` |
| 409 | `COMMANDE_NON_REMBOURSABLE`, `REMBOURSEMENT_IMPOSSIBLE` | `BT011`, `BT012` |
| 409 | `RESERVATION_NON_ACTIVE`, `RESERVATION_EXPIREE`, `PLAFOND_RESERVATIONS`, `MONTANT_INCOHERENT` | `BT032`, `BT033`, `BT034`, `BT035` |
| 409 | `SCAN_DEJA_UTILISE`, `DERNIER_ADMINISTRATEUR` | `BT052`, `BT060` |
| 401 | `SIGNATURE_WEBHOOK_INVALIDE` | en-tête `Stripe-Signature` absent, faux ou trop ancien |
| 502 / 503 | `PAIEMENT_INDISPONIBLE`, `PAIEMENT_NON_CONFIGURE`, `WEBHOOK_NON_CONFIGURE` | prestataire injoignable, clés Stripe absentes |
| 409 | `CONFLIT`, `REFERENCE_INVALIDE` | `23505`, `23503` |
| 413 | `REQUETE_INVALIDE` | corps > 64 Kio |
| 422 | `QUANTITE_INVALIDE`, `ATTRIBUT_INVALIDE`, `CONTRAINTE_VIOLEE` | `BT007`, `BT020`, `23514` |
| 429 | `TROP_DE_REQUETES` | 300 req/min par IP ; 10 req/min sur login / register / password ; 30 req/min sur réservation, paiement, liste d'attente et journal d'activité |
| 500 | `ERREUR_INTERNE` | journalisé côté serveur avec `requestId` |

## Endpoints

Légende accès : **public** (anonyme accepté), **connecté** (tout rôle), **orga** (organizer), **admin**.

### Premier démarrage
Tant que l'application n'est pas initialisée, **toutes** les autres routes répondent `503 SETUP_REQUIS` (hormis `/health` et `/auth/csrf`).

| Méthode | Chemin | Accès | Description |
|---------|--------|-------|-------------|
| GET | `/setup/status` | public | `{ etat: requis \| en_cours \| pret, mode }` |
| POST | `/setup` | jeton d'installation + CSRF | `{ jeton, mode: test \| live, stripe?: { secretKey, webhookSecret }, admin: { email, password, prenom, nom } }` → 202. Le jeton (journaux de `docker compose logs bootstrap`) est à usage unique, comparé à temps constant, remplacé après 5 erreurs ; route limitée à 10 requêtes/min. Clés Stripe : exigées et vérifiées auprès de Stripe en mode `live`, interdites en mode `test` (lues dans `infra/stripe/test-keys.env`). L'API dépose la demande ; un conteneur dédié charge les données et crée l'administrateur, puis l'API redémarre dans le mode choisi. `409 DEJA_INITIALISEE` ensuite, définitivement |

### Santé et authentification
| Méthode | Chemin | Accès | Description |
|---------|--------|-------|-------------|
| GET | `/health` | public | `{ status, database, mongodb }` ; 503 avec le détail si l'une des deux bases manque |
| GET | `/auth/csrf` | public | Émet le jeton CSRF |
| POST | `/auth/register` | public | `{ email, password (12–128, ni courant ni trop simple), prenom, nom }` → 201 `{ message }`, compte `visitor`. **Aucune session ouverte et réponse identique que l'adresse soit libre ou déjà utilisée** (pas d'énumération de comptes) : l'utilisateur se connecte ensuite |
| POST | `/auth/login` | public | `{ email, password }` → 200 `{ user, csrfToken }` |
| POST | `/auth/logout` | public | 204 ; révoque en base toutes les sessions du compte (`auth_version`) et supprime les cookies |
| GET | `/auth/me` | connecté | `{ user: { id, email, prenom, nom, role, organisateurId } }` |
| POST | `/auth/password` | connecté + CSRF | `{ currentPassword, newPassword }` (le nouveau doit différer de l'actuel) ; vérifie le mot de passe actuel, applique Argon2id, incrémente la version de session et révoque immédiatement toutes les sessions (réponse 204, reconnexion requise) |

### Catalogue
| Méthode | Chemin | Accès | Description |
|---------|--------|-------|-------------|
| GET | `/events` | public | Filtres : `q` (nom, ville, type), `ville`, `typeId` (**inclut les sous-types**, `WITH RECURSIVE`), `from`, `to`, `prixMax`, `statut`, `scope` (`public` défaut, `manage` pour orga/admin) ; `sort` ∈ `date`, `-date`, `prix`, `nom`. Résultat filtré par la RLS : public → publiés/terminés ; organisateur → les siens ; admin → tous |
| GET | `/events/:ref` | public | `ref` = identifiant ou slug. Détail + attributs + tarifs avec `restantes` (`places_restantes()`) |
| POST | `/events` | orga, admin | `{ nom, slug, description?, debut, fin, lieuId, typeEvenementId, statut? (draft/published) }` ; admin : `organisateurId` obligatoire. Un organisateur crée toujours pour lui-même (policy `WITH CHECK`) |
| PATCH | `/events/:id` | orga, admin | Champs partiels + `statut`. `organisateurId` non modifiable. 404 si l'événement n'est pas le sien |
| DELETE | `/events/:id` | orga, admin | 204 ; 409 si des tarifs existent |
| PUT | `/events/:id/attributes` | orga, admin | `{ attributes: [{ cle, valeur }] }` : remplacement complet des attributs EAV |
| GET | `/events/:id/prices` | public | Tarifs visibles avec places restantes |
| POST | `/events/:id/prices` | orga, admin | `{ nom, prix, quota, dateDebutVente, dateFinVente, actif? }` |
| PATCH | `/prices/:id` | orga, admin | Modification partielle ; prix/quota journalisés dans `journal_tarifs` (auteur = utilisateur) |
| DELETE | `/prices/:id` | orga, admin | 204 ; 409 si des billets existent |
| GET | `/event-types/tree` | public | Arbre `{ id, parentId, nom, niveau, chemin }` (`WITH RECURSIVE`) |
| GET | `/venues` | public | Lieux paginés, filtre `ville` |
| GET | `/venues/cities` | public | Liste distincte des villes de lieux disponibles (pour le filtre front) |

### Base documentaire MongoDB (pages, avis, activités)
Chaque endpoint indique sa base : **SQL**, **Mongo** ou **croisé** (lecture ou écriture dans les deux). Schéma et index : `database/nosql/schema.mjs`.

| Méthode | Chemin | Accès | Description |
|---------|--------|-------|-------------|
| GET | `/events/:ref/page` | public | **croisé** : événement (PostgreSQL, RLS) + page éditoriale (`event_pages`) + template. `personnalisee: false` si aucune page rédigée |
| PUT | `/events/:id/page` | orga, admin + CSRF | **croisé** : propriété vérifiée en SQL (404 sinon) puis `replaceOne` upsert du document `{ templateId, tags, programme[], medias[], sections[], faq[] }` ; 404 si `templateId` inconnu |
| DELETE | `/events/:id/page` | orga, admin | **croisé** : 204 ; 404 si pas de page |
| GET | `/events/:ref/avis` | public | **croisé** : avis paginés (`noteMin`, `sansReponse`) + `stats` (pipeline `$group` : moyenne, distribution 1..5, taux de réponse) |
| POST | `/events/:id/avis` | connecté + CSRF | **croisé** : 403 `BILLET_REQUIS` sans billet payé (requête SQL sous rôle acheteur) ; `{ note 1..5, titre?, commentaire }` → 201 ; 409 `DOUBLON` (index unique) ; 400 si note hors 1..5 |
| PATCH | `/avis/:id` | auteur | **Mongo** : champs partiels ; 403 si pas l'auteur |
| DELETE | `/avis/:id` | auteur, admin | **Mongo** : 204 |
| POST | `/avis/:id/reponse` | orga, admin | **croisé** : `{ texte }` ; `$set` du champ imbriqué `reponseOrganisateur` ; 403 si l'événement n'est pas le sien (RLS) |
| GET | `/organizer/avis` | orga, admin | **croisé** : identifiants d'événements depuis SQL (RLS) puis `$in` Mongo ; `sansReponse=true` |
| GET | `/events/tendances` | public | **croisé** : score Mongo (`$group`/`$cond` sur 7 j : vue 1 plafonnée à 500, scan 2, achat 5 ; activités émises par l'API uniquement) puis résumés SQL (seuls les événements du catalogue public restent) ; `jours`, `limit` |
| POST | `/activites` | connecté | **Mongo** : `{ type: vue_evenement \| recherche, evenementId?, payload? }` → 201 ; l'événement doit être visible du catalogue (404 sinon), `payload` limité à 10 clés simples. Ces documents (source `client`) **ne comptent pas dans les tendances** ; les autres types sont émis par l'API (connexion, achat, scan) |
| GET | `/activites/evenements/:id` | orga, admin | **croisé** : série temporelle `$dateTrunc` (`granularite=heure\|jour`, `jours`) ; 404 si l'événement n'est pas le sien |
| DELETE | `/activites?avant=` | admin | **Mongo** : purge manuelle (l'index TTL purge à 90 jours) |
| GET | `/templates/events`, `/templates/events/:id`, `/templates/tickets`, `/templates/tickets/:id` | public | **Mongo** : thèmes visuels |

Hooks d'écriture Mongo émis par l'API (fire-and-forget, jamais bloquants) : `GET /events/:ref` (vue_evenement), `GET /events?q=` (recherche), `POST /auth/login` (connexion, succès et échecs), paiement confirmé par webhook ou virement validé (achat), `POST /checkin/scan[/batch]` (scan_checkin, scans acceptés uniquement). `DELETE /events/:id` supprime aussi la page, les avis et les activités de l'événement.

### Achat, billets, commandes
| Méthode | Chemin | Accès | Description |
|---------|--------|-------|-------------|
| POST | `/orders/hold` | connecté | `{ tarifId, quantite (1–10), modePaiement: carte \| virement }` → 201 réservation (hold). `creer_reservation()` : quota (verrou), dates, statut, **plafond par compte** (10 places par tarif, 30 au total, `409 PLAFOND_RESERVATIONS`). Durée : carte 15 min, virement 24 h |
| GET | `/orders/holds/me`, `/orders/holds/:id` | connecté | Ses réservations (état, `commandeId` une fois payée). Celle d'un autre : 404 |
| POST | `/orders/holds/:id/checkout` | connecté | Ouvre le paiement par carte : → 200 `{ statut: "paiement", url }` (page Stripe Checkout, mode test). Le montant est calculé par PostgreSQL à partir du prix figé du hold, jamais fourni par le client. Montant nul : `{ statut: "confirmee", commandeId, billetIds }` |
| DELETE | `/orders/holds/:id` | connecté | 204 : annule sa réservation et rend les places |
| GET | `/orders/holds/transfers` | orga, admin | Virements attendus sur ses événements (RLS), sans donnée personnelle de l'acheteur |
| POST | `/orders/holds/:id/validate-transfer` | orga, admin | Fonds reçus : `valider_virement()` émet les billets. Réservé à l'organisateur **de cet événement** ou à un admin (404 hors périmètre) |
| POST | `/payments/webhook` | signature Stripe | Événement `checkout.session.completed` signé (`Stripe-Signature`, tolérance 5 min). L'API **relit la session auprès de Stripe** (payée ? montant ? réservation ?) puis `traiter_paiement_webhook()` vérifie le montant et émet les billets, une seule fois. → 200 `{ received, resultat: traite \| doublon \| ignore }` |
| GET | `/tickets/me` | connecté | Billets de l'utilisateur (`billets_utilisateur()`), paginés |
| GET | `/orders/me` | connecté | Commandes de l'utilisateur, paginées |
| GET | `/orders/:id` | connecté | Détail + billets. Admin : toute commande ; autres : les leurs (404 sinon) |
| GET | `/orders/:id/payments` | connecté | Paiements (charge, refund). Organisateurs : uniquement leurs propres commandes |
| POST | `/orders/:id/refund` | connecté | `rembourser_commande()` (propriétaire) ou `admin_rembourser_commande()` (admin). 409 si déjà remboursée ou événement commencé |

### Administration et statistiques
| Méthode | Chemin | Accès | Description |
|---------|--------|-------|-------------|
| GET | `/users` | admin | Utilisateurs paginés (`q` sur l'e-mail) ; jamais de hash |
| GET / POST | `/organizers` | admin | Collectifs organisateurs : liste, création `{ nom, email, slug }` |
| POST | `/venues` | admin | Création d'un lieu `{ nom, adresse, ville, codePostal, capacite }` |
| PATCH | `/users/:id/role` | admin | `{ role, organisateurId }` ; cohérence garantie par `ck_utilisateurs_organisateur_coherent` (422). Les sessions du compte sont révoquées ; un administrateur ne modifie pas son propre rôle (403) et le dernier administrateur ne peut pas être rétrogradé (409) |
| GET | `/analytics/summary` | orga, admin | Organisateur : vues `security_invoker` sous RLS (`source: "vues"`). Admin : totaux depuis `mv_ventes_quotidiennes` (`source: "vue_materialisee"`). Retourne `{ billetsVendus, caTotal, tauxRemplissage, commandes, source }` |
| GET | `/analytics/events` | orga, admin | Ventes, CA, places, taux par événement ; `sort` ∈ `ca`, `billets`, `taux`, `date` |
| GET | `/analytics/venues` | orga, admin | `v_classement_lieux` (rang global et par ville) |
| GET | `/analytics/daily-sales` | orga, admin | `from`, `to` (≤ 366 j). Admin : vue matérialisée ; organisateur : calcul à la volée sous RLS |
| GET | `/analytics/recent-orders` | orga, admin | `limit` 1–50 |
| GET | `/analytics/price-audit` | admin | Journal d'audit des modifications de prix/quotas (`journal_tarifs` trigger) |

**Il n'existe aucune route permettant à un acheteur de créer lui-même une commande payée.** Les anciennes routes `POST /tickets/purchase`, `POST /orders/:id/confirm` et `POST /waitlist/:id/confirm` ont été supprimées, et les fonctions SQL correspondantes ne sont plus exécutables par les rôles applicatifs. Une offre de liste d'attente est une réservation comme une autre : elle se règle par `POST /orders/holds/:reservationId/checkout`.

## Exemple complet (curl)
En développement (`pnpm dev`, API sur `localhost:3001`), avec un compte que vous avez créé (`EMAIL`, `MOT_DE_PASSE`).
```bash
J=/tmp/billetto.jar
CSRF=$(curl -s -c $J -b $J localhost:3001/api/v1/auth/csrf | jq -r .csrfToken)
CSRF=$(curl -s -c $J -b $J -X POST localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$MOT_DE_PASSE\"}" | jq -r .csrfToken)
HOLD=$(curl -s -b $J -X POST localhost:3001/api/v1/orders/hold \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"tarifId":19,"quantite":2,"modePaiement":"carte"}' | jq -r .id)
# URL de la page de paiement Stripe (mode test, carte 4242 4242 4242 4242)
curl -s -b $J -X POST "localhost:3001/api/v1/orders/holds/$HOLD/checkout" -H "X-CSRF-Token: $CSRF" | jq -r .url
# Après paiement : la réservation est confirmée par le webhook, les billets apparaissent
curl -s -b $J "localhost:3001/api/v1/orders/holds/$HOLD"
curl -s -b $J "localhost:3001/api/v1/tickets/me?pageSize=5"
```

## Comptes
Il n'existe aucun compte prédéfini ni mot de passe par défaut. Le premier administrateur est créé par l'assistant de premier démarrage ; il attribue ensuite les rôles (`PATCH /users/:id/role`). Les visiteurs s'inscrivent eux-mêmes. Les comptes du jeu de démonstration (mode test) ont un hash invalide et ne peuvent pas se connecter. En développement et dans les tests, les comptes sont créés à la volée avec un mot de passe aléatoire.

## Architecture du code
```text
apps/api/src/
  main.ts, app.factory.ts      démarrage ; helmet, cookies, rate limit, CORS, filtre d'erreurs
  common/
    config/                    variables d'environnement validées (Zod) au démarrage
    database/                  PrismaService (billetto_app), DbContextService (rôle + app.user_id par transaction)
    errors/                    format d'erreur unique, SQLSTATE → HTTP
    validation/                ZodPipe, schémas communs (id, pagination, dates, montants)
  auth/                        domain / application / infrastructure / presentation
  modules/<module>/
    domain/                    types et interface du repository
    application/               cas d'usage (orchestration, aucune règle déjà en base)
    infrastructure/            repository Prisma : $queryRaw paramétré, fonctions SQL, vues
    presentation/              contrôleur, schémas d'entrée
```
Modules : `events`, `pricing`, `event-types`, `venues`, `orders`, `payments`, `tickets`, `users`, `analytics`, `health`, et côté MongoDB `templates`, `event-pages`, `reviews`, `activity` (`common/mongodb` : connexion, types des documents, mapping des erreurs 11000 → 409, 121 → 422).

## Tests
```bash
pnpm --filter @billetto/api test       # 50 tests unitaires (sans base)
pnpm test:e2e                          # 40 tests de bout en bout (base démarrée, migrations + seed)
```
- **Unitaires** : mapping des erreurs PostgreSQL, jeton de session (falsification, `alg: none`, expiration), guards CSRF et rôles, login (réponse identique compte inconnu / mauvais mot de passe, hash factice), validation (liste blanche de tri, champs inconnus, bornes), cas d'usage événements, filtre d'erreurs (aucune fuite), règles de code (aucun `$queryRawUnsafe`, `Prisma.raw` ni `console.log`).
- **End-to-end** (vraie base, API en `billetto_app`) : connexion non superutilisateur ; en-têtes de sécurité, CORS, CSRF, 413, JSON invalide, validation, injection SQL, pagination ; inscription, cookies, escalade de rôle, énumération de comptes, session falsifiée, logout, rate limiting ; catalogue et RLS ; achat, quota, événement commencé, commandes d'autrui, remboursements ; organisateurs A/B (création, usurpation, modification croisée, tarifs, audit avec auteur, publication) ; analytics filtrés ; administration ; **30 achats simultanés sur un quota de 10 → exactement 10 ventes**.
