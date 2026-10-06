# Sécurité PostgreSQL

Migration : `database/migrations/005_security.sql`. Tests : `database/tests/phase05_securite.sql` (51 vérifications) et `database/scripts/security-login.mjs` (11 vérifications en connexion réelle). Tout est lancé par `pnpm db:test`.

## Principe
La base ne fait pas confiance à l'API pour filtrer les données : **les droits et la visibilité des lignes sont appliqués par PostgreSQL**. Une erreur dans un contrôleur (oubli d'un `WHERE organisateur_id = …`) ne peut pas exposer les données d'un autre organisateur.

## Rôles

```text
API ──(connexion)──> billetto_app              LOGIN, aucun droit sur les tables
                        │  SET LOCAL ROLE (membre avec SET, sans INHERIT)
                        ├──> billetto_visiteur       NOLOGIN
                        ├──> billetto_organisateur   NOLOGIN
                        └──> billetto_admin          NOLOGIN
Reporting / BI ─────> billetto_readonly          NOLOGIN (à attribuer à un compte BI)
Migrations, seed ───> propriétaire du schéma     (POSTGRES_USER, jamais utilisé par l'API)
```

| Rôle | Peut | Ne peut pas |
|------|------|-------------|
| `billetto_app` | Se connecter ; `authentification_utilisateur`, `inscrire_utilisateur` ; endosser visiteur/organisateur/admin | Lire ou écrire une table ; endosser `billetto_readonly` ou le propriétaire |
| `billetto_visiteur` | Lire le catalogue publié ; lire **ses** commandes, billets, paiements, amitiés et **sa** ligne utilisateur ; `acheter_billet` et `rembourser_commande` **pour lui-même** | Lire un e-mail, un hash ; écrire dans une table ; voir les données d'un autre ; vues de ventes |
| `billetto_organisateur` | CRUD sur **ses** événements, tarifs, attributs ; lire les billets et commandes de **ses** événements ; vues de ventes (filtrées) ; `ca_evenement` | Voir ou modifier les événements d'un autre ; changer `organisateur_id` ; lire paiements, e-mails, vue matérialisée globale |
| `billetto_admin` | Tout lire (sauf `password_hash`) ; gérer référentiels et catalogue ; `admin_rembourser_commande` | Lire les mots de passe ; écrire directement dans commandes / billets / paiements |
| `billetto_readonly` | Tout lire, y compris la vue matérialisée | Lire e-mails et mots de passe ; écrire ; exécuter les fonctions métier |

Le mot de passe de `billetto_app` vient de `APP_DB_PASSWORD` (`.env`) : `pnpm db:migrate` exécute `ALTER ROLE billetto_app LOGIN PASSWORD :'app_password'` avec une variable psql (échappée), jamais dans un fichier versionné. Sans variable, le rôle reste `NOLOGIN`.

## Cycle d'une requête API

```sql
BEGIN;
SET LOCAL ROLE billetto_organisateur;                 -- selon utilisateurs.role_app
SELECT set_config('app.user_id', '42', true);         -- true : local à la transaction
SELECT * FROM v_ventes_par_evenement;                 -- droits + RLS de l'organisateur 42
COMMIT;                                               -- rôle et contexte disparaissent
```

`SET LOCAL` et `set_config(…, true)` sont annulés à la fin de la transaction : une connexion rendue au pool ne garde ni le rôle ni l'utilisateur précédent (vérifié par `security-login.mjs`). Hors transaction, `SET` et `set_config(…, false)` fuiraient vers la requête suivante d'un autre utilisateur.

## GRANT / REVOKE

**Retrait des droits implicites.** Par défaut, `PUBLIC` (tout rôle) peut se connecter à la base, et exécuter toute fonction. La migration retire :
- `CONNECT` sur la base (seul `billetto_app` le reçoit) ;
- tout droit sur le schéma `public`, ses tables, séquences, fonctions et procédures ;
- `EXECUTE` par défaut sur les **futures** fonctions.

**Piège rencontré** : `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE … FROM PUBLIC` n'a **aucun effet** sur `EXECUTE`. Les privilèges par défaut d'un schéma ne peuvent qu'**ajouter** des droits aux privilèges par défaut globaux, et le `EXECUTE` de `PUBLIC` est un défaut global. Les fonctions créées plus loin dans la migration restaient exécutables par tous : le test « un visiteur ne peut pas appeler `authentification_utilisateur` » a échoué. Correction : `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (sans `IN SCHEMA`) et un `REVOKE ALL ON ALL FUNCTIONS` final. Un test vérifie désormais qu'aucune fonction du schéma n'est exécutable par `PUBLIC`.

**Niveau colonne.** `GRANT SELECT (id, prenom, nom) ON utilisateurs` : `SELECT email` ou `SELECT *` échoue avec `42501` pour un visiteur. L'admin lit `email` mais jamais `password_hash`. `organisateur_id` d'un événement n'a pas de `GRANT UPDATE` pour l'organisateur : un événement ne change pas de propriétaire.

**Écritures sensibles.** Personne (sauf le propriétaire) n'a `INSERT`/`UPDATE` sur `commandes`, `billets`, `paiements`. Les seules voies sont `acheter_billet`, `rembourser_commande` et `admin_rembourser_commande`, qui garantissent quota, dates et atomicité.

## SECURITY DEFINER

Une fonction `SECURITY DEFINER` s'exécute avec les droits de son propriétaire. C'est ce qui permet à un visiteur sans droit d'écriture d'acheter un billet. En contrepartie :

1. **`SET search_path = public, pg_temp`** sur chaque fonction : sinon un appelant pourrait créer un objet homonyme (par exemple une table temporaire `tarifs` dans `pg_temp`, consulté en premier par défaut) et détourner la fonction. `pg_temp` est placé **en dernier**, et les objets sont qualifiés `public.`. Un test vérifie que toute fonction `SECURITY DEFINER` a ce réglage.
2. **`REVOKE EXECUTE … FROM PUBLIC`** puis `GRANT EXECUTE` aux seuls rôles prévus.
3. **Contrôle d'identité explicite** : le propriétaire ignore la RLS, la fonction doit donc vérifier elle-même que l'appelant agit pour son compte. `controler_acteur(p_utilisateur_id)` lève `BT013` si `app.user_id` est absent ou différent. Exception : une session superutilisateur sans contexte (seed, scripts de maintenance).
4. **Le droit porté par le privilège, pas par un paramètre** : le remboursement « administrateur » est une procédure distincte (`admin_rembourser_commande`) dont l'`EXECUTE` n'est accordé qu'à `billetto_admin`, plutôt qu'un booléen `p_est_admin` que n'importe quel appelant pourrait passer.

Les fonctions de trigger `trg_tarifs_audit_fn` et `trg_billets_validate_date_fn` sont aussi `SECURITY DEFINER` : un organisateur qui modifie son tarif déclenche l'écriture dans `journal_tarifs`, sur lequel il n'a aucun droit.

## Row Level Security

Activée **et forcée** (`FORCE ROW LEVEL SECURITY`) sur `evenements`, `tarifs`, `evenement_attributs`, `commandes`, `billets`, `paiements`, `amities`, `utilisateurs`. `FORCE` applique les policies au propriétaire de la table s'il n'est pas superutilisateur ; un superutilisateur ou un rôle `BYPASSRLS` les ignore toujours (aucun rôle `billetto_*` ne l'est, c'est testé).

Sans policy pour le rôle courant, une table RLS renvoie **zéro ligne** : le défaut est le refus.

| Table | Visiteur | Organisateur | Admin | Readonly |
|-------|----------|--------------|-------|----------|
| `evenements` | `statut IN (published, finished)` | `organisateur_id = app_organisateur_id()` (lecture et écriture) | tout | tout |
| `tarifs` | actif et événement visible | événement visible (lecture et écriture) | tout | tout |
| `evenement_attributs` | événement visible | événement visible (lecture et écriture) | tout | tout |
| `commandes` | `utilisateur_id = app_user_id()` | contient un billet visible | tout | tout |
| `billets` | `utilisateur_id = app_user_id()` | tarif visible | tout | tout |
| `paiements` | commande visible | — (pas de GRANT) | tout | tout |
| `amities` | il y participe | — | tout | tout |
| `utilisateurs` | sa ligne | sa ligne | tout | tout |

Les policies s'enchaînent : la sous-requête d'une policy est elle-même soumise à la RLS de l'appelant. « Billet visible pour l'organisateur » = « tarif visible » = « événement visible » = « événement dont il est propriétaire ».

**Contexte.** `app_user_id()` lit `current_setting('app.user_id', true)` (`true` : NULL si absent, pas d'erreur). `app_organisateur_id()` est `SECURITY DEFINER` (un organisateur ne peut pas lire `utilisateurs.organisateur_id`) et ne renvoie une valeur que si l'utilisateur est réellement `organizer` : un compte visiteur qui obtiendrait le rôle organisateur ne voit rien (testé).

**`WITH CHECK`** : pour `INSERT`/`UPDATE`, la nouvelle ligne doit aussi satisfaire la policy. Créer un événement au nom d'un autre organisateur échoue (`42501 new row violates row-level security policy`). À l'inverse, `UPDATE`/`DELETE` d'un événement invisible ne lève pas d'erreur : **0 ligne affectée**, l'API doit traduire ce cas en 404.

### Performance des policies
Une policy est un prédicat ajouté à chaque requête : sa forme compte autant que celle d'une clause `WHERE`.

| Organisateur (10 événements) lisant `v_ventes_par_evenement`, seed FULL | Temps |
|---|---:|
| Superutilisateur, `WHERE organisateur_id = 1` sur la vue (sans RLS) | 1 490 – 1 557 ms |
| RLS, policies `EXISTS (…)` / `tarif_id IN (SELECT …)` | 824 – 1 014 ms |
| RLS, policies `col = ANY (ARRAY(SELECT …))` (version retenue) | **18 – 28 ms** |

- Avec `IN (SELECT …)`/`EXISTS`, la sous-requête de la policy devient un **SubPlan haché** appliqué ligne à ligne : `Seq Scan on billets`, 1 797 226 lignes retirées par le filtre.
- `ARRAY(SELECT …)` devient un **InitPlan** évalué une fois (27 tarifs), et `tarif_id = ANY(tableau)` est une condition d'index : `Bitmap Index Scan on idx_billets_tarif_id`, 2 774 lignes lues.
- Les coûts estimés passent de ≈ 150 000 à ≈ 5 700 : sous `jit_above_cost`, la compilation JIT (≈ 450 ms mesurés) n'est plus déclenchée.
- Le filtre RLS est même **plus efficace** que le `WHERE` posé sur la vue par un superutilisateur : il est appliqué au niveau des tables, avant l'agrégat, alors que le filtre sur `organisateur_id` ne traverse pas le `GROUP BY` de la vue.
- `(SELECT app_user_id())` plutôt que `app_user_id()` : la sous-requête scalaire devient un InitPlan, la fonction n'est pas réévaluée pour chaque ligne.
- Limite : `ANY(ARRAY(…))` matérialise la liste autorisée. C'est idéal pour un organisateur (quelques événements) ; pour le visiteur (≈ 4 600 événements visibles), `EXISTS` est conservé.

Visiteur, « mes commandes » : `Bitmap Index Scan on idx_commandes_utilisateur_id`, 0,5 ms.

## Vues et RLS : la fuite

Une vue s'exécute par défaut avec les droits de son **propriétaire**. Ici, le propriétaire est superutilisateur : il ignore la RLS. Donner `SELECT` sur la vue à un organisateur revient à lui donner toutes les ventes.

Démonstration (test `phase05_securite.sql`, seed FULL) :

```text
security_invoker = false → l'organisateur A voit 5 003 événements (tous)
security_invoker = true  → l'organisateur A voit 11 événements (les siens)
```

Correction : `ALTER VIEW … SET (security_invoker = true)` (PostgreSQL ≥ 15) sur les trois vues. La vue applique alors droits et RLS de l'appelant, ce qui impose de donner à l'organisateur `SELECT` sur les tables sous-jacentes (filtrées par RLS).

La vue matérialisée `mv_ventes_quotidiennes` ne supporte pas la RLS (c'est une table de résultats) : elle contient des agrégats globaux et n'est accessible qu'à `billetto_admin` et `billetto_readonly`.

## Limites et points d'attention
- **Confiance dans l'API.** `billetto_app` peut endosser `billetto_admin` et choisir `app.user_id`. La base protège contre les erreurs de requête et les injections limitées aux données, pas contre une compromission de l'API. C'est le compromis standard d'un pool de connexions à compte technique unique ; l'alternative (un rôle PostgreSQL par utilisateur final) ne passe pas à l'échelle.
- **Propriétaire superutilisateur.** Les fonctions `SECURITY DEFINER` appartiennent à `POSTGRES_USER`, superutilisateur de l'image Docker. En production, le propriétaire devrait être un rôle dédié non superutilisateur (avec `BYPASSRLS` si nécessaire), pour limiter l'impact d'une faille dans une de ces fonctions.
- **Rôles de cluster.** Les rôles survivent à `db:reset` ; leur création est idempotente.
- **`SET ROLE` vérifie le rôle de session.** Un test lancé en superutilisateur peut endosser n'importe quel rôle : les contrôles d'appartenance ne sont testables qu'avec une vraie connexion `billetto_app` (d'où `security-login.mjs`).

## Côté API (phase 06)
Défense en profondeur au-dessus des protections PostgreSQL (détails dans [api.md](api.md)) :
- connexion en `billetto_app` uniquement (test e2e : `session_user = billetto_app`, non superutilisateur) ;
- rôle et `app.user_id` positionnés par `set_config(…, true)` dans chaque transaction, nom de rôle en liste blanche ;
- Argon2id (m = 19 Mio, t = 2, p = 1), hash factice pour les comptes inconnus ;
- session JWT HS256 en cookie `HttpOnly; Secure; SameSite=Strict`, CSRF double submit ;
- helmet (CSP `default-src 'none'`, `X-Frame-Options: DENY`, HSTS, nosniff), CORS limité à l'origine du front ;
- rate limiting (300 req/min, 10 req/min sur login/register), corps limités à 64 Kio, mot de passe ≤ 128 caractères ;
- validation Zod stricte (champs inconnus refusés, tris en liste blanche, identifiants bornés) ;
- SQL uniquement via `$queryRaw` / `Prisma.sql` paramétrés (règle vérifiée par un test sur le code source) ;
- erreurs normalisées sans stacktrace ; journaux sans cookies ni jetons (`redact`).

## Vérifications automatisées
- `phase05_securite.sql` : `billetto_app` sans rôle ; visiteur (catalogue, ses données, colonnes interdites, écritures directes, achat/remboursement pour soi et pour autrui) ; visiteur anonyme ; organisateurs A et B (lecture, création, publication, modification d'un événement d'autrui, usurpation `WITH CHECK`, changement de propriétaire, audit) ; organisateur sans contexte ; compte visiteur sous rôle organisateur ; fuite de vue ; admin ; readonly ; métadonnées (RLS forcée, rôles non privilégiés, aucune fonction exécutable par `PUBLIC`, `search_path` figé, vues `security_invoker`, `PUBLIC` sans `CONNECT`).
- `security-login.mjs` : connexion par mot de passe ; aucune lecture sans rôle ; `SET ROLE billetto_readonly` et propriétaire refusés ; `SET LOCAL ROLE` et `set_config(…, true)` ne survivent pas à la transaction ; achat et remboursement sans contexte → `BT013` ; visiteur sans contexte → aucune commande ; fonction d'authentification refusée au rôle visiteur.
