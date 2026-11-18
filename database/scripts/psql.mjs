// Exécute psql DANS le conteneur postgres (aucun client local requis).
// Les fichiers SQL sont montés en lecture seule sur /database.
// security-audit-ignore: child-process -- spawnSync avec argv (pas de shell côté Node), aucune entrée externe
import { spawnSync } from 'node:child_process';

// Configuration : fichier désigné par BILLETTO_ENV_FILE (volume des secrets, en
// conteneur), sinon le .env de la racine (développement, créé par « pnpm env:pull »).
// Les variables déjà définies priment.
try {
  process.loadEnvFile(process.env.BILLETTO_ENV_FILE ?? new URL('../../.env', import.meta.url));
} catch {
  // aucun fichier : on garde l'environnement courant
}

// env : valeurs sensibles lues côté psql par getenv ; elles ne figurent jamais
// dans la ligne de commande (visible dans la liste des processus).
export function psql(args, { settings = {}, input, capture = false, env: extraEnv = {} } = {}) {
  const pgOptions = Object.entries(settings)
    .map(([k, v]) => `-c ${k}=${v}`)
    .join(' ');

  // Si PGHOST est défini (par ex. dans un conteneur docker ou environnement avec psql direct),
  // on utilise directement le binaire psql sans passer par 'docker compose exec'.
  if (process.env.PGHOST) {
    const directCmd = [
      '-h', process.env.PGHOST,
      '-p', process.env.PGPORT || '5432',
      '-U', process.env.POSTGRES_USER || 'billetto_owner',
      '-d', process.env.POSTGRES_DB || 'billetto',
      '-v', 'ON_ERROR_STOP=1',
      '-X', '-q',
      ...args,
    ];
    const env = {
      ...process.env,
      ...extraEnv,
      PGPASSWORD: process.env.POSTGRES_PASSWORD,
      ...(pgOptions ? { PGOPTIONS: pgOptions } : {}),
    };
    const res = spawnSync('psql', directCmd, {
      input,
      env,
      encoding: 'utf-8',
      stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
    });
    if (res.status !== 0) {
      throw new Error(`psql direct a échoué (code ${res.status})`);
    }
    return res.stdout ?? '';
  }

  const cmd = [
    'compose', 'exec', '-T',
    ...(pgOptions ? ['-e', `PGOPTIONS=${pgOptions}`] : []),
    // « -e NOM » sans valeur : docker la reprend de l'environnement du processus.
    ...Object.keys(extraEnv).flatMap((name) => ['-e', name]),
    'postgres',
    'sh', '-c', 'psql -v ON_ERROR_STOP=1 -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"', 'psql',
    ...args,
  ];
  // security-audit-ignore: child-process -- argv : script sh constant, arguments passés positionnellement via "$@"
  const res = spawnSync('docker', cmd, {
    input,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf-8',
    stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
  });
  if (res.status !== 0) {
    throw new Error(`psql a échoué (code ${res.status})`);
  }
  return res.stdout ?? '';
}
