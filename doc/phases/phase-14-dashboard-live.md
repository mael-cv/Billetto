# Phase 14 — Dashboard temps réel par collectif

## Objectifs
- Donner à chaque organisateur une vue « en direct » de ses événements à venir : places vendues, réservées (paiement en cours) et demandées en liste d'attente.
- Garantir que l'organisateur ne voit que son collectif, par la RLS de la phase 09 et non par un filtre en TypeScript.
- Garantir des chiffres cohérents même pendant une vague d'achats.

## Migration `012_dashboard_live.sql`
- `v_ventes_par_evenement` gagne **en fin de liste**, seule évolution permise par `CREATE OR REPLACE VIEW` sans recréer la chaîne de vues de 002 :
  - `billets_reserves` : holds `active` avec `expire_a > now()`, offres de liste d'attente comprises. C'est la même règle que `places_occupees`, et l'expiration *lazy* est respectée.
  - `places_liste_attente` : somme des `quantite_souhaitee` des inscriptions `en_attente`. Une offre `notifiee` est déjà comptée en réservé : pas de double compte.
- `v_remplissage` gagne en fin de liste `billets_reserves`, `places_liste_attente` et `taux_occupation` = (vendus + réservés) / places.
- `WITH (security_invoker = true)` est répété, car `CREATE OR REPLACE VIEW` réinitialise les options de la vue. J'ai vérifié dans `pg_class.reloptions` qu'il est bien conservé.
- `v_classement_lieux` et `mv_ventes_quotidiennes` ne changent pas.

## API
- `GET /analytics/live` (organisateur ou admin), dans le module `analytics` existant :
  - porte sur les événements publiés à venir, triés par date, limite de 50 ;
  - les totaux sont calculés sur les mêmes lignes que le détail ;
  - en-tête `Cache-Control: no-store`.
- Lecture directe des vues sous `db.run(toDbActor(actor))`, donc RLS de l'appelant. Jamais la vue matérialisée, qui n'est fraîche qu'au dernier `REFRESH`.

## Front
- Section « En direct » en tête de `OrganizerDashboard` (`components/LiveDashboard.tsx`) :
  - 3 cartes : Vendu / Réservé / En liste d'attente ;
  - une jauge par événement, vendu (couleur principale) puis réservé (ambre), avec le taux d'occupation et un badge « N en attente » ;
  - polling toutes les 5 s, que react-query met en pause quand l'onglet est masqué ;
  - indicateur « mis à jour il y a N s » ; en cas de perte de connexion, les dernières valeurs restent affichées avec un avertissement.
- `lib/live.ts` : `liveSegments`, une jauge bornée à 100 % même si le quota a été baissé après les ventes, et `freshness`.

## Tests
- `database/tests/phase14_dashboard.sql` vérifie :
  - les chiffres exacts : remboursement exclu, hold expiré exclu, offre comptée en réservé, inscrits en attente ;
  - la cohérence avec `places_occupees` ;
  - sous `SET ROLE billetto_organisateur`, l'organisateur A ne voit que son collectif et B ne voit pas A.
- `concurrency.mjs`, test 10 : 40 sessions achètent ou réservent pendant que 30 lectures de `v_remplissage` s'enchaînent.
  - Aucune lecture n'a `vendus + réservés > places`.
  - À la fin, la vue est égale aux comptes directs en base, et vendus + réservés = quota.
- e2e `dashboard live` :
  - un visiteur reçoit 403 et l'en-tête `no-store` est présent ;
  - un achat et un hold sont visibles immédiatement ;
  - les chiffres égalent les comptes en base ;
  - l'organisateur B ne voit aucun événement d'un autre collectif.
- Tests unitaires web : `liveSegments`, `freshness`.

## Critères d'acceptation
- [x] Vues étendues (réservé, en liste d'attente), colonnes ajoutées en fin de liste.
- [x] `GET /analytics/live`, isolation par RLS.
- [x] `OrganizerDashboard` : vendu / réservé / en liste d'attente, rafraîchissement automatique.
- [x] Tests : isolation multi-tenant, cohérence sous charge.

## Suites (phase 16)
- Le scénario de charge vérifie qu'après un mélange d'achats, holds, désistements et réponses aux offres, `GET /analytics/live` (organisateur, sous RLS) donne exactement les comptes directs en base.
- `phase16_isolation.sql` vérifie que `v_remplissage` et `v_ventes_par_evenement` ne montrent à un organisateur que son collectif, chiffres vendu / réservé / attente compris.
