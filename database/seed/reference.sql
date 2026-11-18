-- =============================================================================
-- reference.sql — Référentiel minimal du mode « réel » (aucune donnée de démonstration).
-- Types d'événements : même arbre que le jeu de démonstration. Idempotent.
-- Lieux et organisateurs sont créés ensuite par l'administrateur (API).
-- =============================================================================
BEGIN;

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
    (18, 16,   'Business')
ON CONFLICT DO NOTHING;

SELECT setval(pg_get_serial_sequence('type_evenements', 'id'), (SELECT max(id) FROM type_evenements));

COMMIT;
