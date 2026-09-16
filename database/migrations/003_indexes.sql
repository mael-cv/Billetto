-- =============================================================================
-- 003_indexes.sql — Index justifiés par les plans « avant »
--
-- Chaque index répond à un plan mesuré dans database/benchmarks/before/ et
-- documenté dans doc/performance.md. PostgreSQL n'indexe pas les clés
-- étrangères automatiquement : ces colonnes étaient lues en Seq Scan.
--
-- Pas de CREATE INDEX CONCURRENTLY ici : les migrations s'exécutent dans une
-- transaction (CONCURRENTLY y est interdit). En production sur une table
-- chargée, créer l'index hors transaction avec CONCURRENTLY pour ne pas
-- bloquer les écritures.
-- =============================================================================

-- B1, B5, B8 (jointure billets → commandes) : billets d'une commande.
CREATE INDEX idx_billets_commande_id ON billets (commande_id);

-- B5, B6 : billets d'un tarif (ventes d'un événement).
CREATE INDEX idx_billets_tarif_id ON billets (tarif_id);

-- B2, B8 : commandes d'un utilisateur.
-- Colonne created_at ajoutée : l'index fournit directement l'ordre de
-- « ORDER BY created_at DESC LIMIT 20 » sans tri (parcours à rebours).
CREATE INDEX idx_commandes_utilisateur_id ON commandes (utilisateur_id, created_at);

-- B3 : paiements d'une commande.
CREATE INDEX idx_paiements_commande_id ON paiements (commande_id);

-- B4 : événements par date de début (plages de dates + tri).
CREATE INDEX idx_evenements_debut ON evenements (debut);

-- Index de FK restants, sur des tables petites ou peu filtrées : non créés tant
-- qu'aucun plan ne les justifie (evenements.lieu_id, evenements.organisateur_id,
-- billets.utilisateur_id…). billets.utilisateur_id sera réévalué avec
-- billets_utilisateur() en phase 04.

ANALYZE billets;
ANALYZE commandes;
ANALYZE paiements;
ANALYZE evenements;
