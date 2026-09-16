-- =============================================================================
-- 006_api_support.sql — Objets nécessaires à l'API
-- =============================================================================

-- Places restantes d'un tarif.
-- Le catalogue public doit afficher la disponibilité, mais un visiteur ne peut
-- pas compter les billets des autres (RLS sur billets / commandes). Fonction
-- SECURITY DEFINER qui ne renvoie qu'un nombre agrégé, et uniquement pour un
-- tarif que l'appelant a le droit de voir (contrôle explicite avec ses propres
-- droits via la RLS de tarifs, évalué AVANT le passage en mode propriétaire).
CREATE FUNCTION places_restantes(p_tarif_id bigint)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT greatest(t.quota - (
               SELECT count(*)
               FROM public.billets b
               JOIN public.commandes c ON c.id = b.commande_id
               WHERE b.tarif_id = t.id
                 AND c.statut IN ('paid', 'pending')
           ), 0)::integer
    FROM public.tarifs t
    WHERE t.id = p_tarif_id
$$;

REVOKE ALL ON FUNCTION places_restantes(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION places_restantes(bigint) TO billetto_visiteur, billetto_organisateur, billetto_admin;

COMMENT ON FUNCTION places_restantes(bigint) IS
    'Places restantes d''un tarif (quota - billets des commandes paid/pending). Même règle que acheter_billet. SECURITY DEFINER : agrégat seul, sans donnée personnelle.';
