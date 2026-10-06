# Phase 15 — Souhaits secondaires

## Objectifs
- Annulation self-service par l'acheteur, avec un délai réglable par événement.
- E-mail de confirmation avec les billets (QR joints), et e-mail « une place vous attend » pour la liste d'attente.
- Export CSV des participants pour l'organisateur.
- Fuseaux horaires explicites : stockage UTC vérifié, fuseau par événement, affichage correct pour un visiteur d'un autre fuseau ou un événement en ligne.

## Migration `013_souhaits_secondaires.sql`
- **Délai d'annulation** :
  - `evenements.delai_annulation interval` : 48 h par défaut, CHECK entre 0 et 30 jours.
  - `rembourser_commande_impl`, reprise de 005, lève **BT014** sur le chemin self-service quand `now() > debut - delai_annulation`.
  - BT012 (événement commencé) reste vérifié en premier. L'admin (`admin_rembourser_commande`) n'est pas soumis au délai.
  - `limite_annulation(commande)` renvoie l'échéance d'une commande de l'utilisateur courant, et NULL pour celle d'un autre.
  - Le remboursement de sa propre commande existait déjà (contrôle de propriété, phase 05). Cette phase y ajoute le délai.
- **Fuseaux** :
  - `evenements.fuseau_horaire` (IANA, `Europe/Paris` par défaut), validé par trigger contre `pg_timezone_names` (**BT015**) ;
  - `evenements.en_ligne` ;
  - test : aucune colonne `timestamp without time zone` dans les tables.
- **Outbox e-mails, `emails_sortants`** : remplie **par trigger, dans la transaction métier**. Un e-mail n'est donc jamais envoyé pour un achat annulé, et jamais perdu si l'API redémarre.
  - `commande_confirmee` : commande insérée ou passée à `paid`. Cela couvre `acheter_billet`, `confirmer_reservation` et donc `confirmer_liste_attente`.
  - `offre_liste_attente` : inscription passée de `en_attente` à `notifiee`.
  - `UNIQUE (type, commande_id)` et `UNIQUE (type, liste_attente_id)` : jamais deux e-mails pour un même fait.
  - `emails_a_envoyer(n)` : `FOR UPDATE SKIP LOCKED` et bail de 5 min, pour que deux instances ne prennent jamais la même ligne. Il renvoie le contenu, dont les QR des billets.
  - `marquer_email` : `envoye`, ou nouvel essai avec un backoff de 2^n min, puis `echec` après 5 tentatives.
  - Aucun GRANT sur la table. Les deux fonctions sont réservées à `billetto_admin` (le job).
  - La seed vide l'outbox : ses commandes ne sont pas des achats réels.
- **`participants_evenement(evenement)`** :
  - accès par `controler_checkin` (organisateur de l'événement ou admin) ;
  - un billet par ligne : titulaire, tarif, statut de commande, check-in ;
  - **sans e-mail**, conformément à la règle « e-mails visibles de l'admin seulement ».
- GRANT `UPDATE` des nouvelles colonnes à l'organisateur, car 005 accorde `UPDATE` colonne par colonne.

## API
- `POST /orders/:id/refund` : BT014 renvoie 409 `DELAI_ANNULATION_DEPASSE`. `annulationPossibleJusqua` est exposé dans `GET /tickets/me` et `GET /orders/:id`.
- `events` : `enLigne`, `fuseauHoraire` (zod contre `Intl.supportedValuesOf('timeZone')`) et `delaiAnnulationHeures` (0 à 720) en lecture, création et modification. `delai_annulation`, de type `interval`, est écrit en SQL brut, car le client Prisma ne gère pas ce type.
- `GET /events/:id/participants/export` : CSV `text/csv; charset=utf-8`, BOM, séparateur « ; », CRLF, `Content-Disposition: attachment`.
  - Le sérialiseur `common/csv.ts` neutralise l'injection de formules (`= + - @`).
- Module `notifications` :
  - `EmailOutboxJob` tourne toutes les 10 s, en rôle admin ; il réserve un lot, envoie hors transaction, puis marque le résultat ;
  - templates purs (`domain/templates.ts`), avec les heures dans le fuseau de l'événement et son nom ;
  - nodemailer, QR en PNG intégrés au HTML par `cid` ;
  - config `SMTP_URL` (optionnelle : sans elle, les e-mails restent en file), `MAIL_FROM`, `EMAIL_OUTBOX_INTERVAL_MS` (à 0 pendant les tests e2e).
- `docker-compose.yml` : **Mailpit** (SMTP 1025, interface http://localhost:8025), lancé par `pnpm infra:up`. Les variables sont dans `.env.example`.

## Front
- `lib/format.ts` :
  - les dates prennent un fuseau explicite, celui du visiteur par défaut, au lieu de `Europe/Paris` codé en dur ;
  - `formatEventTime` : pour un lieu physique, l'heure du lieu, avec « heure de Paris » si le visiteur est ailleurs ; pour un événement en ligne, l'heure du visiteur « chez vous », avec celle de l'événement ;
  - `zonedTimeToIso` : l'heure saisie par l'organisateur est interprétée dans le fuseau de l'événement, changement d'heure compris.
- `CreateEvent` : fuseau, délai d'annulation, case « Événement en ligne ».
- `EventDetail` et `EventCard` : dates dans le fuseau de l'événement ; « En ligne » à la place du lieu.
- « Mes billets » : bouton « Annuler et rembourser » avec « Annulation possible jusqu'au … », désactivé une fois le délai passé.
- « Mes événements » : bouton « Participants (CSV) », téléchargé par `fetch` avec les cookies (`lib/http.ts`, `download`).

## Tests
- `database/tests/phase15_souhaits.sql` :
  - délai : accepté avant, BT014 après, admin non bloqué ;
  - BT015 ;
  - conversion UTC vers le fuseau ;
  - aucune colonne `timestamp` sans fuseau ;
  - outbox : un e-mail par commande, par `confirmer_reservation` et par offre, pas de doublon au repassage à `paid` ;
  - bail, envoi, backoff, échec définitif ;
  - participants : contenu et BT013.
- e2e « souhaits secondaires » :
  - outbox remplie à l'achat ;
  - 409 `DELAI_ANNULATION_DEPASSE` et échéance exposée ;
  - délai, fuseau et événement en ligne réglables, fuseau invalide en 400 ;
  - CSV cohérent avec la base, 403 pour un autre organisateur et pour un visiteur.
- Tests unitaires :
  - API : `csv.spec.ts` (échappement, formules), `notifications.spec.ts` (templates, job avec nodemailer `jsonTransport`, PNG joints, échec SMTP) ;
  - web : `timezones.spec.ts` (Paris, New York, Tokyo, heures d'été et d'hiver, en ligne / physique, annulation).

## Vérification manuelle
1. `pnpm infra:up`, puis `SMTP_URL=smtp://localhost:1025` dans `.env`, puis `pnpm dev`.
2. Un achat fait arriver un e-mail dans Mailpit avec les QR en pièces jointes, scannables par `/checkin`.
3. Sur « Mes billets », l'échéance d'annulation est affichée, et le bouton est grisé une fois le délai passé.
4. L'export CSV s'ouvre correctement dans Excel : accents, colonnes.
5. Avec un événement en ligne à New York, la page de l'événement affiche « 20:00 chez vous (14:00 heure de New York) ».

## Critères d'acceptation
- [x] Annulation self-service avec délai configurable.
- [x] E-mails de confirmation (QR joints) et d'offre de liste d'attente.
- [x] Export CSV des participants.
- [x] Fuseaux : `timestamptz` vérifié, fuseau d'affichage explicite, conversion front.
- [x] Tests : annulation refusée après délai, CSV cohérent, heure locale correcte.

## Suites (phase 16)
- Le scénario de charge vérifie l'outbox sous concurrence : un e-mail par commande ayant été payée (remboursées comprises) et un par offre de liste d'attente.
- `emails_sortants` n'est lisible par aucun rôle applicatif ; `emails_a_envoyer` est refusé au visiteur (`phase16_isolation.sql`).
- La CI désactive l'envoi réel (`SMTP_URL` vide) : les e-mails restent en file et sont vérifiés en base.
