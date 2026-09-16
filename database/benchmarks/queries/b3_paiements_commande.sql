-- B3 — Paiements d'une commande
-- Index visé : idx_paiements_commande_id
SELECT p.reference, p.type, p.montant, p.statut
FROM paiements p
WHERE p.commande_id = 123456;
