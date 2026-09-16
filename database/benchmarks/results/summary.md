# Benchmarks — avant / après index

Généré par `pnpm db:benchmark compare` — médiane de 3 exécutions, seed FULL.

| Requête | Avant (ms) | Après (ms) | Gain | Nœuds avant | Nœuds après |
|---------|-----------:|-----------:|-----:|-------------|-------------|
| b1_billets_commande | 158.83 | 0.30 | ×526 | Gather, Parallel Seq Scan | Index Scan |
| b2_commandes_utilisateur | 181.54 | 0.86 | ×210 | Limit, Gather Merge, Sort, Parallel Seq Scan | Limit, Sort, Bitmap Heap Scan, Bitmap Index Scan |
| b3_paiements_commande | 121.80 | 0.30 | ×407 | Gather, Parallel Seq Scan | Index Scan |
| b4_evenements_a_venir | 3.05 | 0.63 | ×4.8 | Limit, Sort, Seq Scan | Limit, Sort, Bitmap Heap Scan, Bitmap Index Scan |
| b5_ca_evenement | 347.63 | 6.71 | ×52 | Finalize Aggregate, Gather, Partial Aggregate, Nested Loop, Hash Join, Parallel Seq Scan, Hash, Index Scan | Aggregate, Nested Loop, Index Scan, Bitmap Heap Scan, Bitmap Index Scan |
| b6_vue_ventes_un_evenement | 351.74 | 9.54 | ×37 | Subquery Scan, Nested Loop Left Join, Index Scan, Finalize GroupAggregate, Gather, Partial GroupAggregate, Nested Loop, Hash Join, Parallel Seq Scan, Hash | Subquery Scan, Nested Loop Left Join, Index Scan, GroupAggregate, Nested Loop, Bitmap Heap Scan, Bitmap Index Scan |
| b7_q6_not_exists | 343.65 | 625.93 | ×0.5 | Finalize Aggregate, Gather, Partial Aggregate, Parallel Hash Right Anti Join, Parallel Seq Scan, Parallel Hash, Parallel Index Only Scan | Finalize Aggregate, Gather, Partial Aggregate, Parallel Hash Right Anti Join, Parallel Seq Scan, Parallel Hash, Parallel Index Only Scan |
| b8_q6_count_correle | 10054.90 | 1.07 | ×9406 | Aggregate, Index Only Scan, Seq Scan | Aggregate, Index Only Scan |
| b9_q1_global | 2251.61 | 2592.93 | ×0.9 | Limit, Sort, Subquery Scan, Merge Left Join, Index Only Scan, Finalize GroupAggregate, Gather Merge, Partial HashAggregate, Hash Join, Parallel Hash Join, Parallel Seq Scan, Parallel Hash, Hash, Seq Scan | Limit, Sort, Subquery Scan, Merge Left Join, Index Only Scan, Finalize GroupAggregate, Gather Merge, Partial HashAggregate, Hash Join, Parallel Hash Join, Parallel Seq Scan, Parallel Hash, Hash, Seq Scan |
