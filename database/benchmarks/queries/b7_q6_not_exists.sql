-- B7 — Q6 version NOT EXISTS : utilisateurs sans commande
-- Hash Anti Join attendu avant ET après : l'index n'est pas forcément utile
-- quand on parcourt toute la table.
SELECT count(*)
FROM utilisateurs u
WHERE NOT EXISTS (SELECT 1 FROM commandes c WHERE c.utilisateur_id = u.id);
