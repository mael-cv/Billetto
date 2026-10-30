# Vidéo de présentation

Durée attendue : 8 à 12 minutes, MP4, voix audible, texte lisible.

- Fichier : `docs/video/billetto-presentation.mp4` (si ≤ 100 Mo), sinon lien ci-dessous et dans le README racine.
- Lien : _à compléter_

## Déroulé prévu (aligné sur la consigne)

1. **Démarrage à vide** : `docker compose down -v` puis `docker compose up -d` ; logs du conteneur `init` (migrations, seed SQL, schéma et seed MongoDB).
2. **Preuve du peuplement** : `psql` (`SELECT count(*) FROM billets` → 10 000) et `mongosh` (`db.activites.countDocuments()` → ≈ 20 000, `db.avis.findOne()`).
3. **Application** : parcours visiteur (recherche, fiche événement avec programme MongoDB, achat), espace organisateur (page éditoriale, avis).
4. **Interactions** : poster un avis depuis le front puis `db.avis.find({ utilisateurId: … })` ; lecture croisée `GET /events/tendances` (score Mongo + catalogue SQL).
5. **Requêtes avancées** : `pnpm db:test` (concurrence SQL), `database/queries/q1,q6,q8` (CTE, NOT EXISTS, WITH RECURSIVE), `pnpm db:queries:nosql` (pipelines), `EXPLAIN` avant/après index.
6. **Choix techniques** : pourquoi PostgreSQL pour les ventes, pourquoi MongoDB pour le contenu, les avis et la télémétrie, comment les deux sont reliées.
