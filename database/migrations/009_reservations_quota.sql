-- =============================================================================
-- 009_reservations_quota.sql — Phase 10 (suite) : quota unifié achat / hold
--
-- 008 a étendu le calcul de quota de creer_reservation aux réservations
-- actives, mais acheter_billet (005) et places_restantes (006) comptaient
-- encore uniquement les billets : un achat direct pouvait consommer des
-- places déjà réservées (survente). Les trois chemins partagent désormais
-- places_occupees(), toujours évaluée après le verrou FOR UPDATE sur tarifs.
--
-- Revient aussi sur la déviation de 008 : ck_commandes_statut accepte
-- 'en_attente_virement' (demandé par la checklist Phase 10). L'état de
-- référence du virement reste reservations.statut.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Places occupées d'un tarif (billets paid/pending + holds actifs non expirés)
-- -----------------------------------------------------------------------------
-- Expiration LAZY : expire_a > now() est la seule garantie anti-survente,
-- reservations.statut = 'expiree' (job de purge) n'est que du reporting.
-- Appelée uniquement depuis des fonctions SECURITY DEFINER : pas de GRANT.
CREATE FUNCTION places_occupees(p_tarif_id bigint)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        (SELECT count(*)
         FROM public.billets b
         JOIN public.commandes c ON c.id = b.commande_id
         WHERE b.tarif_id = p_tarif_id AND c.statut IN ('paid', 'pending'))
        + (SELECT coalesce(sum(r.quantite), 0)
           FROM public.reservations r
           WHERE r.tarif_id = p_tarif_id AND r.statut = 'active' AND r.expire_a > now())
$$;

COMMENT ON FUNCTION places_occupees(bigint) IS
    'Billets paid/pending + réservations actives non expirées (expire_a > now()). Règle de quota unique de '
    'acheter_billet, creer_reservation et places_restantes.';

-- -----------------------------------------------------------------------------
-- 2. acheter_billet : identique à 005, quota via places_occupees()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acheter_billet(
    p_utilisateur_id bigint,
    p_tarif_id       bigint,
    p_quantite       integer DEFAULT 1
)
RETURNS TABLE (
    commande_id    bigint,
    paiement_id    bigint,
    billet_ids     bigint[],
    montant_total  numeric(12,2)
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_tarif     public.tarifs%ROWTYPE;
    v_evenement public.evenements%ROWTYPE;
    v_vendus    bigint;
    v_montant   numeric(12,2);
    v_commande  bigint;
    v_paiement  bigint;
    v_billets   bigint[];
BEGIN
    -- Phase 05 : on n'achète que pour soi.
    PERFORM public.controler_acteur(p_utilisateur_id);

    IF p_quantite IS NULL OR p_quantite < 1 OR p_quantite > 10 THEN
        RAISE EXCEPTION 'quantité invalide : % (1 à 10)', p_quantite
            USING ERRCODE = 'BT007';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.utilisateurs u WHERE u.id = p_utilisateur_id) THEN
        RAISE EXCEPTION 'utilisateur % introuvable', p_utilisateur_id
            USING ERRCODE = 'BT008';
    END IF;

    SELECT * INTO v_tarif
    FROM public.tarifs t
    WHERE t.id = p_tarif_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'tarif % introuvable', p_tarif_id USING ERRCODE = 'BT001';
    END IF;
    IF NOT v_tarif.actif THEN
        RAISE EXCEPTION 'tarif % inactif', p_tarif_id USING ERRCODE = 'BT002';
    END IF;

    SELECT * INTO v_evenement FROM public.evenements e WHERE e.id = v_tarif.evenement_id;

    IF v_evenement.statut <> 'published' THEN
        RAISE EXCEPTION 'événement % non publié (statut %)', v_evenement.id, v_evenement.statut
            USING ERRCODE = 'BT003';
    END IF;
    IF now() >= v_evenement.debut THEN
        RAISE EXCEPTION 'événement % déjà commencé', v_evenement.id USING ERRCODE = 'BT005';
    END IF;
    IF now() < v_tarif.date_debut_vente OR now() >= v_tarif.date_fin_vente THEN
        RAISE EXCEPTION 'vente fermée pour le tarif % (du % au %)',
            p_tarif_id, v_tarif.date_debut_vente, v_tarif.date_fin_vente
            USING ERRCODE = 'BT004';
    END IF;

    -- Inclut les holds actifs (phase 10) : un achat direct ne peut pas
    -- consommer des places réservées.
    v_vendus := public.places_occupees(p_tarif_id);

    IF v_vendus + p_quantite > v_tarif.quota THEN
        RAISE EXCEPTION 'quota épuisé pour le tarif % : % restant(s), % demandé(s)',
            p_tarif_id, greatest(v_tarif.quota - v_vendus, 0), p_quantite
            USING ERRCODE = 'BT006';
    END IF;

    v_montant := v_tarif.prix * p_quantite;

    INSERT INTO public.commandes (utilisateur_id, statut, montant_total)
    VALUES (p_utilisateur_id, 'paid', v_montant)
    RETURNING id INTO v_commande;

    INSERT INTO public.paiements (commande_id, reference, type, montant, statut)
    VALUES (v_commande, 'PAY-' || gen_random_uuid(), 'charge', v_montant, 'succeeded')
    RETURNING id INTO v_paiement;

    WITH nouveaux AS (
        INSERT INTO public.billets (tarif_id, commande_id, utilisateur_id, prix_paye)
        SELECT p_tarif_id, v_commande, p_utilisateur_id, v_tarif.prix
        FROM generate_series(1, p_quantite)
        RETURNING id
    )
    SELECT array_agg(id ORDER BY id) INTO v_billets FROM nouveaux;

    RETURN QUERY SELECT v_commande, v_paiement, v_billets, v_montant;
END;
$$;

COMMENT ON FUNCTION acheter_billet(bigint, bigint, integer) IS
    'Achat atomique pour l''utilisateur courant : contrôle d''identité (BT013), tarif, événement, période de vente et quota (verrou FOR UPDATE), crée commande + paiement + billets. SECURITY DEFINER.';

-- -----------------------------------------------------------------------------
-- 3. places_restantes : même règle que le quota
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION places_restantes(p_tarif_id bigint)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT greatest(t.quota - public.places_occupees(t.id), 0)::integer
    FROM public.tarifs t
    WHERE t.id = p_tarif_id
$$;

COMMENT ON FUNCTION places_restantes(bigint) IS
    'Places restantes d''un tarif (quota - places_occupees : billets paid/pending + holds actifs). Même règle que '
    'acheter_billet et creer_reservation. SECURITY DEFINER : agrégat seul, sans donnée personnelle.';

-- -----------------------------------------------------------------------------
-- 4. Statut de commande en_attente_virement
-- -----------------------------------------------------------------------------
ALTER TABLE commandes DROP CONSTRAINT ck_commandes_statut;
ALTER TABLE commandes ADD CONSTRAINT ck_commandes_statut
    CHECK (statut IN ('pending', 'en_attente_virement', 'paid', 'cancelled', 'refunded'));

REVOKE ALL ON FUNCTION places_occupees(bigint) FROM PUBLIC;
