# Phase 09 — Multi-tenant « collectifs »

## Objectifs
- Vérifier que le multi-tenant posé en phase 05 (un organisateur = un tenant, isolé par RLS) tient réellement face à plusieurs organisateurs concurrents.
- Donner à chaque collectif une page vitrine séparée (identifiant public stable).
- Fixer la règle à suivre pour les phases 10-14 : toute nouvelle table doit être rattachable à un seul organisateur et recevoir sa policy RLS dès sa migration de création.

## Audit des policies RLS existantes (`005_security.sql`)
Le filtrage est bien ligne à ligne par `organisateur_id`, jamais seulement par rôle :
- `evenements` : `organisateur_id = (SELECT app_organisateur_id())` (policy `p_evenements_organisateur_all`).
- `tarifs`, `evenement_attributs` : filtrage en cascade, `evenement_id = ANY(ARRAY(SELECT e.id FROM evenements e))` — l'ensemble autorisé est recalculé via la RLS de `evenements`.
- `commandes`, `billets` : cascade similaire via `billets`/`tarifs` jusqu'à `evenements`.
- `paiements` : **aucune policy ni GRANT organisateur** — décision assumée, pas un oubli. Un organisateur ne voit jamais les paiements bruts (moyens de paiement, référence prestataire) ; seuls `admin`/`readonly` y accèdent. Confirmé par test (`phase05_securite.sql`, refus `42501`).
- `mv_ventes_quotidiennes` : pas de RLS possible sur une vue matérialisée. Isolée uniquement par `GRANT SELECT` restreint à `billetto_admin`/`billetto_readonly` — l'organisateur n'a aucun grant dessus.
- `journal_tarifs` : pas de RLS, pas de GRANT organisateur (SELECT réservé à `admin`/`readonly`). Confirmé par `phase09_multi_tenant.sql`.

## Migration `007_multi_tenant.sql`
- `organisateurs.slug` : `text NOT NULL UNIQUE`, même format que `evenements.slug` (`^[a-z0-9]+(-[a-z0-9]+)*$`), backfill dérivé de `nom` pour les lignes existantes.
- Lecture publique du slug (`GRANT SELECT (slug)` à `visiteur`/`organisateur`/`readonly`), à l'image de `(id, nom)` — `email` reste réservé à l'admin.

## Règle pour les phases 10-14
Toute table introduite par les phases suivantes (`reservations`, `liste_attente`, `billets_scans`, `paiement_webhooks`) doit :
1. porter un chemin explicite vers un organisateur unique (colonne directe ou cascade via `tarif_id`/`evenement_id`) ;
2. recevoir `ENABLE`/`FORCE ROW LEVEL SECURITY` + ses policies **dans la même migration** que son `CREATE TABLE`, jamais après coup.

## Revue transverse API — défense en profondeur
Mécanisme central : `apps/api/src/common/database/db-context.service.ts::run()` pose `set_config('role', …, true)` + `set_config('app.user_id', …, true)` dans la transaction Prisma (`SET LOCAL`, jamais de fuite de contexte entre connexions poolées — pas de pooler externe type PgBouncer configuré).

| Module | Filtre `organisateur_id` en code | Défense en profondeur |
|---|---|---|
| `events` | Non en lecture (RLS seule) ; oui en écriture (`CreateEventUseCase` vérifie `actor.organisateurId`) | Écriture uniquement |
| `pricing` | Non | Aucune — repose entièrement sur la cascade RLS de `tarifs` |
| `orders` | Oui, `utilisateur_id` explicite dans `prisma-orders.repository.ts` (scope acheteur) | Oui |
| `analytics` | Non, assumé (« Aucun filtre organisateur n'est écrit en TypeScript ») | Aucune — RLS + `security_invoker` + GRANT sur la MV + garde de rôle sur les routes admin |
| `tickets`, `payments` | Non | Aucune — cascade RLS via `tarifs`/`commandes`, appels vérifiés passés par `db.run`/`asBuyer` |

Vérifié : tous les `$queryRaw`/`$executeRaw` des dépôts Prisma reçoivent le `tx` scopé par `DbContextService`, aucune requête ne contourne le mécanisme en passant par `PrismaService` directement (réservé à `auth`/`health` via `db.raw()`).

Le module `analytics` reste le plus exposé par design : un bug de branchement de rôle dans `analytics.use-cases.ts` n'a pas de filet RLS pour la vue matérialisée. C'est un risque accepté (volumétrie faible, ~15 événements/an) plutôt qu'une correction en profondeur — à surveiller en phase 14 (dashboard temps réel, qui étend ce module).

## Tests
- SQL : `database/tests/phase09_multi_tenant.sql` — RLS directe (lecture/écriture cross-tenant → 0 ligne, jamais une erreur), 3 organisateurs concurrents sans fuite de ventes ni de `journal_tarifs`, métadonnées de `organisateurs.slug`.
- Aucune régression sur `database/tests/phase05_securite.sql` après application de `007_multi_tenant.sql`.

## Critères d'acceptation
- [x] Policies RLS confirmées ligne à ligne par `organisateur_id`, jamais seulement par rôle.
- [x] `organisateurs.slug` ajouté, unique, contraint en format, backfillé.
- [x] Revue transverse API : aucun contournement du mécanisme `DbContextService` trouvé.
- [x] Test à 3 organisateurs concurrents sans fuite de données (ventes, `journal_tarifs`).
- [x] Test RLS direct en SQL : lecture cross-tenant renvoie 0 ligne.

## Suites (phases 10 à 16)
- La règle « RLS dans la migration de création » a été appliquée à `reservations` (008), `liste_attente` (010), `billets_scans` (011) et `emails_sortants` (013).
  - `emails_sortants` et `checkin_secret` n'ont **aucun** droit applicatif : elles ne sont lues que par des fonctions SECURITY DEFINER.
- `paiement_webhooks` n'existe pas encore : la Phase 11 n'est pas implémentée.
- **Phase 16** : `database/tests/phase16_isolation.sql` rejoue l'isolation sur toutes ces tables, pour chaque rôle (visiteur, organisateur A/B, readonly), et ajoute un **garde-fou générique**. Toute table lisible par un rôle visiteur ou organisateur sans RLS activée et forcée fait échouer la suite, hors référentiels publics (`lieux`, `organisateurs`, `type_evenements`). Un oubli dans une future migration est donc détecté automatiquement.
- Le risque accepté sur `analytics` a été revu en phase 14 : `GET /analytics/live` lit les vues `security_invoker` sous RLS, jamais la vue matérialisée.
