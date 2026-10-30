// Peuplement déterministe de MongoDB à partir des données PostgreSQL.
//   node database/nosql/seed-nosql.mjs            (graine : SEED, défaut 20260916)
//   MONGO_URL : connexion (défaut : conteneur compose)
//
// Lit dans PostgreSQL (source de vérité) les événements, les couples
// acheteur/événement et les organisateurs, puis génère :
//   - event_templates / ticket_templates : les documents par défaut (templates.mjs)
//   - event_pages : 1 page éditoriale par événement
//   - avis        : ~60 % des couples (acheteur, événement) laissent un avis
//   - activites   : journal d'activité sur 60 jours, trafic concentré sur
//                   quelques événements « tendance »
import { MongoClient } from 'mongodb';
import { psql } from '../scripts/psql.mjs';
import { applySchema, ACTIVITY_TYPES } from './schema.mjs';
import { DEFAULT_EVENT_TEMPLATES, DEFAULT_TICKET_TEMPLATES } from './templates.mjs';

const SEP = '\x1f';
const seed = Number(process.env.SEED ?? '20260916');
const mongoUrl =
  process.env.MONGO_URL ?? 'mongodb://billetto_mongo:billetto_mongo_pass@localhost:27017/billetto_templates?authSource=admin';

// ---------------------------------------------------------------------------
// Générateur pseudo-aléatoire déterministe (mulberry32) : même SEED => mêmes documents.
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(seed);
const ri = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;

// ---------------------------------------------------------------------------
// Lecture PostgreSQL
// ---------------------------------------------------------------------------
function rows(sql) {
  const out = psql(['-At', '-F', SEP, '-c', sql], { capture: true });
  return out
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter(Boolean)
    .map((l) => l.split(SEP));
}

const evenements = rows(`
  SELECT e.id, e.slug, e.nom, e.statut, e.debut, e.fin, e.organisateur_id,
         t.nom AS type, COALESCE(tp.nom, t.nom) AS famille,
         COALESCE(tpp.nom, tp.nom, t.nom) AS racine
  FROM evenements e
  JOIN type_evenements t   ON t.id = e.type_evenement_id
  LEFT JOIN type_evenements tp  ON tp.id = t.parent_id
  LEFT JOIN type_evenements tpp ON tpp.id = tp.parent_id
  ORDER BY e.id`).map(([id, slug, nom, statut, debut, fin, org, type, famille, racine]) => ({
  id: Number(id), slug, nom, statut, debut: new Date(debut), fin: new Date(fin),
  organisateurId: Number(org), type, famille, racine,
}));

// Couples (acheteur, événement) avec commande payée : seuls eux peuvent laisser un avis.
const couples = rows(`
  SELECT DISTINCT b.utilisateur_id, t.evenement_id, u.prenom
  FROM billets b
  JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
  JOIN tarifs t    ON t.id = b.tarif_id
  JOIN utilisateurs u ON u.id = b.utilisateur_id
  ORDER BY t.evenement_id, b.utilisateur_id`).map(([u, e, prenom]) => ({ utilisateurId: Number(u), evenementId: Number(e), prenom }));

const nbUtilisateurs = Number(rows('SELECT count(*) FROM utilisateurs')[0][0]);

if (evenements.length === 0) {
  console.error('❌ Aucun événement dans PostgreSQL : lancer le seed SQL avant le seed NoSQL.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Générateurs de contenu
// ---------------------------------------------------------------------------
const TEMPLATE_PAR_RACINE = { Musique: 'concert', Sport: 'default', 'Arts de la scène': 'theatre', Conférence: 'conference' };
const templatePour = (e) => (e.famille === 'Festival' || e.type === 'Festival' ? 'festival' : (TEMPLATE_PAR_RACINE[e.racine] ?? 'default'));

const ARTISTES = ['Nova Kline', 'The Lumen', 'DJ Orbital', 'Maya Sorel', 'Quartet Aube', 'Léo Vance', 'Sirène Bleue',
  'Kraft & Cie', 'Odile Marchand', 'Collectif Ricochet', 'Ibrahim Tall', 'Les Frères Kaplan', 'Sora Ito', 'Trio Granit'];
const SCENES = ['Grande scène', 'Scène Nord', 'Club', 'Auditorium', 'Plateau B', 'Chapiteau', 'Terrain central', 'Salle 1'];
const TAGS = ['plein-air', 'famille', 'nocturne', 'accessible-pmr', 'cashless', 'gratuit-moins-12', 'after', 'premium', 'debout', 'assis'];
const SECTIONS = [
  ['Accès & transports', 'Navettes toutes les 15 minutes depuis la gare. Parking surveillé à proximité.'],
  ['Restauration', 'Food-court et bars ouverts dès l’ouverture des portes. Paiement sans contact.'],
  ['Sécurité', 'Fouille systématique à l’entrée. Bouteilles en verre et objets tranchants interdits.'],
  ['Vestiaire', 'Vestiaire payant (2 €) à l’entrée principale, gratuit pour les poussettes.'],
  ['Accessibilité', 'Plateformes PMR devant chaque scène, accompagnateur gratuit sur justificatif.'],
  ['Objets trouvés', 'Guichet objets trouvés ouvert jusqu’à 1 h après la fin de l’événement.'],
];
const FAQ = [
  ['Puis-je sortir et revenir ?', 'Non, toute sortie après validation du billet est définitive.'],
  ['Les enfants paient-ils ?', 'Entrée gratuite pour les moins de 12 ans accompagnés d’un adulte muni d’un billet.'],
  ['Le billet est-il nominatif ?', 'Oui, une pièce d’identité peut être demandée au contrôle.'],
  ['Que se passe-t-il en cas de pluie ?', 'L’événement est maintenu ; seules les conditions dangereuses entraînent un report.'],
  ['Puis-je transférer mon billet ?', 'Oui, depuis votre espace « Mes billets » jusqu’à 2 h avant le début.'],
];
const AVIS_TITRES = { 5: ['Inoubliable', 'Parfait du début à la fin', 'À refaire'], 4: ['Très bonne soirée', 'Belle organisation', 'Content'],
  3: ['Correct', 'Mitigé', 'Peut mieux faire'], 2: ['Déçu', 'Trop d’attente', 'Son médiocre'], 1: ['À éviter', 'Annulé sans prévenir', 'Catastrophe'] };
const AVIS_TEXTES = {
  5: ['Ambiance incroyable, son impeccable et entrée fluide grâce au QR code.', 'Tout était parfait, des navettes à la programmation.'],
  4: ['Très bon moment, juste un peu de queue au bar.', 'Programmation au top, l’accès PMR mériterait une meilleure signalétique.'],
  3: ['Pas mal mais le son était trop fort côté gradins.', 'Bien sans plus, les horaires annoncés n’ont pas été respectés.'],
  2: ['Quarante minutes d’attente à l’entrée, scanner en panne.', 'Le vestiaire était saturé, on a attendu longtemps à la sortie.'],
  1: ['Pas de communication sur le changement d’horaire, soirée gâchée.', 'Placement non respecté, personne pour nous aider.'],
};
const REPONSES = ['Merci pour votre retour, nous en tenons compte pour la prochaine édition.',
  'Nous sommes désolés pour cette attente, l’équipe d’accueil sera renforcée.', 'Ravi que la soirée vous ait plu, à bientôt !'];
const RECHERCHES = ['concert', 'rock paris', 'festival été', 'théâtre', 'jazz', 'conférence tech', 'ligue 1', 'humour', 'danse', 'electro lyon', 'basket', 'business'];
const NAVIGATEURS = ['Chrome/Windows', 'Safari/iOS', 'Firefox/Linux', 'Chrome/Android', 'Edge/Windows'];
const SOURCES = ['accueil', 'recherche', 'tendances', 'lien-direct', 'email'];

function pageDe(e) {
  const n = ri(3, 8);
  const programme = Array.from({ length: n }, (_, i) => ({
    heure: new Date(e.debut.getTime() + i * ri(30, 75) * 60_000),
    scene: pick(SCENES),
    titre: i === 0 ? 'Ouverture des portes' : i === n - 1 ? 'Tête d’affiche' : `Set ${i}`,
    artiste: pick(ARTISTES),
    dureeMin: ri(20, 90),
  }));
  const medias = Array.from({ length: ri(1, 3) }, (_, i) => ({
    type: i === 0 ? 'image' : pick(['image', 'video']),
    url: `https://picsum.photos/seed/${e.slug}-${i}/1200/630`,
    legende: i === 0 ? `Affiche officielle — ${e.nom}` : `Édition précédente (${i})`,
  }));
  const sections = [...SECTIONS].sort(() => rnd() - 0.5).slice(0, ri(1, 3)).map(([title, content]) => ({ title, content }));
  const faq = [...FAQ].sort(() => rnd() - 0.5).slice(0, ri(1, 3)).map(([question, answer]) => ({ question, answer }));
  const tags = [...TAGS].sort(() => rnd() - 0.5).slice(0, ri(1, 4));
  return {
    evenementId: e.id, organisateurId: e.organisateurId, slug: e.slug, templateId: templatePour(e),
    tags, programme, medias, sections, faq, updatedAt: new Date(e.debut.getTime() - 120 * 86_400_000),
  };
}

function avisDe(c, e) {
  // Distribution des notes centrée sur 4 (réaliste), plus sévère pour les événements annulés.
  const r = rnd();
  let note = e.statut === 'cancelled' ? (r < 0.6 ? 1 : 2) : r < 0.05 ? 1 : r < 0.12 ? 2 : r < 0.3 ? 3 : r < 0.65 ? 4 : 5;
  const createdAt = new Date(e.fin.getTime() + ri(1, 240) * 3600_000);
  const doc = {
    evenementId: c.evenementId, utilisateurId: c.utilisateurId, utilisateur: { prenom: c.prenom },
    note, titre: pick(AVIS_TITRES[note]), commentaire: pick(AVIS_TEXTES[note]), utile: ri(0, 25), createdAt,
  };
  // Les organisateurs répondent surtout aux avis négatifs.
  if (chance(note <= 2 ? 0.7 : 0.2)) {
    doc.reponseOrganisateur = { texte: pick(REPONSES), date: new Date(createdAt.getTime() + ri(2, 72) * 3600_000) };
  }
  return doc;
}

function activite(now, populaires) {
  const r = rnd();
  const type = r < 0.55 ? 'vue_evenement' : r < 0.75 ? 'recherche' : r < 0.85 ? 'connexion' : r < 0.95 ? 'achat' : 'scan_checkin';
  // Trafic décroissant avec l'ancienneté, concentré sur les 7 derniers jours.
  const jours = chance(0.5) ? rnd() * 7 : rnd() * 60;
  const ts = new Date(now - jours * 86_400_000 - ri(0, 86_399) * 1000);
  const utilisateurId = chance(0.6) ? ri(1, nbUtilisateurs) : null;
  // 20 % des événements concentrent 70 % des vues (tendances).
  const e = chance(0.7) ? pick(populaires) : pick(evenements);
  const base = { type, ts, utilisateurId, evenementId: null, payload: {} };
  switch (type) {
    case 'vue_evenement':
      return { ...base, evenementId: e.id, payload: { source: pick(SOURCES), dureeMs: ri(800, 120_000), navigateur: pick(NAVIGATEURS) } };
    case 'recherche': {
      const q = pick(RECHERCHES);
      return { ...base, payload: { q, resultats: ri(0, 40), filtres: chance(0.4) ? { ville: pick(['Paris', 'Lyon', 'Nantes']) } : {} } };
    }
    case 'connexion':
      return { ...base, utilisateurId: utilisateurId ?? ri(1, nbUtilisateurs), payload: { navigateur: pick(NAVIGATEURS), succes: chance(0.93) } };
    case 'achat':
      return { ...base, evenementId: e.id, utilisateurId: utilisateurId ?? ri(1, nbUtilisateurs), payload: { billets: ri(1, 4), montant: ri(15, 180), moyen: pick(['carte', 'virement']) } };
    default:
      return { ...base, evenementId: e.id, payload: { resultat: chance(0.9) ? 'ok' : 'doublon', appareil: pick(['scanner-1', 'scanner-2', 'mobile']), horsLigne: chance(0.15) } };
  }
}

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------
async function insertBatches(col, docs, size = 1000) {
  for (let i = 0; i < docs.length; i += size) {
    await col.insertMany(docs.slice(i, i + size), { ordered: false });
  }
}

const started = Date.now();
const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });
await client.connect();
const db = client.db();
console.log(`» seed NoSQL (SEED=${seed}) vers ${db.databaseName}`);

await applySchema(db);
for (const name of ['event_templates', 'ticket_templates', 'event_pages', 'avis', 'activites']) {
  await db.collection(name).deleteMany({});
}

const now = new Date();
await db.collection('event_templates').insertMany(DEFAULT_EVENT_TEMPLATES.map((t) => ({ ...t, updatedAt: now })));
await db.collection('ticket_templates').insertMany(DEFAULT_TICKET_TEMPLATES.map((t) => ({ ...t, updatedAt: now })));

await insertBatches(db.collection('event_pages'), evenements.map(pageDe));

const parId = new Map(evenements.map((e) => [e.id, e]));
const avis = couples.filter((c) => chance(0.6) && parId.get(c.evenementId).fin < now).map((c) => avisDe(c, parId.get(c.evenementId)));
await insertBatches(db.collection('avis'), avis);

const populaires = evenements.filter((e) => e.statut === 'published').filter((_, i) => i % 5 === 0);
const nbActivites = Math.min(nbUtilisateurs * 20, 200_000);
const activites = Array.from({ length: nbActivites }, () => activite(now.getTime(), populaires.length ? populaires : evenements));
await insertBatches(db.collection('activites'), activites, 5000);

const counts = {};
for (const name of ['event_templates', 'ticket_templates', 'event_pages', 'avis', 'activites']) {
  counts[name] = await db.collection(name).countDocuments();
}
console.table(counts);
console.log(`✓ seed NoSQL en ${((Date.now() - started) / 1000).toFixed(1)} s (types d'activité : ${ACTIVITY_TYPES.join(', ')})`);
await client.close();
