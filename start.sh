#!/bin/sh
# Entrypoint for the Docker container.
# Runs DB migration/schema-push first, then starts the Next.js server.
set -e

echo "[start] Running database migrations…"
node scripts/migrate.mjs

echo "[start] Starting server…"
exec node server.js
