-- =============================================================================
-- 018_setup.sql — Premier démarrage : initialisation unique de l'application
--
-- L'assistant web recueille le mode (test / live) et le premier administrateur.
-- Ce n'est PAS l'API qui crée ce compte : elle n'a aucun droit sur les objets
-- ci-dessous. Le conteneur « seeder », seul à se connecter en propriétaire,
-- appelle initialiser_application() après avoir chargé (ou non) le jeu de
-- démonstration.
--
-- L'unicité est garantie par la base : application_setup ne peut contenir
-- qu'une ligne, et la fonction refuse tout second appel. Rejouer l'assistant,
-- même avec un jeton valide, ne peut donc pas créer un second administrateur.
-- =============================================================================

CREATE TABLE application_setup (
    id             boolean     NOT NULL DEFAULT true,
    mode           text        NOT NULL,
    administrateur bigint      NOT NULL,
    initialise_a   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_application_setup PRIMARY KEY (id),
    -- Une seule ligne possible : la clé primaire ne peut valoir que true.
    CONSTRAINT ck_application_setup_singleton CHECK (id),
    CONSTRAINT ck_application_setup_mode CHECK (mode IN ('test', 'live')),
    CONSTRAINT fk_application_setup_administrateur FOREIGN KEY (administrateur)
        REFERENCES utilisateurs (id) ON DELETE RESTRICT
);

COMMENT ON TABLE application_setup IS
    'Marqueur d''initialisation (une seule ligne). Aucun GRANT : lu par application_initialisee(), '
    'écrit par initialiser_application() uniquement.';

ALTER TABLE application_setup ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_setup FORCE ROW LEVEL SECURITY;

-- État d'initialisation : seul renseignement accessible à l'API.
CREATE FUNCTION application_initialisee()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (SELECT 1 FROM public.application_setup)
$$;

COMMENT ON FUNCTION application_initialisee() IS
    'Vrai une fois le premier démarrage terminé. EXECUTE : billetto_app (aucune autre donnée exposée).';

CREATE FUNCTION initialiser_application(
    p_mode          text,
    p_email         text,
    p_password_hash text,
    p_prenom        text,
    p_nom           text
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin bigint;
BEGIN
    IF p_mode NOT IN ('test', 'live') THEN
        RAISE EXCEPTION 'mode d''installation invalide' USING ERRCODE = '22023';
    END IF;
    IF p_password_hash IS NULL OR length(p_password_hash) > 512 OR p_password_hash NOT LIKE '$argon2id$%' THEN
        RAISE EXCEPTION 'hash de mot de passe invalide' USING ERRCODE = '22023';
    END IF;
    IF p_email IS NULL OR btrim(p_email) = '' OR btrim(coalesce(p_prenom, '')) = '' OR btrim(coalesce(p_nom, '')) = '' THEN
        RAISE EXCEPTION 'administrateur incomplet' USING ERRCODE = '22023';
    END IF;

    -- Verrou : deux appels simultanés ne peuvent pas tous deux réussir.
    LOCK TABLE public.application_setup IN EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.application_setup) THEN
        RAISE EXCEPTION 'application déjà initialisée' USING ERRCODE = 'BT070';
    END IF;

    INSERT INTO public.utilisateurs (email, password_hash, prenom, nom, role_app)
    VALUES (lower(btrim(p_email)), p_password_hash, btrim(p_prenom), btrim(p_nom), 'admin')
    ON CONFLICT ON CONSTRAINT uq_utilisateurs_email
    DO UPDATE SET password_hash = EXCLUDED.password_hash,
                  prenom = EXCLUDED.prenom,
                  nom = EXCLUDED.nom,
                  role_app = 'admin',
                  organisateur_id = NULL,
                  auth_version = public.utilisateurs.auth_version + 1
    RETURNING id INTO v_admin;

    INSERT INTO public.application_setup (mode, administrateur) VALUES (p_mode, v_admin);
    RETURN v_admin;
END;
$$;

COMMENT ON FUNCTION initialiser_application(text, text, text, text, text) IS
    'Crée le premier administrateur et marque l''application comme initialisée, une seule fois (BT070 ensuite). '
    'Aucun GRANT : exécutée par le conteneur d''installation, jamais par l''API.';

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;

GRANT EXECUTE ON FUNCTION application_initialisee() TO billetto_app;
