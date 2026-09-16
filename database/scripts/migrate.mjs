// Applique database/migrations/*.sql dans l'ordre, une transaction par fichier,
// en traçant les versions dans schema_migrations.
import { readdirSync } from 'node:fs';
import { psql } from './psql.mjs';

const reset = process.argv.includes('--reset');

if (reset) {
  console.log('» reset : DROP SCHEMA public CASCADE');
  psql(['-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;']);
}

psql([
  '-c',
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     version text PRIMARY KEY,
     applied_at timestamptz NOT NULL DEFAULT now()
   )`,
]);

const applied = new Set(
  psql(['-At', '-c', 'SELECT version FROM schema_migrations'], { capture: true })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean),
);

const files = readdirSync(new URL('../migrations/', import.meta.url))
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  if (applied.has(file)) continue;
  console.log(`» migration ${file}`);
  psql(['-1', '-f', `/database/migrations/${file}`, '-c',
        `INSERT INTO schema_migrations (version) VALUES ('${file.replace(/'/g, "''")}')`]);
}
// Compte applicatif : mot de passe jamais versionné, lu depuis APP_DB_PASSWORD.
// Passé en variable psql sur l'entrée standard (:'app_password' est échappé par psql).
const hasAppRole = psql(['-At', '-c', "SELECT 1 FROM pg_roles WHERE rolname = 'billetto_app'"], {
  capture: true,
}).trim();
if (hasAppRole) {
  if (process.env.APP_DB_PASSWORD) {
    psql(['-v', `app_password=${process.env.APP_DB_PASSWORD}`], {
      input: "ALTER ROLE billetto_app WITH LOGIN PASSWORD :'app_password';\n",
    });
    console.log('» billetto_app : LOGIN activé (mot de passe depuis APP_DB_PASSWORD)');
  } else {
    psql(['-c', 'ALTER ROLE billetto_app NOLOGIN']);
    console.warn('» APP_DB_PASSWORD absent : billetto_app reste NOLOGIN');
  }
}

console.log('✓ migrations à jour');
