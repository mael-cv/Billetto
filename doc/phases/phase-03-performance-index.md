# Phase 03 — Performance : index et EXPLAIN

## Objectifs
- Mesurer, puis indexer, puis re-mesurer : aucun index sans preuve.
- Savoir lire un plan d'exécution PostgreSQL.

## Spécifications
- Sur seed FULL, `database/benchmarks/before/*.sql` : `EXPLAIN (ANALYZE, BUFFERS)` des requêtes de la phase 02 et des accès API courants.
- Migration `003_indexes.sql` : `idx_billets_tarif_id`, `idx_billets_commande_id`, `idx_commandes_utilisateur_id`, `idx_paiements_commande_id`, `idx_evenements_debut` ; d'autres index uniquement si un plan le justifie.
- `ANALYZE`, puis mêmes requêtes dans `after/`.
- `pnpm db:benchmark` écrit les plans dans `database/benchmarks/results/`.
- `doc/performance.md` : nœuds rencontrés (Seq Scan, Index Scan, Bitmap Heap/Index Scan, Nested Loop, Hash Join, Merge Join), lignes estimées vs réelles, rows removed by filter, temps avant/après.

## Livrables
- Requêtes : `database/benchmarks/queries/b1…b9*.sql`
- Plans : `database/benchmarks/before/`, `database/benchmarks/after/`
- Comparatif : `database/benchmarks/results/summary.md`
- Migration : `database/migrations/003_indexes.sql` (5 index)
- Analyse : `doc/performance.md`

## Résultat
Accès ciblés ×37 à ×9 406 plus rapides ; agrégats globaux inchangés (attendu) ; un index composite écarté après mesure.

## Critères d'acceptation
- [x] Plans avant/après versionnés pour au moins 5 requêtes (9 mesurées).
- [x] Chaque index créé est justifié par un plan « avant » dans la doc.
- [x] Gain de temps mesuré et documenté pour chaque requête.
- [x] `pnpm db:benchmark` est reproductible.
