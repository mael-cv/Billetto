-- B9 — Q1 global : ventes de tous les événements
-- Agrégat sur toute la table : un index ne doit PAS aider (témoin).
SELECT evenement_id, billets_vendus, ca
FROM v_ventes_par_evenement
ORDER BY ca DESC
LIMIT 10;
