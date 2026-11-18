// Finalisation du premier démarrage (conteneur « seeder »).
//
// L'assistant web dépose une demande d'installation (mode + premier administrateur,
// mot de passe déjà haché) dans le volume de configuration. Ce conteneur, seul à
// disposer des droits propriétaire sur la base :
//   1. charge le jeu de démonstration en mode « test » (rien en mode « live ») ;
//   2. crée le premier administrateur et marque l'application comme initialisée
//      (initialiser_application : une seule fois, garanti par la base).
// L'API ne peut ni charger de données ni créer d'administrateur par elle-même.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { psql } from './psql.mjs';

const CONFIG_DIR = process.env.CONFIG_DIR ?? '/config';
const requestFile = join(CONFIG_DIR, 'setup-request.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const initialised = () =>
  psql(['-At', '-c', 'SELECT application_initialisee();'], { capture: true }).trim() === 't';

if (initialised()) {
  console.log('✓ Application déjà initialisée : rien à faire.');
  process.exit(0);
}

console.log('» En attente de l’assistant de premier démarrage…');
let request = null;
while (!request) {
  if (existsSync(requestFile)) {
    try {
      request = JSON.parse(readFileSync(requestFile, 'utf-8'));
    } catch {
      request = null; // fichier en cours d'écriture
    }
  }
  if (!request) await sleep(2000);
}

const { mode, admin } = request;
if (!['test', 'live'].includes(mode) || !admin?.email || !admin?.passwordHash?.startsWith('$argon2id$')) {
  console.error('✗ Demande d’installation invalide.');
  process.exit(1);
}

if (mode === 'test') {
  console.log('» Mode test : chargement du jeu de démonstration (PostgreSQL)…');
  process.argv[2] = 'small';
  await import('./seed.mjs');
  console.log('» Mode test : chargement du jeu de démonstration (MongoDB)…');
  await import('../nosql/seed-nosql.mjs');
} else {
  console.log('» Mode live : aucune donnée de démonstration, référentiel des types d’événements uniquement.');
  psql(['-f', '/database/seed/reference.sql'], { settings: { client_min_messages: 'warning' } });
  const { MongoClient } = await import('mongodb');
  const { DEFAULT_EVENT_TEMPLATES, DEFAULT_TICKET_TEMPLATES } = await import('../nosql/templates.mjs');
  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const now = new Date();
  // Modèles visuels : nécessaires à l'affichage des événements et des billets.
  for (const [name, docs] of [['event_templates', DEFAULT_EVENT_TEMPLATES], ['ticket_templates', DEFAULT_TICKET_TEMPLATES]]) {
    const col = client.db().collection(name);
    if ((await col.countDocuments()) === 0) await col.insertMany(docs.map((t) => ({ ...t, updatedAt: now })));
  }
  await client.close();
}

// Valeurs transmises par l'environnement de psql (\getenv) : rien dans la ligne de commande.
psql([], {
  env: {
    BILLETTO_SETUP_MODE: mode,
    BILLETTO_SETUP_EMAIL: admin.email,
    BILLETTO_SETUP_HASH: admin.passwordHash,
    BILLETTO_SETUP_PRENOM: admin.prenom,
    BILLETTO_SETUP_NOM: admin.nom,
  },
  input: `\\getenv mode BILLETTO_SETUP_MODE
\\getenv email BILLETTO_SETUP_EMAIL
\\getenv hash BILLETTO_SETUP_HASH
\\getenv prenom BILLETTO_SETUP_PRENOM
\\getenv nom BILLETTO_SETUP_NOM
SELECT initialiser_application(:'mode', :'email', :'hash', :'prenom', :'nom');
`,
});
console.log(`✓ Application initialisée en mode ${mode} ; premier administrateur créé.`);
process.exit(0);
