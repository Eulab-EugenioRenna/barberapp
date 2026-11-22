#!/bin/sh
# Deploy di ALORA su VM Proxmox (profilo P1, §14 del modello EULAB).
# Usato a mano al primo giro e poi dal workflow GitHub "deploy" sul runner self-hosted.
# Uso: deploy/scripts/deploy.sh <tag-immagine>   (tag = commit, es. 3f2a9c1...)
# Ritorno indietro: rilanciare con il tag precedente (le migrazioni sono additive;
# se una versione nuova ha cambiato dati, ripristinare il backup fatto prima del deploy).
set -eu

TAG="${1:?Specificare il tag immagine (commit)}"
ENV_FILE="${ALORA_ENV_FILE:-/srv/alora/.env.production}"
HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$HERE/../compose.production.yml"
STATE_DIR="${ALORA_STATE_DIR:-/srv/alora}"

[ -f "$ENV_FILE" ] || { echo "Manca $ENV_FILE (vedi deploy/.env.production.example)" >&2; exit 1; }
perm="$(stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE")"
[ "$perm" = "600" ] || { echo "$ENV_FILE deve avere permessi 600 (ora $perm)" >&2; exit 1; }

for key in POSTGRES_PASSWORD REDIS_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
  grep -Eq "^$key=.+" "$ENV_FILE" || { echo "Variabile obbligatoria vuota: $key" >&2; exit 1; }
done

export ALORA_IMAGE_TAG="$TAG" ALORA_ENV_FILE="$ENV_FILE"
dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

echo "== 1/5 Configurazione"
dc config --quiet

echo "== 2/5 Immagini $TAG"
if [ "${ALORA_SKIP_PULL:-0}" = 1 ]; then
  echo "Download saltato (ALORA_SKIP_PULL=1, solo per prove locali)"
else
  dc pull api web-admin web-public-booking landing
fi

echo "== 3/5 Backup prima delle migrazioni"
"$HERE/backup.sh" "pre-$TAG"

echo "== 4/5 Avvio (l'API applica solo le migrazioni pendenti)"
dc up -d --remove-orphans

echo "== 5/5 Controllo di salute"
port="$(grep -E '^ALORA_HTTP_PORT=' "$ENV_FILE" | cut -d= -f2)"; port="${port:-8080}"
ip="$(grep -E '^ALORA_BIND_IP=' "$ENV_FILE" | cut -d= -f2)"; ip="${ip:-127.0.0.1}"
ok=0
for i in $(seq 1 40); do
  api="$(curl -s -o /dev/null -w '%{http_code}' "http://$ip:$port/api/health" || true)"
  home="$(curl -s -o /dev/null -w '%{http_code}' "http://$ip:$port/" || true)"
  admin="$(curl -s -o /dev/null -w '%{http_code}' "http://$ip:$port/admin/" || true)"
  if [ "$api" = 200 ] && [ "$home" = 200 ] && [ "$admin" = 200 ]; then ok=1; break; fi
  sleep 3
done
dc ps
if [ "$ok" != 1 ]; then
  echo "Controllo fallito: api=$api home=$home admin=$admin" >&2
  dc logs --tail 80 api >&2 || true
  exit 1
fi

prev="$(cat "$STATE_DIR/current-tag" 2>/dev/null || echo nessuno)"
echo "$prev" > "$STATE_DIR/previous-tag"
echo "$TAG" > "$STATE_DIR/current-tag"
echo "Deploy riuscito: $TAG (precedente: $prev). api=200 /=200 /admin/=200"
