# Phases du projet Billetto

Chaque phase est livrée puis validée avant de passer à la suivante.
Chaque fichier décrit : **objectifs**, **spécifications**, **critères d'acceptation**.

| #  | Phase                                                                  | Statut        |
|----|------------------------------------------------------------------------|---------------|
| 01 | [Bootstrap, schéma, seed](phase-01-bootstrap-schema-seed.md)           | ✅ Livrée     |
| 02 | [SQL avancé, vues, vue matérialisée](phase-02-sql-avance-vues.md)      | ✅ Livrée     |
| 03 | [Performance : index et EXPLAIN](phase-03-performance-index.md)        | ✅ Livrée     |
| 04 | [Fonctions, procédures, triggers](phase-04-fonctions-triggers.md)      | ✅ Livrée     |
| 05 | [Sécurité PostgreSQL : rôles, GRANT, RLS](phase-05-securite-db.md)     | ✅ Livrée     |
| 06 | [API NestJS](phase-06-api.md)                                          | ✅ Livrée     |
| 07 | [Branchement du front](phase-07-front.md)                              | ✅ Livrée     |
| 08 | [Documentation, Docker final, CI](phase-08-docs-ci.md)                 | 🔄 CI et doc base livrées en phase 16 ; README/démos à finir |
| 09 | [Multi-tenant « collectifs »](phase-09-multi-tenant.md)                | ✅ Livrée     |
| 10 | [Réservation temporaire (hold) + TTL](phase-10-reservations.md)        | ✅ Livrée     |
| 11 | [Idempotence webhook paiement](phase-11-webhooks.md)                   | ⬜ À faire    |
| 12 | [Liste d'attente](phase-12-liste-attente.md)                           | ✅ Livrée     |
| 13 | [Check-in QR, doublons, offline-first](phase-13-checkin.md)            | ✅ Livrée (test mobile manuel à faire) |
| 14 | [Dashboard temps réel par collectif](phase-14-dashboard-live.md)       | ✅ Livrée     |
| 15 | [Souhaits secondaires](phase-15-souhaits-secondaires.md)               | ✅ Livrée     |
| 16 | [Charge, concurrence, durcissement, docs](phase-16-durcissement.md)    | ✅ Livrée hors webhook (dépend de 11) |
