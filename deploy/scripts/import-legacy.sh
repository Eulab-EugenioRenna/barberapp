#!/bin/sh
# Importa i dati della vecchia installazione ALORA (VM "barber") nella nuova piattaforma.
# Da eseguire UNA volta, a mano, con Eugenio, su un database nuovo e vuoto.
#
# Prima, sulla vecchia VM (sola lettura, nessuna modifica):
#   docker compose exec -T postgres pg_dump -U <utente> -d <db> -Fc > barber-legacy.dump
#   docker compose exec -T api tar -C /app -czf - uploads > barber-legacy-uploads.tar.gz
# e copiare i due file sulla nuova VM verificando lo sha256.
#
# Uso: deploy/scripts/import-legacy.sh <barber-legacy.dump> [barber-legacy-uploads.tar.gz] <tag-immagine>
# Gli account locali NON vengono convertiti qui: passano a Connect al primo accesso,
# con il percorso assistito dell'app (docs/sso-step-4.md).
set -eu

DUMP="${1:?Specificare il dump della vecchia VM}"
UPLOADS="${2:-}"
TAG="${3:?Specificare il tag immagine}"
ENV_FILE="${ALORA_ENV_FILE:-/srv/alora/.env.production}"
COMPOSE_FILE="$(cd "$(dirname "$0")/.." && pwd)/compose.production.yml"
export ALORA_IMAGE_TAG="$TAG" ALORA_ENV_FILE="$ENV_FILE"
dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

[ -s "$DUMP" ] || { echo "Dump assente o vuoto: $DUMP" >&2; exit 1; }

echo "== Avvio solo del database"
dc up -d postgres
for i in $(seq 1 30); do dc exec -T postgres pg_isready -q && break; sleep 2; done

tables="$(dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from information_schema.tables where table_schema='"'"'public'"'"'"')"
if [ "${tables:-0}" != "0" ]; then
  echo "Il database di destinazione non è vuoto ($tables tabelle): import annullato." >&2
  echo "Per ripetere la prova usare un volume nuovo, mai cancellare dati senza backup." >&2
  exit 1
fi

echo "== Verifica e ripristino del dump"
dc exec -T postgres pg_restore --list < "$DUMP" > /dev/null
dc exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error' < "$DUMP"

echo "== Avvio dell'API: applica le migrazioni mancanti della nuova versione"
dc up -d redis api
for i in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q api)" 2>/dev/null)" = healthy ] && break
  sleep 3
done

if [ -n "$UPLOADS" ]; then
  echo "== Ripristino dei file caricati"
  dc exec -T api tar -C /app -xzf - < "$UPLOADS"
fi

echo "== Conteggi per il confronto con la vecchia VM"
dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  select '"'"'tenant'"'"' as tabella, count(*) from \"Tenant\"
  union all select '"'"'utenti'"'"', count(*) from \"User\"
  union all select '"'"'clienti'"'"', count(*) from \"Customer\"
  union all select '"'"'appuntamenti'"'"', count(*) from \"Appointment\";"' || \
  echo "(nomi tabella da adattare allo schema: confrontare comunque con la vecchia VM)"

echo "Import completato. Avviare poi l'intero stack con deploy.sh $TAG."
