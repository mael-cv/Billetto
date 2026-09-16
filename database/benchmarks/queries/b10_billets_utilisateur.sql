-- B10 — Billets d'un utilisateur (« Mes billets », corps de billets_utilisateur())
-- Index visé : idx_billets_utilisateur_id (ajouté en 004)
SELECT b.id, b.code, e.nom, e.debut, t.nom AS tarif, b.prix_paye, c.statut
FROM billets b
JOIN commandes c  ON c.id = b.commande_id
JOIN tarifs t     ON t.id = b.tarif_id
JOIN evenements e ON e.id = t.evenement_id
WHERE b.utilisateur_id = 4242
ORDER BY e.debut DESC;
