-- =============================================================================
-- 012_dashboard_live.sql — Phase 14 : dashboard temps réel par collectif
--
-- Les vues d'analyse gagnent deux mesures « en cours », ajoutées EN FIN DE
-- LISTE (seule évolution permise par CREATE OR REPLACE VIEW, voir 002) :
--   billets_reserves      holds actifs non expirés (reservations, phase 10),
--                         y compris les offres de liste d'attente ; même règle
--                         que places_occupees (expire_a > now(), lazy) ;
--   places_liste_attente  places demandées par les inscrits encore en_attente
--                         (une offre notifiee est déjà comptée en réservé).
--
-- Isolation multi-tenant (phase 09) : les vues restent security_invoker, la
-- RLS de l'appelant s'applique à evenements, billets, reservations et
-- liste_attente. Un organisateur ne voit que son collectif.
-- =============================================================================

-- WITH (security_invoker) est répété : CREATE OR REPLACE VIEW réinitialise
-- les options de la vue.
CREATE OR REPLACE VIEW v_ventes_par_evenement WITH (security_invoker = true) AS
WITH ventes AS (
    SELECT t.evenement_id,
           count(*)         AS billets_vendus,
           sum(b.prix_paye) AS ca
    FROM billets b
    JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
    JOIN tarifs t    ON t.id = b.tarif_id
    GROUP BY t.evenement_id
),
reserves AS (
    SELECT t.evenement_id, sum(r.quantite) AS billets_reserves
    FROM reservations r
    JOIN tarifs t ON t.id = r.tarif_id
    WHERE r.statut = 'active' AND r.expire_a > now()
    GROUP BY t.evenement_id
),
attente AS (
    SELECT t.evenement_id, sum(la.quantite_souhaitee) AS places_liste_attente
    FROM liste_attente la
    JOIN tarifs t ON t.id = la.tarif_id
    WHERE la.statut = 'en_attente'
    GROUP BY t.evenement_id
)
SELECT e.id                          AS evenement_id,
       e.nom,
       e.slug,
       e.statut,
       e.debut,
       e.organisateur_id,
       e.lieu_id,
       e.type_evenement_id,
       coalesce(v.billets_vendus, 0) AS billets_vendus,
       coalesce(v.ca, 0)::numeric(14,2) AS ca,
       coalesce(r.billets_reserves, 0)::bigint     AS billets_reserves,
       coalesce(a.places_liste_attente, 0)::bigint AS places_liste_attente
FROM evenements e
LEFT JOIN ventes v   ON v.evenement_id = e.id
LEFT JOIN reserves r ON r.evenement_id = e.id
LEFT JOIN attente a  ON a.evenement_id = e.id;

COMMENT ON VIEW v_ventes_par_evenement IS
    'Billets vendus (commandes paid), CA, billets réservés (holds actifs non expirés) et places en liste d''attente '
    'par événement ; événements sans vente inclus. Source de v_remplissage et v_classement_lieux. security_invoker.';

CREATE OR REPLACE VIEW v_remplissage WITH (security_invoker = true) AS
WITH places AS (
    SELECT evenement_id, sum(quota) AS places
    FROM tarifs
    WHERE actif
    GROUP BY evenement_id
)
SELECT v.evenement_id,
       v.nom,
       v.statut,
       v.debut,
       v.organisateur_id,
       coalesce(p.places, 0)  AS places,
       v.billets_vendus,
       round(v.billets_vendus::numeric / nullif(p.places, 0), 4) AS taux_remplissage,
       v.billets_reserves,
       v.places_liste_attente,
       round((v.billets_vendus + v.billets_reserves)::numeric / nullif(p.places, 0), 4) AS taux_occupation
FROM v_ventes_par_evenement v
LEFT JOIN places p ON p.evenement_id = v.evenement_id;

COMMENT ON VIEW v_remplissage IS
    'Taux de remplissage = vendus / somme des quotas des tarifs actifs ; taux d''occupation = (vendus + réservés) / '
    'places. Places en liste d''attente en sus. NULL si aucune place. security_invoker.';
