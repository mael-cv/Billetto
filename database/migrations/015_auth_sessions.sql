-- Révocation immédiate des sessions après changement de mot de passe.
ALTER TABLE utilisateurs
    ADD COLUMN auth_version integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_utilisateurs_auth_version CHECK (auth_version >= 0);

CREATE FUNCTION version_session_utilisateur(p_utilisateur_id bigint)
RETURNS TABLE(version integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT u.auth_version FROM public.utilisateurs u WHERE u.id = p_utilisateur_id
$$;

CREATE FUNCTION changer_mot_de_passe(p_utilisateur_id bigint, p_password_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.controler_acteur(p_utilisateur_id);
    IF p_password_hash IS NULL OR length(p_password_hash) > 512 OR p_password_hash NOT LIKE '$argon2id$%' THEN
        RAISE EXCEPTION 'hash de mot de passe invalide' USING ERRCODE = '22023';
    END IF;
    UPDATE public.utilisateurs
       SET password_hash = p_password_hash,
           auth_version = auth_version + 1
     WHERE id = p_utilisateur_id;
END;
$$;

REVOKE ALL ON FUNCTION version_session_utilisateur(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION changer_mot_de_passe(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION version_session_utilisateur(bigint), changer_mot_de_passe(bigint, text) TO billetto_app;

COMMENT ON COLUMN utilisateurs.auth_version IS
    'Version de révocation des sessions JWT. Incrémentée à chaque changement de mot de passe.';

CREATE FUNCTION invalider_sessions_apres_changement_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.role_app IS DISTINCT FROM OLD.role_app
       OR NEW.organisateur_id IS DISTINCT FROM OLD.organisateur_id THEN
        NEW.auth_version := OLD.auth_version + 1;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION invalider_sessions_apres_changement_role() FROM PUBLIC;
CREATE TRIGGER trg_utilisateurs_auth_version_role
    BEFORE UPDATE OF role_app, organisateur_id ON utilisateurs
    FOR EACH ROW EXECUTE FUNCTION invalider_sessions_apres_changement_role();

COMMENT ON TRIGGER trg_utilisateurs_auth_version_role ON utilisateurs IS
    'Révoque toutes les sessions quand un administrateur modifie le rôle ou le tenant du compte.';
