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
console.log('✓ migrations à jour');
