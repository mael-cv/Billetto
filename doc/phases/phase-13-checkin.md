# Phase 13 — Check-in QR, détection de doublon, offline-first

## Objectifs
- Valider l'entrée d'un billet en scannant son QR depuis un mobile, y compris sans réseau.
- Un billet n'est validé qu'**une seule fois**, garanti par la base, même avec plusieurs appareils en parallèle.
- Les scans faits hors ligne sont rejoués sans jamais créer de doublon, quel que soit l'ordre d'envoi.

## Migration `011_checkin.sql`
- **QR signé en base.**
  - `pgcrypto` ; la clé HMAC est dans `checkin_secret`, une ligne, sans aucun GRANT.
  - `billets.code_verification` = HMAC-SHA256(secret, `code`) en base64url sur 22 caractères (132 bits).
  - Un trigger la recalcule à chaque insertion ou modification : aucun chemin ne peut fournir sa propre signature.
  - Les billets existants ont été remplis par backfill ; la colonne est ensuite passée en `NOT NULL UNIQUE`.
  - QR : `BT1.<code>.<code_verification>`. Ni l'API ni le front ne connaissent le secret.
- **`billets_scans`** : un journal de tous les scans (`ok`, `doublon`, `invalide`, `annule`, `mauvais_evenement`), avec `scanne_a` (heure du téléphone) et `recu_a` (heure serveur).
  - `client_scan_id uuid UNIQUE`, généré par le téléphone : c'est la clé d'idempotence des rejeux.
  - **`uq_billets_scans_billet_ok`** : `UNIQUE (billet_id) WHERE resultat = 'ok'`. C'est la garantie anti-doublon.
  - Un doublon est relié au premier scan par `premier_scan_id`.
  - RLS dans la même migration : l'organisateur voit les scans de ses événements, l'admin tout. Aucune écriture directe.
- **`scanner_billet(client_scan_id, payload, evenement_id, scanne_a, appareil)`** :
  1. Contrôle d'accès (`controler_checkin`) : organisateur de l'événement ou admin, sinon BT013 ; BT050 si l'événement n'existe pas.
  2. Si le `client_scan_id` est déjà connu, la ligne d'origine est renvoyée avec `rejeu = true`, sans aucune écriture.
  3. Vérification du HMAC, de l'événement et du statut de la commande (`paid`).
  4. `INSERT ok`. Une `unique_violation` sur l'index partiel donne un `INSERT doublon`. Une violation sur `client_scan_id` (même scan rejoué en parallèle) renvoie la ligne déjà enregistrée.
  5. Le retour inclut le titulaire abrégé (« Camille P. »), le tarif et, pour un doublon, l'heure et l'appareil du premier scan.
- **Règle d'arbitrage** : le premier scan *reçu par le serveur* gagne. L'horloge d'un téléphone hors ligne n'est pas fiable ; `scanne_a` sert uniquement à l'affichage.
- **`manifeste_checkin(evenement_id)`** : billets payés, signature, titulaire abrégé et statut de scan. Il sert à la validation provisoire hors ligne.

## API
- Nouveau module `apps/api/src/modules/checkin/`, réservé aux organisateurs et aux admins. Routes :
  - `POST /checkin/scan` ;
  - `POST /checkin/scan/batch` (1 à 200 scans) ;
  - `GET /checkin/manifest?evenementId=`.
- **Lot** : une transaction par scan. Une erreur métier ne concerne que son scan (`status: 'error'`). Une erreur technique interrompt le lot, et le client conserve alors toute sa file.
- `GET /tickets/me` expose `qrPayload` ; la RLS limite le titulaire à ses propres signatures.
- Codes : `BT050` (404 `EVENEMENT_INTROUVABLE`), `BT051` (422 `QR_VIDE`).

## Front
- `Tickets.tsx` affiche un vrai QR (librairie `qrcode`) à la place de l'ancien motif décoratif.
- `/checkin?evenement=<id>` est accessible par le bouton « Check-in » des événements publiés, dans `OrganizerEvents`. Écran pensé pour le mobile :
  - caméra arrière via `BarcodeDetector`, avec saisie manuelle en repli (iOS Safari et Firefox n'ont pas `BarcodeDetector`) ;
  - plein écran **vert** (validé), **rouge** (déjà utilisé, avec l'heure et l'appareil du premier scan), **orange** (annulé, invalide, autre événement), plus une vibration ;
  - bandeau « En ligne / Hors ligne · N à synchroniser », compteurs, liste des conflits.
- `lib/checkinQueue.ts` : chaque scan est d'abord écrit dans la file locale (localStorage, avec repli en mémoire), avec un `crypto.randomUUID()`, puis :
  - un verdict provisoire est calculé à partir du manifeste, mis en cache pour fonctionner après un rechargement hors ligne ;
  - en ligne, le scan part immédiatement ; sinon il est synchronisé par lots, à l'événement `online` et toutes les 15 s ;
  - un scan validé hors ligne puis refusé par le serveur (doublon fait sur un autre appareil) est affiché comme **conflit**.
- `pnpm --filter @billetto/web dev:https` lance Vite avec un certificat auto-signé et `--host`. La caméra exige HTTPS sur un téléphone.

## Tests
- `database/tests/phase13_checkin.sql` vérifie :
  - la signature : calculée, non modifiable ;
  - ok puis doublon, avec les informations du premier scan ;
  - les rejeux, y compris dans le désordre : aucune ligne supplémentaire, exactement 1 `ok` ;
  - les cas invalide, mauvais événement et billet remboursé ;
  - BT013, BT050, BT051 ;
  - le manifeste.
- `concurrency.mjs`, test 9 : 40 scans simultanés du même billet donnent 1 `ok` et 39 `doublon` ; le même `client_scan_id` envoyé 40 fois donne 1 ligne.
- e2e `check-in` : QR exposé, contrôle d'accès, doublon, lot rejoué dans le désordre, isolement des erreurs dans un lot, manifeste.
- Tests unitaires : schémas zod (API), `checkinQueue` (web).

## Test manuel mobile (à faire)
1. `pnpm infra:up`, puis `pnpm --filter @billetto/api dev` et `pnpm --filter @billetto/web dev:https`. Sur le téléphone, ouvrir `https://<ip-du-pc>:3000` (Chrome Android) et accepter le certificat.
2. Se connecter en organisateur, ouvrir « Check-in » sur un événement publié. Le manifeste se charge.
3. Passer en **mode avion** et scanner 2 billets différents, puis le premier une seconde fois : vert, vert, rouge (doublon local). Le bandeau affiche « 3 à synchroniser ».
4. Scanner l'un de ces billets depuis un autre appareil, resté en ligne.
5. Couper le mode avion : la synchronisation est automatique, le compteur revient à 0, et le doublon fait sur l'autre appareil apparaît en conflit.
6. Vérifier en base :
   ```sql
   SELECT billet_id, count(*) FILTER (WHERE resultat = 'ok') FROM billets_scans GROUP BY 1 HAVING count(*) FILTER (WHERE resultat = 'ok') > 1;
   ```
   La requête doit renvoyer 0 ligne.

## Critères d'acceptation
- [x] `011_checkin.sql` : `code_verification` signée, `billets_scans`, `client_scan_id UNIQUE`, index unique partiel.
- [x] Module API `checkin` (scan, lot, manifeste).
- [x] Front `/checkin` : caméra, file offline, synchronisation en arrière-plan, retour visuel.
- [x] Tests : doublon avec les informations du premier scan ; rejeux dans le désordre idempotents.
- [ ] Test manuel mobile en mode avion.

## Suites (phases 15 et 16)
- **Phase 15** : les QR des billets sont joints en PNG à l'e-mail de confirmation. Ils sont scannables par `/checkin`.
- **Phase 16** : isolation vérifiée.
  - Un organisateur ne voit que les scans de ses événements ; `manifeste_checkin` et `scanner_billet` sur l'événement d'un autre collectif renvoient `BT013`.
  - Aucune écriture directe dans `billets_scans` : on ne peut ni forger ni effacer un passage.
  - `checkin_secret` n'est lisible par aucun rôle applicatif.
- Le doublon de scan reste un **résultat** et non un code d'erreur, contrairement à la proposition du TODO de la phase 16. Voir [database.md](../database.md#codes-derreur).
