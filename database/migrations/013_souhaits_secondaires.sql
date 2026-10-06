-- =============================================================================
-- 013_souhaits_secondaires.sql — Phase 15
--   1. Annulation self-service avec délai configurable par événement
--   2. Fuseau d'affichage explicite (événements en ligne)
--   3. File d'e-mails sortants (pattern outbox) : confirmation de commande
--      et offre de liste d'attente, écrite dans la transaction métier
--   4. Export des participants d'un événement
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Délai d'annulation et fuseau horaire
-- -----------------------------------------------------------------------------
ALTER TABLE evenements
    ADD COLUMN delai_annulation interval NOT NULL DEFAULT interval '48 hours',
    ADD COLUMN en_ligne         boolean  NOT NULL DEFAULT false,
    ADD COLUMN fuseau_horaire   text     NOT NULL DEFAULT 'Europe/Paris',
    ADD CONSTRAINT ck_evenements_delai_annulation
        CHECK (delai_annulation >= interval '0' AND delai_annulation <= interval '30 days');

COMMENT ON COLUMN evenements.delai_annulation IS
    'Annulation self-service possible jusqu''à debut - delai_annulation (BT014 au-delà). L''admin n''y est pas soumis.';
COMMENT ON COLUMN evenements.en_ligne IS
    'Événement en ligne : le front affiche l''heure locale du visiteur en plus de celle du fuseau de l''événement.';
COMMENT ON COLUMN evenements.fuseau_horaire IS
    'Fuseau IANA d''affichage (ex. Europe/Paris). Les instants restent stockés en timestamptz (UTC).';

-- Un CHECK ne peut pas interroger pg_timezone_names : validation par trigger.
CREATE FUNCTION trg_evenements_fuseau_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = NEW.fuseau_horaire) THEN
        RAISE EXCEPTION 'fuseau horaire inconnu : %', NEW.fuseau_horaire USING ERRCODE = 'BT015';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evenements_fuseau
    BEFORE INSERT OR UPDATE OF fuseau_horaire ON evenements
    FOR EACH ROW EXECUTE FUNCTION trg_evenements_fuseau_fn();

COMMENT ON TRIGGER trg_evenements_fuseau ON evenements IS
    'Refuse (BT015) un fuseau absent de pg_timezone_names.';

-- -----------------------------------------------------------------------------
-- 2. Remboursement : délai d'annulation pour le propriétaire
-- -----------------------------------------------------------------------------
-- Reprise de 005_security.sql ; seul ajout : le contrôle BT014, appliqué au
-- chemin self-service (p_controle_proprietaire). L'admin n'est limité que par
-- le début de l'événement (BT012), vérifié en premier pour garder ce code.
CREATE OR REPLACE PROCEDURE rembourser_commande_impl(p_commande_id bigint, p_controle_proprietaire boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_commande public.commandes%ROWTYPE;
    v_limite   timestamptz;
BEGIN
    SELECT * INTO v_commande
    FROM public.commandes c
    WHERE c.id = p_commande_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'commande % introuvable', p_commande_id USING ERRCODE = 'BT010';
    END IF;

    IF p_controle_proprietaire THEN
        PERFORM public.controler_acteur(v_commande.utilisateur_id);
    END IF;

    IF v_commande.statut <> 'paid' THEN
        RAISE EXCEPTION 'commande % non remboursable (statut %)', p_commande_id, v_commande.statut
            USING ERRCODE = 'BT011';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.billets b
        JOIN public.tarifs t     ON t.id = b.tarif_id
        JOIN public.evenements e ON e.id = t.evenement_id
        WHERE b.commande_id = p_commande_id
          AND e.debut <= now()
    ) THEN
        RAISE EXCEPTION 'commande % : événement déjà commencé, remboursement impossible', p_commande_id
            USING ERRCODE = 'BT012';
    END IF;

    IF p_controle_proprietaire THEN
        v_limite := public.limite_annulation_impl(p_commande_id);
        IF v_limite IS NOT NULL AND now() > v_limite THEN
            RAISE EXCEPTION 'commande % : délai d''annulation dépassé (possible jusqu''au %)', p_commande_id, v_limite
                USING ERRCODE = 'BT014';
        END IF;
    END IF;

    INSERT INTO public.paiements (commande_id, reference, type, montant, statut)
    VALUES (p_commande_id, 'REF-' || gen_random_uuid(), 'refund', -v_commande.montant_total, 'succeeded');

    UPDATE public.commandes
    SET statut = 'refunded'
    WHERE id = p_commande_id;
END;
$$;

COMMENT ON PROCEDURE rembourser_commande(bigint) IS
    'Annulation self-service : rembourse une commande de l''utilisateur courant (BT013 sinon), paid, avant '
    'debut - delai_annulation (BT014) et avant le début (BT012). Erreurs BT010–BT014.';

-- Échéance d'annulation d'une commande : la plus proche de ses événements.
CREATE FUNCTION limite_annulation_impl(p_commande_id bigint)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT min(e.debut - e.delai_annulation)
    FROM public.billets b
    JOIN public.tarifs t     ON t.id = b.tarif_id
    JOIN public.evenements e ON e.id = t.evenement_id
    WHERE b.commande_id = p_commande_id
$$;

COMMENT ON FUNCTION limite_annulation_impl(bigint) IS
    'Date limite d''annulation self-service d''une commande. Aucun GRANT : voir limite_annulation.';

-- Version exposée : uniquement pour ses propres commandes (NULL sinon).
CREATE FUNCTION limite_annulation(p_commande_id bigint)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT public.limite_annulation_impl(c.id)
    FROM public.commandes c
    WHERE c.id = p_commande_id AND c.utilisateur_id = public.app_user_id()
$$;

COMMENT ON FUNCTION limite_annulation(bigint) IS
    'Date limite d''annulation d''une commande de l''utilisateur courant (NULL pour la commande d''un autre).';

-- -----------------------------------------------------------------------------
-- 3. E-mails sortants (outbox)
-- -----------------------------------------------------------------------------
CREATE TABLE emails_sortants (
    id                bigint GENERATED ALWAYS AS IDENTITY,
    utilisateur_id    bigint      NOT NULL,
    type              text        NOT NULL,
    commande_id       bigint,
    liste_attente_id  bigint,
    statut            text        NOT NULL DEFAULT 'a_envoyer',
    tentatives        integer     NOT NULL DEFAULT 0,
    derniere_erreur   text,
    -- Bail de traitement : une ligne prise par un worker n'est reprise
    -- qu'après ce délai (crash pendant l'envoi) ; aussi utilisé pour le backoff.
    prochain_essai    timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    envoye_a          timestamptz,
    CONSTRAINT pk_emails_sortants PRIMARY KEY (id),
    CONSTRAINT fk_emails_sortants_utilisateur_id FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    CONSTRAINT fk_emails_sortants_commande_id FOREIGN KEY (commande_id)
        REFERENCES commandes (id) ON DELETE RESTRICT,
    CONSTRAINT fk_emails_sortants_liste_attente_id FOREIGN KEY (liste_attente_id)
        REFERENCES liste_attente (id) ON DELETE RESTRICT,
    CONSTRAINT ck_emails_sortants_type CHECK (
        (type = 'commande_confirmee' AND commande_id IS NOT NULL AND liste_attente_id IS NULL)
        OR (type = 'offre_liste_attente' AND liste_attente_id IS NOT NULL AND commande_id IS NULL)),
    CONSTRAINT ck_emails_sortants_statut CHECK (statut IN ('a_envoyer', 'envoye', 'echec')),
    -- Jamais deux e-mails pour le même fait métier.
    CONSTRAINT uq_emails_sortants_commande UNIQUE (type, commande_id),
    CONSTRAINT uq_emails_sortants_liste_attente UNIQUE (type, liste_attente_id)
);

CREATE INDEX ix_emails_sortants_a_envoyer ON emails_sortants (prochain_essai) WHERE statut = 'a_envoyer';

COMMENT ON TABLE emails_sortants IS
    'Outbox des e-mails : écrite par trigger dans la transaction métier, envoyée par le job API. '
    'Aucun GRANT : accès via emails_a_envoyer / marquer_email.';

-- Aucun accès direct ; RLS par cohérence avec les autres tables métier.
ALTER TABLE emails_sortants ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails_sortants FORCE ROW LEVEL SECURITY;

CREATE FUNCTION trg_commandes_email_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.emails_sortants (utilisateur_id, type, commande_id)
    VALUES (NEW.utilisateur_id, 'commande_confirmee', NEW.id)
    ON CONFLICT DO NOTHING;
    RETURN NULL;
END;
$$;

-- Insertion directe en 'paid' (acheter_billet, confirmer_reservation, donc
-- aussi confirmer_liste_attente) ou passage ultérieur à 'paid'.
CREATE TRIGGER trg_commandes_email_insert
    AFTER INSERT ON commandes
    FOR EACH ROW WHEN (NEW.statut = 'paid')
    EXECUTE FUNCTION trg_commandes_email_fn();

CREATE TRIGGER trg_commandes_email_update
    AFTER UPDATE OF statut ON commandes
    FOR EACH ROW WHEN (NEW.statut = 'paid' AND OLD.statut <> 'paid')
    EXECUTE FUNCTION trg_commandes_email_fn();

COMMENT ON TRIGGER trg_commandes_email_insert ON commandes IS
    'Commande créée payée : e-mail de confirmation avec billets (outbox).';
COMMENT ON TRIGGER trg_commandes_email_update ON commandes IS
    'Commande passée à paid : e-mail de confirmation avec billets (outbox).';

CREATE FUNCTION trg_liste_attente_email_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.emails_sortants (utilisateur_id, type, liste_attente_id)
    VALUES (NEW.utilisateur_id, 'offre_liste_attente', NEW.id)
    ON CONFLICT DO NOTHING;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_liste_attente_email
    AFTER UPDATE OF statut ON liste_attente
    FOR EACH ROW WHEN (NEW.statut = 'notifiee' AND OLD.statut = 'en_attente')
    EXECUTE FUNCTION trg_liste_attente_email_fn();

COMMENT ON TRIGGER trg_liste_attente_email ON liste_attente IS
    'Offre de liste d''attente : e-mail « une place vous attend » avec le délai (outbox).';

-- Prend jusqu'à p_limit e-mails à envoyer (FOR UPDATE SKIP LOCKED : plusieurs
-- instances de l'API ne prennent jamais la même ligne) et pose un bail de
-- 5 minutes. Contenu prêt à mettre en forme dans `donnees`.
CREATE FUNCTION emails_a_envoyer(p_limit integer DEFAULT 20)
RETURNS TABLE (
    email_id    bigint,
    type        text,
    destinataire text,
    prenom      text,
    tentatives  integer,
    donnees     jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    WITH pris AS (
        SELECT s.id
        FROM public.emails_sortants s
        WHERE s.statut = 'a_envoyer' AND s.prochain_essai <= now()
        ORDER BY s.prochain_essai, s.id
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    ),
    bail AS (
        UPDATE public.emails_sortants s
        SET prochain_essai = now() + interval '5 minutes', tentatives = s.tentatives + 1
        FROM pris
        WHERE s.id = pris.id
        RETURNING s.*
    )
    SELECT b.id, b.type, u.email, u.prenom, b.tentatives,
           CASE b.type
           WHEN 'commande_confirmee' THEN (
               SELECT jsonb_build_object(
                   'commandeId', c.id,
                   'montantTotal', c.montant_total,
                   'billets', coalesce(jsonb_agg(jsonb_build_object(
                       'billetId', bi.id,
                       'code', bi.code,
                       'qrPayload', 'BT1.' || bi.code || '.' || bi.code_verification,
                       'tarif', t.nom,
                       'prix', bi.prix_paye,
                       'evenement', e.nom,
                       'debut', e.debut,
                       'fuseauHoraire', e.fuseau_horaire,
                       'enLigne', e.en_ligne,
                       'lieu', l.nom,
                       'ville', l.ville) ORDER BY bi.id), '[]'::jsonb))
               FROM public.commandes c
               LEFT JOIN public.billets bi    ON bi.commande_id = c.id
               LEFT JOIN public.tarifs t      ON t.id = bi.tarif_id
               LEFT JOIN public.evenements e  ON e.id = t.evenement_id
               LEFT JOIN public.lieux l       ON l.id = e.lieu_id
               WHERE c.id = b.commande_id
               GROUP BY c.id)
           ELSE (
               SELECT jsonb_build_object(
                   'listeAttenteId', la.id,
                   'quantite', la.quantite_souhaitee,
                   'expireA', la.expire_a,
                   'tarif', t.nom,
                   'evenement', e.nom,
                   'debut', e.debut,
                   'fuseauHoraire', e.fuseau_horaire,
                   'enLigne', e.en_ligne)
               FROM public.liste_attente la
               JOIN public.tarifs t     ON t.id = la.tarif_id
               JOIN public.evenements e ON e.id = t.evenement_id
               WHERE la.id = b.liste_attente_id)
           END
    FROM bail b
    JOIN public.utilisateurs u ON u.id = b.utilisateur_id
    ORDER BY b.id;
END;
$$;

COMMENT ON FUNCTION emails_a_envoyer(integer) IS
    'Réserve (bail 5 min, SKIP LOCKED) et renvoie les e-mails à envoyer avec leur contenu. Job API, rôle admin.';

-- Résultat d'un envoi : envoyé, ou nouvel essai avec backoff, 'echec' après 5 tentatives.
CREATE FUNCTION marquer_email(p_email_id bigint, p_ok boolean, p_erreur text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.emails_sortants s
    SET statut          = CASE WHEN p_ok THEN 'envoye' WHEN s.tentatives >= 5 THEN 'echec' ELSE 'a_envoyer' END,
        envoye_a        = CASE WHEN p_ok THEN now() END,
        derniere_erreur = CASE WHEN p_ok THEN NULL ELSE left(p_erreur, 500) END,
        prochain_essai  = CASE WHEN p_ok THEN s.prochain_essai
                               ELSE now() + make_interval(mins => power(2, s.tentatives)::integer) END
    WHERE s.id = p_email_id AND s.statut = 'a_envoyer';
END;
$$;

COMMENT ON FUNCTION marquer_email(bigint, boolean, text) IS
    'Enregistre le résultat d''un envoi : envoye, ou nouvel essai (backoff 2^n min), echec après 5 tentatives.';

-- -----------------------------------------------------------------------------
-- 4. Participants d'un événement (export CSV)
-- -----------------------------------------------------------------------------
-- Pas d'e-mail : règle existante « e-mails visibles de l'admin seulement ».
CREATE FUNCTION participants_evenement(p_evenement_id bigint)
RETURNS TABLE (
    billet_id       bigint,
    code            uuid,
    tarif           text,
    prix_paye       numeric(10,2),
    prenom          text,
    nom             text,
    commande_id     bigint,
    statut_commande text,
    achete_le       timestamptz,
    scanne          boolean,
    scanne_le       timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.controler_checkin(p_evenement_id);

    RETURN QUERY
    SELECT b.id, b.code, t.nom, b.prix_paye, u.prenom, u.nom, c.id, c.statut, c.created_at,
           s.id IS NOT NULL, s.scanne_a
    FROM public.billets b
    JOIN public.tarifs t       ON t.id = b.tarif_id
    JOIN public.commandes c    ON c.id = b.commande_id
    JOIN public.utilisateurs u ON u.id = b.utilisateur_id
    LEFT JOIN public.billets_scans s ON s.billet_id = b.id AND s.resultat = 'ok'
    WHERE t.evenement_id = p_evenement_id
    ORDER BY u.nom, u.prenom, b.id;
END;
$$;

COMMENT ON FUNCTION participants_evenement(bigint) IS
    'Billets d''un événement avec titulaire, statut de commande et check-in. Organisateur de l''événement ou admin '
    '(controler_checkin). SECURITY DEFINER.';

-- -----------------------------------------------------------------------------
-- 5. Privilèges
-- -----------------------------------------------------------------------------
-- 005 accorde UPDATE colonne par colonne : l'organisateur règle aussi les nouvelles.
GRANT UPDATE (en_ligne, fuseau_horaire, delai_annulation) ON evenements TO billetto_organisateur;
GRANT EXECUTE ON FUNCTION limite_annulation(bigint) TO billetto_visiteur, billetto_organisateur, billetto_admin;
GRANT EXECUTE ON FUNCTION participants_evenement(bigint) TO billetto_organisateur, billetto_admin;
GRANT EXECUTE ON FUNCTION emails_a_envoyer(integer) TO billetto_admin;
GRANT EXECUTE ON FUNCTION marquer_email(bigint, boolean, text) TO billetto_admin;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;
