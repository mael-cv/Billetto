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
- [ ] Migration `008_reservations.sql` : table `reservations` (`tarif_id, utilisateur_id, quantite, statut, mode_paiement, expire_a`)
- [ ] Étendre la contrainte `CHECK` sur `commandes.statut` pour ajouter `en_attente_virement`
- [ ] Fonction `creer_reservation(...)` : même verrou `FOR UPDATE` sur `tarifs` que `acheter_billet`, TTL selon `mode_paiement` (carte ~10-15 min, virement ~48-72h, configurable)
- [ ] Fonction `confirmer_reservation(reservation_id)` : transforme la réservation en commande `paid`
- [ ] Calcul de quota occupé étendu pour inclure les réservations `active` avec `expire_a > now()` (expiration lazy, garantie anti-survente)
- [ ] Job de purge périodique (`statut = 'expiree'`) pour le reporting uniquement, jamais source de vérité anti-survente
- [ ] API : `POST /orders/hold`, `POST /orders/:id/confirm`
- [ ] Front : compte à rebours sur `Checkout` (carte), écran "en attente de virement" avec délai
- [ ] Test de concurrence (adapter `database/scripts/concurrency.mjs`) : N holds simultanés sur tarif à quota fixe, zéro survente
- [ ] Test : hold expiré ne bloque plus le quota

## Phase 11 — Idempotence webhook paiement
- [ ] Migration `009_webhooks.sql` : table `paiement_webhooks` avec `UNIQUE (evenement_externe_id)`
- [ ] Endpoint `POST /payments/webhook` avec vérification de signature prestataire (guard dédié, distinct des guards par session)
- [ ] Logique `INSERT ... ON CONFLICT DO NOTHING` + traitement métier dans la même transaction que l'insertion d'idempotence
- [ ] Test : envoi du même événement webhook deux fois en parallèle → un seul billet créé
- [ ] Test : signature invalide rejetée

## Phase 12 — Liste d'attente
- [ ] Migration `010_liste_attente.sql` : table `liste_attente` (`tarif_id, utilisateur_id, quantite_souhaitee, statut, notifie_a, expire_a`)
- [ ] Fonction `notifier_prochain_en_attente(tarif_id)` avec `FOR UPDATE SKIP LOCKED`, FIFO par `created_at`
- [ ] Définir le déclencheur canonique unique de libération de place (éviter doublons/oublis de notification)
- [ ] Nouveau module API `waitlist` : `POST /waitlist`, `GET /waitlist/me`, `POST /waitlist/:id/confirm`, vue organisateur par tarif
- [ ] Front : bouton "s'inscrire en liste d'attente" sur `EventDetail`, écran de confirmation avec délai
- [ ] Test : désistement notifie le bon utilisateur (FIFO strict), non-réponse passe au suivant, pas de fuite de place

## Phase 13 — Check-in QR avec détection de doublon, offline-first
- [ ] Migration `011_checkin.sql` : colonne `billets.code_verification` (token signé) si absente
- [ ] Table `billets_scans` avec `client_scan_id UNIQUE` (idempotence des rejeux offline)
- [ ] Index unique partiel `UNIQUE (billet_id) WHERE resultat = 'ok'` (détection de doublon garantie en DB)
- [ ] Nouveau module API `checkin` : `POST /checkin/scan`, `POST /checkin/scan/batch`, `GET /checkin/manifest`
- [ ] Front mobile-first : écran `/checkin`, scan caméra, file locale offline, sync en arrière-plan, retour visuel net
- [ ] Test : scan du même billet deux fois → deuxième rejeté avec info du premier
- [ ] Test : scans hors ligne rejoués dans le désordre → idempotence garantie par `client_scan_id`
- [ ] Test manuel mobile en mode avion (scan → reconnexion → sync), vérifier absence de doublon

## Phase 14 — Dashboard temps réel par collectif
- [ ] Étendre les vues existantes (ventes/remplissage) avec colonnes "réservé" et "en liste d'attente" (ajout en fin de liste)
- [ ] API : `GET /analytics/live` en polling court (5-10s), isolation via RLS (phase 09)
- [ ] Front : extension `OrganizerDashboard` (vendu / réservé / en liste d'attente, rafraîchissement automatique)
- [ ] Test : isolation multi-tenant du flux, cohérence des chiffres sous charge

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
