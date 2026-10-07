# Phase 11 — Idempotence webhook paiement

**Statut : livrée** (branche `feat/webhook`, migration `014_webhooks.sql`). Développée en parallèle des phases 13 à 16 : sa migration prend le numéro 014 car 013 était déjà attribué à la phase 15.

## Objectifs
Un prestataire de paiement notifie l'API par webhook, parfois plusieurs fois et dans le désordre. Chaque événement de paiement ne doit produire son effet (confirmation d'une réservation, création des billets) **qu'une seule fois**.

## Migration `014_webhooks.sql`
- Table `paiement_webhooks` : `UNIQUE (evenement_externe_id)`, lien vers la réservation, payload `jsonb`. RLS activée et forcée dans la même migration (règle de la phase 09) ; aucune écriture directe.
- `traiter_paiement_webhook(evenement_externe_id, type, reservation_id, payload)` (SECURITY DEFINER) : `INSERT … ON CONFLICT DO NOTHING`, puis, seulement si la ligne est nouvelle, `confirmer_reservation` **dans la même transaction**. Si la confirmation échoue, l'insertion est annulée aussi : un rejeu ultérieur peut réussir.

## API
- `POST /payments/webhook` : guard dédiée, sans session ni CSRF. Signature HMAC-SHA256 du corps brut avec `PAYMENTS_WEBHOOK_SECRET`. Docker Compose exige un secret non vide ; hors Compose, sans secret configuré, la garde répond indisponible et refuse le webhook.
- Un événement déjà reçu renvoie 200 sans rien refaire.

## Tests
- `database/tests/phase11_webhooks.sql` : idempotence, rollback de l'insertion si la confirmation échoue, RLS.
- `database/scripts/concurrency.mjs` : le même événement envoyé 40 fois en parallèle → un seul billet.
- Unitaires : guard de signature. e2e : signature invalide rejetée, signature valide confirme une seule fois.
- `phase16_isolation.sql` : le garde-fou RLS couvre automatiquement `paiement_webhooks`.

## Reste à faire
- Une vague webhook dans le scénario de charge `pnpm test:load` (phase 16).
