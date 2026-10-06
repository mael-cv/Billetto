# Sécurité des entrées, requêtes et secrets

Billetto utilise NestJS/Fastify, Zod et PostgreSQL via Prisma. Les recommandations MySQL/JPA ne s'appliquent pas directement à cette pile.

## Entrées et base de données

- Les paramètres HTTP sont validés par des schémas Zod, avec tailles/plages bornées et rejet des clés inattendues dans les objets d'entrée.
- Les lectures et écritures passent par Prisma. Pour SQL brut, employer exclusivement les requêtes taguées/paramétrées (`$queryRaw` / `$executeRaw`) et ne jamais interpoler une valeur utilisateur dans une chaîne SQL. Les appels non sûrs sont interdits par la règle de sécurité du dépôt.
- Fastify limite la taille du corps, la longueur des paramètres et des en-têtes, ainsi que le temps de traitement des requêtes.

## Origine et CSRF

- CORS n'est configuré que pour l'origine du frontend; il ne constitue pas à lui seul un contrôle d'autorisation.
- Les méthodes mutantes valident l'en-tête `Origin` lorsqu'il est présent et exigent le jeton CSRF double-submit. Les routes de webhook vérifient leur signature HMAC.
- Les cookies de session sont configurés avec les attributs de sécurité adaptés à l'environnement.

## Uploads

Aucune route d'upload ni prise en charge multipart n'est actuellement installée. N'ajoutez pas de réception de fichier sans établir une politique dédiée : limite stricte de taille, extension et type autorisés, vérification de la signature réelle du fichier, nom aléatoire, stockage hors du répertoire public, accès autorisé, et analyse antimalware si le cas d'usage l'exige. Ne faites jamais confiance au nom ou au type MIME fourni par le client.

## Secrets

- Les fichiers `.env*` et les formats courants de clés privées/identifiants sont ignorés par Git et le contexte Docker. `.env.example` reste le modèle versionné sans secrets de production.
- La CI utilise Gitleaks sur l'historique Git complet. En local, installez le hook pré-commit Gitleaks ou lancez le scanner avant le premier push. Un secret déjà commité doit être révoqué/renouvelé; le supprimer du dernier commit ne suffit pas à effacer l'historique distant.
- Fournissez les secrets de production via le gestionnaire de secrets de l'environnement de déploiement, jamais dans les sources ni les images.
