-- =============================================================================
-- 004_functions_triggers.sql — Fonctions, procédure, triggers
--
-- Codes d'erreur métier (SQLSTATE classe « BT », hors plage réservée) :
--   BT001 tarif introuvable            BT007 quantité invalide
--   BT002 tarif inactif                BT008 utilisateur introuvable
--   BT003 événement non publié         BT010 commande introuvable
--   BT004 vente fermée                 BT011 commande non remboursable (statut)
--   BT005 événement déjà commencé      BT012 remboursement impossible : événement commencé
--   BT006 quota épuisé                 BT020 attribut d'événement invalide
-- L'API traduit ces codes en réponses HTTP sans analyser les messages.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Index justifié par le benchmark B10 (billets d'un utilisateur) :
-- avant = Parallel Seq Scan sur 1,8 M billets pour 24 lignes.
-- -----------------------------------------------------------------------------
CREATE INDEX idx_billets_utilisateur_id ON billets (utilisateur_id);
ANALYZE billets;

-- =============================================================================
-- Fonctions de lecture
-- =============================================================================

-- CA d'un événement (commandes payées). 0 si aucune vente ou événement inconnu.
-- LANGUAGE sql + STABLE : le planner peut l'intégrer (inlining) dans la requête appelante.
CREATE FUNCTION ca_evenement(p_evenement_id bigint)
RETURNS numeric(14,2)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT coalesce(sum(b.prix_paye), 0)::numeric(14,2)
    FROM tarifs t
    JOIN billets b   ON b.tarif_id = t.id
    JOIN commandes c ON c.id = b.commande_id AND c.statut = 'paid'
    WHERE t.evenement_id = p_evenement_id
$$;

COMMENT ON FUNCTION ca_evenement(bigint) IS
    'Chiffre d''affaires d''un événement : somme des prix payés des billets de commandes paid. 0 si aucune vente.';

-- Billets d'un utilisateur, plus récents d'abord.
CREATE FUNCTION billets_utilisateur(p_utilisateur_id bigint)
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
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT b.id, b.code, e.id, e.nom, e.debut, l.nom, l.ville, t.nom, b.prix_paye, c.id, c.statut
    FROM billets b
    JOIN commandes c  ON c.id = b.commande_id
    JOIN tarifs t     ON t.id = b.tarif_id
    JOIN evenements e ON e.id = t.evenement_id
    JOIN lieux l      ON l.id = e.lieu_id
    WHERE b.utilisateur_id = p_utilisateur_id
    ORDER BY e.debut DESC, b.id
$$;

COMMENT ON FUNCTION billets_utilisateur(bigint) IS
    'Billets d''un utilisateur avec événement, lieu, tarif et statut de commande (tous statuts).';

-- =============================================================================
-- acheter_billet — mécanisme unique de création d'un achat
-- =============================================================================
CREATE FUNCTION acheter_billet(
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
-- Exécutée avec les droits du propriétaire : l'appelant n'aura (phase 05)
-- aucun droit d'écriture direct sur commandes / billets / paiements.
SECURITY DEFINER
-- Chemin figé : empêche un appelant de détourner un nom non qualifié via un
-- objet homonyme dans son schéma ou dans pg_temp (placé en dernier).
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
    IF p_quantite IS NULL OR p_quantite < 1 OR p_quantite > 10 THEN
        RAISE EXCEPTION 'quantité invalide : % (1 à 10)', p_quantite
            USING ERRCODE = 'BT007';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.utilisateurs u WHERE u.id = p_utilisateur_id) THEN
        RAISE EXCEPTION 'utilisateur % introuvable', p_utilisateur_id
            USING ERRCODE = 'BT008';
    END IF;

    -- Verrou ligne sur le tarif : les achats concurrents du MÊME tarif sont
    -- sérialisés jusqu'à la fin de la transaction. Le comptage des places
    -- vendues ci-dessous voit donc les achats déjà validés : pas de survente.
    -- Les achats sur des tarifs différents restent parallèles.
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

    -- Places occupées : billets des commandes payées ou en attente.
    -- Les commandes annulées ou remboursées libèrent leurs places.
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

    -- Paiement simulé (pas de prestataire) : immédiatement réussi.
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

REVOKE ALL ON FUNCTION acheter_billet(bigint, bigint, integer) FROM PUBLIC;

COMMENT ON FUNCTION acheter_billet(bigint, bigint, integer) IS
    'Achat atomique : contrôle tarif, événement, période de vente et quota (verrou FOR UPDATE sur le tarif), crée commande + paiement + billets. SECURITY DEFINER. Erreurs BT001–BT008.';

-- =============================================================================
-- rembourser_commande — procédure (pas de valeur de retour)
-- =============================================================================
CREATE PROCEDURE rembourser_commande(p_commande_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_commande public.commandes%ROWTYPE;
BEGIN
    -- Verrou : deux remboursements simultanés de la même commande sont
    -- sérialisés ; le second voit le statut refunded et échoue.
    SELECT * INTO v_commande
    FROM public.commandes c
    WHERE c.id = p_commande_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'commande % introuvable', p_commande_id USING ERRCODE = 'BT010';
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

REVOKE ALL ON PROCEDURE rembourser_commande(bigint) FROM PUBLIC;

COMMENT ON PROCEDURE rembourser_commande(bigint) IS
    'Rembourse une commande paid avant le début de l''événement : paiement refund négatif, statut refunded, places libérées. Erreurs BT010–BT012.';

-- =============================================================================
-- Trigger : pas de billet pour un événement commencé
-- =============================================================================
-- Filet de sécurité au niveau table : protège aussi les insertions qui ne
-- passent pas par acheter_billet (scripts, futurs endpoints, erreurs).
-- Compare à NEW.created_at (et non now()) pour que le seed puisse insérer
-- des ventes historiques datées avant le début de leur événement.
CREATE FUNCTION trg_billets_validate_date_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_debut timestamptz;
BEGIN
    SELECT e.debut INTO v_debut
    FROM public.tarifs t
    JOIN public.evenements e ON e.id = t.evenement_id
    WHERE t.id = NEW.tarif_id;

    IF NEW.created_at >= v_debut THEN
        RAISE EXCEPTION 'billet refusé : l''événement du tarif % a commencé le %', NEW.tarif_id, v_debut
            USING ERRCODE = 'BT005';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_billets_validate_date
BEFORE INSERT ON billets
FOR EACH ROW
EXECUTE FUNCTION trg_billets_validate_date_fn();

COMMENT ON FUNCTION trg_billets_validate_date_fn() IS
    'Refuse un billet dont created_at est postérieur ou égal au début de l''événement (BT005).';
COMMENT ON TRIGGER trg_billets_validate_date ON billets IS
    'BEFORE INSERT FOR EACH ROW : refuse les billets d''un événement déjà commencé. Coût : une recherche par ligne insérée (voir doc/database.md).';

-- =============================================================================
-- Trigger : audit des tarifs
-- =============================================================================
CREATE FUNCTION trg_tarifs_audit_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.journal_tarifs
        (tarif_id, ancien_prix, nouveau_prix, ancien_quota, nouveau_quota, action, auteur)
    VALUES (
        OLD.id,
        OLD.prix,
        CASE WHEN TG_OP = 'UPDATE' THEN NEW.prix END,
        OLD.quota,
        CASE WHEN TG_OP = 'UPDATE' THEN NEW.quota END,
        TG_OP,
        -- Utilisateur applicatif s'il est transmis (phase 05), sinon rôle de connexion.
        coalesce(nullif(current_setting('app.user_id', true), ''), session_user)
    );
    RETURN NULL; -- valeur ignorée pour un trigger AFTER
END;
$$;

-- Deux triggers : la clause WHEN ne peut pas référencer NEW pour un DELETE.
-- WHEN évite d'écrire une ligne d'audit si prix et quota sont inchangés
-- (ex. UPDATE tarifs SET prix = prix).
CREATE TRIGGER trg_tarifs_audit_update
AFTER UPDATE OF prix, quota ON tarifs
FOR EACH ROW
WHEN (OLD.prix IS DISTINCT FROM NEW.prix OR OLD.quota IS DISTINCT FROM NEW.quota)
EXECUTE FUNCTION trg_tarifs_audit_fn();

CREATE TRIGGER trg_tarifs_audit_delete
AFTER DELETE ON tarifs
FOR EACH ROW
EXECUTE FUNCTION trg_tarifs_audit_fn();

COMMENT ON FUNCTION trg_tarifs_audit_fn() IS
    'Écrit l''ancienne et la nouvelle valeur de prix/quota dans journal_tarifs.';
COMMENT ON TRIGGER trg_tarifs_audit_update ON tarifs IS
    'AFTER UPDATE OF prix, quota : journalise uniquement si une valeur change réellement.';
COMMENT ON TRIGGER trg_tarifs_audit_delete ON tarifs IS
    'AFTER DELETE : journalise la suppression d''un tarif (l''historique survit, pas de FK).';

-- =============================================================================
-- Trigger : updated_at
-- =============================================================================
-- Uniquement sur les tables dotées de updated_at et peu écrites.
-- Pas sur billets ni paiements : pas de colonne updated_at (lignes immuables).
CREATE FUNCTION trg_set_updated_at_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_set_updated_at_fn() IS
    'Positionne updated_at à l''heure de la transaction.';

-- WHEN (OLD IS DISTINCT FROM NEW) : pas de mise à jour de date si rien ne change.
CREATE TRIGGER trg_organisateurs_updated_at BEFORE UPDATE ON organisateurs
    FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION trg_set_updated_at_fn();
CREATE TRIGGER trg_lieux_updated_at BEFORE UPDATE ON lieux
    FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION trg_set_updated_at_fn();
CREATE TRIGGER trg_evenements_updated_at BEFORE UPDATE ON evenements
    FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION trg_set_updated_at_fn();
CREATE TRIGGER trg_tarifs_updated_at BEFORE UPDATE ON tarifs
    FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION trg_set_updated_at_fn();
CREATE TRIGGER trg_utilisateurs_updated_at BEFORE UPDATE ON utilisateurs
    FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION trg_set_updated_at_fn();
CREATE TRIGGER trg_commandes_updated_at BEFORE UPDATE ON commandes
    FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION trg_set_updated_at_fn();

COMMENT ON TRIGGER trg_organisateurs_updated_at ON organisateurs IS 'Maintient updated_at.';
COMMENT ON TRIGGER trg_lieux_updated_at ON lieux IS 'Maintient updated_at.';
COMMENT ON TRIGGER trg_evenements_updated_at ON evenements IS 'Maintient updated_at.';
COMMENT ON TRIGGER trg_tarifs_updated_at ON tarifs IS 'Maintient updated_at.';
COMMENT ON TRIGGER trg_utilisateurs_updated_at ON utilisateurs IS 'Maintient updated_at.';
COMMENT ON TRIGGER trg_commandes_updated_at ON commandes IS 'Maintient updated_at.';

-- =============================================================================
-- Bonus : validation de la table EAV evenement_attributs
-- =============================================================================
-- Une contrainte CHECK ne peut pas dépendre de la valeur d'une autre colonne
-- de façon lisible pour chaque clé ; le trigger centralise les règles des clés
-- connues. Les clés inconnues restent acceptées (flexibilité de l'EAV).
CREATE FUNCTION trg_evenement_attributs_validate_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    CASE NEW.cle
        WHEN 'age_minimum' THEN
            -- Deux IF imbriqués : SQL ne garantit pas l'ordre d'évaluation d'un OR,
            -- le cast ::int pourrait s'exécuter sur une valeur non numérique.
            IF NEW.valeur !~ '^[0-9]{1,2}$' THEN
                RAISE EXCEPTION 'age_minimum doit être un entier entre 0 et 21 (reçu « % »)', NEW.valeur
                    USING ERRCODE = 'BT020';
            ELSIF NEW.valeur::int > 21 THEN
                RAISE EXCEPTION 'age_minimum doit être un entier entre 0 et 21 (reçu « % »)', NEW.valeur
                    USING ERRCODE = 'BT020';
            END IF;
        WHEN 'parking', 'accessibilite_pmr' THEN
            IF NEW.valeur NOT IN ('oui', 'non') THEN
                RAISE EXCEPTION '% doit valoir oui ou non (reçu « % »)', NEW.cle, NEW.valeur
                    USING ERRCODE = 'BT020';
            END IF;
        ELSE
            IF btrim(NEW.valeur) = '' THEN
                RAISE EXCEPTION 'valeur vide pour l''attribut %', NEW.cle USING ERRCODE = 'BT020';
            END IF;
    END CASE;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evenement_attributs_validate
BEFORE INSERT OR UPDATE ON evenement_attributs
FOR EACH ROW
EXECUTE FUNCTION trg_evenement_attributs_validate_fn();

COMMENT ON FUNCTION trg_evenement_attributs_validate_fn() IS
    'Valide les valeurs des clés EAV connues (age_minimum, parking, accessibilite_pmr) ; BT020 sinon.';
COMMENT ON TRIGGER trg_evenement_attributs_validate ON evenement_attributs IS
    'BEFORE INSERT OR UPDATE : typage applicatif minimal de la table EAV.';
