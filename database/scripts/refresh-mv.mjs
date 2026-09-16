// Rafraîchit les vues matérialisées.
//   pnpm db:refresh-mv             -> REFRESH ... CONCURRENTLY (lectures non bloquées)
//   pnpm db:refresh-mv --blocking  -> REFRESH classique (verrou exclusif, plus rapide)
import { psql } from './psql.mjs';

const blocking = process.argv.includes('--blocking');
const mode = blocking ? '' : 'CONCURRENTLY ';
const started = Date.now();
console.log(`» REFRESH MATERIALIZED VIEW ${mode}mv_ventes_quotidiennes`);
psql(['-c', `REFRESH MATERIALIZED VIEW ${mode}mv_ventes_quotidiennes`]);
console.log(`✓ rafraîchie en ${((Date.now() - started) / 1000).toFixed(1)} s`);
