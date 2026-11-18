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
MG_DB="${MONGO_DB:-billetto_nosql}"
# Identifiants MongoDB lus dans l'environnement du conteneur (jamais dans la ligne de commande de l'hôte).
MG_AUTH='-u "$MONGO_INITDB_ROOT_USERNAME" -p "$(cat "$MONGO_INITDB_ROOT_PASSWORD_FILE")" --authenticationDatabase admin'
MG_COUNTS='print("event_pages="+db.event_pages.countDocuments()+" avis="+db.avis.countDocuments()+" activites="+db.activites.countDocuments())'

dest="${1:-backups/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$dest"
echo "» sauvegarde dans $dest"

docker compose exec -T postgres pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$dest/postgres.dump"
docker compose exec -T mongodb sh -c "mongodump --quiet $MG_AUTH --db \"\$1\" --archive --gzip" sh "$MG_DB" > "$dest/mongo.archive"

{
  echo "date: $(date -Iseconds)"
  echo "postgres: $(docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -Atc \
    "SELECT 'evenements='||(SELECT count(*) FROM evenements)||' billets='||(SELECT count(*) FROM billets)||' utilisateurs='||(SELECT count(*) FROM utilisateurs)")"
  echo "mongodb: $(docker compose exec -T mongodb sh -c "mongosh --quiet $MG_AUTH \"\$1\" --eval \"\$2\"" sh "$MG_DB" "$MG_COUNTS")"
} > "$dest/manifest.txt"

ls -l "$dest"
cat "$dest/manifest.txt"
echo "✓ sauvegarde terminée"
