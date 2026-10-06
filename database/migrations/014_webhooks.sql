-- =============================================================================
-- 014_webhooks.sql — Phase 11 : idempotence des webhooks de paiement
--
-- Un événement vérifié est journalisé et son traitement métier s'exécute dans
-- la même transaction. Si la confirmation échoue, l'insertion est annulée aussi.
--
-- Rejouable : la branche feat/webhook a d'abord livré ce contenu sous le nom
-- 013_webhooks.sql. Une base qui l'a déjà appliqué reçoit ici une version sans
-- effet (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS), et l'ancienne
-- entrée de schema_migrations est retirée.
-- =============================================================================

CREATE TABLE IF NOT EXISTS paiement_webhooks (
    id                   bigint GENERATED ALWAYS AS IDENTITY,
    evenement_externe_id text        NOT NULL,
    type_evenement       text        NOT NULL,
    reservation_id       bigint      NOT NULL,
    payload              jsonb       NOT NULL,
    recu_a               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_paiement_webhooks PRIMARY KEY (id),
    CONSTRAINT uq_paiement_webhooks_evenement_externe_id UNIQUE (evenement_externe_id),
    CONSTRAINT fk_paiement_webhooks_reservation_id FOREIGN KEY (reservation_id)
        REFERENCES reservations (id) ON DELETE RESTRICT,
    CONSTRAINT ck_paiement_webhooks_event_id_non_vide CHECK (btrim(evenement_externe_id) <> ''),
    CONSTRAINT ck_paiement_webhooks_type_non_vide CHECK (btrim(type_evenement) <> '')
);

CREATE INDEX IF NOT EXISTS ix_paiement_webhooks_reservation_id ON paiement_webhooks (reservation_id);

COMMENT ON TABLE paiement_webhooks IS
    'Événements paiement vérifiés par signature HMAC. La contrainte unique rend les rejeux idempotents.';

ALTER TABLE paiement_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE paiement_webhooks FORCE ROW LEVEL SECURITY;

-- La réservation assure le rattachement au propriétaire/collectif et filtre
-- l'accès via les policies RLS déjà en place sur reservations.
DROP POLICY IF EXISTS p_paiement_webhooks_visiteur_select ON paiement_webhooks;
CREATE POLICY p_paiement_webhooks_visiteur_select ON paiement_webhooks
    FOR SELECT TO billetto_visiteur
    USING (reservation_id = ANY (ARRAY(SELECT r.id FROM reservations r)));

DROP POLICY IF EXISTS p_paiement_webhooks_organisateur_select ON paiement_webhooks;
CREATE POLICY p_paiement_webhooks_organisateur_select ON paiement_webhooks
    FOR SELECT TO billetto_organisateur
    USING (reservation_id = ANY (ARRAY(SELECT r.id FROM reservations r)));

DROP POLICY IF EXISTS p_paiement_webhooks_admin_select ON paiement_webhooks;
CREATE POLICY p_paiement_webhooks_admin_select ON paiement_webhooks
    FOR SELECT TO billetto_admin USING (true);

DROP POLICY IF EXISTS p_paiement_webhooks_readonly_select ON paiement_webhooks;
CREATE POLICY p_paiement_webhooks_readonly_select ON paiement_webhooks
    FOR SELECT TO billetto_readonly USING (true);

GRANT SELECT ON paiement_webhooks TO billetto_visiteur, billetto_organisateur, billetto_admin, billetto_readonly;

CREATE OR REPLACE FUNCTION traiter_paiement_webhook(
    p_evenement_externe_id text,
    p_type_evenement       text,
    p_reservation_id       bigint,
    p_payload              jsonb
)
RETURNS TABLE (
    duplique    boolean,
    commande_id bigint,
    billet_ids  bigint[]
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_webhook_id bigint;
    v_user_id    bigint;
    v_commande   bigint;
    v_billets    bigint[];
BEGIN
    IF p_evenement_externe_id IS NULL OR btrim(p_evenement_externe_id) = '' THEN
        RAISE EXCEPTION 'identifiant externe invalide' USING ERRCODE = '22023';
    END IF;
    IF p_type_evenement IS NULL OR btrim(p_type_evenement) = '' THEN
        RAISE EXCEPTION 'type d''événement invalide' USING ERRCODE = '22023';
    END IF;
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION 'payload invalide' USING ERRCODE = '22023';
    END IF;

    SELECT r.utilisateur_id INTO v_user_id
    FROM public.reservations r
    WHERE r.id = p_reservation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'réservation % introuvable', p_reservation_id USING ERRCODE = 'BT031';
    END IF;

    INSERT INTO public.paiement_webhooks (evenement_externe_id, type_evenement, reservation_id, payload)
    VALUES (p_evenement_externe_id, p_type_evenement, p_reservation_id, p_payload)
    ON CONFLICT (evenement_externe_id) DO NOTHING
    RETURNING id INTO v_webhook_id;

    IF v_webhook_id IS NULL THEN
        RETURN QUERY SELECT true, NULL::bigint, NULL::bigint[];
        RETURN;
    END IF;

    -- Les événements inconnus/échec sont journalisés, sans confirmer le hold.
    IF p_type_evenement <> 'payment.succeeded' THEN
        RETURN QUERY SELECT false, NULL::bigint, NULL::bigint[];
        RETURN;
    END IF;

    -- Réutilise le traitement métier existant, qui vérifie l'identité via
    -- app.user_id. L'utilisateur vient de la réservation associée au webhook
    -- dont la signature HMAC a déjà été validée par l'API.
    PERFORM set_config('app.user_id', v_user_id::text, true);
    SELECT c.commande_id, c.billet_ids
    INTO v_commande, v_billets
    FROM public.confirmer_reservation(p_reservation_id, v_user_id) c;

    RETURN QUERY SELECT false, v_commande, v_billets;
END;
$$;

COMMENT ON FUNCTION traiter_paiement_webhook(text, text, bigint, jsonb) IS
    'Insère l’événement avec ON CONFLICT DO NOTHING puis confirme une réservation sur payment.succeeded, dans la même transaction. SECURITY DEFINER.';

GRANT EXECUTE ON FUNCTION traiter_paiement_webhook(text, text, bigint, jsonb)
    TO billetto_visiteur, billetto_organisateur, billetto_admin;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;

-- Ancien nom de cette migration (avant renumérotation).
DELETE FROM schema_migrations WHERE version = '013_webhooks.sql';
