# Autorisation et RBAC

Être connecté prouve une identité de session ; cela ne prouve pas le droit d’effectuer une action ou d’accéder à une ressource. Billetto applique les contrôles à deux niveaux : rôle de l’acteur dans l’API, puis droits et périmètre des lignes dans PostgreSQL.

## Défaut fermé dans l’API

Le guard global `AuthGuard` refuse maintenant toute route qui n’a pas de déclaration d’accès explicite :

- `@Authenticated()` exige une session valide, quel que soit le rôle applicatif.
- `@Authenticated('organizer', 'admin')` exige une session et l’un des rôles indiqués.
- `@OptionalAuth()` autorise l’anonyme et charge l’identité si une session valide est présente. À réserver aux routes dont les résultats peuvent réellement varier selon l’identité.
- `@Public()` désigne une route publique qui n’utilise pas l’identité pour décider de l’accès. Pour un webhook, son guard de signature reste obligatoire.

Toute nouvelle route doit choisir une de ces annotations. L’absence d’annotation ne rend jamais une route publique. La liste et les rôles autorisés se vérifient aussi dans les contrôleurs Nest, pas seulement dans les composants React.

Les routes publiques actuelles sont les opérations d’authentification, la santé et le webhook signé. Le catalogue, les types d’événements, les lieux et les tarifs publics utilisent l’accès optionnel. Les routes d’administration, d’analytics, de check-in, d’achat, de commandes et de gestion exigent une session avec le rôle approprié.

## Autorisation sur la ressource

Un rôle ne suffit pas pour les objets appartenant à un utilisateur ou à un organisateur. Chaque accès aux événements, tarifs, commandes, billets, paiements, réservations, listes d’attente et scans doit aussi respecter le propriétaire et le tenant. L’API établit le rôle PostgreSQL et `app.user_id` dans la transaction ; les GRANT et policies RLS appliquent ensuite ce périmètre. Une ressource absente ou masquée est renvoyée comme inexistante lorsque le contrat API le prévoit.

Les identifiants reçus dans l’URL ou le corps ne sont pas une preuve de propriété. Les mutations d’événements et de tarifs doivent rester sous RLS, les procédures métier sensibles contrôlent l’acteur, et les opérations de check-in/export/analytics doivent filtrer le même tenant que les lectures ordinaires.

## Règles pour toute nouvelle fonctionnalité

1. Déclarer le niveau de session et la liste minimale de rôles sur chaque route.
2. Définir l’autorisation par action et ressource : propriétaire, tenant, visibilité et rôle.
3. Appliquer la vérification dans PostgreSQL/RLS ou dans une procédure métier sûre, pas uniquement dans le front ou le contrôleur.
4. Rechercher les chemins alternatifs (export, statistiques, sous-ressources, opérations groupées, webhooks) qui pourraient contourner le contrôle.
5. Couvrir l’anonyme, un rôle insuffisant, le propriétaire légitime et un autre utilisateur/organisateur dans les vérifications de sécurité.

Référence d’implémentation : `apps/api/src/auth/presentation/auth.decorators.ts` et `auth.guard.ts`. Les rôles PostgreSQL et leur périmètre sont détaillés dans [security.md](security.md).
