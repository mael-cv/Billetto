# Phase 07 — Branchement du front

## Objectifs
- Remplacer l'API simulée du front par l'API réelle, sans introduire de logique métier côté client.

## Spécifications
- `apps/web/src/lib/api.ts` : appels HTTP réels (`credentials: 'include'`, en-tête CSRF `X-CSRF-Token` automatique et rejeu transparent).
- TanStack Query pour le cache, le chargement et les erreurs ; React Hook Form + Zod pour les formulaires.
- Écrans branchés : catalogue, détail, checkout, succès, mes billets, authentification, dashboard organisateur, gestion des événements, ventes, administration.
- États loading / empty / error / success / disabled conservés.
- Nginx configuré pour le conteneur Docker `web` avec proxy inverse `/api/` et SPA fallback.

## Critères d'acceptation
- [x] Plus aucune donnée issue de `data.ts` dans le build de production (`data.ts` supprimé, build propre en production).
- [x] Parcours complet : inscription → achat → billet visible dans « Mes billets » et remboursement testé de bout en bout.
- [x] Dashboard organisateur alimenté par les vues analytics (filtré par RLS dans PostgreSQL).
- [x] Dashboard administrateur alimenté par la vue matérialisée et audit des tarifs issu du trigger PostgreSQL.
- [x] Erreurs API (quota épuisé, identifiants invalides, accès refusé 401/403) affichées explicitement.

## Livrables
1. **Client API & Auth** :
   - `apps/web/src/lib/http.ts` : gestion des cookies HttpOnly, extraction CSRF et retry automatique sur `CSRF_INVALIDE`.
   - `apps/web/src/lib/api.ts` : mapping typé de toutes les routes de l'API Billetto.
   - `apps/web/src/lib/auth.tsx` : `useAuth()` et composant `<RequireAuth>` avec gardes par rôles (`visitor`, `organizer`, `admin`).
2. **Proxy de développement et conteneurisation** :
   - `apps/web/vite.config.ts` : proxy inverse `/api` vers `http://localhost:3001`.
   - `infra/nginx/nginx.conf` & `Dockerfile` : Nginx avec proxy `/api/` vers `http://api:3001/api/`, compression gzip, cache des assets et SPA routing.
3. **Tests unitaires (Vitest)** :
   - 27 tests unitaires répartis dans `format.spec.ts`, `http.spec.ts`, `router.spec.ts`, `dashboard.spec.ts` (100 % passants).
4. **Tests de bout en bout (Playwright)** :
   - 6 scénarios automatisés dans `apps/web/e2e/` :
     - `user-flow.spec.ts` : inscription visiteur, navigation catalogue, sélection tarif, checkout avec CGV, paiement, consultation billet et remboursement.
     - `organizer-flow.spec.ts` : connexion organisateur, dashboard RLS, liste des événements, bascule publication/brouillon.
     - `admin-flow.spec.ts` : connexion admin, statistiques globales, consultation utilisateurs et journal d'audit tarifs (`price-audit`).
     - `security-errors.spec.ts` : mauvais mot de passe (erreur UI), garde 401 sur page protégée, garde 403 sur page admin.
