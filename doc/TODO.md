# TODO — avancement en direct

> Mis à jour pendant chaque phase. Légende : ✅ fait · 🔄 en cours · ⬜ à faire · ⚠️ bloqué / à vérifier

**Phase courante : 16 — Charge, concurrence, durcissement, documentation** · statut : ✅ livrée hors webhook
Détail : [phases/phase-16-durcissement.md](phases/phase-16-durcissement.md) · index : [phases/README.md](phases/README.md)

> Depuis la phase 10, la liste de contrôle détaillée de chaque phase est tenue dans `todo.md` (racine du dépôt) ; ce fichier garde l'état d'ensemble et le journal.

## Phase 09
- ✅ Audit des policies RLS existantes (organisateur_id ligne à ligne, jamais seulement par rôle)
- ✅ Migration `007_multi_tenant.sql` : `organisateurs.slug` (unique, contraint, backfillé)
- ✅ Règle documentée pour 10-14 : toute nouvelle table rattachée à un organisateur + RLS dès sa création
- ✅ Revue transverse API (events, pricing, orders, analytics) : aucun contournement de `DbContextService` trouvé ; `analytics` documenté comme le module le plus exposé (risque accepté)
- ✅ Test SQL : 3 organisateurs concurrents, aucune fuite (ventes, journal_tarifs)
- ✅ Test SQL : RLS directe cross-tenant → 0 ligne
- ✅ Pas de régression sur `phase05_securite.sql`

## Phase 07
### Compléments API nécessaires au front
- ✅ `scope=public|manage` sur le catalogue (un organisateur connecté voit tout le catalogue public)
- ✅ `GET /venues/cities`
- ✅ `PUT /events/:id/attributes` (EAV, validé par trigger)
- ✅ `GET /analytics/price-audit` (journal_tarifs, admin)
- ✅ `commandes` dans le résumé analytics
- ✅ Tests e2e API mis à jour et complétés (44/44 passants)

### Front
- ✅ Dépendances : TanStack Query, React Hook Form, Zod, @hookform/resolvers
- ✅ Client HTTP (`credentials: include`, CSRF, erreurs typées), proxy Vite `/api`
- ✅ Authentification réelle (session cookie, `/auth/me`), garde de routes par rôle
- ✅ Pages : accueil, découverte (filtres réels, pagination), détail, checkout, succès, mes billets (remboursement), auth, compte
- ✅ Pages : dashboard organisateur, mes événements (publication), ventes, création d'événement, admin
- ✅ Suppression de `data.ts` (aucune donnée simulée dans le build)
- ✅ Tests unitaires front (Vitest, 27 tests passants)
- ✅ Tests navigateur de bout en bout (Playwright) : inscription → achat → billet ; organisateur ; admin ; erreurs (6/6 passants)
- ✅ Docker : conteneur `web` (nginx + proxy `/api`)
- ✅ Docs : phase 07, decisions, api.md, README

## Phases
| Phase | Statut |
|-------|--------|
| 01 — Bootstrap, schéma, seed | ✅ |
| 02 — SQL avancé, vues, MV | ✅ |
| 03 — Performance, index | ✅ |
| 04 — Fonctions, triggers | ✅ |
| 05 — Sécurité DB | ✅ |
| 06 — API | ✅ |
| 07 — Front | ✅ |
| 08 — Docs, CI | 🔄 (CI et doc base en phase 16) |
| 09 — Multi-tenant collectifs | ✅ |
| 10 — Réservation temporaire + TTL | ✅ |
| 11 — Idempotence webhook paiement | ⬜ |
| 12 — Liste d'attente | ✅ |
| 13 — Check-in QR offline-first | ✅ (test mobile manuel ⬜) |
| 14 — Dashboard temps réel | ✅ |
| 15 — Souhaits secondaires | ✅ |
| 16 — Charge, durcissement, docs, CI | ✅ hors webhook |

## Reste à vérifier (phase 01)
- ✅ Conteneur `api` (phase 06)
- ✅ Conteneur `web` (phase 07)
- ⚠️ pgAdmin dans le navigateur

## Journal
- 2026-09-16 — Phase 01 livrée : port 5433 (PostgreSQL Windows local sur 5432), Prisma installé aussi à la racine.
- 2026-09-16 — Phase 02 livrée. Migration des vues = `002_views.sql` ; index en `003_indexes.sql`.
- 2026-09-16 — Phase 03 livrée. Mesures bruitées sous Docker Desktop (B7 : 260–630 ms à plan identique).
- 2026-09-16 — Phase 04 livrée : tout vert sur small et FULL.
- 2026-09-16 — Phase 05 livrée : tout vert sur FULL et sur base vierge.
- 2026-09-16 — Phase 06 livrée : 50 tests unitaires + 40 e2e verts, conteneur api healthy.
- 2026-09-16 — Phase 07 livrée : 27 tests unitaires Vitest, 6 tests e2e Playwright (parcours visiteur/achat/remboursement, organisateur, admin, erreurs), configuration Nginx Docker avec proxy `/api/`, proxy Vite dev/preview, suppression définitive de `data.ts`.
- 2026-09-18 — Phase 09 livrée : `007_multi_tenant.sql` (organisateurs.slug), audit RLS + revue API sans écart trouvé, tests `phase09_multi_tenant.sql` verts, phase 08 (Docs/CI) reste ⬜ et sera traitée séparément.
- Phases 10, 12 à 15 livrées (migrations 008 à 013) : réservations + quota unifié, liste d'attente FIFO, check-in QR offline-first, dashboard temps réel, annulation self-service, e-mails (outbox), export CSV, fuseaux horaires.
- 2026-10-06 — Phase 16 livrée hors webhook : charge combinée via l'API (`pnpm test:load`), isolation RLS rejouée sur les tables 10–15 avec garde-fou automatique, `database.md` et docs de phases à jour, CI GitHub Actions. Phase 11 (webhooks) toujours à faire ; numérotation des codes BT conservée (voir `database.md`).
