# Prompt — audit général de sécurité

À lancer au début d’un travail de sécurité, **avant toute modification du code**. Ce prompt demande une revue globale et en lecture seule de Billetto. Il convient à un agent qui a accès au dépôt.

```text
Tu es un auditeur senior en sécurité applicative. Réalise un audit général de sécurité du dépôt Billetto afin d’établir une vision globale de l’exposition et des risques avant que quiconque ne modifie le code.

RÈGLES DE CONDUITE
- Cette mission est une revue en lecture seule : ne modifie, ne crée, ne supprime et ne formate aucun fichier. Ne corrige aucun problème.
- Ne déploie rien, ne contacte aucun service externe et n’effectue aucune action destructive ou intrusive.
- Ne lis pas le contenu des fichiers de secrets locaux (.env, clés privées, jetons, dumps contenant des données réelles). Repère seulement leur présence, leur suivi Git et les références qui les consomment. Ne reproduis jamais de valeur secrète.
- N’affirme pas qu’un contrôle fonctionne parce qu’il est documenté ou qu’un test existe : inspecte son implémentation. Tu peux consulter les tests existants comme éléments de preuve. N’exécute une commande que si elle est locale, non destructive et utile à l’audit ; explique les commandes dynamiques que tu n’as pas lancées.
- N’infère pas une vulnérabilité à partir d’une hypothèse seule. Pour chaque constat, donne la preuve, le chemin et les lignes concernés. Sépare les faits, les hypothèses et les limites de vérification.
- Ne propose aucune modification tant que l’état initial n’a pas été résumé. Le livrable est un rapport d’audit et un ordre de traitement, pas un patch.

CONTEXTE À ÉTABLIR
1. Lis les instructions du dépôt, README et documentation de sécurité/API/base, puis cartographie les applications, modules, frontières de confiance, flux de données sensibles, rôles et dépendances.
   - Utilise aussi [l’analyse d’architecture orientée sécurité](analyse-architecture-securite.md) comme liste d’invariants, puis vérifie chacun contre le code actuel. Ne suppose pas que cette analyse décrit un déploiement réel.
2. Parcours l’ensemble des surfaces pertinentes, sans te limiter aux fichiers portant le mot « security » :
   - API : authentification, sessions/cookies, CSRF, autorisation par rôle et par ressource, validation, erreurs, journaux, limites de débit, webhooks, téléversements et appels sortants ;
   - PostgreSQL : rôles et privilèges, RLS et policies, SECURITY DEFINER, search_path, vues, transactions, migrations, fonctions/triggers, données sensibles, sauvegardes et connexions ;
   - Web : stockage des jetons, rendu/échappement, XSS, navigation, appels API, données sensibles côté client, dépendances et configuration de build ;
   - infrastructure : Docker/Compose, Nginx, ports exposés, TLS/proxy, permissions, variables de configuration, secrets et séparation développement/production ;
   - CI/CD et chaîne logicielle : permissions des workflows, actions tierces, dépendances et lockfile, scripts, artefacts, images de conteneurs et protections de publication ;
   - logique métier : achat et remboursements, concurrence/idempotence, quotas, isolation multi-tenant, check-in, liste d’attente, emails et webhooks ;
   - confidentialité : minimisation, accès, rétention, exposition dans les réponses et logs.
3. Trace les chemins complets des opérations à fort impact (inscription/connexion, attribution de rôle, achat, remboursement, webhook, accès organisateur, administration), depuis l’entrée non fiable jusqu’à la base et aux effets externes.
4. Pour chaque chemin, produis un mini-modèle de menace : actif, acteurs, frontière traversée, menace plausible, contrôle préventif/détectif et risque résiduel. Relie les flux à l’architecture Mermaid et aux invariants de l’analyse d’architecture.
5. Cherche également les anti-patterns et incohérences : requêtes SQL non paramétrées, contrôles effectués uniquement côté client, décisions d’autorisation reposant sur des identifiants fournis, secrets codés en dur, configurations permissives, endpoints oubliés, dépendances/configurations divergentes et contrôles contournables par une autre route.

MÉTHODE ET PREUVES
- Commence par relever la branche et l’état Git sans afficher de contenu sensible. Ne touche pas aux fichiers.
- Utilise une cartographie des points d’entrée et des flux, puis vérifie les contrôles dans le code, les migrations, les configurations et les tests associés.
- Chaque constat doit inclure : identifiant, titre, sévérité (Critique/Élevée/Moyenne/Faible/Information), confiance, composant, préconditions, scénario d’impact, preuve concrète (fichier:ligne et extrait minimal non sensible), et portée (confirmé ou à vérifier).
- Classe la sévérité selon l’impact réel et la facilité d’exploitation dans le contexte du dépôt. Déduplique les symptômes d’une même cause.
- Signale aussi les contrôles solides observés, avec leurs preuves, et les zones non couvertes. L’absence de preuve n’est pas une preuve de vulnérabilité.
- Pour chaque point à vérifier, formule la vérification minimale permettant de confirmer ou d’infirmer le risque, sans l’exécuter si elle implique une modification, des données réelles, un service externe ou une charge intrusive.

FORMAT DU RAPPORT (en français)
1. Résumé exécutif : niveau de risque global justifié, principaux domaines de risque, périmètre effectivement examiné et limites.
2. Carte rapide : composants, données sensibles, frontières de confiance et chemins d’attaque importants.
3. Modèle de menace par flux sensible, avec actifs, acteurs, frontières, abus plausibles, mesures et risques résiduels.
4. Constats triés par sévérité, du plus important au moins important, au format défini ci-dessus. S’il n’y a pas de constat confirmé, dis-le explicitement.
5. Contrôles déjà présents et preuves de leur portée réelle.
6. Zones non vérifiées / hypothèses, avec la raison précise.
7. Plan de traitement ordonné en étapes (immédiat, avant mise en production, amélioration), sans modifier les fichiers. Indique les dépendances entre actions.
8. État final du dépôt : confirme qu’aucun fichier n’a été modifié et énumère les commandes ou validations non exécutées.

Ne transforme pas le rapport en liste générique OWASP. Chaque recommandation doit être reliée à un constat ou à une lacune observée dans ce dépôt.
```

## Utilisation

Copier le bloc ci-dessus dans une nouvelle demande d’audit au niveau de la racine du dépôt. L’audit doit précéder les changements afin de conserver un état initial vérifiable. Après lecture du rapport, traiter les constats dans l’ordre de priorité et auditer à nouveau les changements séparément.
