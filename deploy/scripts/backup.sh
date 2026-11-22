#!/bin/sh
# Backup coerente di ALORA in produzione: database (pg_dump formato custom) e file caricati.
# Esce con errore se un passo fallisce o se il dump non è leggibile: il deploy deve fermarsi.
# Uso: deploy/scripts/backup.sh [etichetta]
set -eu

ENV_FILE="${ALORA_ENV_FILE:-/srv/alora/.env.production}"
BACKUP_DIR="${ALORA_BACKUP_DIR:-/srv/alora/backups}"
COMPOSE_FILE="$(cd "$(dirname "$0")/.." && pwd)/compose.production.yml"
LABEL="${1:-manual}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

[ -f "$ENV_FILE" ] || { echo "Manca $ENV_FILE" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Il tag non serve al backup ma il compose lo richiede: uso quello in esecuzione o un segnaposto.
export ALORA_IMAGE_TAG="${ALORA_IMAGE_TAG:-backup}"
dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

if ! dc ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "Database non in esecuzione: primo avvio, nessun dato da salvare."
  exit 0
fi

DB_FILE="$BACKUP_DIR/alora-$STAMP-$LABEL.dump"
UP_FILE="$BACKUP_DIR/alora-$STAMP-$LABEL-uploads.tar.gz"

echo "Dump del database in $DB_FILE"
dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DB_FILE.part"
mv "$DB_FILE.part" "$DB_FILE"

echo "Verifica del dump"
dc exec -T postgres pg_restore --list < "$DB_FILE" > /dev/null
[ -s "$DB_FILE" ] || { echo "Dump vuoto" >&2; exit 1; }

if dc ps --status running --services | grep -qx api; then
  echo "Archivio dei file caricati in $UP_FILE"
  dc exec -T api tar -C /app -czf - uploads > "$UP_FILE.part"
  mv "$UP_FILE.part" "$UP_FILE"
fi

chmod 600 "$BACKUP_DIR"/alora-"$STAMP"-*
echo "Backup completato: $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"
