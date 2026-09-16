// Exécute psql DANS le conteneur postgres (aucun client local requis).
// Les fichiers SQL sont montés en lecture seule sur /database.
import { spawnSync } from 'node:child_process';

export function psql(args, { settings = {}, input, capture = false } = {}) {
  const pgOptions = Object.entries(settings)
    .map(([k, v]) => `-c ${k}=${v}`)
    .join(' ');
  const cmd = [
    'compose', 'exec', '-T',
    ...(pgOptions ? ['-e', `PGOPTIONS=${pgOptions}`] : []),
    'postgres',
    'sh', '-c', 'psql -v ON_ERROR_STOP=1 -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"', 'psql',
    ...args,
  ];
  const res = spawnSync('docker', cmd, {
    input,
    encoding: 'utf-8',
    stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
  });
  if (res.status !== 0) {
    throw new Error(`psql a échoué (code ${res.status})`);
  }
  return res.stdout ?? '';
}
