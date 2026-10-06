# Phase 11 — Idempotence webhook paiement

**Statut : à faire.** Cette phase n'est pas implémentée. Les points de la phase 16 qui en dépendent (charge « webhook inclus », rejeu massif de webhook) restent ouverts.

## Objectifs
Un prestataire de paiement notifie l'API par webhook, parfois plusieurs fois et dans le désordre. Chaque événement de paiement ne doit produire son effet (confirmation d'une réservation, création des billets) **qu'une seule fois**.

## Spécifications prévues (todo)
- Migration `014_webhooks.sql` : table `paiement_webhooks` avec `UNIQUE (evenement_externe_id)`, RLS dans la même migration (règle de la phase 09).
- `POST /payments/webhook` avec vérification de signature du prestataire : guard dédié, distinct de l'authentification par session.
- `INSERT … ON CONFLICT DO NOTHING` dans la même transaction que le traitement métier (`confirmer_reservation`). Un rejeu ne fait rien et renvoie 200.
- Tests : même événement envoyé deux fois en parallèle, un seul billet créé ; signature invalide rejetée ; rejeu massif dans le scénario de charge (`pnpm test:load`).

## Points d'appui déjà en place
- `confirmer_reservation` verrouille la réservation et refuse une seconde confirmation (`BT032`). Le webhook n'aura qu'à l'appeler.
- Le paiement par virement attend déjà une confirmation externe : statut `en_attente_virement` et réservation de 72 h (phase 10).
