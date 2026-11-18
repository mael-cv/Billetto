// Amorçage de la configuration au premier démarrage (conteneur « bootstrap »).
//
// Aucun secret n'existe dans le dépôt ni sur l'hôte : ils sont générés ici, une
// seule fois, dans deux volumes Docker distincts.
//   SECRETS_DIR (/secrets)  identifiants d'administration des bases : lus par
//                           postgres, mongodb, init et seeder — jamais par l'API ;
//   CONFIG_DIR  (/config)   configuration de l'API (compte restreint, secret de
//                           session, mode, clés Stripe écrites par l'assistant).
// Relancer le conteneur ne régénère rien : les fichiers existants sont conservés.
import { randomBytes } from 'node:crypto';
import { chmodSync, chownSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SECRETS_DIR = process.env.SECRETS_DIR ?? '/secrets';
const CONFIG_DIR = process.env.CONFIG_DIR ?? '/config';
// Utilisateur « node » de l'image de l'API : seul lecteur de sa configuration.
const API_UID = Number(process.env.API_UID ?? 1000);
const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://localhost:3000';

// base64url : utilisable tel quel dans une URL de connexion.
const secret = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export const serializeEnv = (values) =>
  `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;

const readEnv = (file) => (existsSync(file) ? parseEnv(readFileSync(file, 'utf-8')) : null);

function write(file, content, mode, uid) {
  writeFileSync(file, content, { mode });
  chmodSync(file, mode);
  if (uid !== undefined) chownSync(file, uid, uid);
}

mkdirSync(SECRETS_DIR, { recursive: true });
mkdirSync(CONFIG_DIR, { recursive: true });

// --- 1. Identifiants d'administration des bases -----------------------------
const infraFile = join(SECRETS_DIR, 'infra.env');
let infra = readEnv(infraFile);
if (!infra) {
  const pg = secret(24);
  const mongo = secret(24);
  infra = {
    POSTGRES_USER: 'billetto_owner',
    POSTGRES_PASSWORD: pg,
    POSTGRES_DB: 'billetto',
    PGHOST: 'postgres',
    PGPORT: '5432',
    DATABASE_URL: `postgresql://billetto_owner:${pg}@postgres:5432/billetto`,
    APP_DB_PASSWORD: secret(24),
    READONLY_DB_PASSWORD: secret(24),
    MONGO_USER: 'billetto_mongo',
    MONGO_PASSWORD: mongo,
    MONGO_DB: 'billetto_nosql',
    MONGO_URL: `mongodb://billetto_mongo:${mongo}@mongodb:27017/billetto_nosql?authSource=admin`,
    MONGO_APP_USER: 'billetto_app',
    MONGO_APP_PASSWORD: secret(24),
    SEED: '20260916',
  };
  write(infraFile, serializeEnv(infra), 0o600);
  console.log('✓ Identifiants des bases générés (volume des secrets).');
}
// Fichiers lus par les images officielles (POSTGRES_PASSWORD_FILE, …) : ces
// processus ne tournent pas en root, d'où la lecture ouverte dans ce volume
// monté uniquement dans les conteneurs de base de données.
write(join(SECRETS_DIR, 'postgres_password'), infra.POSTGRES_PASSWORD, 0o444);
write(join(SECRETS_DIR, 'mongo_password'), infra.MONGO_PASSWORD, 0o444);

// --- 2. Configuration de l'API ----------------------------------------------
const apiFile = join(CONFIG_DIR, 'api.env');
let api = readEnv(apiFile);
if (!api) {
  api = {
    APP_MODE: 'setup',
    APP_DATABASE_URL: `postgresql://billetto_app:${infra.APP_DB_PASSWORD}@postgres:5432/${infra.POSTGRES_DB}`,
    APP_MONGO_URL: `mongodb://${infra.MONGO_APP_USER}:${infra.MONGO_APP_PASSWORD}@mongodb:27017/${infra.MONGO_DB}`,
    JWT_SECRET: secret(48),
  };
  write(apiFile, serializeEnv(api), 0o600, API_UID);
  console.log('✓ Configuration de l’API générée (volume de configuration).');
}
chownSync(CONFIG_DIR, API_UID, API_UID);
chmodSync(CONFIG_DIR, 0o700);

// --- 3. Jeton de l'assistant de premier démarrage ---------------------------
if (api.APP_MODE === 'setup') {
  const tokenFile = join(CONFIG_DIR, 'setup-token');
  if (!existsSync(tokenFile)) write(tokenFile, randomBytes(24).toString('base64url'), 0o600, API_UID);
  const token = readFileSync(tokenFile, 'utf-8').trim();
  const line = '='.repeat(72);
  console.log(`\n${line}`);
  console.log('  BILLETTO — premier démarrage');
  console.log(`  Ouvrez ${PUBLIC_URL}/#/setup et saisissez ce jeton d'installation :`);
  console.log(`\n      ${token}\n`);
  console.log('  Jeton à usage unique : il disparaît dès que l’application est initialisée.');
  console.log('  Après 5 saisies erronées, un nouveau jeton est émis dans les logs de l’API.');
  console.log(`${line}\n`);
} else {
  console.log(`✓ Application déjà initialisée (mode ${api.APP_MODE}).`);
}
