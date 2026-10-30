// N2 — Note moyenne, nombre d'avis et distribution 1..5 par événement
// (équivalent d'un GROUP BY + FILTER en SQL), limité aux événements ayant
// au moins 5 avis (équivalent HAVING) — c'est le bloc `stats` de GET /events/:ref/avis.
const stats = db.avis.aggregate([
  {
    $group: {
      _id: '$evenementId',
      nbAvis: { $sum: 1 },
      moyenne: { $avg: '$note' },
      distribution: { $push: '$note' },
      avecReponse: { $sum: { $cond: [{ $ifNull: ['$reponseOrganisateur', false] }, 1, 0] } },
    },
  },
  { $match: { nbAvis: { $gte: 5 } } },
  {
    $project: {
      _id: 0,
      evenementId: '$_id',
      nbAvis: 1,
      moyenne: { $round: ['$moyenne', 2] },
      tauxReponse: { $round: [{ $divide: ['$avecReponse', '$nbAvis'] }, 2] },
      distribution: {
        $arrayToObject: {
          $map: {
            input: [1, 2, 3, 4, 5],
            as: 'n',
            in: {
              k: { $toString: '$$n' },
              v: { $size: { $filter: { input: '$distribution', as: 'x', cond: { $eq: ['$$x', '$$n'] } } } },
            },
          },
        },
      },
    },
  },
  { $sort: { moyenne: -1, nbAvis: -1 } },
  { $limit: 10 },
]);

printjson(stats.toArray());
