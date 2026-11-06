#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Build first: current containers continue serving if compilation fails.
# BuildKit reuses the shared deps layer and persistent npm download cache.
docker compose build api web-admin web-public-booking

# Recreate only application containers, preserving database, Redis and uploads.
docker compose up -d --no-deps --wait --wait-timeout 120 api web-admin web-public-booking

# Gateway upstreams and cache headers may have changed too.
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload
