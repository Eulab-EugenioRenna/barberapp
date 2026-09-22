#!/bin/sh
set -eu

host="${DB_HOST:-postgres}"
port="${DB_PORT:-5432}"
attempts="${DB_WAIT_ATTEMPTS:-60}"
sleep_seconds="${DB_WAIT_SLEEP_SECONDS:-2}"

echo "Waiting for database at ${host}:${port}..."

count=1
while [ "$count" -le "$attempts" ]; do
  if nc -z "$host" "$port" >/dev/null 2>&1; then
    echo "Database reachable at ${host}:${port}"
    exec node dist/apps/api/main.js
  fi

  echo "Database not ready yet (${count}/${attempts})"
  sleep "$sleep_seconds"
  count=$((count + 1))
done

echo "Database did not become reachable at ${host}:${port}"
exit 1
