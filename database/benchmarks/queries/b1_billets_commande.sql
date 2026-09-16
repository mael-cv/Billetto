-- B1 — Billets d'une commande (page « détail commande »)
-- Index visé : idx_billets_commande_id
SELECT b.id, b.code, b.prix_paye, b.tarif_id
FROM billets b
WHERE b.commande_id = 123456;
