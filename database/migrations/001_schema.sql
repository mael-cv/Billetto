-- =============================================================================
-- 001_schema.sql — Schéma relationnel Billetto (3FN)
--
-- Volontairement SANS index pédagogiques : seuls existent les index créés
-- implicitement par PRIMARY KEY et UNIQUE. Les index sur clés étrangères
-- (billets.tarif_id, commandes.utilisateur_id, ...) arrivent en 002 afin de
-- mesurer le avant/après avec EXPLAIN ANALYZE. PostgreSQL n'indexe PAS
-- automatiquement les FK.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Référentiels
-- -----------------------------------------------------------------------------
CREATE TABLE organisateurs (
    id          bigint GENERATED ALWAYS AS IDENTITY,
    nom         text        NOT NULL,
    email       text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_organisateurs PRIMARY KEY (id),
    CONSTRAINT uq_organisateurs_email UNIQUE (email),
    CONSTRAINT ck_organisateurs_nom_non_vide CHECK (btrim(nom) <> ''),
    CONSTRAINT ck_organisateurs_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE TABLE lieux (
    id           bigint GENERATED ALWAYS AS IDENTITY,
    nom          text        NOT NULL,
    adresse      text        NOT NULL,
    ville        text        NOT NULL,
    code_postal  text        NOT NULL,
    capacite     integer     NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_lieux PRIMARY KEY (id),
    CONSTRAINT uq_lieux_nom_ville UNIQUE (nom, ville),
    CONSTRAINT ck_lieux_capacite_positive CHECK (capacite > 0),
    CONSTRAINT ck_lieux_code_postal_format CHECK (code_postal ~ '^[0-9]{5}$')
);

-- Hiérarchie (arbre) exploitée par WITH RECURSIVE.
CREATE TABLE type_evenements (
    id         bigint GENERATED ALWAYS AS IDENTITY,
    parent_id  bigint,
    nom        text NOT NULL,
    CONSTRAINT pk_type_evenements PRIMARY KEY (id),
    CONSTRAINT fk_type_evenements_parent_id FOREIGN KEY (parent_id)
        REFERENCES type_evenements (id) ON DELETE RESTRICT,
    CONSTRAINT uq_type_evenements_parent_id_nom UNIQUE NULLS NOT DISTINCT (parent_id, nom),
    CONSTRAINT ck_type_evenements_pas_auto_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- -----------------------------------------------------------------------------
-- Événements
-- -----------------------------------------------------------------------------
CREATE TABLE evenements (
    id                 bigint GENERATED ALWAYS AS IDENTITY,
    organisateur_id    bigint      NOT NULL,
    lieu_id            bigint      NOT NULL,
    type_evenement_id  bigint      NOT NULL,
    nom                text        NOT NULL,
    slug               text        NOT NULL,
    description        text        NOT NULL DEFAULT '',
    debut              timestamptz NOT NULL,
    fin                timestamptz NOT NULL,
    statut             text        NOT NULL DEFAULT 'draft',
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_evenements PRIMARY KEY (id),
    CONSTRAINT uq_evenements_slug UNIQUE (slug),
    CONSTRAINT fk_evenements_organisateur_id FOREIGN KEY (organisateur_id)
        REFERENCES organisateurs (id) ON DELETE RESTRICT,
    CONSTRAINT fk_evenements_lieu_id FOREIGN KEY (lieu_id)
        REFERENCES lieux (id) ON DELETE RESTRICT,
    CONSTRAINT fk_evenements_type_evenement_id FOREIGN KEY (type_evenement_id)
        REFERENCES type_evenements (id) ON DELETE RESTRICT,
    CONSTRAINT ck_evenements_fin_apres_debut CHECK (fin > debut),
    CONSTRAINT ck_evenements_statut CHECK (statut IN ('draft', 'published', 'cancelled', 'finished')),
    CONSTRAINT ck_evenements_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- EAV volontaire (défaut pédagogique du sujet) — voir doc/database.md.
CREATE TABLE evenement_attributs (
    id            bigint GENERATED ALWAYS AS IDENTITY,
    evenement_id  bigint NOT NULL,
    cle           text   NOT NULL,
    valeur        text   NOT NULL,
    CONSTRAINT pk_evenement_attributs PRIMARY KEY (id),
    CONSTRAINT fk_evenement_attributs_evenement_id FOREIGN KEY (evenement_id)
        REFERENCES evenements (id) ON DELETE CASCADE,
    CONSTRAINT uq_evenement_attributs_evenement_id_cle UNIQUE (evenement_id, cle),
    CONSTRAINT ck_evenement_attributs_cle_format CHECK (cle ~ '^[a-z][a-z0-9_]*$')
);

CREATE TABLE tarifs (
    id                bigint GENERATED ALWAYS AS IDENTITY,
    evenement_id      bigint        NOT NULL,
    nom               text          NOT NULL,
    prix              numeric(10,2) NOT NULL,
    quota             integer       NOT NULL,
    date_debut_vente  timestamptz   NOT NULL,
    date_fin_vente    timestamptz   NOT NULL,
    actif             boolean       NOT NULL DEFAULT true,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pk_tarifs PRIMARY KEY (id),
    CONSTRAINT fk_tarifs_evenement_id FOREIGN KEY (evenement_id)
        REFERENCES evenements (id) ON DELETE RESTRICT,
    CONSTRAINT uq_tarifs_evenement_id_nom UNIQUE (evenement_id, nom),
    CONSTRAINT ck_tarifs_prix_positive CHECK (prix >= 0),
    CONSTRAINT ck_tarifs_quota_positive CHECK (quota > 0),
    CONSTRAINT ck_tarifs_periode_vente CHECK (date_fin_vente > date_debut_vente)
);

-- -----------------------------------------------------------------------------
-- Utilisateurs & relations sociales
-- -----------------------------------------------------------------------------
CREATE TABLE utilisateurs (
    id             bigint GENERATED ALWAYS AS IDENTITY,
    email          text        NOT NULL,
    password_hash  text        NOT NULL,
    prenom         text        NOT NULL,
    nom            text        NOT NULL,
    role_app       text        NOT NULL DEFAULT 'visitor',
    organisateur_id bigint,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_utilisateurs PRIMARY KEY (id),
    CONSTRAINT uq_utilisateurs_email UNIQUE (email),
    CONSTRAINT fk_utilisateurs_organisateur_id FOREIGN KEY (organisateur_id)
        REFERENCES organisateurs (id) ON DELETE SET NULL,
    CONSTRAINT ck_utilisateurs_role_app CHECK (role_app IN ('visitor', 'organizer', 'admin')),
    CONSTRAINT ck_utilisateurs_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    -- Un organizer est rattaché à exactement un organisateur ; les autres à aucun.
    CONSTRAINT ck_utilisateurs_organisateur_coherent
        CHECK ((role_app = 'organizer') = (organisateur_id IS NOT NULL))
);

CREATE TABLE amities (
    id              bigint GENERATED ALWAYS AS IDENTITY,
    utilisateur_id  bigint      NOT NULL,
    ami_id          bigint      NOT NULL,
    statut          text        NOT NULL DEFAULT 'pending',
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_amities PRIMARY KEY (id),
    CONSTRAINT fk_amities_utilisateur_id FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs (id) ON DELETE CASCADE,
    CONSTRAINT fk_amities_ami_id FOREIGN KEY (ami_id)
        REFERENCES utilisateurs (id) ON DELETE CASCADE,
    CONSTRAINT uq_amities_utilisateur_id_ami_id UNIQUE (utilisateur_id, ami_id),
    CONSTRAINT ck_amities_pas_soi_meme CHECK (utilisateur_id <> ami_id),
    CONSTRAINT ck_amities_statut CHECK (statut IN ('pending', 'accepted', 'blocked'))
);

-- -----------------------------------------------------------------------------
-- Ventes
-- -----------------------------------------------------------------------------
CREATE TABLE commandes (
    id              bigint GENERATED ALWAYS AS IDENTITY,
    utilisateur_id  bigint        NOT NULL,
    statut          text          NOT NULL DEFAULT 'pending',
    montant_total   numeric(12,2) NOT NULL DEFAULT 0,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pk_commandes PRIMARY KEY (id),
    CONSTRAINT fk_commandes_utilisateur_id FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    CONSTRAINT ck_commandes_statut CHECK (statut IN ('pending', 'paid', 'cancelled', 'refunded')),
    CONSTRAINT ck_commandes_montant_positive CHECK (montant_total >= 0)
);

-- Table lourde (~1,8 M lignes en seed FULL).
-- Une vente = un billet dont la commande est au statut 'paid'.
CREATE TABLE billets (
    id              bigint GENERATED ALWAYS AS IDENTITY,
    tarif_id        bigint        NOT NULL,
    commande_id     bigint        NOT NULL,
    utilisateur_id  bigint        NOT NULL,
    code            uuid          NOT NULL DEFAULT gen_random_uuid(),
    prix_paye       numeric(10,2) NOT NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pk_billets PRIMARY KEY (id),
    CONSTRAINT uq_billets_code UNIQUE (code),
    CONSTRAINT fk_billets_tarif_id FOREIGN KEY (tarif_id)
        REFERENCES tarifs (id) ON DELETE RESTRICT,
    CONSTRAINT fk_billets_commande_id FOREIGN KEY (commande_id)
        REFERENCES commandes (id) ON DELETE RESTRICT,
    CONSTRAINT fk_billets_utilisateur_id FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    CONSTRAINT ck_billets_prix_paye_positive CHECK (prix_paye >= 0)
);

-- Un remboursement est un paiement de type 'refund' au montant négatif.
CREATE TABLE paiements (
    id           bigint GENERATED ALWAYS AS IDENTITY,
    commande_id  bigint        NOT NULL,
    reference    text          NOT NULL,
    type         text          NOT NULL DEFAULT 'charge',
    montant      numeric(12,2) NOT NULL,
    statut       text          NOT NULL DEFAULT 'pending',
    created_at   timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pk_paiements PRIMARY KEY (id),
    CONSTRAINT uq_paiements_reference UNIQUE (reference),
    CONSTRAINT fk_paiements_commande_id FOREIGN KEY (commande_id)
        REFERENCES commandes (id) ON DELETE RESTRICT,
    CONSTRAINT ck_paiements_type CHECK (type IN ('charge', 'refund')),
    CONSTRAINT ck_paiements_statut CHECK (statut IN ('pending', 'succeeded', 'failed')),
    CONSTRAINT ck_paiements_signe_montant CHECK (
        (type = 'charge' AND montant >= 0) OR (type = 'refund' AND montant <= 0)
    )
);

-- Audit alimenté par trigger (lot D). Pas de FK vers tarifs : l'historique
-- doit survivre à la suppression du tarif.
CREATE TABLE journal_tarifs (
    id             bigint GENERATED ALWAYS AS IDENTITY,
    tarif_id       bigint        NOT NULL,
    ancien_prix    numeric(10,2),
    nouveau_prix   numeric(10,2),
    ancien_quota   integer,
    nouveau_quota  integer,
    action         text          NOT NULL,
    auteur         text          NOT NULL DEFAULT current_user,
    created_at     timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pk_journal_tarifs PRIMARY KEY (id),
    CONSTRAINT ck_journal_tarifs_action CHECK (action IN ('UPDATE', 'DELETE'))
);

COMMENT ON TABLE evenement_attributs IS
    'EAV volontaire (défaut pédagogique) : flexible mais non typé, voir doc/database.md';
COMMENT ON TABLE billets IS
    'Table volumineuse. Vente = billet dont la commande est au statut paid.';
COMMENT ON TABLE journal_tarifs IS
    'Journal d''audit des modifications de tarifs, alimenté par trigger.';
