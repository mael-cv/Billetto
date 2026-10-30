// N4 — Recherche plein texte dans les pages d'événement (index texte tx_contenu
// sur programme.artiste, programme.titre, sections.content, faq.question)
// puis filtre sur un tableau imbriqué avec $elemMatch.
const texte = db.event_pages
  .find({ $text: { $search: 'navettes cashless', $language: 'french' } }, { _id: 0, slug: 1, tags: 1, score: { $meta: 'textScore' } })
  .sort({ score: { $meta: 'textScore' } })
  .limit(5);
printjson(texte.toArray());

// Programmes où un set de plus de 60 minutes se joue sur la Grande scène.
const longsSets = db.event_pages
  .find(
    { programme: { $elemMatch: { scene: 'Grande scène', dureeMin: { $gt: 60 } } } },
    { _id: 0, slug: 1, 'programme.$': 1 },
  )
  .limit(5);
printjson(longsSets.toArray());

// Nombre de pages par template (répartition éditoriale) et par tag ($unwind).
printjson(db.event_pages.aggregate([{ $group: { _id: '$templateId', pages: { $sum: 1 } } }, { $sort: { pages: -1 } }]).toArray());
printjson(
  db.event_pages
    .aggregate([{ $unwind: '$tags' }, { $group: { _id: '$tags', pages: { $sum: 1 } } }, { $sort: { pages: -1 } }, { $limit: 5 }])
    .toArray(),
);
