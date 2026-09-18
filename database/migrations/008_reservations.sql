-- =============================================================================
-- 008_reservations.sql — Phase 10 : réservation temporaire (hold) + TTL
--
-- Modèle : acheter_billet() (005_security.sql) fait tout en une transaction
-- (verrou FOR UPDATE sur tarifs, quota, commande+paiement+billets), adapté à
-- un paiement instantané. Un virement bancaire prend plusieurs jours : il
-- faut bloquer le quota le temps que l'argent arrive, sans jamais survendre,
-- et libérer automatiquement la place si le virement n'arrive jamais.
--
-- reservations bloque le quota via le même verrou FOR UPDATE sur tarifs que
-- acheter_billet. L'expiration est LAZY : une réservation n'est jamais
-- comptée dans le quota dès que expire_a <= now(), que son statut ait ou non
-- déjà été marqué 'expiree' par le job de purge. La purge
-- (purger_reservations_expirees) est un confort de reporting, jamais une
-- garantie de correction — voir son commentaire plus bas.
--
-- Déviation assumée par rapport au TODO littéral : pas d'ajout de
-- 'en_attente_virement' à ck_commandes_statut. confirmer_reservation()
-- n'insère jamais dans commandes tant qu'elle n'a pas réussi, et le fait
-- toujours avec statut='paid' (comme acheter_billet) : l'état "en attente"
-- vit entièrement dans reservations.statut, jamais dans commandes.statut.
-- Ajouter cette valeur créerait un état du CHECK jamais écrit.
--
-- Règle héritée de 007_multi_tenant.sql : nouvelle table rattachable à un
-- organisateur (ici en cascade via tarif_id) et RLS posée dans cette même
-- migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
CREATE TABLE reservations (
    id              bigint GENERATED ALWAYS AS IDENTITY,
    tarif_id        bigint        NOT NULL,
    utilisateur_id  bigint        NOT NULL,
    quantite        integer       NOT NULL,
    statut          text          NOT NULL DEFAULT 'active',
    mode_paiement   text          NOT NULL,
    -- Prix figé au moment du hold : un virement (jusqu'à 72h) ne doit pas
    -- facturer un prix différent si l'organisateur modifie le tarif entretemps.
    prix_unitaire   numeric(10,2) NOT NULL,
    expire_a        timestamptz   NOT NULL,
    commande_id     bigint,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pk_reservations PRIMARY KEY (id),
    CONSTRAINT fk_reservations_tarif_id FOREIGN KEY (tarif_id)
        REFERENCES tarifs (id) ON DELETE RESTRICT,
    CONSTRAINT fk_reservations_utilisateur_id FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    CONSTRAINT fk_reservations_commande_id FOREIGN KEY (commande_id)
        REFERENCES commandes (id) ON DELETE RESTRICT,
    CONSTRAINT ck_reservations_statut CHECK (statut IN ('active', 'confirmee', 'expiree', 'annulee')),
    CONSTRAINT ck_reservations_mode_paiement CHECK (mode_paiement IN ('carte', 'virement')),
    CONSTRAINT ck_reservations_quantite CHECK (quantite > 0 AND quantite <= 10),
    CONSTRAINT ck_reservations_prix_positive CHECK (prix_unitaire >= 0)
);

-- Requête chaude : quota lazy (tarif_id, statut='active', expire_a > now()),
-- utilisée à chaque creer_reservation/acheter_billet concurrent sur ce tarif.
CREATE INDEX ix_reservations_tarif_actives ON reservations (tarif_id, statut, expire_a);
CREATE INDEX ix_reservations_utilisateur_id ON reservations (utilisateur_id);

CREATE TRIGGER trg_reservations_updated_at BEFORE UPDATE ON reservations
    FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION trg_set_updated_at_fn();

COMMENT ON TRIGGER trg_reservations_updated_at ON reservations IS
    'Rafraîchit updated_at à chaque modification effective (même trigger que commandes/tarifs/...).';

COMMENT ON TABLE reservations IS
    'Blocage temporaire de quota avant paiement (hold), TTL différencié par mode_paiement. '
    'Expiration lazy : expire_a <= now() suffit à exclure la ligne du quota, indépendamment de statut.';

-- -----------------------------------------------------------------------------
-- 2. Row Level Security — même migration que la création, règle 007
-- -----------------------------------------------------------------------------
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations FORCE ROW LEVEL SECURITY;

CREATE POLICY p_reservations_visiteur_select ON reservations
    FOR SELECT TO billetto_visiteur
    USING (utilisateur_id = (SELECT app_user_id()));

-- Réservations des tarifs visibles par l'organisateur, cascade comme billets/tarifs.
CREATE POLICY p_reservations_organisateur_select ON reservations
    FOR SELECT TO billetto_organisateur
    USING (tarif_id = ANY (ARRAY(SELECT t.id FROM tarifs t)));

CREATE POLICY p_reservations_admin_select ON reservations
    FOR SELECT TO billetto_admin USING (true);

CREATE POLICY p_reservations_readonly_select ON reservations
    FOR SELECT TO billetto_readonly USING (true);

-- Lecture seule pour tous (RLS) : aucune écriture directe, comme commandes/billets.
-- Écriture uniquement via creer_reservation / confirmer_reservation /
-- purger_reservations_expirees (SECURITY DEFINER).
GRANT SELECT ON reservations TO billetto_visiteur, billetto_organisateur, billetto_admin, billetto_readonly;

-- -----------------------------------------------------------------------------
-- 3. creer_reservation : pose le hold (même verrou anti-survente qu'acheter_billet)
-- -----------------------------------------------------------------------------
CREATE FUNCTION creer_reservation(
    p_utilisateur_id bigint,
    p_tarif_id       bigint,
    p_quantite       integer DEFAULT 1,
    p_mode_paiement  text DEFAULT 'carte',
    -- Réservé aux tests SQL et à database/scripts/concurrency.mjs : jamais
    -- exposé côté API (aucun champ correspondant dans les schémas zod).
    p_ttl_override   interval DEFAULT NULL
)
RETURNS TABLE (
    reservation_id bigint,
    expire_a       timestamptz,
    montant_total  numeric(12,2)
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_tarif        public.tarifs%ROWTYPE;
    v_evenement    public.evenements%ROWTYPE;
    v_vendus       bigint;
    v_ttl          interval;
    v_reservation  bigint;
    v_expire       timestamptz;
BEGIN
    -- Même contrôle d'identité qu'acheter_billet : on ne réserve que pour soi.
    PERFORM public.controler_acteur(p_utilisateur_id);

    IF p_quantite IS NULL OR p_quantite < 1 OR p_quantite > 10 THEN
        RAISE EXCEPTION 'quantité invalide : % (1 à 10)', p_quantite
            USING ERRCODE = 'BT007';
    END IF;

    IF p_mode_paiement NOT IN ('carte', 'virement') THEN
        RAISE EXCEPTION 'mode de paiement invalide : %', p_mode_paiement
            USING ERRCODE = 'BT030';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.utilisateurs u WHERE u.id = p_utilisateur_id) THEN
        RAISE EXCEPTION 'utilisateur % introuvable', p_utilisateur_id
            USING ERRCODE = 'BT008';
    END IF;

    -- Même verrou qu'acheter_billet : sérialise holds et achats concurrents
    -- sur ce tarif, c'est la seule garantie anti-survente.
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

    -- Quota étendu : billets déjà vendus (paid/pending) + réservations
    -- actives non expirées. expire_a > now() est l'unique garantie anti-
    -- survente pour les holds : une réservation expirée ne compte plus,
    -- purgée ou non.
    SELECT
        (SELECT count(*)
         FROM public.billets b
         JOIN public.commandes c ON c.id = b.commande_id
         WHERE b.tarif_id = p_tarif_id AND c.statut IN ('paid', 'pending'))
        + (SELECT coalesce(sum(r.quantite), 0)
           FROM public.reservations r
           WHERE r.tarif_id = p_tarif_id AND r.statut = 'active' AND r.expire_a > now())
    INTO v_vendus;

    IF v_vendus + p_quantite > v_tarif.quota THEN
        RAISE EXCEPTION 'quota épuisé pour le tarif % : % restant(s), % demandé(s)',
            p_tarif_id, greatest(v_tarif.quota - v_vendus, 0), p_quantite
            USING ERRCODE = 'BT006';
    END IF;

    v_ttl := coalesce(
        p_ttl_override,
        CASE p_mode_paiement WHEN 'carte' THEN interval '15 minutes' ELSE interval '72 hours' END
    );

    INSERT INTO public.reservations (tarif_id, utilisateur_id, quantite, statut, mode_paiement, prix_unitaire, expire_a)
    VALUES (p_tarif_id, p_utilisateur_id, p_quantite, 'active', p_mode_paiement, v_tarif.prix, now() + v_ttl)
    RETURNING id, reservations.expire_a INTO v_reservation, v_expire;

    RETURN QUERY SELECT v_reservation, v_expire, v_tarif.prix * p_quantite;
END;
$$;

COMMENT ON FUNCTION creer_reservation(bigint, bigint, integer, text, interval) IS
    'Pose un hold sur le quota (contrôle d''identité BT013, tarif, événement, période, quota étendu '
    'billets+réservations actives, verrou FOR UPDATE partagé avec acheter_billet). TTL par mode_paiement '
    '(carte 15 min, virement 72h par défaut) ; p_ttl_override réservé aux tests. SECURITY DEFINER.';

-- -----------------------------------------------------------------------------
-- 4. confirmer_reservation : transforme le hold en commande payée
-- -----------------------------------------------------------------------------
CREATE FUNCTION confirmer_reservation(
    p_reservation_id bigint,
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
    v_reservation public.reservations%ROWTYPE;
    v_montant     numeric(12,2);
    v_commande    bigint;
    v_paiement    bigint;
    v_billets     bigint[];
BEGIN
    PERFORM public.controler_acteur(p_utilisateur_id);

    -- Verrou sur la ligne réservation : le quota a déjà été bloqué au moment
    -- du hold, ce verrou sérialise uniquement les doubles confirmations
    -- concurrentes de la même réservation.
    SELECT * INTO v_reservation
    FROM public.reservations r
    WHERE r.id = p_reservation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'réservation % introuvable', p_reservation_id USING ERRCODE = 'BT031';
    END IF;

    IF v_reservation.utilisateur_id IS DISTINCT FROM p_utilisateur_id THEN
        RAISE EXCEPTION 'action interdite pour la réservation d''un autre utilisateur' USING ERRCODE = 'BT013';
    END IF;

    IF v_reservation.statut <> 'active' THEN
        RAISE EXCEPTION 'réservation % non active (statut %)', p_reservation_id, v_reservation.statut
            USING ERRCODE = 'BT032';
    END IF;

    -- Point d'application réel de l'expiration : vérifié même si statut vaut
    -- encore 'active', la purge étant lazy et non garantie.
    IF v_reservation.expire_a <= now() THEN
        RAISE EXCEPTION 'réservation % expirée le %', p_reservation_id, v_reservation.expire_a
            USING ERRCODE = 'BT033';
    END IF;

    v_montant := v_reservation.prix_unitaire * v_reservation.quantite;

    INSERT INTO public.commandes (utilisateur_id, statut, montant_total)
    VALUES (p_utilisateur_id, 'paid', v_montant)
    RETURNING id INTO v_commande;

    INSERT INTO public.paiements (commande_id, reference, type, montant, statut)
    VALUES (v_commande, 'PAY-' || gen_random_uuid(), 'charge', v_montant, 'succeeded')
    RETURNING id INTO v_paiement;

    WITH nouveaux AS (
        INSERT INTO public.billets (tarif_id, commande_id, utilisateur_id, prix_paye)
        SELECT v_reservation.tarif_id, v_commande, p_utilisateur_id, v_reservation.prix_unitaire
        FROM generate_series(1, v_reservation.quantite)
        RETURNING id
    )
    SELECT array_agg(id ORDER BY id) INTO v_billets FROM nouveaux;

    UPDATE public.reservations
    SET statut = 'confirmee', commande_id = v_commande
    WHERE id = p_reservation_id;

    RETURN QUERY SELECT v_commande, v_paiement, v_billets, v_montant;
END;
$$;

COMMENT ON FUNCTION confirmer_reservation(bigint, bigint) IS
    'Transforme un hold actif et non expiré en commande payée (mêmes inserts qu''acheter_billet, au prix '
    'figé lors du hold). Contrôle d''identité BT013, BT031/BT032/BT033 sinon. SECURITY DEFINER.';

-- -----------------------------------------------------------------------------
-- 5. Purge — reporting uniquement, jamais une garantie anti-survente
-- -----------------------------------------------------------------------------
CREATE PROCEDURE purger_reservations_expirees()
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.reservations
    SET statut = 'expiree'
    WHERE statut = 'active' AND expire_a < now();
END;
$$;

COMMENT ON PROCEDURE purger_reservations_expirees() IS
    'Marquage de reporting uniquement (statut=''expiree''). JAMAIS consultée par le calcul de quota : la '
    'garantie anti-survente repose exclusivement sur expire_a > now() dans creer_reservation/confirmer_reservation. '
    'À appeler périodiquement (job externe) pour le confort des tableaux de bord, sans impact fonctionnel si absent.';

-- -----------------------------------------------------------------------------
-- 6. Privilèges d'exécution
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION creer_reservation(bigint, bigint, integer, text, interval)
    TO billetto_visiteur, billetto_organisateur, billetto_admin;
GRANT EXECUTE ON FUNCTION confirmer_reservation(bigint, bigint)
    TO billetto_visiteur, billetto_organisateur, billetto_admin;
GRANT EXECUTE ON PROCEDURE purger_reservations_expirees() TO billetto_admin;

-- Filet de sécurité (comme 005_security.sql §10) : toute fonction/procédure
-- de ce schéma reste par défaut inexécutable par PUBLIC.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;
