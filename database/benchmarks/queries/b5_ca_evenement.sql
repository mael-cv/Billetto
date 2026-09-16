-- B5 — Ventes et CA d'un événement (futur ca_evenement)
-- Index visé : idx_billets_tarif_id (tarifs.evenement_id est déjà couvert
-- par l'index unique uq_tarifs_evenement_id_nom, colonne de tête)
SELECT count(*) AS billets, coalesce(sum(b.prix_paye), 0) AS ca
FROM tarifs t
JOIN billets b   ON b.tarif_id = t.id
JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
WHERE t.evenement_id = 42;
