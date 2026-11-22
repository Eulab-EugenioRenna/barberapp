#!/bin/sh
# Development only (docker-compose.dev.yml): runs the API built on the host
# (`npm run build:api`) and restarts it whenever a new build lands.
# The build is copied into /app so Node resolves the image's node_modules,
# including the ESM-only Connect SDK. Pending migrations apply on each restart.
# A change to prisma/schema.prisma still needs an image rebuild (Prisma client).
set -eu

SRC="${ALORA_DEV_API_DIST:-/srv/dist/apps/api}"
DEST=/app/dist/apps/api
POLL_SECONDS="${ALORA_DEV_POLL_SECONDS:-2}"
host="${DB_HOST:-postgres}"
port="${DB_PORT:-5432}"
PID=""

echo "Waiting for database at ${host}:${port}..."
until nc -z "$host" "$port" >/dev/null 2>&1; do sleep 2; done

# Newest file time and file count: changes while the host build is writing.
fingerprint() {
  if [ ! -f "$SRC/main.js" ]; then echo "missing"; return; fi
  find "$SRC" -type f -exec stat -c %Y {} + 2>/dev/null | sort -n | awk 'END { print NR ":" $0 }'
}

stop_api() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  PID=""
}

start_api() {
  if [ -f "$SRC/main.js" ]; then
    rm -rf "$DEST.next"
    cp -R "$SRC" "$DEST.next"
    rm -rf "$DEST"
    mv "$DEST.next" "$DEST"
    echo "[dev] API build from host copied"
  else
    echo "[dev] No host build in $SRC: running the build inside the image"
  fi
  node scripts/prisma-bootstrap.js
  node dist/apps/api/main.js &
  PID=$!
}

trap 'stop_api; exit 0' TERM INT

current="$(fingerprint)"
start_api
while true; do
  sleep "$POLL_SECONDS"
  next="$(fingerprint)"
  if [ "$next" != "$current" ] && [ "$next" != "missing" ]; then
    # Wait for the build to settle before restarting.
    sleep "$POLL_SECONDS"
    settled="$(fingerprint)"
    if [ "$settled" = "$next" ]; then
      echo "[dev] New API build detected: restarting"
      current="$settled"
      stop_api
      start_api
    fi
  elif [ -n "$PID" ] && ! kill -0 "$PID" 2>/dev/null; then
    echo "[dev] API stopped: restarting in 3s"
    sleep 3
    start_api
  fi
done
