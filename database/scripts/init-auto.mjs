// Initialisation au démarrage (conteneur « init », ou « pnpm db:init » en développement) :
//   - certificat TLS auto-signé du front (si TLS_CERT_DIR est défini) ;
//   - migrations SQL ;
//   - schéma MongoDB (validateurs, index) et compte MongoDB restreint de l'API.
// Aucune donnée n'est chargée ici : le jeu de démonstration dépend du mode choisi
// dans l'assistant de premier démarrage (voir seeder.mjs). En développement,
// « --seed » charge le jeu de démonstration si la base est vide.
// security-audit-ignore: child-process -- spawnSync avec argv constant (openssl), aucune entrée externe
import { spawnSync } from 'node:child_process';
import { chownSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { psql } from './psql.mjs';
import { applySchema } from '../nosql/schema.mjs';

const withSeed = process.argv.includes('--seed');
const started = Date.now();
console.log('====================================================');
console.log('BILLETTO — initialisation');
console.log('====================================================');

// Certificat TLS auto-signé du front (volume partagé avec nginx). Créé une seule fois.
const certDir = process.env.TLS_CERT_DIR;
if (certDir) {
  const crt = join(certDir, 'billetto.crt');
  const key = join(certDir, 'billetto.key');
  if (!existsSync(crt) || !existsSync(key)) {
    const res = spawnSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365', '-subj', '/CN=localhost',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', crt],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    if (res.status !== 0) {
      console.error('✗ Génération du certificat TLS impossible.');
      process.exit(1);
    }
    // nginx tourne sous l'uid 101 (image non-root) : lui seul lit la clé privée.
    chownSync(crt, 101, 101);
    chownSync(key, 101, 101);
    chmodSync(key, 0o400);
    console.log('✓ Certificat TLS auto-signé créé (valable 365 jours).');
  }
}

async function retry(label, attempt, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      return await attempt();
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.error(`✗ ${label} injoignable après ${tries} secondes.`);
  process.exit(1);
}

// 1. PostgreSQL : attente puis migrations
console.log('» PostgreSQL : attente…');
await retry('PostgreSQL', () => {
  if (!psql(['-c', 'SELECT 1;'], { capture: true }).includes('1')) throw new Error('pas prêt');
});
console.log('» PostgreSQL : migrations…');
try {
  await import('./migrate.mjs');
} catch (err) {
  console.error('✗ Migrations SQL :', err.message);
  process.exit(1);
}

// 2. Jeu de démonstration (développement uniquement, base vide)
if (withSeed) {
  const events = parseInt(psql(['-At', '-c', 'SELECT count(*) FROM evenements;'], { capture: true }).trim(), 10) || 0;
  if (events === 0) {
    console.log('» Base vide : chargement du jeu de démonstration…');
    process.argv[2] = 'small';
    await import('./seed.mjs');
  } else {
    console.log(`✓ PostgreSQL déjà peuplé (${events} événements).`);
  }
}

// 3. MongoDB : schéma et compte applicatif restreint
const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
  console.error('✗ MONGO_URL absent de la configuration.');
  process.exit(1);
}
console.log('» MongoDB : attente…');
const mongoClient = await retry('MongoDB', async () => {
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 2000 });
  await client.connect();
  await client.db().admin().ping();
  return client;
});
try {
  const db = mongoClient.db();
  await applySchema(db);

  // L'API ne se connecte jamais en root MongoDB : readWrite sur sa seule base.
  const appUser = process.env.MONGO_APP_USER;
  const appPassword = process.env.MONGO_APP_PASSWORD;
  if (!appUser || !appPassword) throw new Error('MONGO_APP_USER / MONGO_APP_PASSWORD absents de la configuration');
  const roles = [{ role: 'readWrite', db: db.databaseName }];
  const { users } = await db.command({ usersInfo: appUser });
  await db.command(
    users.length > 0 ? { updateUser: appUser, pwd: appPassword, roles } : { createUser: appUser, pwd: appPassword, roles },
  );
  console.log(`✓ Compte MongoDB applicatif : readWrite sur ${db.databaseName} uniquement.`);

  const pages = await db.collection('event_pages').countDocuments();
  await mongoClient.close();
  if (withSeed && pages === 0) {
    console.log('» MongoDB vide : chargement du jeu de démonstration…');
    await import('../nosql/seed-nosql.mjs');
  }
} catch (err) {
  console.error('✗ Initialisation MongoDB :', err.message);
  process.exit(1);
}

console.log(`✓ Initialisation terminée en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
process.exit(0);
