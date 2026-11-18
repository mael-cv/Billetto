-- =============================================================================
-- Tests phase 18 — premier démarrage (migration 018).
-- Tout est annulé par ROLLBACK.
--   1. privilèges : l'API ne peut ni lire le marqueur ni initialiser l'application
--   2. initialisation : premier administrateur + marqueur, une seule fois
-- =============================================================================

BEGIN;

CREATE SCHEMA test_p18;
GRANT USAGE ON SCHEMA test_p18 TO PUBLIC;

CREATE FUNCTION test_p18.expect_error(p_sql text, p_code text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_code THEN
            RAISE NOTICE 'OK % → %', p_label, SQLSTATE;
            RETURN;
        END IF;
        RAISE EXCEPTION '% : SQLSTATE % attendu, obtenu % (%)', p_label, p_code, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION '% : une erreur % était attendue', p_label, p_code;
END;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test_p18 TO PUBLIC;

-- Base de développement éventuellement déjà initialisée : on repart d'un état vierge (annulé à la fin).
DELETE FROM application_setup;

-- -----------------------------------------------------------------------------
-- 1. Privilèges
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['billetto_app', 'billetto_visiteur', 'billetto_organisateur', 'billetto_admin',
                             'billetto_readonly', 'billetto_paiement'] LOOP
        ASSERT NOT has_function_privilege(r, 'initialiser_application(text, text, text, text, text)', 'EXECUTE'),
            format('%s ne peut pas initialiser l''application', r);
        ASSERT NOT has_table_privilege(r, 'application_setup', 'SELECT'), format('%s ne lit pas le marqueur', r);
        ASSERT NOT has_table_privilege(r, 'application_setup', 'INSERT'), format('%s n''écrit pas le marqueur', r);
    END LOOP;
    ASSERT has_function_privilege('billetto_app', 'application_initialisee()', 'EXECUTE'), 'billetto_app lit l''état';
    ASSERT NOT has_function_privilege('public', 'application_initialisee()', 'EXECUTE'), 'pas PUBLIC';
    ASSERT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'application_setup'::regclass),
        'RLS activée et forcée';
    RAISE NOTICE 'OK privilèges : seule la session propriétaire initialise l''application';
END $$;

-- L'API (billetto_app, puis un rôle métier endossé) ne peut pas créer d'administrateur par cette voie.
DO $$
BEGIN
    SET LOCAL ROLE billetto_app;
    ASSERT NOT application_initialisee(), 'état lisible par billetto_app : non initialisée';
    PERFORM test_p18.expect_error(
        $q$SELECT initialiser_application('test', 'pirate@billetto.test', '$argon2id$x', 'P', 'Irate')$q$,
        '42501', 'initialisation par billetto_app');
    PERFORM test_p18.expect_error('SELECT * FROM application_setup', '42501', 'lecture du marqueur par billetto_app');
    SET LOCAL ROLE billetto_admin;
    PERFORM test_p18.expect_error(
        $q$SELECT initialiser_application('test', 'pirate@billetto.test', '$argon2id$x', 'P', 'Irate')$q$,
        '42501', 'initialisation par le rôle admin');
    RESET ROLE;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Initialisation unique
-- -----------------------------------------------------------------------------
SELECT test_p18.expect_error(
    $q$SELECT initialiser_application('root', 'a@billetto.test', '$argon2id$x', 'A', 'B')$q$, '22023', 'mode inconnu');
SELECT test_p18.expect_error(
    $q$SELECT initialiser_application('test', 'a@billetto.test', 'mot-de-passe-en-clair', 'A', 'B')$q$, '22023', 'mot de passe non haché');
SELECT test_p18.expect_error(
    $q$SELECT initialiser_application('test', 'a@billetto.test', '$argon2id$x', '', 'B')$q$, '22023', 'administrateur incomplet');

DO $$
DECLARE
    v_admin bigint;
BEGIN
    ASSERT NOT application_initialisee(), 'non initialisée avant';
    v_admin := initialiser_application('test', '  Premier.Admin@Billetto.TEST ', '$argon2id$v=19$m=19456,t=2,p=1$x$y', ' Ada ', 'Admin');
    ASSERT application_initialisee(), 'initialisée après';
    ASSERT (SELECT email = 'premier.admin@billetto.test' AND role_app = 'admin' AND prenom = 'Ada' AND organisateur_id IS NULL
            FROM utilisateurs WHERE id = v_admin), 'administrateur créé, e-mail normalisé';
    ASSERT (SELECT mode = 'test' AND administrateur = v_admin FROM application_setup), 'marqueur écrit';

    -- Second appel : refusé, aucun second administrateur.
    PERFORM test_p18.expect_error(
        $q$SELECT initialiser_application('live', 'second@billetto.test', '$argon2id$x', 'S', 'Econd')$q$,
        'BT070', 'seconde initialisation');
    ASSERT NOT EXISTS (SELECT 1 FROM utilisateurs WHERE email = 'second@billetto.test'), 'aucun second administrateur';
    ASSERT (SELECT count(*) FROM application_setup) = 1, 'une seule ligne de marqueur';

    -- Le marqueur ne peut pas être doublé, même en propriétaire.
    PERFORM test_p18.expect_error(
        format('INSERT INTO application_setup (mode, administrateur) VALUES (''live'', %s)', v_admin),
        '23505', 'second marqueur');
    PERFORM test_p18.expect_error(
        format('INSERT INTO application_setup (id, mode, administrateur) VALUES (false, ''live'', %s)', v_admin),
        '23514', 'marqueur hors singleton');
    RAISE NOTICE 'OK initialisation unique : administrateur %, marqueur verrouillé', v_admin;
END $$;

ROLLBACK;
