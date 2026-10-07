-- =============================================================================
-- Tests — compte de connexion BI / pgAdmin (migration 016)
-- billetto_bi hérite de billetto_readonly : lecture globale, aucune donnée
-- personnelle, aucune écriture. Tout est annulé par ROLLBACK.
-- =============================================================================

BEGIN;

DO $$
BEGIN
    ASSERT (SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND rolinherit
            FROM pg_roles WHERE rolname = 'billetto_bi'), 'billetto_bi : rôle non privilégié, avec héritage';
    ASSERT pg_has_role('billetto_bi', 'billetto_readonly', 'USAGE'), 'billetto_bi hérite de billetto_readonly';
    ASSERT NOT pg_has_role('billetto_bi', 'billetto_app', 'MEMBER'), 'billetto_bi sans lien avec billetto_app';
    ASSERT has_database_privilege('billetto_bi', current_database(), 'CONNECT'), 'billetto_bi : CONNECT';
    ASSERT has_table_privilege('billetto_bi', 'v_ventes_par_evenement', 'SELECT'), 'billetto_bi : lecture des vues';
    ASSERT NOT has_table_privilege('billetto_bi', 'evenements', 'INSERT'), 'billetto_bi : pas d''écriture';
    ASSERT NOT has_column_privilege('billetto_bi', 'utilisateurs', 'email', 'SELECT'), 'billetto_bi : pas d''e-mails';
    ASSERT NOT has_column_privilege('billetto_bi', 'utilisateurs', 'password_hash', 'SELECT'), 'billetto_bi : pas de hash';
END $$;

-- Lecture réelle sous l'identité billetto_bi (RLS des policies TO billetto_readonly).
SELECT set_config('test.evenements_total', (SELECT count(*) FROM evenements)::text, true);
SET LOCAL ROLE billetto_bi;
DO $$
DECLARE n bigint;
BEGIN
    SELECT count(*) INTO n FROM evenements;
    ASSERT n = current_setting('test.evenements_total')::bigint, 'billetto_bi : tous les événements visibles';
    BEGIN
        PERFORM email FROM utilisateurs LIMIT 1;
        RAISE EXCEPTION 'billetto_bi : lecture des e-mails non refusée';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK [billetto_bi] e-mails refusés';
    END;
    BEGIN
        INSERT INTO lieux (nom, adresse, ville, code_postal, capacite) VALUES ('x', 'x', 'x', '00000', 1);
        RAISE EXCEPTION 'billetto_bi : écriture non refusée';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK [billetto_bi] écriture refusée';
    END;
    RAISE NOTICE 'OK [billetto_bi] lecture seule sans données personnelles (% événements visibles)', n;
END $$;
RESET ROLE;

ROLLBACK;
