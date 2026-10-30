// Script d'initialisation et de vérification automatique au démarrage.
// Applique les migrations SQL, vérifie si les seeds SQL et MongoDB sont nécessaires,
// et peuple les données si la base est vierge.
import { MongoClient } from 'mongodb';
import { psql } from './psql.mjs';
import { applySchema } from '../nosql/schema.mjs';

const started = Date.now();
console.log('====================================================');
console.log('🚀 BILLETTO — Vérification de l\'initialisation');
console.log('====================================================');
if ((process.env.POSTGRES_PASSWORD ?? '') === 'billetto_owner_pass') {
  console.warn('⚠️  Secrets PAR DÉFAUT de docker-compose.yml en usage : réservés à la démonstration. Créez un .env (voir .env.example) pour tout autre usage.');
}

// 1. Attente active de PostgreSQL
console.log('» 1/4 Attente de la base PostgreSQL...');
let pgReady = false;
for (let i = 0; i < 30; i++) {
  try {
    const res = psql(['-c', 'SELECT 1;'], { capture: true });
    if (res.includes('1')) {
      pgReady = true;
      break;
    }
  } catch {
    // attendre 1s
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!pgReady) {
  console.error('❌ Impossible de joindre PostgreSQL après 30 secondes.');
  process.exit(1);
}
console.log('✓ PostgreSQL est prêt.');

// 2. Application des migrations SQL
console.log('» 2/4 Vérification des migrations PostgreSQL...');
try {
  await import('./migrate.mjs');
} catch (err) {
  console.error('❌ Erreur lors des migrations SQL :', err.message);
  process.exit(1);
}

// 3. Vérification des données relationnelles (Seed PostgreSQL)
console.log('» 3/4 Vérification des données de la billetterie...');
let userCount = 0;
try {
  const out = psql(['-At', '-c', 'SELECT count(*) FROM utilisateurs;'], { capture: true });
  userCount = parseInt(out.trim(), 10) || 0;
} catch {
  userCount = 0;
}

if (userCount === 0) {
  console.log('» Base PostgreSQL vierge : exécution du seed small et des comptes de démo...');
  try {
    process.argv[2] = 'small';
    await import('./seed.mjs');
    console.log('✓ Seed PostgreSQL et comptes de démo créés.');
  } catch (err) {
    console.error('❌ Erreur lors du seed PostgreSQL :', err.message);
    process.exit(1);
  }
} else {
  console.log(`✓ PostgreSQL déjà initialisé (${userCount} utilisateurs trouvés) : seed ignoré.`);
}

// 4. Base documentaire MongoDB : schéma (validateurs + index) puis peuplement si vide.
//    Le seed NoSQL lit les identifiants dans PostgreSQL : il s'exécute toujours après le seed SQL.
console.log('» 4/4 Vérification de la base NoSQL MongoDB...');
const mongoUrl =
  process.env.MONGO_URL ??
  'mongodb://billetto_mongo:billetto_mongo_pass@mongodb:27017/billetto_templates?authSource=admin';

let mongoClient = null;
for (let i = 0; i < 30; i++) {
  try {
    mongoClient = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 2000 });
    await mongoClient.connect();
    await mongoClient.db().admin().ping();
    break;
  } catch {
    mongoClient = null;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!mongoClient) {
  console.error('❌ Impossible de joindre MongoDB après 30 secondes.');
  process.exit(1);
}
try {
  const db = mongoClient.db();
  await applySchema(db);
  const pages = await db.collection('event_pages').countDocuments();
  await mongoClient.close();
  if (pages === 0) {
    console.log('» Base MongoDB vierge : seed NoSQL (templates, pages, avis, activités)...');
    await import('../nosql/seed-nosql.mjs');
  } else {
    console.log(`✓ MongoDB déjà initialisé (${pages} pages d'événement) : seed ignoré.`);
  }
} catch (err) {
  console.error('❌ Erreur lors de l\'initialisation MongoDB :', err.message);
  process.exit(1);
}

console.log('====================================================');
console.log(`✓ Initialisation complète terminée en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
console.log('✓ Tous les services sont prêts à démarrer.');
console.log('====================================================');
process.exit(0);
