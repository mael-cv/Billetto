# Phase 16 — Charge, concurrence, durcissement, documentation

## Objectifs
- Prouver l'absence de survente quand tous les mécanismes des phases 10 à 15 s'exercent **en même temps**, via l'API complète.
- Rejouer l'isolation multi-tenant de la phase 09 sur toutes les tables récentes, et la rendre automatique pour les tables futures.
- Documenter les phases 09 à 15, la base et les codes d'erreur.
- Exécuter toute la suite en CI.

## Décisions
- **Webhook.** La Phase 11 a été livrée après cette phase (migration 014). Le rejeu massif est couvert par `concurrency.mjs` ; le scénario `test:load` ne contient pas encore de vague webhook (voir [phase 11](phase-11-webhooks.md)).
- **Codes d'erreur inchangés.** La numérotation proposée par le TODO (`BT030` réservation expirée, `BT031` liste d'attente fermée, `BT032` doublon de scan, `BT033` webhook dupliqué) entre en conflit avec les codes en place depuis la phase 10. L'API, le front et les tests en dépendent : rien n'a été renuméroté. La table complète réelle est dans [database.md](../database.md#codes-derreur), avec la correspondance.
- **`doc/` est versionné** (retiré du `.gitignore`). `docs/` (instructions d'agents) reste ignoré.

## Charge combinée (`pnpm test:load`)
`apps/api/test/load.load-spec.ts`, avec la config Jest séparée `test/jest-load.json`, pour ne pas ralentir `test:e2e`. Le test passe par l'API complète : HTTP, NestJS, PostgreSQL en `billetto_app`, RLS et fonctions. Il porte sur un tarif de quota 10, avec `LOAD_USERS` acheteurs (60 par défaut, 100 en CI).

| Vague | Action concurrente | Attendu |
|-------|--------------------|---------|
| 1 | N holds simultanés | exactement 10 acceptés, les autres en `QUOTA_EPUISE` |
| 2 | chaque hold confirmé 3 fois en parallèle | une commande par hold, sinon `RESERVATION_NON_ACTIVE` |
| 3 | 30 inscriptions en liste d'attente | 30 positions FIFO distinctes |
| 4 | 5 remboursements + 2 offres ignorées (expiration, balayage) | offres aux 5, puis aux 2 suivants, FIFO strict |
| 5 | réponses aux offres et achats directs simultanés | offres confirmées, achats en `QUOTA_EPUISE` |

Invariants : vendus + holds actifs ≤ quota après chaque vague ; quota exactement rempli à la fin ; `GET /analytics/live` égal à la base ; un e-mail par commande payée et par offre.

Mesures locales (Docker Desktop) : 6 tests verts en environ 35 s pour 60 acheteurs. Également vert à 100 et à 150 acheteurs.

## Isolation RLS (`database/tests/phase16_isolation.sql`)
Jeu d'essai propre avec deux collectifs (achats, holds, inscriptions croisées, scans), même harnais que la phase 09.
- **Visiteur** : uniquement son hold et son inscription. Aucun accès à `billets_scans`, `emails_sortants`, `checkin_secret`. Écritures directes refusées (`42501`). Fonctions organisateur non exécutables.
- **Organisateur** : uniquement son collectif dans `reservations`, `liste_attente`, `billets_scans` et les vues du dashboard. `manifeste_checkin`, `participants_evenement` et `scanner_billet` refusés sur l'autre collectif (`BT013`). Impossible de forger ou d'effacer un scan.
- **Readonly** : lecture globale, aucune écriture, aucune table interne.
- **Garde-fou** : toute table lisible par un rôle visiteur ou organisateur doit avoir la RLS activée et forcée.

## CI (`.github/workflows/ci.yml`)
- **`checks`** : installation, `prisma generate`, lint, `tsc` API et web, tests unitaires, build.
- **`database`** :
  1. `.env` créé depuis `.env.example`, avec des secrets éphémères et `SMTP_URL` vide ;
  2. `docker compose up -d --wait postgres` ;
  3. migrations, seeds `small` et `demo` ;
  4. `pnpm db:test` (SQL, concurrence, isolation), `pnpm test:e2e`, `pnpm test:load` (`LOAD_USERS=100`) ;
  5. journaux PostgreSQL en cas d'échec.
- **Vérification locale** : la séquence du job `database` a été rejouée sur une base vierge, dans un projet Compose isolé (`COMPOSE_PROJECT_NAME=billetto-ci`, port 5434). Tout est vert. Le premier passage sur GitHub Actions reste à constater au push.

## Documentation
- [database.md](../database.md) : modèle avec les tables 008 à 013, migrations, contraintes, index, triggers, quota unifié, outbox, table complète des codes, stratégie de tests.
- Phases 09, 10 et 12 à 15 : section « Suites » ajoutée (ce que les phases suivantes ont changé ou vérifié). Fiche de la phase 11 créée (à faire). Index à jour.

## Critères d'acceptation
- [x] Charge combinée (holds, confirmations, expiration, liste d'attente) sans survente via l'API complète, **hors webhook**.
- [ ] Charge avec webhook : vague à ajouter à `test:load`.
- [x] Isolation RLS rejouée sur les tables des phases 10 à 15, avec garde-fou automatique.
- [x] Idempotence webhook sous rejeu massif (`concurrency.mjs`, phase 11).
- [x] Documentation des phases 09 à 15 et des codes d'erreur (numérotation existante conservée).
- [x] `doc/database.md` à jour.
- [x] Nouveaux tests dans la CI.
