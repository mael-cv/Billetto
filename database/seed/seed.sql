-- =============================================================================
-- seed.sql — Jeu de données déterministe, 100 % set-based (generate_series).
--
-- Paramètres de session (posés par database/scripts/seed.mjs) :
--   seed.mode  = small | full
--   seed.value = graine entière (SEED=20260916 par défaut)
--
-- Déterminisme : pas de random() (sensible à l'ordre d'exécution / parallélisme).
-- Chaque valeur « aléatoire » est dérivée de hashtextextended(sel || n, graine),
-- donc identique d'une exécution à l'autre pour une même graine.
-- Toutes les dates sont relatives à une date de référence fixe (2026-09-16).
-- =============================================================================

BEGIN;

TRUNCATE journal_tarifs, paiements, billets, commandes, amities, utilisateurs,
         tarifs, evenement_attributs, evenements, type_evenements, lieux, organisateurs
    RESTART IDENTITY CASCADE;

DROP SCHEMA IF EXISTS seed_util CASCADE;
CREATE SCHEMA seed_util;

-- Pseudo-aléatoire déterministe dans [0, 1).
CREATE FUNCTION seed_util.r(salt text, n bigint) RETURNS double precision
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT (hashtextextended(salt || ':' || n, current_setting('seed.value')::bigint)
            & 9007199254740991)::double precision / 9007199254740992
$$;

-- Entier déterministe dans [lo, hi].
CREATE FUNCTION seed_util.ri(salt text, n bigint, lo bigint, hi bigint) RETURNS bigint
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT lo + floor(seed_util.r(salt, n) * (hi - lo + 1))::bigint
$$;

CREATE TABLE seed_util.p AS
SELECT *
FROM (VALUES
    --  mode     orga  lieux  evt   tarifs  users   billets  amities
    ('small',    20,   30,    100,  300,    1000,   10000,   2000),
    ('full',     500,  400,   5001, 15001,  100000, 1800000, 200000)
) AS v(mode, n_org, n_lieux, n_evt, n_tarifs, n_users, n_billets, n_amities)
CROSS JOIN (SELECT timestamptz '2026-09-16 12:00:00+02' AS ref) AS r
WHERE mode = current_setting('seed.mode');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM seed_util.p) THEN
        RAISE EXCEPTION 'seed.mode invalide : % (attendu small|full)', current_setting('seed.mode');
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- type_evenements : arbre fixe (3 niveaux) pour WITH RECURSIVE
-- -----------------------------------------------------------------------------
INSERT INTO type_evenements (id, parent_id, nom) OVERRIDING SYSTEM VALUE VALUES
    (1,  NULL, 'Musique'),
    (2,  1,    'Concert'),
    (3,  2,    'Rock'),
    (4,  2,    'Jazz'),
    (5,  2,    'Electro'),
    (6,  1,    'Festival'),
    (7,  NULL, 'Sport'),
    (8,  7,    'Football'),
    (9,  8,    'Ligue 1'),
    (10, 8,    'Ligue 2'),
    (11, 7,    'Basketball'),
    (12, NULL, 'Arts de la scène'),
    (13, 12,   'Théâtre'),
    (14, 12,   'Humour'),
    (15, 12,   'Danse'),
    (16, NULL, 'Conférence'),
    (17, 16,   'Tech'),
    (18, 16,   'Business');

-- Feuilles uniquement, indexées 1..n pour un tirage déterministe.
CREATE TABLE seed_util.types_feuilles AS
SELECT row_number() OVER (ORDER BY t.id) AS rn, t.id
FROM type_evenements t
WHERE NOT EXISTS (SELECT 1 FROM type_evenements c WHERE c.parent_id = t.id);

-- -----------------------------------------------------------------------------
-- organisateurs, lieux
-- -----------------------------------------------------------------------------
INSERT INTO organisateurs (id, nom, email, slug, created_at, updated_at) OVERRIDING SYSTEM VALUE
SELECT g,
       (ARRAY['Nuits','Sonic','Arena','Horizon','Pulse','Lumière','Onde','Atlas'])[1 + g % 8]
           || ' ' || (ARRAY['Productions','Live','Events','Agency','Collective'])[1 + (g / 8) % 5]
           || ' ' || g,
       'orga' || g || '@billetto.test',
       lower((ARRAY['nuits','sonic','arena','horizon','pulse','lumiere','onde','atlas'])[1 + g % 8]
           || '-' || (ARRAY['productions','live','events','agency','collective'])[1 + (g / 8) % 5]
           || '-' || g),
       p.ref - interval '3 years', p.ref - interval '3 years'
FROM seed_util.p p, generate_series(1, p.n_org) AS g;

INSERT INTO lieux (id, nom, adresse, ville, code_postal, capacite, created_at, updated_at)
    OVERRIDING SYSTEM VALUE
SELECT g,
       (ARRAY['Le Transbordeur','La Cigale','Le Zénith','L''Olympia','Le Rocher','La Halle',
              'Le Hangar','La Grande Scène','Le Dôme','La Friche'])[1 + g % 10] || ' ' || g,
       seed_util.ri('lieu_num', g, 1, 250) || ' rue '
           || (ARRAY['de la République','Victor Hugo','des Arts','du Port','Jean Jaurès'])[1 + g % 5],
       v.ville,
       v.cp || lpad(seed_util.ri('lieu_cp', g, 0, 99)::text, 2, '0'),
       seed_util.ri('lieu_cap', g, 2, 60) * 100,
       p.ref - interval '3 years', p.ref - interval '3 years'
FROM seed_util.p p
CROSS JOIN generate_series(1, p.n_lieux) AS g
JOIN (VALUES (0,'Paris','750'),(1,'Lyon','690'),(2,'Marseille','130'),(3,'Bordeaux','330'),
             (4,'Lille','590'),(5,'Nantes','440'),(6,'Toulouse','310'),(7,'Nice','060'),
             (8,'Strasbourg','670'),(9,'Rennes','350'),(10,'Montpellier','340'),
             (11,'Grenoble','380')) AS v(k, ville, cp)
  ON v.k = g % 12;

-- -----------------------------------------------------------------------------
-- evenements : fenêtre [ref - 400 j, ref + 180 j]
--   id % 25 = 0 -> draft ; id % 31 = 0 -> cancelled ; fin < ref -> finished
--   id % 20 = 0 -> publié mais volontairement SANS vente (Q2)
-- -----------------------------------------------------------------------------
INSERT INTO evenements (id, organisateur_id, lieu_id, type_evenement_id, nom, slug, description,
                        debut, fin, statut, created_at, updated_at) OVERRIDING SYSTEM VALUE
SELECT e.g, e.org, e.lieu, tf.id, e.nom,
       'evt-' || e.g, 'Description de ' || e.nom || '.',
       e.debut, e.debut + e.duree,
       CASE WHEN e.g % 25 = 0 THEN 'draft'
            WHEN e.g % 31 = 0 THEN 'cancelled'
            WHEN e.debut + e.duree < p.ref THEN 'finished'
            ELSE 'published' END,
       e.debut - interval '150 days', e.debut - interval '150 days'
FROM seed_util.p p
CROSS JOIN LATERAL (
    SELECT g,
           seed_util.ri('evt_org', g, 1, p.n_org) AS org,
           seed_util.ri('evt_lieu', g, 1, p.n_lieux) AS lieu,
           seed_util.ri('evt_type', g, 1, (SELECT count(*) FROM seed_util.types_feuilles)) AS type_rn,
           (ARRAY['Midnight','Solstice','Echoes','Neon','Velvet','Aurora','Riviera','Kinetic',
                  'Moonlight','Paradox','Wild','Golden'])[1 + g % 12]
               || ' ' || (ARRAY['Session','Night','Tour','Live','Experience','Club'])[1 + (g / 12) % 6]
               || ' #' || g AS nom,
           date_trunc('hour', p.ref - interval '400 days'
               + seed_util.r('evt_debut', g) * interval '580 days') AS debut,
           seed_util.ri('evt_duree', g, 2, 8) * interval '1 hour' AS duree
    FROM generate_series(1, p.n_evt) AS g
) AS e
JOIN seed_util.types_feuilles tf ON tf.rn = e.type_rn;

INSERT INTO evenement_attributs (evenement_id, cle, valeur)
SELECT e.id, a.cle,
       CASE a.cle
           WHEN 'age_minimum' THEN (ARRAY['0','12','16','18'])[1 + e.id % 4]
           WHEN 'dress_code'  THEN (ARRAY['casual','chic','tenue de soirée'])[1 + e.id % 3]
           WHEN 'parking'     THEN (ARRAY['oui','non'])[1 + e.id % 2]
           ELSE (ARRAY['oui','non'])[1 + (e.id / 2) % 2]
       END
FROM evenements e
CROSS JOIN (VALUES (0,'age_minimum'),(1,'dress_code'),(2,'parking'),(3,'accessibilite_pmr')) AS a(k, cle)
WHERE seed_util.r('attr_' || a.cle, e.id) < 0.6;

-- -----------------------------------------------------------------------------
-- tarifs : 3 par événement (Early Bird / Standard / VIP), total = n_tarifs
-- Vente ouverte de debut - 120 j à debut - 1 h. Quota fixé après les billets.
-- -----------------------------------------------------------------------------
INSERT INTO tarifs (id, evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente,
                    actif, created_at, updated_at) OVERRIDING SYSTEM VALUE
SELECT t.g, e.id,
       (ARRAY['Early Bird','Standard','VIP'])[1 + (t.g - 1) % 3],
       round((seed_util.ri('prix_base', e.id, 10, 80)
             * (ARRAY[0.7, 1.0, 2.5])[1 + (t.g - 1) % 3])::numeric, 2),
       1,
       e.debut - interval '120 days', e.debut - interval '1 hour',
       e.statut <> 'draft',
       e.created_at, e.created_at
FROM seed_util.p p
CROSS JOIN generate_series(1, p.n_tarifs) AS t(g)
JOIN evenements e ON e.id = (t.g - 1) / 3 % p.n_evt + 1;

-- Tarifs vendables : événement publié/terminé, hors bucket « sans vente »,
-- vente déjà ouverte à la date de référence.
CREATE TABLE seed_util.tarifs_vendables AS
SELECT row_number() OVER (ORDER BY t.id) AS rn, t.id, t.prix, t.date_debut_vente,
       least(t.date_fin_vente, p.ref) AS fin_fenetre
FROM tarifs t
JOIN evenements e ON e.id = t.evenement_id
CROSS JOIN seed_util.p p
WHERE e.statut IN ('published', 'finished')
  AND e.id % 20 <> 0
  AND t.date_debut_vente < p.ref;

-- -----------------------------------------------------------------------------
-- utilisateurs
--   id 1 = admin ; ids 2..n_org+1 = organizers ; 10 % derniers = jamais commandé (Q6)
-- -----------------------------------------------------------------------------
INSERT INTO utilisateurs (id, email, password_hash, prenom, nom, role_app, organisateur_id,
                          created_at, updated_at) OVERRIDING SYSTEM VALUE
SELECT g,
       'user' || g || '@billetto.test',
       -- Hash non vérifiable : les comptes seedés ne peuvent pas se connecter.
       -- Les comptes de démonstration avec vrai hash Argon2id arrivent au lot F.
       '!seed-no-login',
       (ARRAY['Camille','Léa','Hugo','Lucas','Chloé','Louis','Emma','Nathan','Inès','Jules',
              'Manon','Adam','Sarah','Tom','Zoé','Noah'])[1 + g % 16],
       (ARRAY['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand',
              'Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia'])[1 + (g / 16) % 15],
       CASE WHEN g = 1 THEN 'admin' WHEN g <= p.n_org + 1 THEN 'organizer' ELSE 'visitor' END,
       CASE WHEN g BETWEEN 2 AND p.n_org + 1 THEN g - 1 END,
       p.ref - interval '2 years' + seed_util.r('user_created', g) * interval '600 days',
       p.ref - interval '2 years' + seed_util.r('user_created', g) * interval '600 days'
FROM seed_util.p p, generate_series(1, p.n_users) AS g;

-- ami = u décalé de 1..n-1 (modulo n) : jamais égal à u.
INSERT INTO amities (utilisateur_id, ami_id, statut, created_at)
SELECT a.u, (a.u + seed_util.ri('ami_off', a.g, 0, p.n_users - 2)) % p.n_users + 1,
       (ARRAY['accepted','accepted','accepted','pending','blocked'])[1 + a.g % 5],
       p.ref - seed_util.r('ami_date', a.g) * interval '300 days'
FROM seed_util.p p
CROSS JOIN LATERAL (
    SELECT g, seed_util.ri('ami_u', g, 1, p.n_users) AS u
    FROM generate_series(1, p.n_amities) AS g
) AS a
ON CONFLICT ON CONSTRAINT uq_amities_utilisateur_id_ami_id DO NOTHING;

-- -----------------------------------------------------------------------------
-- commandes : 2 billets par commande, un seul tarif par commande
--   statut : 90 % paid, 4 % pending, 3 % cancelled, 3 % refunded
-- -----------------------------------------------------------------------------
CREATE TABLE seed_util.cmd AS
SELECT c.g AS id,
       seed_util.ri('cmd_user', c.g, 2, floor(p.n_users * 0.9)::bigint) AS utilisateur_id,
       tv.id AS tarif_id,
       tv.prix,
       tv.date_debut_vente + seed_util.r('cmd_date', c.g)
           * (tv.fin_fenetre - tv.date_debut_vente) AS created_at,
       CASE
           WHEN seed_util.r('cmd_statut', c.g) < 0.90 THEN 'paid'
           WHEN seed_util.r('cmd_statut', c.g) < 0.94 THEN 'pending'
           WHEN seed_util.r('cmd_statut', c.g) < 0.97 THEN 'cancelled'
           ELSE 'refunded'
       END AS statut
FROM seed_util.p p
CROSS JOIN generate_series(1, p.n_billets / 2) AS c(g)
JOIN seed_util.tarifs_vendables tv
  ON tv.rn = seed_util.ri('cmd_tarif', c.g, 1, (SELECT count(*) FROM seed_util.tarifs_vendables));

INSERT INTO commandes (id, utilisateur_id, statut, montant_total, created_at, updated_at)
    OVERRIDING SYSTEM VALUE
SELECT id, utilisateur_id, statut, prix * 2, created_at, created_at
FROM seed_util.cmd;

INSERT INTO billets (tarif_id, commande_id, utilisateur_id, code, prix_paye, created_at)
SELECT c.tarif_id, c.id, c.utilisateur_id,
       md5(current_setting('seed.value') || ':billet:' || c.id || ':' || k)::uuid,
       c.prix, c.created_at
FROM seed_util.cmd c
CROSS JOIN generate_series(1, 2) AS k
ORDER BY c.id, k;

-- Paiement principal
INSERT INTO paiements (commande_id, reference, type, montant, statut, created_at)
SELECT id, 'PAY-' || lpad(id::text, 8, '0'), 'charge', prix * 2,
       CASE statut WHEN 'pending' THEN 'pending' WHEN 'cancelled' THEN 'failed' ELSE 'succeeded' END,
       created_at + interval '1 minute'
FROM seed_util.cmd;

-- Remboursements (montant négatif)
INSERT INTO paiements (commande_id, reference, type, montant, statut, created_at)
SELECT id, 'REF-' || lpad(id::text, 8, '0'), 'refund', -(prix * 2), 'succeeded',
       created_at + interval '3 days'
FROM seed_util.cmd
WHERE statut = 'refunded';

-- Quota = vendus + marge (certains tarifs quasi complets pour v_remplissage).
UPDATE tarifs t
SET quota = greatest(1, v.nb + seed_util.ri('quota_marge', t.id, 0, 3) * greatest(10, v.nb / 2))
FROM (SELECT tr.id, count(b.id) AS nb
      FROM tarifs tr LEFT JOIN billets b ON b.tarif_id = tr.id
      GROUP BY tr.id) AS v
WHERE v.id = t.id;

-- Le calcul initial des quotas n'est pas une modification métier : on vide le
-- journal alimenté par trg_tarifs_audit_update (migration 004).
TRUNCATE journal_tarifs;

-- Réaligner les séquences IDENTITY après OVERRIDING SYSTEM VALUE.
DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['type_evenements','organisateurs','lieux','evenements',
                               'tarifs','utilisateurs','commandes'] LOOP
        EXECUTE format('SELECT setval(pg_get_serial_sequence(%L, ''id''), '
                       '(SELECT coalesce(max(id), 0) + 1 FROM %I), false)', tbl, tbl);
    END LOOP;
END $$;

DROP SCHEMA seed_util CASCADE;

COMMIT;

-- Les vues matérialisées ne suivent pas les données : rafraîchir après le seed.
DO $$
BEGIN
    IF to_regclass('public.mv_ventes_quotidiennes') IS NOT NULL THEN
        REFRESH MATERIALIZED VIEW mv_ventes_quotidiennes;
    END IF;
END $$;

ANALYZE;
