# API REST

Base : `http://localhost:3001/api/v1` — JSON — NestJS 11 + Fastify 5 — code : `apps/api`.

## Principes
- La validation, l’authentification, l’autorisation, le CSRF et les limites d’entrée sont appliqués par l’API ; le frontend n’est jamais une frontière de confiance. Voir [Sécurité de l’API](api-security.md).
- **Accès fermé par défaut.** Chaque route porte `@Authenticated(...)`, `@OptionalAuth()` ou `@Public()` ; sans déclaration explicite, le guard refuse la requête. Le rôle ne remplace pas les contrôles de propriété et de tenant appliqués par RLS.
- **PostgreSQL décide.** L'API se connecte en `billetto_app` et, pour chaque requête, endosse le rôle PostgreSQL de l'utilisateur dans une transaction (`set_config('role', …, true)` + `set_config('app.user_id', …, true)`). Visibilité des lignes (RLS), droits (GRANT) et règles métier (`acheter_billet`, `rembourser_commande`) sont appliqués par la base ; l'API ne réimplémente ni quota, ni prix, ni filtre « ses événements ».
- **Données d'acheteur sous le rôle visiteur.** Commandes, billets, achats et remboursements personnels passent toujours par `billetto_visiteur`, quel que soit le rôle applicatif : un organisateur qui achète un billet est un acheteur comme un autre.
- **Invisible = inexistant.** Une ressource masquée par la RLS répond `404`, jamais `403` : l'API ne révèle pas son existence.

## Authentification et CSRF
Session : cookie `billetto_session` (JWT HS256 signé, `HttpOnly`, `Secure`, `SameSite=Strict`, 2 h). Aucun jeton n'est accessible au JavaScript du front.

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
| 409 | `CONFLIT`, `REFERENCE_INVALIDE` | `23505`, `23503` |
| 413 | `REQUETE_INVALIDE` | corps > 64 Kio |
| 422 | `QUANTITE_INVALIDE`, `ATTRIBUT_INVALIDE`, `CONTRAINTE_VIOLEE` | `BT007`, `BT020`, `23514` |
| 429 | `TROP_DE_REQUETES` | 300 req/min par IP ; 10 req/min sur login/register |
| 500 | `ERREUR_INTERNE` | journalisé côté serveur avec `requestId` |

## Endpoints

Légende accès : **public** (anonyme accepté), **connecté** (tout rôle), **orga** (organizer), **admin**.

### Santé et authentification
| Méthode | Chemin | Accès | Description |
|---------|--------|-------|-------------|
| GET | `/health` | public | `{ status, database }` |
| GET | `/auth/csrf` | public | Émet le jeton CSRF |
| POST | `/auth/register` | public | `{ email, password (12–128), prenom, nom }` → 201, compte `visitor`, session ouverte. `409` si e-mail existant |
| POST | `/auth/login` | public | `{ email, password }` → 200 `{ user, csrfToken }` |
| POST | `/auth/logout` | public | 204, supprime la session |
| GET | `/auth/me` | connecté | `{ user: { id, email, prenom, nom, role, organisateurId } }` |
| POST | `/auth/password` | connecté + CSRF | `{ currentPassword, newPassword }` ; vérifie le mot de passe actuel, applique Argon2id, incrémente la version de session et révoque immédiatement toutes les sessions (réponse 204, reconnexion requise) |

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

### Achat, billets, commandes
| Méthode | Chemin | Accès | Description |
|---------|--------|-------|-------------|
| POST | `/tickets/purchase` | connecté | `{ tarifId, quantite (1–10) }` → 201 `{ commandeId, paiementId, billetIds, montantTotal }`. Appelle `acheter_billet()` : quota (verrou), dates, statut. Erreurs `404/409/422` métier |
| GET | `/tickets/me` | connecté | Billets de l'utilisateur (`billets_utilisateur()`), paginés |
| GET | `/orders/me` | connecté | Commandes de l'utilisateur, paginées |
| GET | `/orders/:id` | connecté | Détail + billets. Admin : toute commande ; autres : les leurs (404 sinon) |
| GET | `/orders/:id/payments` | connecté | Paiements (charge, refund). Organisateurs : uniquement leurs propres commandes |
| POST | `/orders/:id/refund` | connecté | `rembourser_commande()` (propriétaire) ou `admin_rembourser_commande()` (admin). 409 si déjà remboursée ou événement commencé |

### Administration et statistiques
| Méthode | Chemin | Accès | Description |
|---------|--------|-------|-------------|
| GET | `/users` | admin | Utilisateurs paginés (`q` sur l'e-mail) ; jamais de hash |
| PATCH | `/users/:id/role` | admin | `{ role, organisateurId }` ; cohérence garantie par `ck_utilisateurs_organisateur_coherent` (422). Effet à la prochaine connexion |
| GET | `/analytics/summary` | orga, admin | Organisateur : vues `security_invoker` sous RLS (`source: "vues"`). Admin : totaux depuis `mv_ventes_quotidiennes` (`source: "vue_materialisee"`). Retourne `{ billetsVendus, caTotal, tauxRemplissage, commandes, source }` |
| GET | `/analytics/events` | orga, admin | Ventes, CA, places, taux par événement ; `sort` ∈ `ca`, `billets`, `taux`, `date` |
| GET | `/analytics/venues` | orga, admin | `v_classement_lieux` (rang global et par ville) |
| GET | `/analytics/daily-sales` | orga, admin | `from`, `to` (≤ 366 j). Admin : vue matérialisée ; organisateur : calcul à la volée sous RLS |
| GET | `/analytics/recent-orders` | orga, admin | `limit` 1–50 |
| GET | `/analytics/price-audit` | admin | Journal d'audit des modifications de prix/quotas (`journal_tarifs` trigger) |

## Exemple complet (curl)
```bash
J=/tmp/billetto.jar
CSRF=$(curl -s -c $J -b $J localhost:3001/api/v1/auth/csrf | jq -r .csrfToken)
CSRF=$(curl -s -c $J -b $J -X POST localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"email":"demo-visiteur@billetto.test","password":"Billetto-Demo-2026!"}' | jq -r .csrfToken)
curl -s -b $J -X POST localhost:3001/api/v1/tickets/purchase \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" -d '{"tarifId":19,"quantite":2}'
curl -s -b $J "localhost:3001/api/v1/tickets/me?pageSize=5"
```

## Comptes de démonstration
Créés par `pnpm db:seed:small|full` (ou `pnpm db:seed:demo`), mot de passe `DEMO_PASSWORD` du `.env` (développement uniquement, jamais en production) :

| E-mail | Rôle |
|--------|------|
| `demo-visiteur@billetto.test` | visitor |
| `demo-organisateur@billetto.test` | organizer (organisateur n° 1) |
| `demo-admin@billetto.test` | admin |

Les 100 000 comptes générés par le seed ont un hash invalide et ne peuvent pas se connecter.

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
Modules : `events`, `pricing`, `event-types`, `venues`, `orders`, `payments`, `tickets`, `users`, `analytics`, `health`.

## Tests
```bash
pnpm --filter @billetto/api test       # 50 tests unitaires (sans base)
pnpm test:e2e                          # 40 tests de bout en bout (base démarrée, migrations + seed)
```
- **Unitaires** : mapping des erreurs PostgreSQL, jeton de session (falsification, `alg: none`, expiration), guards CSRF et rôles, login (réponse identique compte inconnu / mauvais mot de passe, hash factice), validation (liste blanche de tri, champs inconnus, bornes), cas d'usage événements, filtre d'erreurs (aucune fuite), règles de code (aucun `$queryRawUnsafe`, `Prisma.raw` ni `console.log`).
- **End-to-end** (vraie base, API en `billetto_app`) : connexion non superutilisateur ; en-têtes de sécurité, CORS, CSRF, 413, JSON invalide, validation, injection SQL, pagination ; inscription, cookies, escalade de rôle, énumération de comptes, session falsifiée, logout, rate limiting ; catalogue et RLS ; achat, quota, événement commencé, commandes d'autrui, remboursements ; organisateurs A/B (création, usurpation, modification croisée, tarifs, audit avec auteur, publication) ; analytics filtrés ; administration ; **30 achats simultanés sur un quota de 10 → exactement 10 ventes**.
