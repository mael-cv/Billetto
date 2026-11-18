// Usage : node scripts/seed.mjs small|full   (graine : variable SEED)
import { psql } from './psql.mjs';

const mode = process.argv[2];
if (mode !== 'small' && mode !== 'full') {
  console.error('Usage : seed.mjs small|full');
  process.exit(1);
}
const seed = process.env.SEED ?? '20260916';
if (!/^\d+$/.test(seed)) {
  console.error('SEED doit être un entier');
  process.exit(1);
}

const started = Date.now();
console.log(`» seed ${mode} (SEED=${seed})`);
psql(['-f', '/database/seed/seed.sql'], { settings: { 'seed.mode': mode, 'seed.value': seed, client_min_messages: 'warning' } });
psql(['-c', `SELECT 'evenements' AS table, count(*) FROM evenements
             UNION ALL SELECT 'tarifs', count(*) FROM tarifs
             UNION ALL SELECT 'utilisateurs', count(*) FROM utilisateurs
             UNION ALL SELECT 'commandes', count(*) FROM commandes
             UNION ALL SELECT 'billets', count(*) FROM billets
             UNION ALL SELECT 'paiements', count(*) FROM paiements`]);
console.log(`✓ seed ${mode} en ${((Date.now() - started) / 1000).toFixed(1)} s`);
