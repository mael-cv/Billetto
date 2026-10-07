-- =============================================================================
-- 016_compte_bi.sql — Compte de connexion BI / pgAdmin en lecture seule
--
--   pgAdmin / BI ──(login)──> billetto_bi ──(hérite)──> billetto_readonly
--
-- billetto_readonly (005) reste un rôle de groupe NOLOGIN. billetto_bi est le
-- seul compte de connexion qui en hérite : lecture seule, sans données
-- personnelles, RLS appliquée (policies TO billetto_readonly). pgAdmin ne se
-- connecte plus avec le propriétaire du schéma.
-- Le mot de passe n'est jamais versionné : posé par database/scripts/migrate.mjs
-- depuis READONLY_DB_PASSWORD (.env) ; sans mot de passe, le rôle reste NOLOGIN.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billetto_bi') THEN
        CREATE ROLE billetto_bi NOLOGIN;
    END IF;
END $$;

ALTER ROLE billetto_bi NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT;

-- Hérite des SELECT de billetto_readonly, sans pouvoir l'endosser explicitement
-- (aucun intérêt) ni l'administrer.
GRANT billetto_readonly TO billetto_bi WITH INHERIT TRUE, SET FALSE;

DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO billetto_bi', current_database());
END $$;

-- Transactions en lecture seule par défaut (garde-fou supplémentaire).
ALTER ROLE billetto_bi SET default_transaction_read_only = on;

COMMENT ON ROLE billetto_bi IS 'Connexion BI / pgAdmin : hérite de billetto_readonly (lecture seule, sans données personnelles).';
