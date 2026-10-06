# Phase 05 — Sécurité PostgreSQL : rôles, GRANT, RLS

## Objectifs
- L'API ne se connecte jamais en superuser ni en propriétaire du schéma.
- Les données sont protégées par la base, pas seulement par l'API.

## Spécifications
- Rôles : `billetto_app` (LOGIN, compte de l'API), `billetto_readonly`, `billetto_visiteur`, `billetto_organisateur`, `billetto_admin` (NOLOGIN).
- `REVOKE ALL … FROM PUBLIC` ; `GRANT` minimaux, au niveau colonne pour `utilisateurs` (ni `email` ni `password_hash` en lecture publique).
- Pas d'écriture directe sur `commandes`, `billets`, `paiements` : uniquement `EXECUTE` sur `acheter_billet` (`SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE EXECUTE … FROM PUBLIC`).
- RLS sur `evenements` (`ENABLE` + `FORCE`) : visitor → événements publiés ; organizer → les siens ; admin → tout. Contexte transmis par `set_config('app.user_id', …, true)` dans la transaction.
- Démonstration de fuite via une vue sans `security_invoker`, puis correction avec `security_invoker = true`.

## Livrables
- Migration : `database/migrations/005_security.sql`
- Tests SQL : `database/tests/phase05_securite.sql` (51 vérifications)
- Tests en connexion réelle : `database/scripts/security-login.mjs` (11 vérifications), intégrés à `pnpm db:test`
- Mot de passe `billetto_app` : `APP_DB_PASSWORD` (`.env`), appliqué par `pnpm db:migrate`
- Documentation : `doc/security.md`, `doc/decisions.md` D17–D24

## Ajouts par rapport à la spécification
- RLS également sur `tarifs`, `evenement_attributs`, `commandes`, `billets`, `paiements`, `amities`, `utilisateurs`.
- Contrôle d'identité dans les fonctions SECURITY DEFINER (`BT013`) et `admin_rembourser_commande`.
- Fonctions d'authentification pour l'API (`authentification_utilisateur`, `inscrire_utilisateur`).
- Optimisation mesurée des policies (×40 sur la vue de ventes d'un organisateur).
- Détection et correction du piège `ALTER DEFAULT PRIVILEGES IN SCHEMA` (EXECUTE PUBLIC non retiré).

## Critères d'acceptation
- [x] Un visiteur ne peut pas modifier un événement.
- [x] Un visiteur ne peut pas lire `utilisateurs.email`.
- [x] Un organisateur ne voit pas les événements d'un autre ; l'admin voit tout.
- [x] `billetto_app` ne peut pas faire `INSERT INTO billets` mais peut appeler `acheter_billet`.
- [x] Le test de fuite montre la fuite sans `security_invoker` et son absence avec.
- [x] Sans `app.user_id` positionné, aucun événement non publié n'est visible.
