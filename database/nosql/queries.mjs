// Exécute chaque requête de database/nosql/queries/*.mongodb.js dans mongosh
// (conteneur mongodb, dossier monté sur /database/nosql). Usage :
//   node database/nosql/queries.mjs            toutes les requêtes
//   node database/nosql/queries.mjs n2         une seule (préfixe du fichier)
// security-audit-ignore: child-process -- docker compose exec avec argv constant, aucune entrée externe
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // pas de .env : environnement courant
}

const dbName = process.env.MONGO_DB ?? 'billetto_nosql';
const filter = process.argv[2];

const files = readdirSync(new URL('./queries/', import.meta.url))
  .filter((f) => f.endsWith('.mongodb.js') && (!filter || f.startsWith(filter)))
  .sort();

let failed = 0;
for (const file of files) {
  console.log(`\n==== ${file} ====`);
  const res = spawnSync(
    'docker',
    // Identifiants repris de l'environnement du conteneur : rien de secret dans la ligne de commande de l'hôte.
    ['compose', 'exec', '-T', 'mongodb', 'sh', '-c',
      'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$(cat "$MONGO_INITDB_ROOT_PASSWORD_FILE")" --authenticationDatabase admin "$1" --file "$2"',
      'mongosh', dbName, `/database/nosql/queries/${file}`],
    { stdio: 'inherit' },
  );
  if (res.status !== 0) failed++;
}
if (failed) {
  console.error(`\n${failed} requête(s) en échec`);
  process.exit(1);
}
