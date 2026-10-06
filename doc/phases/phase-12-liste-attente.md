# Phase 12 — Liste d'attente

## Objectifs
- Permettre de s'inscrire sur un tarif épuisé et proposer chaque place libérée au premier inscrit (FIFO strict par `created_at`), avec un délai de réponse limité.
- Passer automatiquement au suivant en cas de non-réponse, sans doublon ni oubli de notification, et sans qu'une place offerte puisse être prise par un autre chemin d'achat.

## Migration `010_liste_attente.sql`
- Table `liste_attente` (`tarif_id`, `utilisateur_id`, `quantite_souhaitee`, `statut`, `reservation_id`, `notifie_a`, `expire_a`, `created_at`). Statuts : `en_attente`, `notifiee`, `confirmee`, `expiree`, `annulee`.
  - Index unique partiel : une seule inscription vivante par utilisateur et par tarif.
  - Index FIFO partiel `(tarif_id, created_at, id) WHERE statut = 'en_attente'`.
  - RLS posée dans la même migration (règle de la phase 09) : chacun ses lignes, l'organisateur celles de ses tarifs, l'admin tout. Aucune écriture directe.
- **Une offre est une réservation.** Notifier un inscrit crée une ligne `reservations` à son nom (mode `carte`, TTL 30 min, prix figé). Ce choix réutilise directement la phase 10 :
  - la place est comptée par `places_occupees()`, donc bloquée pour `acheter_billet`, `creer_reservation` et `places_restantes` ;
  - l'expiration est *lazy* (`expire_a > now()`), donc une non-réponse libère la place sans job ;
  - la confirmation passe par `confirmer_reservation` (mêmes inserts, prix figé).
- `notifier_prochain_en_attente(p_tarif_id)` :
  1. pose le verrou `FOR UPDATE` sur `tarifs`, le même que les achats ;
  2. prend la tête de file avec `ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED` ;
  3. crée l'offre si la quantité demandée rentre dans le quota libre. **FIFO strict** : une tête trop grosse n'est pas doublée.
  4. Si la vente est fermée (événement non publié, déjà commencé ou hors période), aucune offre n'est créée.
- **Déclencheur canonique unique : `traiter_liste_attente(p_tarif_id)`.**
  - Elle clôt les offres terminées (`confirmee`, ou `expiree` si la réservation a expiré ou a été annulée), puis notifie la file tant que la tête rentre.
  - Elle est idempotente, puisqu'elle recalcule tout depuis `places_occupees` sous verrou : l'appeler plusieurs fois ne crée jamais deux offres pour une même place.
  - Elle a trois points d'appel, tous vers cette seule fonction :
    - trigger `trg_commandes_liberation` : une commande passe de `paid`/`pending` à `refunded`/`cancelled` (désistement) ;
    - trigger `trg_reservations_liberation` : un hold `active` passe à `annulee` ou `expiree` ;
    - `traiter_listes_attente()` : balayage de toutes les files non vides, appelé par `ReservationsPurgeJob` juste après la purge. Il rattrape les expirations *lazy*, qui ne produisent aucun événement.
- Fonctions utilisateur (SECURITY DEFINER, contrôle d'identité BT013) :
  - `inscrire_liste_attente` refuse avec BT040 si des places sont libres et que personne n'attend, et avec BT042 en cas de double inscription ;
  - `confirmer_liste_attente` lève BT041 (introuvable) ou BT043 (aucune offre active) ;
  - `annuler_liste_attente` rend une offre en cours, qui est alors proposée au suivant ;
  - `position_liste_attente` renvoie le rang FIFO, agrégat seul.

## API
- Nouveau module `apps/api/src/modules/waitlist/`, sur le modèle à 4 couches de `orders`. Routes :
  - `POST /waitlist` ;
  - `GET /waitlist/me` ;
  - `POST /waitlist/:id/confirm` ;
  - `DELETE /waitlist/:id` ;
  - `GET /waitlist/tarifs/:tarifId` (organisateur ou admin, filtrée par la RLS, sans donnée personnelle).
- Codes métier dans `pg-errors.ts` : `BT040` (409 `PLACES_DISPONIBLES`), `BT041` (404), `BT042` (409 `DEJA_INSCRIT`), `BT043` (409 `OFFRE_INACTIVE`).
- `ReservationsPurgeJob` appelle `traiter_listes_attente()` après `purger_reservations_expirees()`.

## Front
- `EventDetail` : sur un tarif épuisé, bouton « S'inscrire en liste d'attente », ou l'état de l'inscription (position, offre à confirmer). Le propriétaire voit les files de ses tarifs.
- Page `/waitlist` :
  - les offres en cours, avec un compte à rebours (`HoldCountdown`), « Confirmer et payer » et « Laisser ma place » ;
  - les inscriptions en attente, avec leur position ;
  - l'historique.
- « Notification » : polling de `GET /waitlist/me` toutes les 30 s, et badge dans l'en-tête quand une offre est en cours. **Lacune assumée** : pas d'e-mail.

## Tests
- `database/tests/phase12_liste_attente.sql` vérifie :
  - un remboursement notifie le seul premier inscrit ;
  - aucune fuite pendant l'offre : `acheter_billet` et `creer_reservation` renvoient BT006 ;
  - idempotence du déclencheur ;
  - une non-réponse passe l'offre au suivant ;
  - la confirmation ;
  - une désinscription rend la place ;
  - FIFO strict avec une tête trop grosse ;
  - les erreurs BT040 à BT043 et BT013.
- `database/scripts/concurrency.mjs`, test 8 : 40 `traiter_liste_attente` simultanés après une expiration lazy donnent exactement une offre, pour la tête de file.
- e2e `apps/api/test/api.e2e-spec.ts` (« liste d'attente ») : parcours HTTP complet, vue organisateur et isolation RLS.

## Critères d'acceptation
- [x] Migration `010_liste_attente.sql`, RLS dans la même migration.
- [x] `notifier_prochain_en_attente` : `FOR UPDATE SKIP LOCKED`, FIFO strict.
- [x] Déclencheur canonique unique et idempotent (`traiter_liste_attente`), sans doublon ni oubli.
- [x] Module API `waitlist` et vue organisateur.
- [x] Front : inscription sur `EventDetail`, écran de confirmation avec délai.
- [x] Tests : FIFO strict, non-réponse, pas de fuite de place, concurrence.

## Suites (phases 14 à 16)
- **Phase 14** : `v_remplissage.places_liste_attente` compte les places demandées par les inscrits `en_attente`. Une offre `notifiee` est comptée en réservé, sans double compte.
- **Phase 15** : le passage à `notifiee` met en file un e-mail « une place vous attend » (`trg_liste_attente_email`). Il complète le polling et le badge du front.
- **Phase 16** :
  - charge via l'API : 30 inscriptions simultanées (positions FIFO distinctes), 5 désistements concurrents (les 5 premiers inscrits reçoivent l'offre, eux seuls), 2 offres ignorées (expiration puis balayage : les 2 suivants sont notifiés), confirmations pendant que d'autres tentent d'acheter (aucune place volée) ;
  - isolation : un organisateur ne voit que les inscriptions sur ses tarifs, un visiteur que les siennes, et aucun rôle ne peut modifier directement `liste_attente` pour sauter la file.
