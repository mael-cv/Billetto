#!/usr/bin/env bash
# Restauration des deux bases Billetto depuis un dossier produit par backup.sh.
#   ./scripts/restore.sh backups/<horodatage>
# PostgreSQL : pg_restore --clean --if-exists (remplace les objets existants, une transaction).
# MongoDB    : mongorestore --drop (chaque collection est vidée puis rechargée, index compris).
# Arrêter l'API pendant la restauration (docker compose stop api) pour éviter les écritures concurrentes.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
PG_USER="${POSTGRES_USER:-billetto_owner}"; PG_DB="${POSTGRES_DB:-billetto}"
MG_DB="${MONGO_DB:-billetto_nosql}"
# Identifiants MongoDB lus dans l'environnement du conteneur (jamais dans la ligne de commande de l'hôte).
MG_AUTH='-u "$MONGO_INITDB_ROOT_USERNAME" -p "$(cat "$MONGO_INITDB_ROOT_PASSWORD_FILE")" --authenticationDatabase admin'
MG_COUNTS='print("event_pages="+db.event_pages.countDocuments()+" avis="+db.avis.countDocuments()+" activites="+db.activites.countDocuments())'

src="${1:?dossier de sauvegarde requis}"
[ -f "$src/postgres.dump" ] && [ -f "$src/mongo.archive" ] || { echo "sauvegarde incomplète dans $src"; exit 1; }

echo "» restauration PostgreSQL ($PG_DB)"
docker compose exec -T postgres pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists --single-transaction --no-owner < "$src/postgres.dump"
echo "» restauration MongoDB ($MG_DB)"
docker compose exec -T mongodb sh -c "mongorestore --quiet $MG_AUTH --nsInclude \"\$1.*\" --drop --archive --gzip" sh "$MG_DB" < "$src/mongo.archive"

echo "» vérification"
echo "attendu : $(sed -n '2,3p' "$src/manifest.txt" | tr '\n' ' ')"
echo "obtenu  : postgres: $(docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -Atc \
  "SELECT 'evenements='||(SELECT count(*) FROM evenements)||' billets='||(SELECT count(*) FROM billets)||' utilisateurs='||(SELECT count(*) FROM utilisateurs)") mongodb: $(docker compose exec -T mongodb sh -c "mongosh --quiet $MG_AUTH \"\$1\" --eval \"\$2\"" sh "$MG_DB" "$MG_COUNTS")"
echo "✓ restauration terminée (relancer : docker compose start api)"
