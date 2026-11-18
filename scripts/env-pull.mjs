// Développement : copie la configuration générée dans les volumes Docker vers
// ./.env, pour lancer l'API, les scripts et les tests directement sur l'hôte.
//   pnpm infra:up && pnpm env:pull
// Les hôtes internes (postgres, mongodb) sont remplacés par localhost et les
// ports publiés par docker-compose.dev.yml. Le fichier contient des secrets :
// il est ignoré par git et n'est jamais nécessaire pour « docker compose up ».
// security-audit-ignore: child-process -- docker compose avec argv constant, aucune entrée externe
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envPath = fileURLToPath(new URL('../.env', import.meta.url));

const parse = (text) => {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
};

function readVolumeFile(path) {
  const res = spawnSync(
    'docker',
    ['compose', 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'cat', 'bootstrap', path],
    { cwd: root, encoding: 'utf-8' },
  );
  if (res.status !== 0) {
    console.error(`✗ Lecture de ${path} impossible : lancez d'abord « pnpm infra:up ».\n${res.stderr}`);
    process.exit(1);
  }
  return parse(res.stdout);
}

const infra = readVolumeFile('/secrets/infra.env');
const api = readVolumeFile('/config/api.env');
const stripeFile = fileURLToPath(new URL('../infra/stripe/test-keys.env', import.meta.url));
const stripe = existsSync(stripeFile) ? parse(readFileSync(stripeFile, 'utf-8')) : {};
const previous = existsSync(envPath) ? parse(readFileSync(envPath, 'utf-8')) : {};

const pgPort = process.env.POSTGRES_PORT ?? '5433';
const mongoPort = process.env.MONGO_PORT ?? '27017';
const local = (url) => url.replace('@postgres:5432', `@localhost:${pgPort}`).replace('@mongodb:27017', `@localhost:${mongoPort}`);

const values = {
  POSTGRES_USER: infra.POSTGRES_USER,
  POSTGRES_PASSWORD: infra.POSTGRES_PASSWORD,
  POSTGRES_DB: infra.POSTGRES_DB,
  POSTGRES_PORT: pgPort,
  DATABASE_URL: local(infra.DATABASE_URL),
  APP_DB_PASSWORD: infra.APP_DB_PASSWORD,
  APP_DATABASE_URL: local(api.APP_DATABASE_URL),
  READONLY_DB_PASSWORD: infra.READONLY_DB_PASSWORD,
  MONGO_USER: infra.MONGO_USER,
  MONGO_PASSWORD: infra.MONGO_PASSWORD,
  MONGO_DB: infra.MONGO_DB,
  MONGO_PORT: mongoPort,
  MONGO_URL: local(infra.MONGO_URL),
  MONGO_APP_USER: infra.MONGO_APP_USER,
  MONGO_APP_PASSWORD: infra.MONGO_APP_PASSWORD,
  APP_MONGO_URL: local(api.APP_MONGO_URL),
  SEED: infra.SEED,
  // API lancée sur l'hôte : mode test, sans assistant.
  APP_MODE: 'test',
  API_PORT: '3001',
  CORS_ORIGIN: 'http://localhost:3000',
  COOKIE_SECURE: 'true',
  JWT_SECRET: api.JWT_SECRET,
  STRIPE_SECRET_KEY: stripe.STRIPE_SECRET_KEY ?? '',
  STRIPE_WEBHOOK_SECRET: stripe.STRIPE_WEBHOOK_SECRET ?? '',
  SMTP_URL: 'smtp://localhost:1025',
  // pgAdmin (profil facultatif) : compte local conservé d'une exécution à l'autre.
  PGADMIN_DEFAULT_EMAIL: previous.PGADMIN_DEFAULT_EMAIL ?? 'admin@billetto.local',
  PGADMIN_DEFAULT_PASSWORD: previous.PGADMIN_DEFAULT_PASSWORD ?? randomBytes(18).toString('base64url'),
};

const content = `# Copie locale de la configuration générée dans les volumes Docker (pnpm env:pull).\n# Développement uniquement — ne jamais commiter ni partager ce fichier.\n${Object.entries(values)
  .map(([key, value]) => `${key}=${value}`)
  .join('\n')}\n`;
writeFileSync(envPath, content, { mode: 0o600 });
console.log('✓ .env local écrit à partir des volumes Docker.');
