# TODO — Extension Billetto pour "Les Nuits de la Garonne"

Plan complet : voir `C:\Users\litmaaa\.claude\plans\par-rapport-au-projet-warm-naur.md`.

## Ordre des phases

```
Phase 09 (Multi-tenant "collectifs")
   └─> Phase 10 (Réservation temporaire + TTL différencié)
           └─> Phase 11 (Idempotence webhook paiement)
           └─> Phase 12 (Liste d'attente)
   └─> Phase 13 (Check-in QR + anti-doublon)          [dépend de 09 seulement]
   └─> Phase 14 (Dashboard temps réel)                 [dépend de 09, 10, 12]
Phase 15 (Souhaits secondaires)
Phase 16 (Charge/concurrence, durcissement, docs/CI)
```

## Phases 01–07 — Socle existant
- [x] Phase 01 — Bootstrap monorepo, schéma 3NF (`organisateurs`, `lieux`, `type_evenements`, `evenements`, `evenement_attributs` EAV, `tarifs`, `utilisateurs`, `amities`, `commandes`, `billets`, `paiements`, `journal_tarifs`), seed small + full
- [x] Phase 02 — Vues analytiques, vue matérialisée
- [x] Phase 03 — Index, EXPLAIN ANALYZE avant/après
- [x] Phase 04 — Fonctions/triggers, anti-survente via `acheter_billet` + verrou `FOR UPDATE` sur `tarifs` (erreurs `BT001–BT008`)
- [x] Phase 05 — Sécurité DB : rôles (`billetto_app`, `billetto_readonly`, `billetto_visiteur`, `billetto_organisateur`, `billetto_admin`), RLS, tests `database/tests/phase05_securite.sql`
- [x] Phase 06 — API NestJS (auth session/CSRF/Argon2, modules users/events/event-types/venues/pricing/orders/tickets/payments/analytics), 50 tests unitaires + 40 e2e
- [x] Phase 07 — Front React branché à l'API réelle (TanStack Query, RHF+Zod), toutes les pages principales, 27 tests unitaires + 6 e2e Playwright

## Phase 08 — Docs, CI
- [ ] Phase 08 — Documentation et CI (en cours selon `doc/TODO.md`, hors périmètre de ce plan)

## Phase 09 — Multi-tenant "collectifs"
- [x] Auditer les policies RLS existantes (`005_security.sql`) : confirmer le filtrage ligne à ligne par `organisateur_id = app_organisateur_id()`, pas seulement par rôle
- [x] Migration `007_multi_tenant.sql` : ajouter `organisateurs.slug` (pages vitrine séparées par collectif)
- [x] Garantir que toute nouvelle table (holds, waitlist, scans, webhooks) des phases 10-14 est rattachable à un seul organisateur, avec policy RLS dès sa création
- [x] Revue transverse API (`events`, `pricing`, `orders`, `analytics`) : défense en profondeur contre toute fuite de `organisateur_id`
- [x] Test : 3 organisateurs en parallèle, vérifier absence de fuite de données (ventes, `journal_tarifs`) entre collectifs
- [x] Test RLS direct en SQL : tentative de lecture des événements d'un autre organisateur doit échouer (0 ligne, comportement RLS attendu — pas une erreur)

## Phase 10 — Réservation temporaire (hold) + TTL différencié par mode de paiement
- [x] Migration `008_reservations.sql` : table `reservations` (`tarif_id, utilisateur_id, quantite, statut, mode_paiement, expire_a`)
- [x] Étendre la contrainte `CHECK` sur `commandes.statut` pour ajouter `en_attente_virement` (migration `009_reservations_quota.sql`)
- [x] Fonction `creer_reservation(...)` : même verrou `FOR UPDATE` sur `tarifs` que `acheter_billet`, TTL selon `mode_paiement` (carte ~10-15 min, virement ~48-72h, configurable)
- [x] Fonction `confirmer_reservation(reservation_id)` : transforme la réservation en commande `paid`
- [x] Calcul de quota occupé étendu pour inclure les réservations `active` avec `expire_a > now()` (expiration lazy, garantie anti-survente) — unifié via `places_occupees()` dans `acheter_billet`, `creer_reservation` et `places_restantes` (009)
- [x] Job de purge périodique (`statut = 'expiree'`) pour le reporting uniquement, jamais source de vérité anti-survente — `ReservationsPurgeJob` côté API (`RESERVATIONS_PURGE_INTERVAL_MS`, défaut 60 s)
- [x] API : `POST /orders/hold`, `POST /orders/:id/confirm`
- [x] Front : compte à rebours sur `Checkout` (carte), écran "en attente de virement" avec délai
- [x] Test de concurrence (adapter `database/scripts/concurrency.mjs`) : N holds simultanés sur tarif à quota fixe, zéro survente
- [x] Test : hold expiré ne bloque plus le quota (aussi pour `acheter_billet`) ; achat direct bloqué par des holds actifs ; purge sans effet sur les holds actifs

## Phase 11 � Idempotence webhook paiement
- [x] Migration `013_webhooks.sql` : table `paiement_webhooks` avec `UNIQUE (evenement_externe_id)`
- [x] Endpoint `POST /payments/webhook` : garde HMAC-SHA256 d�di�e, sans session ; corps brut sign�, secret `PAYMENTS_WEBHOOK_SECRET`
- [x] Logique `INSERT ... ON CONFLICT DO NOTHING` + traitement m�tier dans la m�me transaction que l'insertion d'idempotence
- [x] Test : envoi du m�me �v�nement webhook 40 fois en parall�le ? un seul billet cr�� (`concurrency.mjs`)
- [x] Test : signature invalide rejet�e, signature valide confirme la r�servation une seule fois (unitaires + e2e)
## Phase 12 — Liste d'attente
- [x] Migration `010_liste_attente.sql` : table `liste_attente` (`tarif_id, utilisateur_id, quantite_souhaitee, statut, notifie_a, expire_a`)
- [x] Fonction `notifier_prochain_en_attente(tarif_id)` avec `FOR UPDATE SKIP LOCKED`, FIFO par `created_at` — offre = réservation à TTL 30 min (réutilise `places_occupees` et `confirmer_reservation`)
- [x] Définir le déclencheur canonique unique de libération de place (éviter doublons/oublis de notification) — `traiter_liste_attente(tarif)` idempotente, appelée par triggers (commande refunded/cancelled, réservation annulee/expiree) + balayage `traiter_listes_attente()` dans `ReservationsPurgeJob`
- [x] Nouveau module API `waitlist` : `POST /waitlist`, `GET /waitlist/me`, `POST /waitlist/:id/confirm`, vue organisateur par tarif (+ `DELETE /waitlist/:id`, `GET /waitlist/tarifs/:tarifId`)
- [x] Front : bouton "s'inscrire en liste d'attente" sur `EventDetail`, écran de confirmation avec délai ; page `/waitlist` (compte à rebours), badge d’offre dans l’en-tête, files par tarif pour l’organisateur
- [x] Test : désistement notifie le bon utilisateur (FIFO strict), non-réponse passe au suivant, pas de fuite de place — `database/tests/phase12_liste_attente.sql`, test 8 de `concurrency.mjs`, scénario e2e `liste d’attente`

## Phase 13 — Check-in QR avec détection de doublon, offline-first
- [x] Migration `011_checkin.sql` : colonne `billets.code_verification` (token signé) si absente — HMAC-SHA256 calculé en base (secret dans `checkin_secret`, sans GRANT), QR `BT1.<code>.<signature>`
- [x] Table `billets_scans` avec `client_scan_id UNIQUE` (idempotence des rejeux offline)
- [x] Index unique partiel `UNIQUE (billet_id) WHERE resultat = 'ok'` (détection de doublon garantie en DB)
- [x] Nouveau module API `checkin` : `POST /checkin/scan`, `POST /checkin/scan/batch`, `GET /checkin/manifest` — lots : une transaction par scan
- [x] Front mobile-first : écran `/checkin`, scan caméra, file locale offline, sync en arrière-plan, retour visuel net — `BarcodeDetector` + saisie manuelle en repli, `lib/checkinQueue.ts`, `pnpm --filter @billetto/web dev:https` pour mobile
- [x] Test : scan du même billet deux fois → deuxième rejeté avec info du premier — `database/tests/phase13_checkin.sql`, e2e `check-in`, test 9 de `concurrency.mjs` (40 scans simultanés → 1 ok)
- [x] Test : scans hors ligne rejoués dans le désordre → idempotence garantie par `client_scan_id` — SQL + e2e (lot B, A puis A, B, A)
- [ ] Test manuel mobile en mode avion (scan → reconnexion → sync), vérifier absence de doublon

## Phase 14 — Dashboard temps réel par collectif
- [x] Étendre les vues existantes (ventes/remplissage) avec colonnes "réservé" et "en liste d'attente" (ajout en fin de liste) — migration `012_dashboard_live.sql` : `billets_reserves`, `places_liste_attente`, `taux_occupation` (vues toujours `security_invoker`)
- [x] API : `GET /analytics/live` en polling court (5-10s), isolation via RLS (phase 09) — `Cache-Control: no-store`, front à 5 s
- [x] Front : extension `OrganizerDashboard` (vendu / réservé / en liste d'attente, rafraîchissement automatique) — section « En direct » (`components/LiveDashboard.tsx`), jauge vendu/réservé, pause du polling onglet masqué
- [x] Test : isolation multi-tenant du flux, cohérence des chiffres sous charge — `database/tests/phase14_dashboard.sql` (RLS organisateur A/B), test 10 de `concurrency.mjs` (30 lectures pendant 40 achats/holds), e2e `dashboard live`

## Phase 15 — Souhaits secondaires
- [ ] Annulation self-service : délai configurable, appel autorisé depuis le compte utilisateur (pas seulement organisateur/admin)
- [ ] Email de confirmation avec billet (déclenché à la confirmation de commande et à la réponse waitlist), QR joint si phase 13 livrée
- [ ] Export CSV participants : `GET /events/:id/participants/export`
- [ ] Fuseaux horaires : vérifier `timestamptz`, ajouter fuseau d'affichage explicite pour événements en ligne, conversion front (`Intl.DateTimeFormat`)
- [ ] Test : annulation refusée après délai, export CSV cohérent, heure locale visiteur correcte

## Phase 16 — Charge, concurrence, durcissement, documentation
- [ ] Scénario de charge combiné (holds + confirmations + expiration + liste d'attente) sur tarif en forte contention, zéro survente via API complète (webhook inclus)
- [ ] Rejouer les tests d'isolation RLS (phase 09) sur toutes les tables des phases 10-14
- [ ] Test d'idempotence webhook sous rejeu massif
- [ ] Documenter chaque phase (`doc/phases/phase-09-*.md` à `phase-15-*.md`), étendre les codes d'erreur (`BT030` réservation expirée, `BT031` liste d'attente fermée, `BT032` doublon scan, `BT033` webhook dupliqué)
- [ ] Mettre à jour `doc/database.md`
- [ ] Intégrer les nouveaux scripts de test/charge au pipeline CI

## Risques techniques principaux

1. **RLS multi-tenant (09)** : jamais réellement éprouvée avec plusieurs organisateurs concurrents — fondation de tout le reste, à valider en premier.
2. **Cohérence TTL / anti-survente (10)** : toute nouvelle voie de réservation doit passer par le verrou `FOR UPDATE` sur `tarifs`, sous peine de réintroduire le bug des 12 places vendues en trop.
3. **Transaction unique idempotence + traitement métier (11)**.
4. **Offline check-in (13)** : la contrainte DB unique est la seule source de vérité, pas le front.
5. **Déclencheur unique pour la notification de liste d'attente (12)**.
6. **Pas de websocket existant (14)** : démarrer en polling, ne pas sur-ingénierer par rapport à la volumétrie réelle (~15 événements/an, 80-600 places).

## Fichiers clés à modifier/étendre

- `database/migrations/004_functions_triggers.sql` (fonction `acheter_billet`, verrouillage à répliquer)
- `database/migrations/005_security.sql` (RLS à auditer et étendre)
- `doc/database.md` (documentation du mécanisme anti-survente à étendre)
- `apps/api/src/modules/orders/` et `apps/api/src/modules/payments/` (extensions principales)
- `database/scripts/concurrency.mjs` (tests de charge à étendre)
- `doc/phases/phase-06-api.md`, `phase-07-front.md` (style à répliquer pour les nouvelles phases)
