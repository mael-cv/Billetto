# Phase 06 — API NestJS

## Objectifs
- Exposer le métier via une API REST propre et sécurisée (OWASP), qui s'appuie sur les objets PostgreSQL au lieu de les réimplémenter.

## Spécifications
- Modules en clean architecture (`domain`, `application`, `infrastructure`, `presentation`) : auth, users, events, event-types, venues, pricing, orders, tickets, payments, analytics.
- Endpoints `/api/v1` : events (CRUD + prices), event-types/tree, orders (me, :id, refund), tickets (purchase, me), analytics (events, venues, daily-sales).
- Accès DB : Prisma pour le CRUD ; `$queryRaw` paramétré pour les vues et fonctions ; chaque requête dans une transaction qui positionne `app.user_id` / `app.role`.
- Auth : Argon2id, session en cookie `HttpOnly; Secure; SameSite`, protection CSRF, comptes de démonstration.
- Sécurité : validation (Zod/DTO), en-têtes sécurisés, CORS strict, rate limiting, pagination obligatoire, liste blanche des tris/filtres, limites de payload, filtre d'erreurs centralisé sans stacktrace, logs sans secrets.

## Livrables
- Code : `apps/api/src` (common, auth, 10 modules en domain / application / infrastructure / presentation)
- Migration : `database/migrations/006_api_support.sql` (`places_restantes`)
- Comptes de démonstration : `database/scripts/seed-demo.mjs` (Argon2id), lancé par le seed
- Tests : 50 unitaires (`src/**/*.spec.ts`), 40 end-to-end (`test/api.e2e-spec.ts`)
- Docker : service `api` (connexion `billetto_app`)
- Documentation : `doc/api.md`, `doc/decisions.md` D25–D33

## Critères d'acceptation
- [x] Tests unitaires des use cases, tests e2e des endpoints, tests d'intégration PostgreSQL (50 + 40).
- [x] Test de concurrence d'achat via l'API (30 requêtes simultanées, quota 10 → 10 ventes).
- [x] Un organisateur accédant à l'événement d'un autre reçoit 404/403.
- [x] Aucune utilisation de `$queryRawUnsafe`.
- [x] `doc/api.md` décrit chaque endpoint.
- [x] L'API se connecte en `billetto_app` (non superutilisateur), vérifié par test.
