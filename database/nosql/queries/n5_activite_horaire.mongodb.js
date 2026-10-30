// N5 — Série temporelle : activité par jour et par type sur 14 jours ($dateTrunc),
// puis taux d'échec des scans ($facet pour deux agrégations en une passe).
// C'est la requête du tableau de bord organisateur (GET /organizer/events/:id/activite).
const depuis = new Date(Date.now() - 14 * 24 * 3600 * 1000);

const serie = db.activites.aggregate([
  { $match: { ts: { $gte: depuis } } },
  {
    $group: {
      _id: { jour: { $dateTrunc: { date: '$ts', unit: 'day' } }, type: '$type' },
      n: { $sum: 1 },
    },
  },
  { $group: { _id: '$_id.jour', parType: { $push: { k: '$_id.type', v: '$n' } }, total: { $sum: '$n' } } },
  { $project: { _id: 0, jour: '$_id', total: 1, parType: { $arrayToObject: '$parType' } } },
  { $sort: { jour: 1 } },
]);
printjson(serie.toArray());

const scans = db.activites.aggregate([
  { $match: { type: 'scan_checkin' } },
  {
    $facet: {
      parResultat: [{ $group: { _id: '$payload.resultat', n: { $sum: 1 } } }],
      parAppareil: [{ $group: { _id: '$payload.appareil', n: { $sum: 1 }, horsLigne: { $sum: { $cond: ['$payload.horsLigne', 1, 0] } } } }],
    },
  },
]);
printjson(scans.toArray());

// Rétention : l'index TTL purge automatiquement les activités de plus de 90 jours.
printjson(db.activites.getIndexes().filter((i) => i.expireAfterSeconds !== undefined));
