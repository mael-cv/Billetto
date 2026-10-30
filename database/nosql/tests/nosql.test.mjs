// Tests de la base documentaire : schéma appliqué, validateurs actifs, index
// présents, volume du seed, et requêtes de database/nosql/queries exécutables.
//   node database/nosql/tests/nosql.test.mjs
// security-audit-ignore: child-process -- node + chemin de script constant, sans shell
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { COLLECTIONS } from '../schema.mjs';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // valeurs par défaut
}
const mongoUrl =
  process.env.MONGO_URL ?? 'mongodb://billetto_mongo:billetto_mongo_pass@localhost:27017/billetto_templates?authSource=admin';

const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });
await client.connect();
const db = client.db();
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

await test('toutes les collections existent avec leur validateur', async () => {
  const infos = await db.listCollections().toArray();
  for (const name of Object.keys(COLLECTIONS)) {
    const info = infos.find((c) => c.name === name);
    assert.ok(info, `collection ${name} absente`);
    assert.ok(info.options?.validator?.$jsonSchema, `validateur absent sur ${name}`);
  }
});

await test('tous les index déclarés sont présents (dont unique, partiel, texte, TTL)', async () => {
  for (const [name, spec] of Object.entries(COLLECTIONS)) {
    const indexes = await db.collection(name).indexes();
    for (const [, options] of spec.indexes) {
      assert.ok(indexes.some((i) => i.name === options.name), `${name}.${options.name} manquant`);
    }
  }
  const ttl = (await db.collection('activites').indexes()).find((i) => i.name === 'ttl_ts');
  assert.equal(ttl.expireAfterSeconds, 90 * 24 * 3600);
});

await test('volume du seed : pages = événements SQL, milliers d’avis et d’activités', async () => {
  const pages = await db.collection('event_pages').countDocuments();
  const avis = await db.collection('avis').countDocuments();
  const activites = await db.collection('activites').countDocuments();
  assert.ok(pages >= 100, `event_pages : ${pages}`);
  assert.ok(avis >= 1000, `avis : ${avis}`);
  assert.ok(activites >= 10000, `activites : ${activites}`);
  assert.equal(await db.collection('event_templates').countDocuments(), 5);
});

await test('validateur : une note hors 1..5 est rejetée', async () => {
  await assert.rejects(
    db.collection('avis').insertOne({
      evenementId: 1, utilisateurId: 999999, utilisateur: { prenom: 'Test' }, note: 7, commentaire: 'x', createdAt: new Date(),
    }),
    (err) => err.code === 121, // DocumentValidationFailure
  );
});

await test('validateur : un type d’activité inconnu est rejeté', async () => {
  await assert.rejects(db.collection('activites').insertOne({ type: 'inconnu', ts: new Date() }), (err) => err.code === 121);
});

await test('index unique : un second avis du même acheteur sur le même événement est refusé', async () => {
  const existant = await db.collection('avis').findOne({});
  await assert.rejects(
    db.collection('avis').insertOne({
      evenementId: existant.evenementId, utilisateurId: existant.utilisateurId, utilisateur: { prenom: 'Doublon' },
      note: 3, commentaire: 'doublon', createdAt: new Date(),
    }),
    (err) => err.code === 11000,
  );
});

await test('la recherche d’avis par événement utilise l’index ix_evenement_date (pas de COLLSCAN)', async () => {
  const existant = await db.collection('avis').findOne({});
  const plan = await db.collection('avis').find({ evenementId: existant.evenementId }).sort({ createdAt: -1 }).explain('executionStats');
  const json = JSON.stringify(plan.queryPlanner.winningPlan);
  assert.ok(json.includes('ix_evenement_date'), `plan : ${json.slice(0, 200)}`);
  assert.ok(!json.includes('COLLSCAN'));
});

await test('les requêtes database/nosql/queries s’exécutent sans erreur', async () => {
  const res = spawnSync(process.execPath, [fileURLToPath(new URL('../queries.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || res.stdout);
});

await client.close();
if (failed) {
  console.error(`\n${failed} échec(s) NoSQL`);
  process.exit(1);
}
console.log('\n✓ tous les tests NoSQL passent');
