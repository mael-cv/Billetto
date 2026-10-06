# Phase 04 — Fonctions, procédures, triggers

## Objectifs
- Placer les règles métier atomiques dans PostgreSQL.
- Garantir l'absence de survente, y compris en concurrence.

## Spécifications
- `ca_evenement(evenement_id)` → numeric ; `billets_utilisateur(utilisateur_id)` → table.
- `acheter_billet(utilisateur_id, tarif_id, quantite)` : vérifie tarif actif, événement publié, période de vente, événement non commencé, quota (verrou `SELECT … FOR UPDATE` sur le tarif) ; crée commande, paiement et billets ; renvoie les identifiants ; erreurs via `RAISE` avec des `SQLSTATE` dédiés.
- Procédure `rembourser_commande(commande_id)` : commande `paid` uniquement, paiement `refund` négatif, statut `refunded`.
- Triggers : `trg_billets_validate_date` (BEFORE INSERT), `trg_tarifs_audit` (AFTER UPDATE OF prix, quota OR DELETE → `journal_tarifs`), `updated_at` sur les tables peu écrites uniquement.
- `COMMENT ON` pour chaque fonction, procédure et trigger.

## Livrables
- Migration : `database/migrations/004_functions_triggers.sql` (+ `idx_billets_utilisateur_id`, justifié par le benchmark B10)
- Tests : `database/tests/phase04_fonctions_triggers.sql` (29 vérifications)
- Concurrence : `database/scripts/concurrency.mjs` (intégré à `pnpm db:test`)
- Documentation : `doc/database.md` (fonctions, codes d'erreur, triggers, coût), `doc/decisions.md` D11–D16

## Ajouts par rapport à la spécification
- Trigger bonus de validation EAV (`BT020`).
- Règle : remboursement refusé après le début de l'événement (`BT012`).
- Démonstration de survente avec une version sans verrou (40 billets vendus pour 10 places).

## Critères d'acceptation
- [x] Tests : achat valide, quota épuisé, événement commencé, tarif inexistant, vente fermée.
- [x] Test de concurrence : N sessions parallèles sur un quota Q → exactement Q billets vendus (40 sessions, quota 10).
- [x] Remboursement valide ; second remboursement refusé.
- [x] Modifier le prix ou le quota, ou supprimer un tarif, crée une ligne dans `journal_tarifs`.
- [x] Insérer un billet pour un événement commencé est refusé par le trigger.
