-- =============================================================================
-- 005_security.sql — Rôles, privilèges, RLS
--
-- Modèle :
--
--   API ──(login)──> billetto_app            aucun droit sur les tables
--                       │  SET LOCAL ROLE (membre en SET uniquement, sans héritage)
--                       ├─> billetto_visiteur      catalogue public + ses commandes/billets
--                       ├─> billetto_organisateur  ses événements, tarifs et ventes
--                       └─> billetto_admin         tout, sauf mots de passe
--   BI / reporting ───> billetto_readonly     lecture seule, sans données personnelles
--
-- Par requête, l'API exécute dans une transaction :
--   SET LOCAL ROLE billetto_organisateur;
--   SELECT set_config('app.user_id', '42', true);   -- true = local à la transaction
--
-- Les rôles sont des objets du CLUSTER (ils survivent à db:reset) : création
-- idempotente. Le mot de passe de billetto_app n'est jamais versionné : il est
-- posé par database/scripts/migrate.mjs depuis APP_DB_PASSWORD (.env).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Rôles
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['billetto_app', 'billetto_visiteur', 'billetto_organisateur',
                             'billetto_admin', 'billetto_readonly'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
    END LOOP;
END $$;

-- Rôles de groupe : jamais de connexion directe, aucun privilège d'administration.
ALTER ROLE billetto_visiteur     NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE billetto_organisateur NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE billetto_admin        NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE billetto_readonly     NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
-- Compte technique : LOGIN activé par migrate.mjs lorsqu'un mot de passe est fourni.
ALTER ROLE billetto_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

-- billetto_app peut ENDOSSER les rôles métier (SET) mais n'hérite pas de leurs
-- droits (INHERIT FALSE) : hors SET ROLE, il ne peut rien lire.
GRANT billetto_visiteur     TO billetto_app WITH INHERIT FALSE, SET TRUE;
GRANT billetto_organisateur TO billetto_app WITH INHERIT FALSE, SET TRUE;
GRANT billetto_admin        TO billetto_app WITH INHERIT FALSE, SET TRUE;

COMMENT ON ROLE billetto_app IS 'Compte de connexion de l''API. Aucun droit direct ; SET LOCAL ROLE vers un rôle métier par requête.';
COMMENT ON ROLE billetto_visiteur IS 'Acheteur : catalogue publié, ses commandes et billets, achat et remboursement de ses commandes.';
COMMENT ON ROLE billetto_organisateur IS 'Organisateur : ses événements, tarifs, attributs et ventes (RLS sur organisateur_id).';
COMMENT ON ROLE billetto_admin IS 'Administrateur : accès global, sans lecture des mots de passe.';
COMMENT ON ROLE billetto_readonly IS 'Reporting : lecture seule de toutes les lignes, sans données personnelles.';

-- -----------------------------------------------------------------------------
-- 2. Retrait des droits implicites de PUBLIC
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO billetto_app', current_database());
END $$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
-- Par défaut, toute fonction est exécutable par PUBLIC.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;
-- Et pour les objets créés ensuite (y compris plus bas dans ce fichier).
-- Piège : des privilèges par défaut « IN SCHEMA » ne peuvent qu'AJOUTER des
-- droits aux privilèges par défaut globaux, jamais en retirer. Le EXECUTE
-- accordé à PUBLIC sur les fonctions est un défaut GLOBAL : il faut le retirer
-- sans clause IN SCHEMA (détecté par tests/phase05_securite.sql).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA public
    TO billetto_app, billetto_visiteur, billetto_organisateur, billetto_admin, billetto_readonly;

-- -----------------------------------------------------------------------------
-- 3. Contexte applicatif
-- -----------------------------------------------------------------------------
-- Utilisateur courant transmis par l'API. NULL si absent ou vide.
CREATE FUNCTION app_user_id()
RETURNS bigint
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT nullif(current_setting('app.user_id', true), '')::bigint
$$;

COMMENT ON FUNCTION app_user_id() IS
    'Identifiant de l''utilisateur applicatif courant (set_config(''app.user_id'', …, true)), NULL sinon.';

-- Organisateur rattaché à l'utilisateur courant. SECURITY DEFINER : un
-- organisateur n'a pas le droit de lire utilisateurs.organisateur_id.
-- Utilisée dans les policies sous la forme (SELECT app_organisateur_id()) :
-- la sous-requête devient un InitPlan évalué UNE fois par requête, pas par ligne.
CREATE FUNCTION app_organisateur_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT u.organisateur_id
    FROM public.utilisateurs u
    WHERE u.id = public.app_user_id()
      AND u.role_app = 'organizer'
$$;

COMMENT ON FUNCTION app_organisateur_id() IS
    'Organisateur de l''utilisateur courant (NULL si ce n''est pas un organizer). SECURITY DEFINER.';

-- Contrôle d'identité pour les fonctions SECURITY DEFINER.
-- Une fonction SECURITY DEFINER contourne la RLS (propriétaire) : elle doit
-- vérifier elle-même que l'appelant agit pour son propre compte.
--   - contexte présent : il doit correspondre à l'utilisateur ciblé ;
--   - contexte absent  : autorisé uniquement pour une session superutilisateur
--     (scripts de maintenance, seed, tests) ; refusé pour billetto_app.
CREATE FUNCTION controler_acteur(p_utilisateur_id bigint)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_acteur bigint := public.app_user_id();
BEGIN
    IF v_acteur IS NULL THEN
        IF NOT (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) THEN
            RAISE EXCEPTION 'contexte utilisateur absent (app.user_id)' USING ERRCODE = 'BT013';
        END IF;
    ELSIF v_acteur IS DISTINCT FROM p_utilisateur_id THEN
        RAISE EXCEPTION 'action interdite pour le compte d''un autre utilisateur' USING ERRCODE = 'BT013';
    END IF;
END;
$$;

COMMENT ON FUNCTION controler_acteur(bigint) IS
    'Lève BT013 si l''utilisateur applicatif courant n''est pas p_utilisateur_id (sauf maintenance superutilisateur sans contexte).';

-- -----------------------------------------------------------------------------
-- 4. Fonctions métier : contrôle de propriété
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acheter_billet(
    p_utilisateur_id bigint,
    p_tarif_id       bigint,
    p_quantite       integer DEFAULT 1
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
    v_tarif     public.tarifs%ROWTYPE;
    v_evenement public.evenements%ROWTYPE;
    v_vendus    bigint;
    v_montant   numeric(12,2);
    v_commande  bigint;
    v_paiement  bigint;
    v_billets   bigint[];
BEGIN
    -- Phase 05 : on n'achète que pour soi.
    PERFORM public.controler_acteur(p_utilisateur_id);

    IF p_quantite IS NULL OR p_quantite < 1 OR p_quantite > 10 THEN
        RAISE EXCEPTION 'quantité invalide : % (1 à 10)', p_quantite
            USING ERRCODE = 'BT007';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.utilisateurs u WHERE u.id = p_utilisateur_id) THEN
        RAISE EXCEPTION 'utilisateur % introuvable', p_utilisateur_id
            USING ERRCODE = 'BT008';
    END IF;

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

    SELECT count(*) INTO v_vendus
    FROM public.billets b
    JOIN public.commandes c ON c.id = b.commande_id
    WHERE b.tarif_id = p_tarif_id
      AND c.statut IN ('paid', 'pending');

    IF v_vendus + p_quantite > v_tarif.quota THEN
        RAISE EXCEPTION 'quota épuisé pour le tarif % : % restant(s), % demandé(s)',
            p_tarif_id, greatest(v_tarif.quota - v_vendus, 0), p_quantite
            USING ERRCODE = 'BT006';
    END IF;

    v_montant := v_tarif.prix * p_quantite;

    INSERT INTO public.commandes (utilisateur_id, statut, montant_total)
    VALUES (p_utilisateur_id, 'paid', v_montant)
    RETURNING id INTO v_commande;

    INSERT INTO public.paiements (commande_id, reference, type, montant, statut)
    VALUES (v_commande, 'PAY-' || gen_random_uuid(), 'charge', v_montant, 'succeeded')
    RETURNING id INTO v_paiement;

    WITH nouveaux AS (
        INSERT INTO public.billets (tarif_id, commande_id, utilisateur_id, prix_paye)
        SELECT p_tarif_id, v_commande, p_utilisateur_id, v_tarif.prix
        FROM generate_series(1, p_quantite)
        RETURNING id
    )
    SELECT array_agg(id ORDER BY id) INTO v_billets FROM nouveaux;

    RETURN QUERY SELECT v_commande, v_paiement, v_billets, v_montant;
END;
$$;

COMMENT ON FUNCTION acheter_billet(bigint, bigint, integer) IS
    'Achat atomique pour l''utilisateur courant : contrôle d''identité (BT013), tarif, événement, période de vente et quota (verrou FOR UPDATE), crée commande + paiement + billets. SECURITY DEFINER.';

-- Logique de remboursement partagée, sans droit d'exécution pour personne :
-- appelée uniquement par les deux procédures ci-dessous (propriétaire).
CREATE PROCEDURE rembourser_commande_impl(p_commande_id bigint, p_controle_proprietaire boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_commande public.commandes%ROWTYPE;
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

    INSERT INTO public.paiements (commande_id, reference, type, montant, statut)
    VALUES (p_commande_id, 'REF-' || gen_random_uuid(), 'refund', -v_commande.montant_total, 'succeeded');

    UPDATE public.commandes
    SET statut = 'refunded'
    WHERE id = p_commande_id;
END;
$$;

REVOKE ALL ON PROCEDURE rembourser_commande_impl(bigint, boolean) FROM PUBLIC;
COMMENT ON PROCEDURE rembourser_commande_impl(bigint, boolean) IS
    'Implémentation du remboursement. Aucun GRANT : appelée par rembourser_commande et admin_rembourser_commande.';

-- Le propriétaire de la commande (visiteur) rembourse SA commande.
CREATE OR REPLACE PROCEDURE rembourser_commande(p_commande_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    CALL public.rembourser_commande_impl(p_commande_id, true);
END;
$$;

COMMENT ON PROCEDURE rembourser_commande(bigint) IS
    'Rembourse une commande de l''utilisateur courant (BT013 sinon), paid et avant le début de l''événement. Erreurs BT010–BT013.';

-- L'administrateur rembourse n'importe quelle commande. Le droit est porté par
-- le privilège EXECUTE (rôle billetto_admin), pas par un paramètre.
CREATE PROCEDURE admin_rembourser_commande(p_commande_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    CALL public.rembourser_commande_impl(p_commande_id, false);
END;
$$;

REVOKE ALL ON PROCEDURE admin_rembourser_commande(bigint) FROM PUBLIC;
COMMENT ON PROCEDURE admin_rembourser_commande(bigint) IS
    'Remboursement d''une commande quelconque. EXECUTE réservé à billetto_admin.';

-- billets_utilisateur passe en SECURITY DEFINER : la RLS des tarifs et
-- événements masquerait à l'acheteur ses propres billets d'un tarif désactivé
-- ou d'un événement annulé. Le contrôle d'identité remplace la RLS.
CREATE OR REPLACE FUNCTION billets_utilisateur(p_utilisateur_id bigint)
RETURNS TABLE (
    billet_id        bigint,
    code             uuid,
    evenement_id     bigint,
    evenement        text,
    debut            timestamptz,
    lieu             text,
    ville            text,
    tarif            text,
    prix_paye        numeric(10,2),
    commande_id      bigint,
    statut_commande  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.controler_acteur(p_utilisateur_id);

    RETURN QUERY
    SELECT b.id, b.code, e.id, e.nom, e.debut, l.nom, l.ville, t.nom, b.prix_paye, c.id, c.statut
    FROM public.billets b
    JOIN public.commandes c  ON c.id = b.commande_id
    JOIN public.tarifs t     ON t.id = b.tarif_id
    JOIN public.evenements e ON e.id = t.evenement_id
    JOIN public.lieux l      ON l.id = e.lieu_id
    WHERE b.utilisateur_id = p_utilisateur_id
    ORDER BY e.debut DESC, b.id;
END;
$$;

COMMENT ON FUNCTION billets_utilisateur(bigint) IS
    'Billets de l''utilisateur courant (BT013 pour un autre) avec événement, lieu, tarif et statut. SECURITY DEFINER.';

-- -----------------------------------------------------------------------------
-- 5. Authentification (utilisées par billetto_app AVANT tout SET ROLE)
-- -----------------------------------------------------------------------------
-- Personne ne lit utilisateurs.password_hash directement : l'API obtient le
-- hash d'un seul compte, par e-mail exact, pour le vérifier (Argon2id) côté API.
CREATE FUNCTION authentification_utilisateur(p_email text)
RETURNS TABLE (
    utilisateur_id   bigint,
    password_hash    text,
    role_app         text,
    organisateur_id  bigint,
    prenom           text,
    nom              text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT u.id, u.password_hash, u.role_app, u.organisateur_id, u.prenom, u.nom
    FROM public.utilisateurs u
    WHERE u.email = lower(btrim(p_email))
$$;

COMMENT ON FUNCTION authentification_utilisateur(text) IS
    'Données de connexion d''un compte par e-mail (hash à vérifier par l''API). EXECUTE : billetto_app uniquement.';

-- Inscription : toujours en visitor ; le rôle ne peut pas être choisi.
CREATE FUNCTION inscrire_utilisateur(p_email text, p_password_hash text, p_prenom text, p_nom text)
RETURNS bigint
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    INSERT INTO public.utilisateurs (email, password_hash, prenom, nom, role_app)
    VALUES (lower(btrim(p_email)), p_password_hash, btrim(p_prenom), btrim(p_nom), 'visitor')
    RETURNING id
$$;

COMMENT ON FUNCTION inscrire_utilisateur(text, text, text, text) IS
    'Crée un compte visitor et renvoie son id (23505 si l''e-mail existe). EXECUTE : billetto_app uniquement.';

-- -----------------------------------------------------------------------------
-- 6. Triggers exécutés pour des rôles sans droit sur les tables lues/écrites
-- -----------------------------------------------------------------------------
-- Un organisateur qui modifie son tarif déclenche l'audit : il n'a aucun droit
-- sur journal_tarifs. La fonction de trigger s'exécute donc avec les droits
-- de son propriétaire.
ALTER FUNCTION trg_tarifs_audit_fn() SECURITY DEFINER;
-- Lecture de tarifs/evenements hors RLS de l'appelant.
ALTER FUNCTION trg_billets_validate_date_fn() SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- 7. Privilèges sur les objets
-- -----------------------------------------------------------------------------
-- Référentiels publics
GRANT SELECT ON lieux, type_evenements
    TO billetto_visiteur, billetto_organisateur, billetto_admin, billetto_readonly;
GRANT SELECT (id, nom) ON organisateurs
    TO billetto_visiteur, billetto_organisateur, billetto_readonly;

-- Catalogue (lignes filtrées par RLS)
GRANT SELECT ON evenements, tarifs, evenement_attributs
    TO billetto_visiteur, billetto_organisateur, billetto_admin, billetto_readonly;

-- Utilisateurs : niveau COLONNE. Ni email ni password_hash pour les rôles non admin.
GRANT SELECT (id, prenom, nom) ON utilisateurs TO billetto_visiteur, billetto_organisateur;
GRANT SELECT (id, prenom, nom, role_app, organisateur_id, created_at) ON utilisateurs TO billetto_readonly;
GRANT SELECT (id, email, prenom, nom, role_app, organisateur_id, created_at, updated_at) ON utilisateurs
    TO billetto_admin;
GRANT UPDATE (prenom, nom, role_app, organisateur_id) ON utilisateurs TO billetto_admin;

-- Ventes : lecture seule pour tous (RLS). Aucune écriture directe :
-- achats et remboursements passent par les fonctions SECURITY DEFINER.
GRANT SELECT ON commandes, billets TO billetto_visiteur, billetto_organisateur, billetto_admin, billetto_readonly;
GRANT SELECT ON paiements TO billetto_visiteur, billetto_admin, billetto_readonly;
GRANT SELECT ON amities TO billetto_visiteur, billetto_admin, billetto_readonly;
GRANT SELECT ON journal_tarifs TO billetto_admin, billetto_readonly;

-- Organisateur : gestion de ses événements. organisateur_id n'est pas
-- modifiable (pas de GRANT UPDATE sur cette colonne) : un événement ne change
-- pas de propriétaire.
GRANT INSERT, DELETE ON evenements TO billetto_organisateur;
GRANT UPDATE (lieu_id, type_evenement_id, nom, slug, description, debut, fin, statut) ON evenements
    TO billetto_organisateur;
GRANT INSERT, UPDATE, DELETE ON tarifs, evenement_attributs TO billetto_organisateur;

-- Admin : gestion des référentiels et du catalogue
GRANT SELECT, INSERT, UPDATE, DELETE ON organisateurs, lieux, type_evenements TO billetto_admin;
GRANT INSERT, UPDATE, DELETE ON evenements, tarifs, evenement_attributs TO billetto_admin;

-- Vues (security_invoker : droits et RLS de l'appelant, voir §9)
GRANT SELECT ON v_ventes_par_evenement, v_remplissage, v_classement_lieux
    TO billetto_organisateur, billetto_admin, billetto_readonly;
-- Vue matérialisée : pas de RLS possible sur une MV (données agrégées globales).
GRANT SELECT ON mv_ventes_quotidiennes TO billetto_admin, billetto_readonly;

-- Fonctions
GRANT EXECUTE ON FUNCTION app_user_id() TO billetto_visiteur, billetto_organisateur, billetto_admin, billetto_readonly;
GRANT EXECUTE ON FUNCTION app_organisateur_id() TO billetto_organisateur, billetto_admin;
GRANT EXECUTE ON FUNCTION acheter_billet(bigint, bigint, integer)
    TO billetto_visiteur, billetto_organisateur, billetto_admin;
GRANT EXECUTE ON FUNCTION billets_utilisateur(bigint)
    TO billetto_visiteur, billetto_organisateur, billetto_admin;
GRANT EXECUTE ON PROCEDURE rembourser_commande(bigint) TO billetto_visiteur, billetto_organisateur, billetto_admin;
GRANT EXECUTE ON PROCEDURE admin_rembourser_commande(bigint) TO billetto_admin;
GRANT EXECUTE ON FUNCTION ca_evenement(bigint) TO billetto_organisateur, billetto_admin, billetto_readonly;
GRANT EXECUTE ON FUNCTION authentification_utilisateur(text) TO billetto_app;
GRANT EXECUTE ON FUNCTION inscrire_utilisateur(text, text, text, text) TO billetto_app;
-- controler_acteur, rembourser_commande_impl et les fonctions de trigger :
-- aucun GRANT (appelées par le propriétaire uniquement).

-- -----------------------------------------------------------------------------
-- 8. Row Level Security
-- -----------------------------------------------------------------------------
-- ENABLE : les policies s'appliquent. FORCE : elles s'appliquent aussi au
-- propriétaire de la table s'il n'est pas superutilisateur (un superutilisateur
-- ou un rôle BYPASSRLS les ignore toujours).
-- Sans policy correspondant au rôle, une table RLS ne renvoie AUCUNE ligne.
ALTER TABLE evenements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarifs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE evenement_attributs ENABLE ROW LEVEL SECURITY;
ALTER TABLE commandes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE billets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE paiements           ENABLE ROW LEVEL SECURITY;
ALTER TABLE amities             ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisateurs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE evenements          FORCE ROW LEVEL SECURITY;
ALTER TABLE tarifs              FORCE ROW LEVEL SECURITY;
ALTER TABLE evenement_attributs FORCE ROW LEVEL SECURITY;
ALTER TABLE commandes           FORCE ROW LEVEL SECURITY;
ALTER TABLE billets             FORCE ROW LEVEL SECURITY;
ALTER TABLE paiements           FORCE ROW LEVEL SECURITY;
ALTER TABLE amities             FORCE ROW LEVEL SECURITY;
ALTER TABLE utilisateurs        FORCE ROW LEVEL SECURITY;

-- evenements ------------------------------------------------------------------
CREATE POLICY p_evenements_visiteur_select ON evenements
    FOR SELECT TO billetto_visiteur
    USING (statut IN ('published', 'finished'));

CREATE POLICY p_evenements_organisateur_all ON evenements
    FOR ALL TO billetto_organisateur
    USING (organisateur_id = (SELECT app_organisateur_id()))
    WITH CHECK (organisateur_id = (SELECT app_organisateur_id()));

CREATE POLICY p_evenements_admin_all ON evenements
    FOR ALL TO billetto_admin USING (true) WITH CHECK (true);

CREATE POLICY p_evenements_readonly_select ON evenements
    FOR SELECT TO billetto_readonly USING (true);

-- Écriture des policies « en cascade » (tarif visible si son événement l'est) :
-- la sous-requête est elle-même filtrée par la RLS de l'appelant.
--
-- Forme  col = ANY (ARRAY(SELECT …))  plutôt que  EXISTS (…) / col IN (SELECT …) :
-- ARRAY(SELECT …) est un InitPlan calculé UNE fois, et « = ANY(tableau) » est
-- utilisable comme condition d'index. Avec EXISTS/IN, la sous-requête devient
-- un SubPlan haché appliqué à chaque ligne d'un parcours séquentiel.
-- Mesure (seed FULL, organisateur, v_ventes_par_evenement) : 820–1 010 ms → 18–28 ms.
-- Adapté quand l'ensemble autorisé est petit (un organisateur : quelques
-- événements) ; pour le visiteur (≈ 4 600 événements visibles), EXISTS reste.

-- tarifs ----------------------------------------------------------------------
CREATE POLICY p_tarifs_visiteur_select ON tarifs
    FOR SELECT TO billetto_visiteur
    USING (actif AND EXISTS (SELECT 1 FROM evenements e WHERE e.id = tarifs.evenement_id));

CREATE POLICY p_tarifs_organisateur_all ON tarifs
    FOR ALL TO billetto_organisateur
    USING (evenement_id = ANY (ARRAY(SELECT e.id FROM evenements e)))
    WITH CHECK (evenement_id = ANY (ARRAY(SELECT e.id FROM evenements e)));

CREATE POLICY p_tarifs_admin_all ON tarifs
    FOR ALL TO billetto_admin USING (true) WITH CHECK (true);

CREATE POLICY p_tarifs_readonly_select ON tarifs
    FOR SELECT TO billetto_readonly USING (true);

-- evenement_attributs ---------------------------------------------------------
CREATE POLICY p_evenement_attributs_visiteur_select ON evenement_attributs
    FOR SELECT TO billetto_visiteur
    USING (EXISTS (SELECT 1 FROM evenements e WHERE e.id = evenement_attributs.evenement_id));

CREATE POLICY p_evenement_attributs_organisateur_all ON evenement_attributs
    FOR ALL TO billetto_organisateur
    USING (evenement_id = ANY (ARRAY(SELECT e.id FROM evenements e)))
    WITH CHECK (evenement_id = ANY (ARRAY(SELECT e.id FROM evenements e)));

CREATE POLICY p_evenement_attributs_admin_all ON evenement_attributs
    FOR ALL TO billetto_admin USING (true) WITH CHECK (true);

CREATE POLICY p_evenement_attributs_readonly_select ON evenement_attributs
    FOR SELECT TO billetto_readonly USING (true);

-- commandes -------------------------------------------------------------------
CREATE POLICY p_commandes_visiteur_select ON commandes
    FOR SELECT TO billetto_visiteur
    USING (utilisateur_id = (SELECT app_user_id()));

-- Commandes contenant au moins un billet d'un de ses événements.
CREATE POLICY p_commandes_organisateur_select ON commandes
    FOR SELECT TO billetto_organisateur
    USING (id = ANY (ARRAY(SELECT b.commande_id FROM billets b)));

CREATE POLICY p_commandes_admin_select ON commandes
    FOR SELECT TO billetto_admin USING (true);

CREATE POLICY p_commandes_readonly_select ON commandes
    FOR SELECT TO billetto_readonly USING (true);

-- billets ---------------------------------------------------------------------
CREATE POLICY p_billets_visiteur_select ON billets
    FOR SELECT TO billetto_visiteur
    USING (utilisateur_id = (SELECT app_user_id()));

-- Billets des tarifs visibles, donc de ses événements.
CREATE POLICY p_billets_organisateur_select ON billets
    FOR SELECT TO billetto_organisateur
    USING (tarif_id = ANY (ARRAY(SELECT t.id FROM tarifs t)));

CREATE POLICY p_billets_admin_select ON billets
    FOR SELECT TO billetto_admin USING (true);

CREATE POLICY p_billets_readonly_select ON billets
    FOR SELECT TO billetto_readonly USING (true);

-- paiements -------------------------------------------------------------------
CREATE POLICY p_paiements_visiteur_select ON paiements
    FOR SELECT TO billetto_visiteur
    USING (EXISTS (SELECT 1 FROM commandes c WHERE c.id = paiements.commande_id));

CREATE POLICY p_paiements_admin_select ON paiements
    FOR SELECT TO billetto_admin USING (true);

CREATE POLICY p_paiements_readonly_select ON paiements
    FOR SELECT TO billetto_readonly USING (true);

-- amities ---------------------------------------------------------------------
CREATE POLICY p_amities_visiteur_select ON amities
    FOR SELECT TO billetto_visiteur
    USING ((SELECT app_user_id()) IN (utilisateur_id, ami_id));

CREATE POLICY p_amities_admin_select ON amities
    FOR SELECT TO billetto_admin USING (true);

CREATE POLICY p_amities_readonly_select ON amities
    FOR SELECT TO billetto_readonly USING (true);

-- utilisateurs ----------------------------------------------------------------
-- En plus du filtrage de colonnes (§7) : un visiteur ou un organisateur ne voit
-- que sa propre ligne. L'authentification passe par une fonction SECURITY DEFINER.
CREATE POLICY p_utilisateurs_soi_select ON utilisateurs
    FOR SELECT TO billetto_visiteur, billetto_organisateur
    USING (id = (SELECT app_user_id()));

CREATE POLICY p_utilisateurs_admin_all ON utilisateurs
    FOR ALL TO billetto_admin USING (true) WITH CHECK (true);

CREATE POLICY p_utilisateurs_readonly_select ON utilisateurs
    FOR SELECT TO billetto_readonly USING (true);

-- -----------------------------------------------------------------------------
-- 9. Vues : exécution avec les droits de l'appelant
-- -----------------------------------------------------------------------------
-- Par défaut, une vue interroge ses tables avec les droits de son PROPRIÉTAIRE.
-- Le propriétaire (superutilisateur ici) ignore la RLS : un organisateur ayant
-- SELECT sur la vue verrait les ventes de TOUS les organisateurs.
-- security_invoker = true (PostgreSQL ≥ 15) applique droits et RLS de l'appelant.
ALTER VIEW v_ventes_par_evenement SET (security_invoker = true);
ALTER VIEW v_remplissage          SET (security_invoker = true);
ALTER VIEW v_classement_lieux     SET (security_invoker = true);

-- -----------------------------------------------------------------------------
-- 10. Filet de sécurité : aucune fonction de ce schéma exécutable par PUBLIC
-- -----------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;
