-- B6 — Vue v_ventes_par_evenement filtrée sur un événement
-- Le filtre est-il poussé à l'intérieur du CTE de la vue ?
SELECT evenement_id, nom, billets_vendus, ca
FROM v_ventes_par_evenement
WHERE evenement_id = 42;
