#!/usr/bin/env bash
# Sauvegarde des deux bases Billetto (PostgreSQL + MongoDB) depuis les conteneurs compose.
#   ./scripts/backup.sh [dossier]      (défaut : ./backups/<horodatage>)
# Produit :
#   postgres.dump   pg_dump -Fc (format custom : restauration sélective, compressé)
#   mongo.archive   mongodump --archive --gzip (toutes les collections de la base)
#   manifest.txt    volumes et comptages, pour vérifier la restauration
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
PG_USER="${POSTGRES_USER:-billetto_owner}"; PG_DB="${POSTGRES_DB:-billetto}"
MG_USER="${MONGO_USER:-billetto_mongo}"; MG_PASS="${MONGO_PASSWORD:-billetto_mongo_pass}"; MG_DB="${MONGO_DB:-billetto_nosql}"

dest="${1:-backups/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$dest"
echo "» sauvegarde dans $dest"

docker compose exec -T postgres pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$dest/postgres.dump"
docker compose exec -T mongodb mongodump --quiet -u "$MG_USER" -p "$MG_PASS" --authenticationDatabase admin \
  --db "$MG_DB" --archive --gzip > "$dest/mongo.archive"

{
  echo "date: $(date -Iseconds)"
  echo "postgres: $(docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -Atc \
    "SELECT 'evenements='||(SELECT count(*) FROM evenements)||' billets='||(SELECT count(*) FROM billets)||' utilisateurs='||(SELECT count(*) FROM utilisateurs)")"
  echo "mongodb: $(docker compose exec -T mongodb mongosh --quiet -u "$MG_USER" -p "$MG_PASS" --authenticationDatabase admin "$MG_DB" \
    --eval 'print("event_pages="+db.event_pages.countDocuments()+" avis="+db.avis.countDocuments()+" activites="+db.activites.countDocuments())')"
} > "$dest/manifest.txt"

ls -l "$dest"
cat "$dest/manifest.txt"
echo "✓ sauvegarde terminée"
