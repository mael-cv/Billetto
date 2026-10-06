-- =============================================================================
-- 010_liste_attente.sql — Phase 12 : liste d'attente
--
-- Un tarif complet accepte des inscriptions. Quand une place se libère, la
-- tête de file (FIFO strict par created_at) reçoit une OFFRE : une ligne
-- reservations à son nom (mode 'carte', TTL d'offre 30 min par défaut).
-- Réutiliser reservations donne gratuitement :
--   - le blocage de la place dans places_occupees() (aucune fuite vers
--     acheter_billet / creer_reservation pendant l'offre) ;
--   - l'expiration lazy (expire_a > now()) : une non-réponse libère la place ;
--   - la confirmation via confirmer_reservation (prix figé, mêmes inserts).
--
-- Déclencheur canonique unique : traiter_liste_attente(tarif). Idempotente
-- (tout est recalculé depuis places_occupees sous le verrou FOR UPDATE de
-- tarifs), donc l'appeler plusieurs fois ne crée jamais deux offres pour une
-- même place. Elle est appelée :
--   - par trigger quand une commande passe à refunded/cancelled ;
--   - par trigger quand une réservation passe à annulee/expiree ;
--   - par traiter_listes_attente() (balayage), appelé périodiquement par le
--     job API après la purge : rattrape les expirations lazy, qui ne
--     produisent aucun événement. Aucun oubli possible, aucun doublon.
--
-- Règle de 007_multi_tenant.sql : RLS posée dans cette même migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
CREATE TABLE liste_attente (
    id                  bigint GENERATED ALWAYS AS IDENTITY,
    tarif_id            bigint      NOT NULL,
    utilisateur_id      bigint      NOT NULL,
    quantite_souhaitee  integer     NOT NULL,
    statut              text        NOT NULL DEFAULT 'en_attente',
    -- Offre en cours (statut 'notifiee') : réservation qui bloque la place.
    reservation_id      bigint,
    notifie_a           timestamptz,
    expire_a            timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_liste_attente PRIMARY KEY (id),
    CONSTRAINT fk_liste_attente_tarif_id FOREIGN KEY (tarif_id)
        REFERENCES tarifs (id) ON DELETE RESTRICT,
    CONSTRAINT fk_liste_attente_utilisateur_id FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    CONSTRAINT fk_liste_attente_reservation_id FOREIGN KEY (reservation_id)
        REFERENCES reservations (id) ON DELETE RESTRICT,
    CONSTRAINT ck_liste_attente_statut
        CHECK (statut IN ('en_attente', 'notifiee', 'confirmee', 'expiree', 'annulee')),
    CONSTRAINT ck_liste_attente_quantite CHECK (quantite_souhaitee > 0 AND quantite_souhaitee <= 10),
    CONSTRAINT ck_liste_attente_offre
        CHECK (statut <> 'notifiee' OR (reservation_id IS NOT NULL AND notifie_a IS NOT NULL AND expire_a IS NOT NULL))
);

-- Une seule inscription vivante par utilisateur et par tarif.
CREATE UNIQUE INDEX uq_liste_attente_inscription_active
    ON liste_attente (tarif_id, utilisateur_id) WHERE statut IN ('en_attente', 'notifiee');
-- Tête de file FIFO.
CREATE INDEX ix_liste_attente_fifo ON liste_attente (tarif_id, created_at, id) WHERE statut = 'en_attente';
CREATE INDEX ix_liste_attente_utilisateur_id ON liste_attente (utilisateur_id);

CREATE TRIGGER trg_liste_attente_updated_at BEFORE UPDATE ON liste_attente
    FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION trg_set_updated_at_fn();

COMMENT ON TABLE liste_attente IS
    'Liste d''attente par tarif, FIFO strict par created_at. Une offre (statut notifiee) est une réservation '
    'à TTL court : elle bloque la place via places_occupees et expire de façon lazy.';

-- -----------------------------------------------------------------------------
-- 2. Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE liste_attente ENABLE ROW LEVEL SECURITY;
ALTER TABLE liste_attente FORCE ROW LEVEL SECURITY;

CREATE POLICY p_liste_attente_visiteur_select ON liste_attente
    FOR SELECT TO billetto_visiteur
    USING (utilisateur_id = (SELECT app_user_id()));

CREATE POLICY p_liste_attente_organisateur_select ON liste_attente
    FOR SELECT TO billetto_organisateur
    USING (tarif_id = ANY (ARRAY(SELECT t.id FROM tarifs t)));

CREATE POLICY p_liste_attente_admin_select ON liste_attente
    FOR SELECT TO billetto_admin USING (true);

CREATE POLICY p_liste_attente_readonly_select ON liste_attente
    FOR SELECT TO billetto_readonly USING (true);

-- Lecture seule : écriture uniquement via les fonctions SECURITY DEFINER.
GRANT SELECT ON liste_attente TO billetto_visiteur, billetto_organisateur, billetto_admin, billetto_readonly;

-- -----------------------------------------------------------------------------
-- 3. notifier_prochain_en_attente : une offre pour la tête de file, si elle rentre
-- -----------------------------------------------------------------------------
CREATE FUNCTION notifier_prochain_en_attente(
    p_tarif_id     bigint,
    -- Réservé aux tests (comme p_ttl_override de creer_reservation).
    p_ttl_override interval DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tarif       public.tarifs%ROWTYPE;
    v_evenement   public.evenements%ROWTYPE;
    v_entree      public.liste_attente%ROWTYPE;
    v_reservation bigint;
    v_expire      timestamptz;
BEGIN
    -- Même verrou que les achats et les holds : la place libre calculée
    -- ci-dessous ne peut pas être prise entre le calcul et l'offre.
    SELECT * INTO v_tarif FROM public.tarifs t WHERE t.id = p_tarif_id FOR UPDATE;
    IF NOT FOUND OR NOT v_tarif.actif THEN
        RETURN NULL;
    END IF;

    -- Vente impossible : pas d'offre (elle ne pourrait pas être confirmée utilement).
    SELECT * INTO v_evenement FROM public.evenements e WHERE e.id = v_tarif.evenement_id;
    IF v_evenement.statut <> 'published' OR now() >= v_evenement.debut
       OR now() < v_tarif.date_debut_vente OR now() >= v_tarif.date_fin_vente THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_entree
    FROM public.liste_attente la
    WHERE la.tarif_id = p_tarif_id AND la.statut = 'en_attente'
    ORDER BY la.created_at, la.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- FIFO strict : si la tête ne rentre pas, on n'avance pas au suivant.
    IF v_tarif.quota - public.places_occupees(p_tarif_id) < v_entree.quantite_souhaitee THEN
        RETURN NULL;
    END IF;

    v_expire := now() + coalesce(p_ttl_override, interval '30 minutes');

    INSERT INTO public.reservations (tarif_id, utilisateur_id, quantite, statut, mode_paiement, prix_unitaire, expire_a)
    VALUES (p_tarif_id, v_entree.utilisateur_id, v_entree.quantite_souhaitee, 'active', 'carte', v_tarif.prix, v_expire)
    RETURNING id INTO v_reservation;

    UPDATE public.liste_attente
    SET statut = 'notifiee', reservation_id = v_reservation, notifie_a = now(), expire_a = v_expire
    WHERE id = v_entree.id;

    RETURN v_entree.id;
END;
$$;

COMMENT ON FUNCTION notifier_prochain_en_attente(bigint, interval) IS
    'Offre la place à la tête de file (FIFO strict, FOR UPDATE SKIP LOCKED) si elle rentre dans le quota '
    'libre : crée une réservation à TTL court (30 min par défaut). Renvoie l''id notifié ou NULL. '
    'Ne pas appeler directement : passer par traiter_liste_attente.';

-- -----------------------------------------------------------------------------
-- 4. traiter_liste_attente : déclencheur canonique unique (idempotent)
-- -----------------------------------------------------------------------------
CREATE FUNCTION traiter_liste_attente(
    p_tarif_id     bigint,
    p_ttl_override interval DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_notifies integer := 0;
BEGIN
    -- Verrou d'abord : deux appels concurrents pour ce tarif sont sérialisés.
    PERFORM 1 FROM public.tarifs t WHERE t.id = p_tarif_id FOR UPDATE;

    -- Offres terminées : confirmées, ou perdues (expiration lazy ou annulation).
    UPDATE public.liste_attente la
    SET statut = CASE WHEN r.statut = 'confirmee' THEN 'confirmee' ELSE 'expiree' END
    FROM public.reservations r
    WHERE r.id = la.reservation_id
      AND la.tarif_id = p_tarif_id
      AND la.statut = 'notifiee'
      AND (r.statut <> 'active' OR r.expire_a <= now());

    WHILE public.notifier_prochain_en_attente(p_tarif_id, p_ttl_override) IS NOT NULL LOOP
        v_notifies := v_notifies + 1;
    END LOOP;

    RETURN v_notifies;
END;
$$;

COMMENT ON FUNCTION traiter_liste_attente(bigint, interval) IS
    'Déclencheur canonique unique de libération de place : clôt les offres terminées puis notifie la file '
    'tant que la tête rentre. Idempotent (recalcul depuis places_occupees sous verrou FOR UPDATE).';

CREATE FUNCTION traiter_listes_attente()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tarif    bigint;
    v_notifies integer := 0;
BEGIN
    FOR v_tarif IN
        SELECT DISTINCT la.tarif_id FROM public.liste_attente la
        WHERE la.statut IN ('en_attente', 'notifiee')
        ORDER BY 1
    LOOP
        v_notifies := v_notifies + public.traiter_liste_attente(v_tarif);
    END LOOP;
    RETURN v_notifies;
END;
$$;

COMMENT ON FUNCTION traiter_listes_attente() IS
    'Balayage de toutes les files non vides (rattrape les expirations lazy). Appelé périodiquement par le job API.';

-- -----------------------------------------------------------------------------
-- 5. Triggers de libération de place → traiter_liste_attente
-- -----------------------------------------------------------------------------
CREATE FUNCTION trg_commandes_liberation_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tarif bigint;
BEGIN
    FOR v_tarif IN SELECT DISTINCT b.tarif_id FROM public.billets b WHERE b.commande_id = NEW.id ORDER BY 1 LOOP
        PERFORM public.traiter_liste_attente(v_tarif);
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_commandes_liberation
    AFTER UPDATE OF statut ON commandes
    FOR EACH ROW
    WHEN (NEW.statut IN ('refunded', 'cancelled') AND OLD.statut IN ('paid', 'pending'))
    EXECUTE FUNCTION trg_commandes_liberation_fn();

COMMENT ON TRIGGER trg_commandes_liberation ON commandes IS
    'Désistement (remboursement / annulation) : libère des places, passe la main à traiter_liste_attente.';

CREATE FUNCTION trg_reservations_liberation_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.traiter_liste_attente(NEW.tarif_id);
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_reservations_liberation
    AFTER UPDATE OF statut ON reservations
    FOR EACH ROW
    WHEN (NEW.statut IN ('annulee', 'expiree') AND OLD.statut = 'active')
    EXECUTE FUNCTION trg_reservations_liberation_fn();

COMMENT ON TRIGGER trg_reservations_liberation ON reservations IS
    'Hold annulé ou marqué expiré : passe la main à traiter_liste_attente.';

-- -----------------------------------------------------------------------------
-- 6. Fonctions utilisateur
-- -----------------------------------------------------------------------------
CREATE FUNCTION inscrire_liste_attente(
    p_utilisateur_id bigint,
    p_tarif_id       bigint,
    p_quantite       integer DEFAULT 1
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tarif     public.tarifs%ROWTYPE;
    v_evenement public.evenements%ROWTYPE;
    v_entree    bigint;
BEGIN
    PERFORM public.controler_acteur(p_utilisateur_id);

    IF p_quantite IS NULL OR p_quantite < 1 OR p_quantite > 10 THEN
        RAISE EXCEPTION 'quantité invalide : % (1 à 10)', p_quantite USING ERRCODE = 'BT007';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.utilisateurs u WHERE u.id = p_utilisateur_id) THEN
        RAISE EXCEPTION 'utilisateur % introuvable', p_utilisateur_id USING ERRCODE = 'BT008';
    END IF;

    SELECT * INTO v_tarif FROM public.tarifs t WHERE t.id = p_tarif_id FOR UPDATE;

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

    -- Places libres et personne devant : l'achat direct suffit.
    IF v_tarif.quota - public.places_occupees(p_tarif_id) >= p_quantite
       AND NOT EXISTS (SELECT 1 FROM public.liste_attente la
                       WHERE la.tarif_id = p_tarif_id AND la.statut = 'en_attente') THEN
        RAISE EXCEPTION 'places disponibles pour le tarif % : achetez directement', p_tarif_id
            USING ERRCODE = 'BT040';
    END IF;

    IF EXISTS (SELECT 1 FROM public.liste_attente la
               WHERE la.tarif_id = p_tarif_id AND la.utilisateur_id = p_utilisateur_id
                 AND la.statut IN ('en_attente', 'notifiee')) THEN
        RAISE EXCEPTION 'déjà inscrit en liste d''attente pour le tarif %', p_tarif_id
            USING ERRCODE = 'BT042';
    END IF;

    INSERT INTO public.liste_attente (tarif_id, utilisateur_id, quantite_souhaitee)
    VALUES (p_tarif_id, p_utilisateur_id, p_quantite)
    RETURNING id INTO v_entree;

    -- Une place peut être libre derrière une tête trop grosse : rien ne
    -- change pour l'ordre, mais on reste cohérent avec la règle canonique.
    PERFORM public.traiter_liste_attente(p_tarif_id);

    RETURN v_entree;
END;
$$;

COMMENT ON FUNCTION inscrire_liste_attente(bigint, bigint, integer) IS
    'Inscription en liste d''attente (contrôles tarif/événement/période, BT040 si places libres sans file, '
    'BT042 si déjà inscrit). SECURITY DEFINER.';

CREATE FUNCTION confirmer_liste_attente(
    p_entree_id      bigint,
    p_utilisateur_id bigint
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
    v_entree public.liste_attente%ROWTYPE;
    v_expire timestamptz;
BEGIN
    PERFORM public.controler_acteur(p_utilisateur_id);

    SELECT * INTO v_entree FROM public.liste_attente la WHERE la.id = p_entree_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'inscription % introuvable', p_entree_id USING ERRCODE = 'BT041';
    END IF;
    IF v_entree.utilisateur_id IS DISTINCT FROM p_utilisateur_id THEN
        RAISE EXCEPTION 'action interdite pour l''inscription d''un autre utilisateur' USING ERRCODE = 'BT013';
    END IF;

    SELECT r.expire_a INTO v_expire FROM public.reservations r
    WHERE r.id = v_entree.reservation_id AND r.statut = 'active';

    IF v_entree.statut <> 'notifiee' OR v_expire IS NULL OR v_expire <= now() THEN
        RAISE EXCEPTION 'aucune offre active pour l''inscription % (statut %)', p_entree_id, v_entree.statut
            USING ERRCODE = 'BT043';
    END IF;

    RETURN QUERY SELECT * FROM public.confirmer_reservation(v_entree.reservation_id, p_utilisateur_id);

    UPDATE public.liste_attente SET statut = 'confirmee' WHERE id = p_entree_id;
END;
$$;

COMMENT ON FUNCTION confirmer_liste_attente(bigint, bigint) IS
    'Accepte une offre de liste d''attente : confirmer_reservation sur la réservation de l''offre. '
    'BT041/BT013/BT043. SECURITY DEFINER.';

CREATE FUNCTION annuler_liste_attente(
    p_entree_id      bigint,
    p_utilisateur_id bigint
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entree public.liste_attente%ROWTYPE;
BEGIN
    PERFORM public.controler_acteur(p_utilisateur_id);

    SELECT * INTO v_entree FROM public.liste_attente la WHERE la.id = p_entree_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'inscription % introuvable', p_entree_id USING ERRCODE = 'BT041';
    END IF;
    IF v_entree.utilisateur_id IS DISTINCT FROM p_utilisateur_id THEN
        RAISE EXCEPTION 'action interdite pour l''inscription d''un autre utilisateur' USING ERRCODE = 'BT013';
    END IF;
    IF v_entree.statut NOT IN ('en_attente', 'notifiee') THEN
        RAISE EXCEPTION 'inscription % déjà close (statut %)', p_entree_id, v_entree.statut
            USING ERRCODE = 'BT043';
    END IF;

    -- L'entrée d'abord, puis la réservation : le trigger de libération voit
    -- alors une file à jour et offre la place au suivant.
    UPDATE public.liste_attente SET statut = 'annulee' WHERE id = p_entree_id;

    IF v_entree.statut = 'notifiee' THEN
        UPDATE public.reservations SET statut = 'annulee'
        WHERE id = v_entree.reservation_id AND statut = 'active';
    END IF;
END;
$$;

COMMENT ON FUNCTION annuler_liste_attente(bigint, bigint) IS
    'Désinscription ; une offre en cours est rendue (réservation annulee → trigger → suivant). SECURITY DEFINER.';

-- Position dans la file (1 = tête). Agrégat seul : un visiteur ne voit pas
-- les inscriptions des autres (RLS).
CREATE FUNCTION position_liste_attente(p_entree_id bigint)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT (SELECT count(*) FROM public.liste_attente a
            WHERE a.tarif_id = la.tarif_id AND a.statut = 'en_attente'
              AND (a.created_at, a.id) <= (la.created_at, la.id))::integer
    FROM public.liste_attente la
    WHERE la.id = p_entree_id AND la.statut = 'en_attente'
$$;

COMMENT ON FUNCTION position_liste_attente(bigint) IS
    'Rang FIFO d''une inscription en_attente (NULL sinon). SECURITY DEFINER : agrégat seul.';

-- -----------------------------------------------------------------------------
-- 7. Privilèges d'exécution
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION inscrire_liste_attente(bigint, bigint, integer)
    TO billetto_visiteur, billetto_organisateur, billetto_admin;
GRANT EXECUTE ON FUNCTION confirmer_liste_attente(bigint, bigint)
    TO billetto_visiteur, billetto_organisateur, billetto_admin;
GRANT EXECUTE ON FUNCTION annuler_liste_attente(bigint, bigint)
    TO billetto_visiteur, billetto_organisateur, billetto_admin;
GRANT EXECUTE ON FUNCTION position_liste_attente(bigint)
    TO billetto_visiteur, billetto_organisateur, billetto_admin;
GRANT EXECUTE ON FUNCTION traiter_listes_attente() TO billetto_admin;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;
