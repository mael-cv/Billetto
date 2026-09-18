-- =============================================================================
-- Tests phase 09 — isolation multi-tenant entre collectifs (organisateurs)
--
-- Complète phase05_securite.sql (déjà focalisé sur rôles/RLS/vues) avec :
--   1. un test RLS direct : lecture/écriture cross-tenant → 0 ligne, jamais
--      une erreur (RLS filtre silencieusement, ce n'est pas un refus 42501) ;
--   2. un test à 3 organisateurs simulés dans la même session (endosser()
--      successif joue le rôle de 3 connexions concurrentes côté RLS — la
--      vraie concurrence sur verrou est déjà couverte par acheter_billet en
--      phase 04) : aucun ne voit les ventes ni le journal_tarifs d'un autre ;
--   3. les métadonnées de la nouvelle colonne organisateurs.slug (007).
-- Même harnais que phase05_securite.sql : BEGIN/ROLLBACK, schéma
-- test_securite avec endosser()/reprendre()/refuse()/nb()/id().
-- =============================================================================

BEGIN;

CREATE SCHEMA test_securite;
GRANT USAGE ON SCHEMA test_securite TO PUBLIC;

CREATE TABLE test_securite.fx (cle text PRIMARY KEY, id bigint);
GRANT SELECT ON test_securite.fx TO PUBLIC;

CREATE FUNCTION test_securite.id(p_cle text) RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT id FROM test_securite.fx WHERE cle = p_cle $$;

CREATE FUNCTION test_securite.endosser(p_role text, p_utilisateur bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    RESET ROLE;
    SET LOCAL ROLE billetto_app;
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    PERFORM set_config('app.user_id', coalesce(p_utilisateur::text, ''), true);
END $$;

CREATE FUNCTION test_securite.reprendre() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    RESET ROLE;
    PERFORM set_config('app.user_id', '', true);
END $$;

-- Échec attendu avec un SQLSTATE précis (exécuté avec le rôle courant).
CREATE FUNCTION test_securite.refuse(p_sql text, p_code text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_code THEN
            RAISE NOTICE 'OK [%] % → %', current_user, p_label, SQLSTATE;
            RETURN;
        END IF;
        RAISE EXCEPTION '[%] % : SQLSTATE % attendu, obtenu % (%)', current_user, p_label, p_code, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION '[%] % : erreur % attendue, aucune levée', current_user, p_label, p_code;
END $$;

CREATE FUNCTION test_securite.nb(p_sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
    EXECUTE format('SELECT count(*) FROM (%s) s', p_sql) INTO n;
    RETURN n;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test_securite TO PUBLIC;

-- -----------------------------------------------------------------------------
-- Jeu d'essai : 3 organisateurs distincts ayant chacun au moins un événement
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_orga_a bigint; v_orga_b bigint; v_orga_c bigint;
    v_user_a bigint; v_user_b bigint; v_user_c bigint;
    v_evt_a bigint; v_evt_b bigint; v_evt_c bigint;
    v_tarif_a bigint;
BEGIN
    SELECT u.id, u.organisateur_id INTO v_user_a, v_orga_a
    FROM utilisateurs u
    WHERE u.role_app = 'organizer' AND EXISTS (SELECT 1 FROM evenements e WHERE e.organisateur_id = u.organisateur_id)
    ORDER BY u.id LIMIT 1;
    SELECT u.id, u.organisateur_id INTO v_user_b, v_orga_b
    FROM utilisateurs u
    WHERE u.role_app = 'organizer' AND u.organisateur_id <> v_orga_a
      AND EXISTS (SELECT 1 FROM evenements e WHERE e.organisateur_id = u.organisateur_id)
    ORDER BY u.id LIMIT 1;
    SELECT u.id, u.organisateur_id INTO v_user_c, v_orga_c
    FROM utilisateurs u
    WHERE u.role_app = 'organizer' AND u.organisateur_id NOT IN (v_orga_a, v_orga_b)
      AND EXISTS (SELECT 1 FROM evenements e WHERE e.organisateur_id = u.organisateur_id)
    ORDER BY u.id LIMIT 1;

    ASSERT v_user_a IS NOT NULL AND v_user_b IS NOT NULL AND v_user_c IS NOT NULL,
        'jeu d''essai incomplet : il faut 3 organisateurs distincts avec événements (utiliser le seed FULL)';

    SELECT min(id) INTO v_evt_a FROM evenements WHERE organisateur_id = v_orga_a;
    SELECT min(id) INTO v_evt_b FROM evenements WHERE organisateur_id = v_orga_b;
    SELECT min(id) INTO v_evt_c FROM evenements WHERE organisateur_id = v_orga_c;
    SELECT min(id) INTO v_tarif_a FROM tarifs WHERE evenement_id = v_evt_a;

    INSERT INTO test_securite.fx VALUES
        ('orga_a', v_orga_a), ('orga_b', v_orga_b), ('orga_c', v_orga_c),
        ('user_a', v_user_a), ('user_b', v_user_b), ('user_c', v_user_c),
        ('evt_a', v_evt_a), ('evt_b', v_evt_b), ('evt_c', v_evt_c),
        ('tarif_a', v_tarif_a);
END $$;

-- =============================================================================
-- 1. RLS directe : lecture/écriture cross-tenant → 0 ligne (pas d'erreur)
-- =============================================================================
DO $$
DECLARE n bigint;
BEGIN
    PERFORM test_securite.endosser('billetto_organisateur', test_securite.id('user_b'));

    ASSERT test_securite.nb(format('SELECT 1 FROM evenements WHERE id = %s', test_securite.id('evt_a'))) = 0,
        'B : lecture directe d''un événement de A → 0 ligne';
    ASSERT test_securite.nb(format('SELECT 1 FROM tarifs WHERE id = %s', test_securite.id('tarif_a'))) = 0,
        'B : lecture directe d''un tarif de A → 0 ligne';

    UPDATE evenements SET nom = 'usurpé par B' WHERE id = test_securite.id('evt_a');
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'B : UPDATE d''un événement de A → 0 ligne affectée';

    DELETE FROM tarifs WHERE id = test_securite.id('tarif_a');
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'B : DELETE d''un tarif de A → 0 ligne affectée';

    RAISE NOTICE 'OK RLS directe : lecture et écriture cross-tenant filtrées silencieusement (0 ligne)';
    PERFORM test_securite.reprendre();
END $$;

-- =============================================================================
-- 2. Trois organisateurs concurrents : aucune fuite de ventes ni de journal
-- =============================================================================
DO $$
DECLARE
    v_ca_a numeric; v_ca_b numeric; v_ca_c numeric;
    v_evt_vus_a bigint; v_evt_vus_b bigint; v_evt_vus_c bigint;
BEGIN
    -- A : ne voit que ses propres ventes
    PERFORM test_securite.endosser('billetto_organisateur', test_securite.id('user_a'));
    v_evt_vus_a := test_securite.nb('SELECT 1 FROM v_ventes_par_evenement');
    SELECT coalesce(sum(ca), 0) INTO v_ca_a FROM v_ventes_par_evenement;
    ASSERT test_securite.nb(format('SELECT 1 FROM v_ventes_par_evenement WHERE organisateur_id <> %s', test_securite.id('orga_a'))) = 0,
        'A : v_ventes_par_evenement ne contient que ses lignes';
    PERFORM test_securite.refuse('SELECT 1 FROM journal_tarifs', '42501',
        'A : aucun accès à journal_tarifs (pas de GRANT organisateur, pas de fuite via RLS d''une autre table)');
    PERFORM test_securite.reprendre();

    -- B : ne voit que ses propres ventes, jamais celles de A ni C
    PERFORM test_securite.endosser('billetto_organisateur', test_securite.id('user_b'));
    v_evt_vus_b := test_securite.nb('SELECT 1 FROM v_ventes_par_evenement');
    SELECT coalesce(sum(ca), 0) INTO v_ca_b FROM v_ventes_par_evenement;
    ASSERT test_securite.nb(format('SELECT 1 FROM v_ventes_par_evenement WHERE organisateur_id <> %s', test_securite.id('orga_b'))) = 0,
        'B : v_ventes_par_evenement ne contient que ses lignes';
    PERFORM test_securite.refuse('SELECT 1 FROM journal_tarifs', '42501', 'B : aucun accès à journal_tarifs');
    PERFORM test_securite.reprendre();

    -- C : idem
    PERFORM test_securite.endosser('billetto_organisateur', test_securite.id('user_c'));
    v_evt_vus_c := test_securite.nb('SELECT 1 FROM v_ventes_par_evenement');
    SELECT coalesce(sum(ca), 0) INTO v_ca_c FROM v_ventes_par_evenement;
    ASSERT test_securite.nb(format('SELECT 1 FROM v_ventes_par_evenement WHERE organisateur_id <> %s', test_securite.id('orga_c'))) = 0,
        'C : v_ventes_par_evenement ne contient que ses lignes';
    PERFORM test_securite.refuse('SELECT 1 FROM journal_tarifs', '42501', 'C : aucun accès à journal_tarifs');
    PERFORM test_securite.reprendre();

    RAISE NOTICE 'OK 3 organisateurs concurrents : CA respectifs %/%/%, aucune fuite croisée, journal_tarifs invisible pour tous',
        v_ca_a, v_ca_b, v_ca_c;
END $$;

-- =============================================================================
-- 3. Métadonnées : organisateurs.slug (007_multi_tenant.sql)
-- =============================================================================
DO $$
DECLARE n bigint;
BEGIN
    ASSERT (SELECT count(*) FROM organisateurs WHERE slug IS NULL) = 0,
        'slug NOT NULL sur toutes les lignes existantes (backfill)';

    SELECT count(*) INTO n FROM pg_constraint
    WHERE conrelid = 'organisateurs'::regclass AND contype = 'u' AND conname = 'uq_organisateurs_slug';
    ASSERT n = 1, 'contrainte UNIQUE sur organisateurs.slug';

    SELECT count(*) INTO n FROM pg_constraint
    WHERE conrelid = 'organisateurs'::regclass AND contype = 'c' AND conname = 'ck_organisateurs_slug_format';
    ASSERT n = 1, 'contrainte CHECK de format sur organisateurs.slug';

    ASSERT has_column_privilege('billetto_visiteur', 'organisateurs', 'slug', 'SELECT'),
        'lecture publique du slug pour billetto_visiteur';

    RAISE NOTICE 'OK métadonnées : organisateurs.slug NOT NULL, UNIQUE, format contraint, lisible publiquement';
END $$;

ROLLBACK;
