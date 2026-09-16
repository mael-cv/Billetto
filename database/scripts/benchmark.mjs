// Benchmarks EXPLAIN (ANALYZE, BUFFERS)
//   pnpm db:benchmark before   -> plans dans benchmarks/before/
//   pnpm db:benchmark after    -> plans dans benchmarks/after/
//   pnpm db:benchmark compare  -> benchmarks/results/summary.md
//   3e argument optionnel : filtre sur le nom de fichier (ex. before b10)
//
// Chaque requête : 1 exécution de chauffe (cache) + 3 mesures ; on garde le
// plan de la mesure médiane. Les requêtes sont en lecture seule.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { psql } from './psql.mjs';

const root = new URL('../benchmarks/', import.meta.url);
const RUNS = 3;
const phase = process.argv[2];
const only = process.argv[3];

const queries = readdirSync(new URL('queries/', root))
  .filter((f) => f.endsWith('.sql'))
  .sort();

const executionTime = (plan) => Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? NaN);

function nodes(plan) {
  const found = new Set();
  for (const line of plan.split('\n')) {
    const m = /^\s*(?:->\s*)?([A-Z][A-Za-z ]+?)(?: on | using |  \(cost)/.exec(line);
    if (m) found.add(m[1].trim());
  }
  return [...found];
}

function run(label) {
  const outDir = new URL(`${label}/`, root);
  mkdirSync(outDir, { recursive: true });
  for (const file of queries.filter((f) => !only || f.includes(only))) {
    const sql = readFileSync(new URL(`queries/${file}`, root), 'utf-8');
    const header = sql.split('\n').filter((l) => l.startsWith('--')).join('\n');
    const body = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n').trim();
    const explain = `SET statement_timeout = '300s';\nEXPLAIN (ANALYZE, BUFFERS) ${body}`;

    psql(['-At', '-c', explain], { capture: true }); // chauffe
    const plans = [];
    for (let i = 0; i < RUNS; i++) {
      plans.push(psql(['-At', '-c', explain], { capture: true }).replace(/^SET\n/, ''));
    }
    plans.sort((a, b) => executionTime(a) - executionTime(b));
    const median = plans[Math.floor(RUNS / 2)];
    const times = plans.map(executionTime);
    writeFileSync(
      new URL(file.replace('.sql', '.txt'), outDir),
      `${header}\n-- ${label} — ${RUNS} mesures (ms) : ${times.join(' / ')} — plan médian ci-dessous\n\n${body}\n\n${median}`,
    );
    console.log(`${label.padEnd(6)} ${file.padEnd(34)} ${executionTime(median).toFixed(3).padStart(12)} ms`);
  }
}

function compare() {
  const rows = [
    '# Benchmarks — avant / après index',
    '',
    `Généré par \`pnpm db:benchmark compare\` — médiane de ${RUNS} exécutions, seed FULL.`,
    '',
    '| Requête | Avant (ms) | Après (ms) | Gain | Nœuds avant | Nœuds après |',
    '|---------|-----------:|-----------:|-----:|-------------|-------------|',
  ];
  for (const file of queries) {
    const name = file.replace('.sql', '.txt');
    const read = (d) =>
      existsSync(new URL(`${d}/${name}`, root)) ? readFileSync(new URL(`${d}/${name}`, root), 'utf-8') : '';
    const before = read('before');
    const after = read('after');
    const tb = executionTime(before);
    const ta = executionTime(after);
    const gain = tb && ta ? `×${(tb / ta).toFixed(tb / ta >= 10 ? 0 : 1)}` : '—';
    rows.push(
      `| ${file.replace('.sql', '')} | ${tb.toFixed(2)} | ${ta.toFixed(2)} | ${gain} | ${nodes(before).join(', ')} | ${nodes(after).join(', ')} |`,
    );
  }
  mkdirSync(new URL('results/', root), { recursive: true });
  writeFileSync(new URL('results/summary.md', root), rows.join('\n') + '\n');
  console.log(rows.join('\n'));
}

if (phase === 'before' || phase === 'after') run(phase);
else if (phase === 'compare') compare();
else {
  console.error('Usage : benchmark.mjs before|after|compare');
  process.exit(1);
}
