-- B2 — Commandes d'un utilisateur, plus récentes d'abord (« Mes commandes »)
-- Index visé : idx_commandes_utilisateur_id
SELECT c.id, c.statut, c.montant_total, c.created_at
FROM commandes c
WHERE c.utilisateur_id = 4242
ORDER BY c.created_at DESC
LIMIT 20;
