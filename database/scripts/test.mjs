// Exécute les tests SQL (database/tests/*.sql) puis vérifie que chaque
// requête de database/queries/ s'exécute sans erreur.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { psql } from './psql.mjs';

const list = (dir) =>
  readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => f.endsWith('.sql')).sort();

let failed = 0;
for (const file of list('tests')) {
  console.log(`\n» test ${file}`);
  try {
    psql(['-f', `/database/tests/${file}`]);
    console.log(`✓ ${file}`);
  } catch {
    console.error(`✗ ${file}`);
    failed++;
  }
}

console.log('\n» requêtes database/queries');
for (const file of list('queries')) {
  try {
    psql(['-o', '/dev/null', '-f', `/database/queries/${file}`]);
    console.log(`✓ ${file}`);
  } catch {
    console.error(`✗ ${file}`);
    failed++;
  }
}

console.log('\n» sécurité en connexion réelle billetto_app');
{
  const res = spawnSync(process.execPath, [fileURLToPath(new URL('./security-login.mjs', import.meta.url))], {
    stdio: 'inherit',
  });
  if (res.status !== 0) failed++;
}

console.log('\n» concurrence (sessions parallèles)');
{
  const res = spawnSync(process.execPath, [fileURLToPath(new URL('./concurrency.mjs', import.meta.url))], {
    stdio: 'inherit',
  });
  if (res.status !== 0) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} échec(s)`);
  process.exit(1);
}
console.log('\n✓ tous les tests SQL passent');
