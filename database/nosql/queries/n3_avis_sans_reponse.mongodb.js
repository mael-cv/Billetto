// N3 — File de modération : avis négatifs (note ≤ 2) SANS réponse de l'organisateur,
// les plus utiles d'abord. Opérateurs $lte / $exists sur un champ imbriqué
// (reponseOrganisateur.date) ; projection partielle ; l'index partiel ix_negatifs (note ≤ 2)
// est éligible car le filtre contient la condition de l'index.
const file = db.avis
  .find(
    { note: { $lte: 2 }, 'reponseOrganisateur.date': { $exists: false } },
    { _id: 0, evenementId: 1, 'utilisateur.prenom': 1, note: 1, titre: 1, commentaire: 1, utile: 1, createdAt: 1 },
  )
  .sort({ utile: -1, createdAt: -1 })
  .limit(10);

printjson(file.toArray());

// Variante : mise à jour d'un champ imbriqué (réponse de l'organisateur) sur le premier avis trouvé.
const premier = db.avis.findOne({ note: { $lte: 2 }, reponseOrganisateur: { $exists: false } });
if (premier) {
  const r = db.avis.updateOne(
    { _id: premier._id, reponseOrganisateur: { $exists: false } },
    { $set: { reponseOrganisateur: { texte: 'Merci, nous vous recontactons.', date: new Date() }, updatedAt: new Date() } },
  );
  print(`réponse ajoutée : matched=${r.matchedCount} modified=${r.modifiedCount}`);
  // On remet l'avis dans son état initial pour garder le jeu de démonstration stable.
  db.avis.updateOne({ _id: premier._id }, { $unset: { reponseOrganisateur: '', updatedAt: '' } });
}
