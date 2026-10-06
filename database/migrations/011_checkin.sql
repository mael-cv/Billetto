-- =============================================================================
-- 011_checkin.sql — Phase 13 : check-in QR, détection de doublon, offline-first
--
-- QR signé : BT1.<billets.code>.<billets.code_verification>, où
-- code_verification = HMAC-SHA256(secret, code) (base64url, 22 caractères).
-- Le secret vit dans checkin_secret, lisible seulement par le propriétaire :
-- ni l'API ni le front ne le connaissent ; un QR forgé est rejeté par
-- scanner_billet.
--
-- Doublon garanti par la base : index unique partiel (billet_id) WHERE
-- resultat = 'ok'. Deux scans concurrents du même billet → un seul 'ok',
-- l'autre devient 'doublon' avec premier_scan_id.
--
-- Rejeux offline : client_scan_id UNIQUE, généré par le téléphone. Un scan
-- renvoyé plusieurs fois, dans n'importe quel ordre, renvoie toujours la
-- même ligne, sans nouvelle écriture. Le premier scan REÇU par le serveur
-- gagne (l'horloge d'un téléphone n'est pas fiable) ; scanne_a est conservé
-- pour l'affichage.
--
-- Règle de 007_multi_tenant.sql : RLS posée dans cette même migration.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Secret de signature (une seule ligne, aucun GRANT)
-- -----------------------------------------------------------------------------
CREATE TABLE checkin_secret (
    id      boolean PRIMARY KEY DEFAULT true,
    secret  bytea   NOT NULL,
    CONSTRAINT ck_checkin_secret_unique CHECK (id)
);
INSERT INTO checkin_secret (secret) VALUES (gen_random_bytes(32));
REVOKE ALL ON checkin_secret FROM PUBLIC;

COMMENT ON TABLE checkin_secret IS
    'Clé HMAC des QR de billets. Aucun GRANT : lue uniquement par les fonctions SECURITY DEFINER.';

CREATE FUNCTION signature_billet(p_code uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT left(rtrim(translate(encode(
               hmac(convert_to(p_code::text, 'UTF8'), s.secret, 'sha256'), 'base64'), '+/', '-_'), '='), 22)
    FROM public.checkin_secret s
$$;

COMMENT ON FUNCTION signature_billet(uuid) IS
    'HMAC-SHA256(secret, code) en base64url tronqué à 22 caractères (132 bits). Pas de GRANT.';

-- -----------------------------------------------------------------------------
-- 2. billets.code_verification
-- -----------------------------------------------------------------------------
ALTER TABLE billets ADD COLUMN code_verification text;
UPDATE billets SET code_verification = signature_billet(code);
ALTER TABLE billets ALTER COLUMN code_verification SET NOT NULL;
ALTER TABLE billets ADD CONSTRAINT uq_billets_code_verification UNIQUE (code_verification);

CREATE FUNCTION trg_billets_code_verification_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.code_verification := public.signature_billet(NEW.code);
    RETURN NEW;
END;
$$;

-- Toujours recalculé : aucun chemin d'insertion ne peut fournir sa propre signature.
CREATE TRIGGER trg_billets_code_verification
    BEFORE INSERT OR UPDATE OF code, code_verification ON billets
    FOR EACH ROW EXECUTE FUNCTION trg_billets_code_verification_fn();

COMMENT ON TRIGGER trg_billets_code_verification ON billets IS
    'Calcule code_verification (HMAC du code) à chaque insertion ou modification : aucune signature fournie n''est conservée.';

COMMENT ON COLUMN billets.code_verification IS
    'Signature HMAC du code, imprimée dans le QR (BT1.<code>.<code_verification>). Calculée par trigger.';

-- -----------------------------------------------------------------------------
-- 3. billets_scans
-- -----------------------------------------------------------------------------
CREATE TABLE billets_scans (
    id               bigint GENERATED ALWAYS AS IDENTITY,
    client_scan_id   uuid        NOT NULL,
    billet_id        bigint,
    evenement_id     bigint      NOT NULL,
    scanne_par       bigint,
    appareil         text,
    payload          text        NOT NULL,
    resultat         text        NOT NULL,
    premier_scan_id  bigint,
    scanne_a         timestamptz NOT NULL,
    recu_a           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_billets_scans PRIMARY KEY (id),
    CONSTRAINT uq_billets_scans_client_scan_id UNIQUE (client_scan_id),
    CONSTRAINT fk_billets_scans_billet_id FOREIGN KEY (billet_id)
        REFERENCES billets (id) ON DELETE RESTRICT,
    CONSTRAINT fk_billets_scans_evenement_id FOREIGN KEY (evenement_id)
        REFERENCES evenements (id) ON DELETE RESTRICT,
    CONSTRAINT fk_billets_scans_scanne_par FOREIGN KEY (scanne_par)
        REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    CONSTRAINT fk_billets_scans_premier_scan_id FOREIGN KEY (premier_scan_id)
        REFERENCES billets_scans (id) ON DELETE RESTRICT,
    CONSTRAINT ck_billets_scans_resultat
        CHECK (resultat IN ('ok', 'doublon', 'invalide', 'annule', 'mauvais_evenement')),
    CONSTRAINT ck_billets_scans_doublon CHECK ((resultat = 'doublon') = (premier_scan_id IS NOT NULL)),
    CONSTRAINT ck_billets_scans_appareil_length CHECK (char_length(appareil) <= 100),
    CONSTRAINT ck_billets_scans_payload_length CHECK (char_length(payload) <= 200)
);

-- Détection de doublon garantie par la base : un seul scan 'ok' par billet.
CREATE UNIQUE INDEX uq_billets_scans_billet_ok ON billets_scans (billet_id) WHERE resultat = 'ok';
CREATE INDEX ix_billets_scans_evenement_id ON billets_scans (evenement_id, recu_a);

COMMENT ON TABLE billets_scans IS
    'Journal des scans de check-in. client_scan_id UNIQUE = idempotence des rejeux offline ; '
    'uq_billets_scans_billet_ok = un seul scan ok par billet (doublon détecté en base).';

ALTER TABLE billets_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE billets_scans FORCE ROW LEVEL SECURITY;

-- Scans de ses événements (cascade RLS de evenements).
CREATE POLICY p_billets_scans_organisateur_select ON billets_scans
    FOR SELECT TO billetto_organisateur
    USING (evenement_id = ANY (ARRAY(SELECT e.id FROM evenements e)));

CREATE POLICY p_billets_scans_admin_select ON billets_scans
    FOR SELECT TO billetto_admin USING (true);

CREATE POLICY p_billets_scans_readonly_select ON billets_scans
    FOR SELECT TO billetto_readonly USING (true);

-- Aucune écriture directe : uniquement via scanner_billet.
GRANT SELECT ON billets_scans TO billetto_organisateur, billetto_admin, billetto_readonly;

-- -----------------------------------------------------------------------------
-- 4. Contrôle d'accès : organisateur de l'événement ou admin
-- -----------------------------------------------------------------------------
CREATE FUNCTION controler_checkin(p_evenement_id bigint)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_organisateur bigint;
    v_user         public.utilisateurs%ROWTYPE;
BEGIN
    SELECT e.organisateur_id INTO v_organisateur FROM public.evenements e WHERE e.id = p_evenement_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'événement % introuvable', p_evenement_id USING ERRCODE = 'BT050';
    END IF;

    SELECT * INTO v_user FROM public.utilisateurs u WHERE u.id = public.app_user_id();
    IF NOT FOUND THEN
        -- Maintenance (tests SQL) : superutilisateur sans contexte, comme controler_acteur.
        IF public.app_user_id() IS NULL
           AND (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'contexte utilisateur absent (app.user_id)' USING ERRCODE = 'BT013';
    END IF;

    IF v_user.role_app = 'admin'
       OR (v_user.role_app = 'organizer' AND v_user.organisateur_id = v_organisateur) THEN
        RETURN;
    END IF;
    RAISE EXCEPTION 'check-in interdit pour l''événement %', p_evenement_id USING ERRCODE = 'BT013';
END;
$$;

COMMENT ON FUNCTION controler_checkin(bigint) IS
    'BT050 si l''événement n''existe pas, BT013 si l''acteur n''est ni son organisateur ni admin.';

-- -----------------------------------------------------------------------------
-- 5. scanner_billet
-- -----------------------------------------------------------------------------
CREATE FUNCTION scanner_billet(
    p_client_scan_id uuid,
    p_payload        text,
    p_evenement_id   bigint,
    p_scanne_a       timestamptz DEFAULT now(),
    p_appareil       text DEFAULT NULL
)
RETURNS TABLE (
    scan_id          bigint,
    client_scan_id   uuid,
    resultat         text,
    rejeu            boolean,
    billet_id        bigint,
    tarif            text,
    titulaire        text,
    scanne_a         timestamptz,
    recu_a           timestamptz,
    premier_scan_a   timestamptz,
    premier_recu_a   timestamptz,
    premier_appareil text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_scan       bigint;
    v_rejeu      boolean := false;
    v_match      text[];
    v_billet     public.billets%ROWTYPE;
    v_evenement  bigint;
    v_statut_cmd text;
    v_resultat   text;
    v_premier    bigint;
    v_constraint text;
BEGIN
    PERFORM public.controler_checkin(p_evenement_id);

    IF p_payload IS NULL OR btrim(p_payload) = '' THEN
        RAISE EXCEPTION 'contenu du QR vide' USING ERRCODE = 'BT051';
    END IF;

    -- Rejeu : la réponse d'origine, sans écriture.
    SELECT s.id INTO v_scan FROM public.billets_scans s WHERE s.client_scan_id = p_client_scan_id;
    IF FOUND THEN
        v_rejeu := true;
    ELSE
        v_match := regexp_match(btrim(p_payload), '^BT1\.([0-9a-fA-F-]{36})\.([A-Za-z0-9_-]{22})$');
        IF v_match IS NOT NULL THEN
            SELECT * INTO v_billet FROM public.billets b
            WHERE b.code = v_match[1]::uuid AND b.code_verification = v_match[2];
        END IF;

        IF v_billet.id IS NULL THEN
            v_resultat := 'invalide';
        ELSE
            SELECT t.evenement_id, c.statut INTO v_evenement, v_statut_cmd
            FROM public.tarifs t, public.commandes c
            WHERE t.id = v_billet.tarif_id AND c.id = v_billet.commande_id;

            v_resultat := CASE
                WHEN v_evenement <> p_evenement_id THEN 'mauvais_evenement'
                WHEN v_statut_cmd <> 'paid' THEN 'annule'
                ELSE 'ok'
            END;
        END IF;

        BEGIN
            INSERT INTO public.billets_scans
                (client_scan_id, billet_id, evenement_id, scanne_par, appareil, payload, resultat, scanne_a)
            VALUES (p_client_scan_id, v_billet.id, p_evenement_id, public.app_user_id(), left(p_appareil, 100),
                    left(btrim(p_payload), 200), v_resultat, coalesce(p_scanne_a, now()))
            RETURNING id INTO v_scan;
        EXCEPTION WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            IF v_constraint = 'uq_billets_scans_client_scan_id' THEN
                -- Même scan rejoué en parallèle : l'autre session l'a enregistré.
                SELECT s.id INTO v_scan FROM public.billets_scans s WHERE s.client_scan_id = p_client_scan_id;
                v_rejeu := true;
            ELSE
                -- uq_billets_scans_billet_ok : billet déjà validé → doublon.
                SELECT s.id INTO v_premier FROM public.billets_scans s
                WHERE s.billet_id = v_billet.id AND s.resultat = 'ok';
                INSERT INTO public.billets_scans
                    (client_scan_id, billet_id, evenement_id, scanne_par, appareil, payload, resultat,
                     premier_scan_id, scanne_a)
                VALUES (p_client_scan_id, v_billet.id, p_evenement_id, public.app_user_id(), left(p_appareil, 100),
                        left(btrim(p_payload), 200), 'doublon', v_premier, coalesce(p_scanne_a, now()))
                RETURNING id INTO v_scan;
            END IF;
        END;
    END IF;

    RETURN QUERY
    SELECT s.id, s.client_scan_id, s.resultat, v_rejeu, s.billet_id, t.nom,
           CASE WHEN u.id IS NULL THEN NULL ELSE u.prenom || ' ' || left(u.nom, 1) || '.' END,
           s.scanne_a, s.recu_a, p.scanne_a, p.recu_a, p.appareil
    FROM public.billets_scans s
    LEFT JOIN public.billets b       ON b.id = s.billet_id
    LEFT JOIN public.tarifs t        ON t.id = b.tarif_id
    LEFT JOIN public.utilisateurs u  ON u.id = b.utilisateur_id
    LEFT JOIN public.billets_scans p ON p.id = s.premier_scan_id
    WHERE s.id = v_scan;
END;
$$;

COMMENT ON FUNCTION scanner_billet(uuid, text, bigint, timestamptz, text) IS
    'Enregistre un scan (ok / doublon / invalide / annule / mauvais_evenement). Idempotent par '
    'client_scan_id ; doublon détecté par uq_billets_scans_billet_ok. BT013/BT050/BT051. SECURITY DEFINER.';

-- -----------------------------------------------------------------------------
-- 6. Manifeste (validation provisoire hors ligne)
-- -----------------------------------------------------------------------------
CREATE FUNCTION manifeste_checkin(p_evenement_id bigint)
RETURNS TABLE (
    billet_id         bigint,
    code_verification text,
    tarif             text,
    titulaire         text,
    deja_scanne       boolean,
    scanne_a          timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.controler_checkin(p_evenement_id);

    RETURN QUERY
    SELECT b.id, b.code_verification, t.nom, u.prenom || ' ' || left(u.nom, 1) || '.',
           s.id IS NOT NULL, s.scanne_a
    FROM public.billets b
    JOIN public.tarifs t        ON t.id = b.tarif_id
    JOIN public.commandes c     ON c.id = b.commande_id
    JOIN public.utilisateurs u  ON u.id = b.utilisateur_id
    LEFT JOIN public.billets_scans s ON s.billet_id = b.id AND s.resultat = 'ok'
    WHERE t.evenement_id = p_evenement_id AND c.statut = 'paid'
    ORDER BY b.id;
END;
$$;

COMMENT ON FUNCTION manifeste_checkin(bigint) IS
    'Billets payés d''un événement et leur statut de scan, pour la validation hors ligne. SECURITY DEFINER.';

-- -----------------------------------------------------------------------------
-- 7. Privilèges
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION scanner_billet(uuid, text, bigint, timestamptz, text) TO billetto_organisateur, billetto_admin;
GRANT EXECUTE ON FUNCTION manifeste_checkin(bigint) TO billetto_organisateur, billetto_admin;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;
