# Phase 02 — SQL avancé, vues, vue matérialisée

## Objectifs
- Implémenter les requêtes d'analyse du cours avec l'outil SQL adapté à chaque problème.
- Encapsuler les agrégations réutilisables dans des vues dépendantes les unes des autres.
- Illustrer le compromis fraîcheur / performance avec une vue matérialisée.

## Spécifications
- `database/queries/` :
  - Q1 ventes par événement : CTE + `LEFT JOIN` depuis `evenements` (événements sans vente conservés).
  - Q2 événements sans vente : `NOT EXISTS`, avec démonstration du piège `NOT IN` + `NULL`.
  - Q3 taux de remplissage : CTE quotas + CTE ventes.
  - Q4 CA par lieu : `LEFT JOIN`, lieux sans vente conservés.
  - Q5 ventes quotidiennes.
  - Q6 utilisateurs sans commande : `COUNT(*) = 0` vs `NOT EXISTS` (plans comparés).
  - Q7 CA par ville et type : agrégats `FILTER (WHERE …)`.
  - Arbre des types : `WITH RECURSIVE` (ancre, `UNION ALL`, niveau, chemin, condition d'arrêt).
- Définition : une vente est un billet appartenant à une commande `paid`.
- Migration vues : `v_ventes_par_evenement` → `v_remplissage`, `v_classement_lieux`.
- `mv_ventes_quotidiennes (jour, commandes, billets, ca)` + index `UNIQUE (jour)`.
- Script `pnpm db:refresh-mv` (`REFRESH MATERIALIZED VIEW CONCURRENTLY`).

## Livrables
- Requêtes : `database/queries/q1…q8*.sql`
- Migration : `database/migrations/002_views.sql`
- Tests : `database/tests/phase02_requetes_vues.sql` — `pnpm db:test`
- Rafraîchissement : `pnpm db:refresh-mv` (concurrent) / `pnpm db:refresh-mv --blocking`

## Critères d'acceptation
- [x] Chaque requête Q1–Q7 s'exécute sur le seed small et son résultat est vérifié par un test SQL.
- [x] Q1 et Q4 incluent les événements / lieux sans vente avec CA = 0.
- [x] Le script Q2 montre que `NOT IN` renvoie 0 ligne en présence d'un `NULL`, contrairement à `NOT EXISTS`.
- [x] La requête récursive renvoie `id, nom, niveau, chemin` pour les 18 types (12 feuilles, profondeur 3).
- [x] `DROP VIEW v_ventes_par_evenement` échoue à cause des dépendances ; test présent.
- [x] Après un achat, la vue reflète la vente immédiatement, la MV seulement après refresh.
- [x] `REFRESH … CONCURRENTLY` fonctionne grâce à l'index unique.
