-- B8 — Q6 version sous-requête corrélée COUNT(*) = 0, sur 200 utilisateurs
-- Sans index : un parcours de commandes (900 000 lignes) par utilisateur.
SELECT count(*)
FROM utilisateurs u
WHERE u.id BETWEEN 90001 AND 90200
  AND (SELECT count(*) FROM commandes c WHERE c.utilisateur_id = u.id) = 0;
