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
  // pas de .env : valeurs par défaut de docker-compose.yml
}

const user = process.env.MONGO_USER ?? 'billetto_mongo';
const password = process.env.MONGO_PASSWORD ?? 'billetto_mongo_pass';
const dbName = process.env.MONGO_DB ?? 'billetto_templates';
const filter = process.argv[2];

const files = readdirSync(new URL('./queries/', import.meta.url))
  .filter((f) => f.endsWith('.mongodb.js') && (!filter || f.startsWith(filter)))
  .sort();

let failed = 0;
for (const file of files) {
  console.log(`\n==== ${file} ====`);
  const res = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'mongodb', 'mongosh', '--quiet', '-u', user, '-p', password, '--authenticationDatabase', 'admin',
      dbName, '--file', `/database/nosql/queries/${file}`],
    { stdio: 'inherit' },
  );
  if (res.status !== 0) failed++;
}
if (failed) {
  console.error(`\n${failed} requête(s) en échec`);
  process.exit(1);
}
