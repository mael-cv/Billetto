// N1 — Événements « tendance » sur 7 jours (pipeline d'agrégation).
// Intention : classer les événements par un score pondéré des activités récentes
// (une vue = 1, un achat = 5, un scan = 2). C'est la requête de l'endpoint
// GET /events/tendances, qui croise ensuite ce classement avec PostgreSQL.
const depuis = new Date(Date.now() - 7 * 24 * 3600 * 1000);

const tendances = db.activites.aggregate([
  { $match: { ts: { $gte: depuis }, evenementId: { $ne: null } } },
  {
    $group: {
      _id: '$evenementId',
      vues: { $sum: { $cond: [{ $eq: ['$type', 'vue_evenement'] }, 1, 0] } },
      achats: { $sum: { $cond: [{ $eq: ['$type', 'achat'] }, 1, 0] } },
      scans: { $sum: { $cond: [{ $eq: ['$type', 'scan_checkin'] }, 1, 0] } },
      visiteurs: { $addToSet: '$utilisateurId' },
      derniere: { $max: '$ts' },
    },
  },
  {
    $project: {
      _id: 0,
      evenementId: '$_id',
      vues: 1,
      achats: 1,
      scans: 1,
      visiteursDistincts: { $size: { $setDifference: ['$visiteurs', [null]] } },
      score: { $add: ['$vues', { $multiply: ['$achats', 5] }, { $multiply: ['$scans', 2] }] },
      derniere: 1,
    },
  },
  { $sort: { score: -1, derniere: -1 } },
  { $limit: 8 },
]);

printjson(tendances.toArray());
