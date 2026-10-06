# Phase 10 — Réservation temporaire (hold) + TTL différencié par mode de paiement

## Objectifs
- Bloquer le quota d'un tarif le temps qu'un paiement se réalise, sans jamais survendre, y compris pour un mode de paiement à délai (virement, plusieurs jours) et non plus seulement l'achat instantané d'`acheter_billet`.
- Libérer automatiquement les places d'un hold qui n'a jamais été confirmé, sans dépendre d'un job de purge pour la correction (expiration *lazy*).
- Unifier le parcours d'achat carte sur le même mécanisme de hold que le virement : `POST /orders/hold` puis `POST /orders/:id/confirm`, la carte enchaînant les deux appels quasi instantanément.

## Migration `008_reservations.sql`
- Table `reservations` (`tarif_id`, `utilisateur_id`, `quantite`, `statut`, `mode_paiement`, `prix_unitaire`, `expire_a`, `commande_id`), rattachée à un organisateur en cascade via `tarif_id` (règle posée en phase 09), RLS et policies posées dans la même migration.
- `prix_unitaire` : ajout au-delà du périmètre littéral du TODO, nécessaire pour figer le prix au moment du hold (un virement de 72h ne doit pas facturer un prix modifié entre-temps par l'organisateur — `confirmer_reservation` utilise ce prix, jamais `tarifs.prix` relu).
- `creer_reservation(p_utilisateur_id, p_tarif_id, p_quantite, p_mode_paiement, p_ttl_override)` : même verrou `FOR UPDATE` sur `tarifs` qu'`acheter_billet`, mêmes contrôles (tarif, événement, période de vente), quota étendu aux réservations actives non expirées en plus des billets `paid`/`pending`. TTL par défaut : carte 15 min, virement 72h. `p_ttl_override` n'est utilisé que par les tests SQL et `database/scripts/concurrency.mjs`, jamais exposé côté API.
- `confirmer_reservation(p_reservation_id, p_utilisateur_id)` : fonction séparée (pas de refactor partagé avec `acheter_billet`), verrouille la ligne `reservations`, revalide qu'elle est active et non expirée (BT033 sinon, y compris si son `statut` est encore `'active'` — c'est le vrai point d'application de l'expiration), puis effectue les mêmes inserts `commandes`/`paiements`/`billets` qu'`acheter_billet`, au prix figé.
- `purger_reservations_expirees()` : marquage `statut='expiree'` pour le reporting uniquement. **Jamais consultée par le calcul de quota** — la garantie anti-survente repose exclusivement sur `expire_a > now()` dans la requête de quota, purgée ou non.

### Migration `009_reservations_quota.sql`
- `places_occupees(p_tarif_id)` : règle de quota unique (billets `paid`/`pending` + réservations `active` avec `expire_a > now()`), utilisée par `acheter_billet` et `places_restantes`. Corrige une survente possible : en 008, un achat direct ne comptait pas les holds actifs.
- `ck_commandes_statut` étendu avec `en_attente_virement` (demandé par le TODO). L'état de référence du virement reste `reservations.statut` : `confirmer_reservation` écrit toujours `paid`.

## Revue API
- `apps/api/src/modules/orders/` étendu (pas de nouveau module) : `POST /orders/hold` (crée le hold), `POST /orders/:id/confirm` (`:id` est ici un id de **réservation**, pas de commande — à ne pas confondre avec `:id/refund`). Suit le pattern à 4 couches déjà utilisé par `tickets` (domain/infrastructure/application/presentation).
- Nouveaux codes métier, ajoutés à `apps/api/src/common/errors/pg-errors.ts` : `BT030` (mode de paiement invalide, 422), `BT031` (réservation introuvable, 404), `BT032` (réservation non active, 409), `BT033` (réservation expirée, 409). `BT013` (action interdite) réutilisé tel quel pour le contrôle de propriété.
- `POST /tickets/purchase` reste disponible (tests/référence) ; `acheter_billet` compte désormais les holds actifs (009) : le Checkout web n'appelle plus `purchase` directement, il passe par `hold`→`confirm`.

## Front
- `Checkout.tsx` pose un hold puis, en carte, enchaîne immédiatement la confirmation (paiement simulé quasi instantané) ; en virement, redirige vers un écran d'attente (`/checkout/awaiting-transfer`) affichant la date limite.
- `HoldCountdown.tsx` : compte à rebours purement indicatif côté client — l'application réelle de l'expiration reste côté serveur (`confirmer_reservation` revalide `expire_a`, BT033 sinon).
- `en_attente_virement` ajouté aux types `OrderStatus` (API + web) et au badge de `OrganizerEvents.tsx`.
- **Lacune assumée** : aucune UI de confirmation de virement n'est fournie (rapprochement bancaire hors périmètre de cette phase, back-office non construit). La réservation expire d'elle-même si le virement n'est jamais confirmé manuellement en base.

## Tests
- SQL : `database/tests/phase10_reservations.sql` — cas nominaux (TTL carte/virement), toutes les erreurs métier (BT001-BT008, BT030-BT033, BT013), quota consommé par des réservations actives seules, prix figé au moment du hold, interaction avec les billets confirmés (compte comme `acheter_billet`), et une preuve que `purger_reservations_expirees` n'a aucun effet sur le résultat du calcul de quota.
- Concurrence : `database/scripts/concurrency.mjs` étendu avec deux scénarios — N holds simultanés sur un tarif à quota fixe (zéro survente, même verrou `FOR UPDATE` qu'`acheter_billet`), et un hold à TTL très court qui, une fois expiré, libère le quota pour un nouveau hold sans dépendre de la purge. Ajouts 009 : N `acheter_billet` simultanés sur un tarif entièrement réservé (0 succès), hold expiré libérant le quota pour `acheter_billet`, purge marquant les holds expirés sans toucher les actifs.
- Aucune régression sur les tests existants (`phase04_fonctions_triggers.sql`, `phase05_securite.sql`, `phase09_multi_tenant.sql`, scénario `acheter_billet` de `concurrency.mjs`).

## Critères d'acceptation
- [x] Migration `008_reservations.sql` : table `reservations`, RLS posée dans la même migration.
- [x] `creer_reservation` : même verrou anti-survente qu'`acheter_billet`, TTL différencié par mode de paiement (15 min / 72h par défaut, configurable via `p_ttl_override` pour les tests).
- [x] `confirmer_reservation` : transforme un hold actif et non expiré en commande payée, au prix figé.
- [x] Quota étendu aux réservations actives non expirées, expiration lazy jamais dépendante de la purge.
- [x] `purger_reservations_expirees` : reporting uniquement, prouvé sans effet sur la correction par test dédié ; appelée périodiquement par `ReservationsPurgeJob` (API, `RESERVATIONS_PURGE_INTERVAL_MS`, défaut 60 s, `0` = désactivé).
- [x] Quota unifié (`places_occupees`) entre `acheter_billet`, `creer_reservation` et `places_restantes` ; `en_attente_virement` dans `ck_commandes_statut` (009).
- [x] API : `POST /orders/hold`, `POST /orders/:id/confirm`.
- [x] Front : compte à rebours sur Checkout (carte), écran d'attente de virement avec délai.
- [x] Test de concurrence : N holds simultanés, zéro survente.
- [x] Test : un hold expiré ne bloque plus le quota.

## Suites (phases 12 à 16)
- **Phase 12** : une offre de liste d'attente est une ligne `reservations` (mode `carte`, TTL 30 min).
  - Elle est bloquée par la même règle de quota et confirmée par `confirmer_reservation`.
  - Le trigger `trg_reservations_liberation` (010) relance la file quand un hold passe à `annulee` ou `expiree`.
- **Phase 15** : `rembourser_commande` refuse l'annulation self-service après `debut - delai_annulation` (`BT014`). Une commande payée met un e-mail en file (outbox).
- **Phase 16** : le scénario de charge `pnpm test:load` (60 acheteurs, quota 10, via l'API) vérifie qu'il n'y a jamais de survente avec holds, confirmations concurrentes (3 par hold : une seule commande), désistements et expirations mélangés.
- Les codes `BT030` à `BT033` restent ceux de cette phase. Le TODO de la phase 16 proposait une autre numérotation, non retenue : voir [database.md](../database.md#codes-derreur).
