-- =============================================================================
-- Tests phase 04 — fonctions, procédure, triggers
-- Jeu d'essai propre (dates relatives à now()), indépendant du seed.
-- Tout est annulé par ROLLBACK. La concurrence est testée par
-- database/scripts/concurrency.mjs (plusieurs sessions nécessaires).
-- =============================================================================

BEGIN;

-- Vérifie qu'une instruction échoue avec le SQLSTATE attendu.
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_code text, p_label text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_code THEN
            RAISE NOTICE 'OK % → % (%)', p_label, SQLSTATE, SQLERRM;
            RETURN;
        END IF;
        RAISE EXCEPTION '% : SQLSTATE % attendu, obtenu % (%)', p_label, p_code, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION '% : une erreur % était attendue, aucune levée', p_label, p_code;
END;
$$;

-- -----------------------------------------------------------------------------
-- Jeu d'essai
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE fx (cle text PRIMARY KEY, id bigint) ON COMMIT DROP;

DO $$
DECLARE
    v_orga bigint; v_lieu bigint; v_type bigint; v_evt bigint; d record;
BEGIN
    INSERT INTO organisateurs (nom, email) VALUES ('Test Orga', 'test-orga@billetto.test')
    RETURNING id INTO v_orga;
    INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
    VALUES ('Test Salle', '1 rue du Test', 'Testville', '99000', 500)
    RETURNING id INTO v_lieu;
    SELECT min(id) INTO v_type FROM type_evenements;
    INSERT INTO fx VALUES ('orga', v_orga), ('lieu', v_lieu);

    INSERT INTO utilisateurs (email, password_hash, prenom, nom)
    VALUES ('test-acheteur@billetto.test', 'x', 'Test', 'Acheteur')
    RETURNING id INTO v_evt;
    INSERT INTO fx VALUES ('user', v_evt);

    -- Événements : à venir / commencé / brouillon
    FOR d IN SELECT * FROM (VALUES
        ('evt_futur',    'Test futur',     'test-futur',     interval '30 days', interval '3 hours',  'published'),
        ('evt_commence', 'Test commencé',  'test-commence',  interval '-1 hour', interval '3 hours',  'published'),
        ('evt_draft',    'Test brouillon', 'test-brouillon', interval '30 days', interval '1 day',    'draft')
    ) AS v(cle, nom, slug, decalage, duree, statut)
    LOOP
        INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
        VALUES (v_orga, v_lieu, v_type, d.nom, d.slug, now() + d.decalage, now() + d.decalage + d.duree, d.statut)
        RETURNING id INTO v_evt;
        INSERT INTO fx VALUES (d.cle, v_evt);
    END LOOP;

    -- Tarifs (fenêtres de vente relatives à now())
    FOR d IN SELECT * FROM (VALUES
        ('t_ok',       'evt_futur',    'Standard',   25.00, 5, interval '-1 day',   interval '29 days',  true),
        ('t_inactif',  'evt_futur',    'Inactif',    25.00, 5, interval '-1 day',   interval '29 days',  false),
        ('t_ferme',    'evt_futur',    'Pas ouvert', 25.00, 5, interval '1 day',    interval '29 days',  true),
        ('t_commence', 'evt_commence', 'Standard',   25.00, 5, interval '-10 days', interval '-2 hours', true),
        ('t_draft',    'evt_draft',    'Standard',   25.00, 5, interval '-1 day',   interval '29 days',  true),
        ('t_libre',    'evt_futur',    'Invendu',    10.00, 5, interval '-1 day',   interval '29 days',  true)
    ) AS v(cle, evt, nom, prix, quota, debut_vente, fin_vente, actif)
    LOOP
        INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente, actif)
        VALUES ((SELECT id FROM fx WHERE cle = d.evt), d.nom, d.prix, d.quota,
                now() + d.debut_vente, now() + d.fin_vente, d.actif)
        RETURNING id INTO v_evt;
        INSERT INTO fx VALUES (d.cle, v_evt);
    END LOOP;
END $$;

-- Accès rapide aux identifiants dans les blocs DO
CREATE FUNCTION pg_temp.fx(p_cle text) RETURNS bigint LANGUAGE sql STABLE AS
    $$ SELECT id FROM fx WHERE cle = p_cle $$;

-- -----------------------------------------------------------------------------
-- acheter_billet : achat valide
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    r record; n_billets bigint; n_paiements bigint; statut text;
BEGIN
    SELECT * INTO r FROM acheter_billet(pg_temp.fx('user'), pg_temp.fx('t_ok'), 2);

    ASSERT r.commande_id IS NOT NULL AND r.paiement_id IS NOT NULL, 'identifiants renvoyés';
    ASSERT array_length(r.billet_ids, 1) = 2, 'deux billets renvoyés';
    ASSERT r.montant_total = 50.00, format('montant 50.00 attendu, %s', r.montant_total);

    SELECT c.statut INTO statut FROM commandes c WHERE c.id = r.commande_id;
    SELECT count(*) INTO n_billets FROM billets b
    WHERE b.commande_id = r.commande_id AND b.prix_paye = 25.00 AND b.utilisateur_id = pg_temp.fx('user');
    SELECT count(*) INTO n_paiements FROM paiements p
    WHERE p.commande_id = r.commande_id AND p.type = 'charge' AND p.montant = 50.00 AND p.statut = 'succeeded';

    ASSERT statut = 'paid', 'commande paid';
    ASSERT n_billets = 2, 'deux billets en base';
    ASSERT n_paiements = 1, 'un paiement charge en base';
    RAISE NOTICE 'OK achat valide : commande %, billets %', r.commande_id, r.billet_ids;
END $$;

-- -----------------------------------------------------------------------------
-- acheter_billet : erreurs métier
-- -----------------------------------------------------------------------------
SELECT pg_temp.expect_error(format('SELECT acheter_billet(%s, %s, 4)', pg_temp.fx('user'), pg_temp.fx('t_ok')),
                            'BT006', 'quota épuisé (3 restants, 4 demandés)');
SELECT pg_temp.expect_error(format('SELECT acheter_billet(%s, %s, 1)', pg_temp.fx('user'), pg_temp.fx('t_commence')),
                            'BT005', 'événement commencé');
SELECT pg_temp.expect_error(format('SELECT acheter_billet(%s, -1, 1)', pg_temp.fx('user')),
                            'BT001', 'tarif inexistant');
SELECT pg_temp.expect_error(format('SELECT acheter_billet(%s, %s, 1)', pg_temp.fx('user'), pg_temp.fx('t_inactif')),
                            'BT002', 'tarif inactif');
SELECT pg_temp.expect_error(format('SELECT acheter_billet(%s, %s, 1)', pg_temp.fx('user'), pg_temp.fx('t_draft')),
                            'BT003', 'événement non publié');
SELECT pg_temp.expect_error(format('SELECT acheter_billet(%s, %s, 1)', pg_temp.fx('user'), pg_temp.fx('t_ferme')),
                            'BT004', 'vente pas encore ouverte');
SELECT pg_temp.expect_error(format('SELECT acheter_billet(%s, %s, 0)', pg_temp.fx('user'), pg_temp.fx('t_ok')),
                            'BT007', 'quantité 0');
SELECT pg_temp.expect_error(format('SELECT acheter_billet(%s, %s, 11)', pg_temp.fx('user'), pg_temp.fx('t_ok')),
                            'BT007', 'quantité 11');
SELECT pg_temp.expect_error(format('SELECT acheter_billet(-1, %s, 1)', pg_temp.fx('t_ok')),
                            'BT008', 'utilisateur inexistant');

-- Une erreur ne laisse aucune trace (atomicité)
DO $$
BEGIN
    ASSERT (SELECT count(*) FROM commandes WHERE utilisateur_id = pg_temp.fx('user')) = 1,
        'les achats refusés ne doivent créer aucune commande';
    RAISE NOTICE 'OK atomicité : seules les données de l''achat valide existent';
END $$;

-- Quota atteint exactement : 3 restants, 3 achetés, puis 1 de plus refusé
SELECT count(*) FROM acheter_billet(pg_temp.fx('user'), pg_temp.fx('t_ok'), 3);
SELECT pg_temp.expect_error(format('SELECT acheter_billet(%s, %s, 1)', pg_temp.fx('user'), pg_temp.fx('t_ok')),
                            'BT006', 'quota atteint exactement (5/5)');

-- -----------------------------------------------------------------------------
-- ca_evenement / billets_utilisateur
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    ca_fn numeric; ca_vue numeric; n bigint;
BEGIN
    SELECT ca_evenement(pg_temp.fx('evt_futur')) INTO ca_fn;
    SELECT ca INTO ca_vue FROM v_ventes_par_evenement WHERE evenement_id = pg_temp.fx('evt_futur');
    ASSERT ca_fn = 125.00, format('ca_evenement : 125.00 attendu, %s', ca_fn);
    ASSERT ca_fn = ca_vue, 'ca_evenement doit égaler v_ventes_par_evenement.ca';
    ASSERT ca_evenement(pg_temp.fx('evt_draft')) = 0, 'CA 0 pour un événement sans vente';
    ASSERT ca_evenement(-1) = 0, 'CA 0 pour un événement inconnu';

    SELECT count(*) INTO n FROM billets_utilisateur(pg_temp.fx('user'))
    WHERE evenement = 'Test futur' AND ville = 'Testville' AND statut_commande = 'paid';
    ASSERT n = 5, format('billets_utilisateur : 5 billets attendus, %s', n);

    -- Cohérence sur un utilisateur du seed
    SELECT count(*) INTO n FROM billets_utilisateur(4242);
    ASSERT n = (SELECT count(*) FROM billets WHERE utilisateur_id = 4242),
        'billets_utilisateur doit renvoyer tous les billets de l''utilisateur';
    RAISE NOTICE 'OK ca_evenement = %, billets_utilisateur', ca_fn;
END $$;

-- -----------------------------------------------------------------------------
-- rembourser_commande
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_cmd bigint; v_montant numeric; n_refund bigint;
BEGIN
    SELECT id, montant_total INTO v_cmd, v_montant
    FROM commandes WHERE utilisateur_id = pg_temp.fx('user') ORDER BY id LIMIT 1;

    CALL rembourser_commande(v_cmd);

    ASSERT (SELECT statut FROM commandes WHERE id = v_cmd) = 'refunded', 'statut refunded';
    SELECT count(*) INTO n_refund FROM paiements
    WHERE commande_id = v_cmd AND type = 'refund' AND montant = -v_montant AND statut = 'succeeded';
    ASSERT n_refund = 1, 'un paiement refund négatif';
    RAISE NOTICE 'OK remboursement commande % (%)', v_cmd, -v_montant;

    PERFORM pg_temp.expect_error(format('CALL rembourser_commande(%s)', v_cmd), 'BT011', 'second remboursement');
END $$;

SELECT pg_temp.expect_error('CALL rembourser_commande(-1)', 'BT010', 'commande inexistante');

-- Le remboursement libère 2 places : on peut racheter 2 billets, pas 3
SELECT pg_temp.expect_error(format('SELECT acheter_billet(%s, %s, 3)', pg_temp.fx('user'), pg_temp.fx('t_ok')),
                            'BT006', 'places libérées limitées à 2');
DO $$
BEGIN
    PERFORM acheter_billet(pg_temp.fx('user'), pg_temp.fx('t_ok'), 2);
    RAISE NOTICE 'OK places libérées par le remboursement rachetées';
END $$;

-- Remboursement refusé après le début de l'événement
DO $$
DECLARE
    v_cmd bigint;
BEGIN
    INSERT INTO commandes (utilisateur_id, statut, montant_total, created_at)
    VALUES (pg_temp.fx('user'), 'paid', 25.00, now() - interval '1 day')
    RETURNING id INTO v_cmd;
    INSERT INTO billets (tarif_id, commande_id, utilisateur_id, prix_paye, created_at)
    VALUES (pg_temp.fx('t_commence'), v_cmd, pg_temp.fx('user'), 25.00, now() - interval '1 day');

    PERFORM pg_temp.expect_error(format('CALL rembourser_commande(%s)', v_cmd), 'BT012',
                                 'remboursement après début de l''événement');
END $$;

-- -----------------------------------------------------------------------------
-- trg_billets_validate_date
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_cmd bigint;
BEGIN
    INSERT INTO commandes (utilisateur_id, statut, montant_total)
    VALUES (pg_temp.fx('user'), 'paid', 25.00) RETURNING id INTO v_cmd;

    PERFORM pg_temp.expect_error(
        format('INSERT INTO billets (tarif_id, commande_id, utilisateur_id, prix_paye) VALUES (%s, %s, %s, 25)',
               pg_temp.fx('t_commence'), v_cmd, pg_temp.fx('user')),
        'BT005', 'trigger : INSERT direct d''un billet pour un événement commencé');

    -- Un billet daté d'avant le début reste accepté (ventes historiques du seed)
    INSERT INTO billets (tarif_id, commande_id, utilisateur_id, prix_paye, created_at)
    VALUES (pg_temp.fx('t_commence'), v_cmd, pg_temp.fx('user'), 25, now() - interval '2 hours');
    RAISE NOTICE 'OK trigger : billet antérieur au début accepté';
END $$;

-- -----------------------------------------------------------------------------
-- Audit des tarifs
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    t bigint := pg_temp.fx('t_ok'); j record; n bigint;
BEGIN
    UPDATE tarifs SET prix = 30.00 WHERE id = t;
    SELECT * INTO j FROM journal_tarifs WHERE tarif_id = t ORDER BY id DESC LIMIT 1;
    ASSERT j.action = 'UPDATE' AND j.ancien_prix = 25.00 AND j.nouveau_prix = 30.00
       AND j.ancien_quota = 5 AND j.nouveau_quota = 5,
        format('audit prix incorrect : %s', row_to_json(j));

    UPDATE tarifs SET quota = 8 WHERE id = t;
    SELECT count(*) INTO n FROM journal_tarifs WHERE tarif_id = t;
    ASSERT n = 2, 'modification du quota journalisée';

    UPDATE tarifs SET nom = 'Standard renommé' WHERE id = t;
    UPDATE tarifs SET prix = prix WHERE id = t;
    SELECT count(*) INTO n FROM journal_tarifs WHERE tarif_id = t;
    ASSERT n = 2, 'renommage et prix inchangé ne doivent pas être journalisés';

    DELETE FROM tarifs WHERE id = pg_temp.fx('t_libre');
    SELECT * INTO j FROM journal_tarifs WHERE tarif_id = pg_temp.fx('t_libre');
    ASSERT j.action = 'DELETE' AND j.ancien_prix = 10.00 AND j.nouveau_prix IS NULL,
        'suppression journalisée avec l''ancien prix';
    ASSERT NOT EXISTS (SELECT 1 FROM tarifs WHERE id = pg_temp.fx('t_libre')), 'tarif supprimé';
    RAISE NOTICE 'OK audit : UPDATE prix, UPDATE quota, pas de ligne inutile, DELETE';
END $$;

-- -----------------------------------------------------------------------------
-- updated_at
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    avant timestamptz;
BEGIN
    UPDATE lieux SET updated_at = now() - interval '10 days' WHERE id = pg_temp.fx('lieu');
    -- Le trigger écrase aussi une valeur explicite : forcer une date ancienne
    -- n'est possible qu'en désactivant le trigger, ce qu'on vérifie ici.
    SELECT updated_at INTO avant FROM lieux WHERE id = pg_temp.fx('lieu');
    ASSERT avant = now(), 'updated_at positionné par le trigger lors de toute modification';

    ALTER TABLE lieux DISABLE TRIGGER trg_lieux_updated_at;
    UPDATE lieux SET updated_at = now() - interval '10 days' WHERE id = pg_temp.fx('lieu');
    ALTER TABLE lieux ENABLE TRIGGER trg_lieux_updated_at;

    UPDATE lieux SET capacite = 600 WHERE id = pg_temp.fx('lieu');
    ASSERT (SELECT updated_at FROM lieux WHERE id = pg_temp.fx('lieu')) = now(), 'updated_at rafraîchi';

    ALTER TABLE lieux DISABLE TRIGGER trg_lieux_updated_at;
    UPDATE lieux SET updated_at = now() - interval '10 days' WHERE id = pg_temp.fx('lieu');
    ALTER TABLE lieux ENABLE TRIGGER trg_lieux_updated_at;
    UPDATE lieux SET capacite = capacite WHERE id = pg_temp.fx('lieu');
    ASSERT (SELECT updated_at FROM lieux WHERE id = pg_temp.fx('lieu')) < now(),
        'UPDATE sans changement : updated_at inchangé (WHEN OLD IS DISTINCT FROM NEW)';
    RAISE NOTICE 'OK updated_at';
END $$;

-- -----------------------------------------------------------------------------
-- Validation EAV
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    e bigint := pg_temp.fx('evt_futur');
BEGIN
    INSERT INTO evenement_attributs (evenement_id, cle, valeur) VALUES
        (e, 'age_minimum', '18'), (e, 'parking', 'oui'), (e, 'dress_code', 'chic'), (e, 'cle_libre', 'ok');

    PERFORM pg_temp.expect_error(format('INSERT INTO evenement_attributs (evenement_id, cle, valeur) VALUES (%s, ''accessibilite_pmr'', ''peut-être'')', e),
                                 'BT020', 'EAV : accessibilite_pmr hors oui/non');
    PERFORM pg_temp.expect_error(format('UPDATE evenement_attributs SET valeur = ''dix-huit'' WHERE evenement_id = %s AND cle = ''age_minimum''', e),
                                 'BT020', 'EAV : age_minimum non numérique');
    PERFORM pg_temp.expect_error(format('UPDATE evenement_attributs SET valeur = ''99'' WHERE evenement_id = %s AND cle = ''age_minimum''', e),
                                 'BT020', 'EAV : age_minimum > 21');
    PERFORM pg_temp.expect_error(format('INSERT INTO evenement_attributs (evenement_id, cle, valeur) VALUES (%s, ''note'', ''  '')', e),
                                 'BT020', 'EAV : valeur vide');
    RAISE NOTICE 'OK validation EAV';
END $$;

-- -----------------------------------------------------------------------------
-- Métadonnées : SECURITY DEFINER, search_path, EXECUTE retiré à PUBLIC, commentaires
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    n_sans_commentaire bigint;
BEGIN
    ASSERT (SELECT prosecdef FROM pg_proc WHERE proname = 'acheter_billet'), 'acheter_billet SECURITY DEFINER';
    ASSERT (SELECT 'search_path=public, pg_temp' = ANY (proconfig) FROM pg_proc WHERE proname = 'acheter_billet'),
        'acheter_billet : search_path figé';
    ASSERT NOT has_function_privilege('public', 'acheter_billet(bigint, bigint, integer)', 'EXECUTE'),
        'EXECUTE retiré à PUBLIC sur acheter_billet';
    ASSERT NOT has_function_privilege('public', 'rembourser_commande(bigint)', 'EXECUTE'),
        'EXECUTE retiré à PUBLIC sur rembourser_commande';

    SELECT count(*) INTO n_sans_commentaire
    FROM pg_trigger tg
    WHERE NOT tg.tgisinternal
      AND tg.tgrelid::regclass::text IN ('billets', 'tarifs', 'lieux', 'evenements', 'organisateurs',
                                        'utilisateurs', 'commandes', 'evenement_attributs')
      AND obj_description(tg.oid, 'pg_trigger') IS NULL;
    ASSERT n_sans_commentaire = 0, format('%s trigger(s) sans COMMENT ON', n_sans_commentaire);
    RAISE NOTICE 'OK métadonnées de sécurité et commentaires';
END $$;

ROLLBACK;
