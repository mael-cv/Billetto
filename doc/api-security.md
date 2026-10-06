# Sécurité de l’API

La sécurité ne dépend jamais de `apps/web` : toute requête doit rester sûre si elle est construite avec curl, un script ou un client malveillant. CORS limite les lectures depuis certains navigateurs ; ce n’est ni une authentification ni une protection contre les appels directs.

## Contrôles serveur

- Les routes refusent l’accès par défaut si elles ne déclarent pas `@Authenticated`, `@OptionalAuth` ou `@Public`. Les rôles et l’accès par ressource sont vérifiés côté API et PostgreSQL/RLS.
- Les bodies, paramètres et queries sont validés par Zod ; les objets d’écriture utilisent des schémas stricts. Les requêtes SQL applicatives sont paramétrées.
- Les mutations avec cookie de session exigent le jeton CSRF ; les sessions sont `HttpOnly`, `SameSite=Strict` et sécurisées en production. Le webhook est exempté du CSRF seulement parce qu’il vérifie le HMAC du corps brut.
- Fastify limite les bodies à 64 Kio, les en-têtes à 16 Kio, les paramètres de route à 128 caractères et le délai de réception d’une requête à 30 secondes.
- Le rate limit couvre toutes les routes et applique un plafond distinct aux connexions, inscriptions et changements de mot de passe. L’IP proxy n’est pas approuvée (`trustProxy: false`) : ne pas faire confiance à un `X-Forwarded-For` fourni par l’appelant.
- Les erreurs HTTP ne retournent pas de stacktrace. Les journaux 500 ne recopient pas les exceptions brutes, qui peuvent contenir SQL ou données d’entrée ; le `requestId` permet de corréler la requête.

## Limites d’exploitation

Le rate limit Fastify par défaut est en mémoire et par processus. En production avec plusieurs instances, compléter par une limite partagée au niveau du proxy ou un magasin distribué, et configurer ce proxy pour limiter les appels directs à l’origine si le modèle de déploiement le permet. Ne définissez pas `trustProxy: true` pour corriger l’adresse client : faites confiance uniquement aux adresses exactes des reverse proxies et empêchez l’accès direct à l’API depuis l’extérieur.

Les ports du `docker-compose.yml` sont destinés au développement local. Un déploiement public doit exposer uniquement les services nécessaires et ne pas publier PostgreSQL, pgAdmin ou Mailpit sur Internet.
