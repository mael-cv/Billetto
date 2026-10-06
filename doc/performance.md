# Performance — index et plans d'exécution

## Méthode
1. Seed FULL (5 001 événements, 900 000 commandes, 926 807 paiements, **1 800 000 billets**), migrations 001–002 : aucun index sur les clés étrangères.
2. `pnpm db:benchmark before` : chaque requête de `database/benchmarks/queries/` est lancée en `EXPLAIN (ANALYZE, BUFFERS)` — 1 exécution de chauffe, 3 mesures, plan médian conservé dans `database/benchmarks/before/`.
3. Lecture des plans, choix des index → migration `003_indexes.sql` (+ `ANALYZE`).
4. `pnpm db:benchmark after` → `database/benchmarks/after/`.
5. `pnpm db:benchmark compare` → `database/benchmarks/results/summary.md`.

Environnement : PostgreSQL 17 dans Docker Desktop (Windows), paramètres par défaut (`shared_buffers` 128 MB, 2 workers parallèles). Les temps absolus dépendent de la machine ; les **rapports** et surtout les **plans** sont ce qui compte.

## Résultats

| Requête | Cas d'usage | Avant (ms) | Après (ms) | Gain | Plan avant → après |
|---------|-------------|-----------:|-----------:|-----:|--------------------|
| B1 | Billets d'une commande | 158,8 | 0,30 | ×526 | Parallel Seq Scan → Index Scan |
| B2 | Commandes d'un utilisateur (tri, LIMIT 20) | 181,5 | 0,86 | ×210 | Parallel Seq Scan + Sort → Bitmap Index/Heap Scan + Sort |
| B3 | Paiements d'une commande | 121,8 | 0,30 | ×407 | Parallel Seq Scan → Index Scan |
| B4 | Événements des 7 prochains jours | 3,05 | 0,63 | ×4,8 | Seq Scan → Bitmap Index/Heap Scan |
| B5 | Ventes et CA d'un événement | 347,6 | 6,71 | ×52 | Hash Join sur Parallel Seq Scan → Nested Loop + Bitmap Index Scan |
| B6 | `v_ventes_par_evenement WHERE evenement_id = 42` | 351,7 | 9,54 | ×37 | idem B5 (le filtre est poussé dans la vue) |
| B7 | Q6 `NOT EXISTS` (tous les utilisateurs) | 260–630 | 377–626 | ≈ 1 | Parallel Hash Right Anti Join (inchangé) |
| B8 | Q6 `COUNT(*)` corrélé (200 utilisateurs) | 10 054,9 | 1,07 | ×9 406 | 200 × Seq Scan → 200 × Index Only Scan |
| B9 | Q1 global (tous les événements) | 2 252 | 2 593 | ≈ 1 | Parallel Hash Join sur Seq Scan (inchangé) |
| B10 | Billets d'un utilisateur (`billets_utilisateur`, phase 04) | 129,0 | 1,24 | ×104 | Parallel Seq Scan → Bitmap Index/Heap Scan |

Plans complets : `database/benchmarks/before/*.txt` et `after/*.txt`.

## Index créés (`003_indexes.sql`)

| Index | Taille | Justifié par | Constat dans le plan « avant » |
|-------|-------:|--------------|--------------------------------|
| `idx_billets_commande_id` | 35 MB | B1 | `Parallel Seq Scan on billets` — **Rows Removed by Filter: 599 999** par worker (× 3) pour 2 lignes utiles |
| `idx_billets_tarif_id` | 12 MB | B5, B6 | `Parallel Seq Scan on billets` lisant 1,8 M lignes pour en garder 456 |
| `idx_commandes_utilisateur_id` | 8 MB | B2, B8 | B8 : `Seq Scan on commandes` exécuté **loops=200**, **Rows Removed by Filter: 900 000** à chaque boucle |
| `idx_paiements_commande_id` | 20 MB | B3 | `Parallel Seq Scan on paiements` — Rows Removed by Filter: 308 935 par worker |
| `idx_billets_utilisateur_id` (004) | 18 MB | B10 | `Parallel Seq Scan on billets` lisant 1,8 M lignes pour 24 billets d'un utilisateur |
| `idx_evenements_debut` | 128 kB | B4 | `Seq Scan on evenements` — Rows Removed by Filter: 4 954 pour 47 lignes |

Coût : ≈ 75 MB d'index pour 226 MB de tables (`billets` 160 MB, `commandes` 66 MB), et un surcoût à chaque `INSERT` sur `billets` (deux index à maintenir). Acceptable : la billetterie lit bien plus qu'elle n'écrit.

`idx_billets_tarif_id` est trois fois plus petit que `idx_billets_commande_id` : PostgreSQL ≥ 13 **déduplique** les entrées de B-tree. Il n'y a que 15 001 tarifs distincts (≈ 120 billets par valeur) contre 900 000 commandes distinctes.

### Index envisagé puis écarté
`commandes (utilisateur_id, created_at)` devait éviter le tri de B2 (parcours de l'index à rebours). Le plan « après » montre que le planner ne s'en sert pas pour l'ordre : un utilisateur a ≈ 10 commandes, un `Bitmap Heap Scan` suivi d'un tri en mémoire (`quicksort Memory: 25kB`) est moins cher. La colonne a été retirée : même performance, index de **27 MB → 8 MB**.

### Index non créés
- `tarifs (evenement_id)` : déjà couvert par `uq_tarifs_evenement_id_nom (evenement_id, nom)`. Un index B-tree sert pour sa colonne de tête : le plan « avant » de B5 montre déjà `Index Scan using uq_tarifs_evenement_id_nom`.
- `evenements (lieu_id)`, `evenements (organisateur_id)` : aucune requête mesurée ne les exige. `billets (utilisateur_id)` a été ajouté en phase 04 après mesure (B10).

## Lecture des plans

### Nœuds rencontrés
| Nœud | Signification | Où |
|------|---------------|----|
| **Seq Scan** | Lecture de toute la table, filtre appliqué ligne à ligne | B4 avant, B8 avant (dans la sous-requête) |
| **Parallel Seq Scan** + **Gather** | Idem, réparti entre le leader et 2 workers ; `loops=3` et les lignes affichées sont **par processus** | B1, B2, B3, B5 avant |
| **Index Scan** | Descente dans le B-tree puis lecture de la ligne dans la table | B1, B3 après |
| **Index Only Scan** | Toutes les colonnes utiles sont dans l'index, pas d'accès à la table (`Heap Fetches: 0`) | B8 après |
| **Bitmap Index Scan** → **Bitmap Heap Scan** | L'index produit une carte des pages concernées, puis ces pages sont lues dans l'ordre physique. Choisi quand il y a « quelques » lignes, trop pour un Index Scan ligne à ligne. `Recheck Cond` revérifie la condition sur la page. | B2, B4, B5 après |
| **Nested Loop** | Pour chaque ligne à gauche, recherche à droite (idéal si la droite est indexée et la gauche petite) | B5 après : 3 tarifs → billets par index |
| **Hash Join** | Construit une table de hachage du petit côté, parcourt le grand | B5 avant : hash des 3 tarifs, parcours de 1,8 M billets |
| **Hash Anti Join** | Implémentation de `NOT EXISTS` : garde les lignes sans correspondance | B7 |
| **Merge Join** | Fusion de deux entrées triées sur la clé de jointure | B9 : `Merge Left Join` entre `pk_evenements` (déjà trié) et l'agrégat |
| **Sort** (`top-N heapsort`, `quicksort`) | Tri ; avec `LIMIT`, un tas de N éléments suffit | B2, B4 |

### Estimé vs réel
Chaque nœud affiche `(cost=… rows=estimé)` puis `(actual … rows=réel loops=n)`. Le nombre réel total vaut `rows × loops`.
- B5 avant : `Hash Join rows=150` estimé contre `rows=152 loops=3` (≈ 456) réels : l'estimation parallèle est par worker, cohérente.
- B8 avant : `Seq Scan on commandes rows=11` estimé, `rows=0` réel. Le planner prévoit ≈ 11 commandes par utilisateur (moyenne) alors que les utilisateurs 90 001+ n'en ont aucune par construction du seed. Écart sans conséquence ici, mais c'est typiquement la source des mauvais plans : une statistique moyenne ne décrit pas une distribution biaisée.
- B7 : `Anti Join rows=7 513` estimé par worker contre 3 335 réels (≈ 10 005 au total). Le planner sur-estime, sans changer le choix du plan.

### Buffers
`Buffers: shared hit=N` compte les pages de 8 kB lues depuis le cache (`read=` : depuis le disque). B8 après : 607 pages ; avant, la sous-requête relisait les ≈ 2 450 pages de `commandes` à chacune des 200 boucles. C'est la mesure la plus stable : elle ne dépend pas de la charge de la machine.

## Enseignements
1. **Les clés étrangères ne sont pas indexées automatiquement.** Toute FK utilisée en filtre ou en jointure depuis le côté parent doit être évaluée.
2. **Les gains sont énormes sur les accès ciblés** (×50 à ×9 000) : la charge d'une API (une commande, un utilisateur, un événement).
3. **Un index n'aide pas une requête qui lit toute la table** (B7, B9) : lire 1,8 M lignes séquentiellement reste le plan optimal. Pour ces agrégats globaux, la réponse est la **vue matérialisée** (phase 02), pas un index.
4. **Une sous-requête corrélée sans index est quadratique** (B8 : 200 × 900 000). La réécrire en `NOT EXISTS` (B7) évite ce piège même sans index.
5. **Mesurer après avoir indexé** : l'index composite prévu pour B2 n'était pas utilisé. Sans le plan « après », on aurait gardé 19 MB inutiles.
6. **Une mesure isolée ment** : B7 varie de 260 à 630 ms à plan identique (Docker Desktop, cache, workers). Comparer des plans et des buffers, et répéter les mesures.

## Reproduire
```bash
pnpm db:reset            # schéma avec 003 : retirer 003_indexes.sql temporairement pour « avant »
pnpm db:seed:full        # ≈ 12 min
pnpm db:benchmark before
pnpm db:migrate          # applique 003_indexes.sql
pnpm db:benchmark after
pnpm db:benchmark compare
```
Alternative sans reset, sur une base FULL déjà indexée (utilisée pour ce rapport, ≈ 3 min) :
```bash
docker compose exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "DROP INDEX idx_billets_commande_id, idx_billets_tarif_id, idx_commandes_utilisateur_id, idx_paiements_commande_id, idx_evenements_debut; ANALYZE;"'
pnpm db:benchmark before
docker compose exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -1 -f /database/migrations/003_indexes.sql'
pnpm db:benchmark after
pnpm db:benchmark compare
```
