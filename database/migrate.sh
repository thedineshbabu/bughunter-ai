#!/usr/bin/env bash
# database/migrate.sh — Run unapplied SQL migrations in order.
#
# Usage:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bughunter ./database/migrate.sh
#
# The script creates a schema_migrations table on first run and skips any
# migration whose version is already recorded in that table.

set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/bughunter}"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/migrations" && pwd)"

echo "==> Connecting to: $DB_URL"

# Ensure the tracking table exists
psql "$DB_URL" -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    VARCHAR(50) PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  );
" > /dev/null

# Apply migrations in sorted filename order
for file in "$MIGRATIONS_DIR"/*.sql; do
  version="$(basename "$file" .sql)"

  already_applied=$(psql "$DB_URL" -t -c \
    "SELECT COUNT(*) FROM schema_migrations WHERE version = '$version';" | tr -d ' ')

  if [ "$already_applied" -gt "0" ]; then
    echo "  [skip]  $version"
  else
    echo "  [apply] $version"
    psql "$DB_URL" -f "$file"
    # Migration 005+ records itself; for older plain migrations insert manually
    psql "$DB_URL" -c "
      INSERT INTO schema_migrations (version) VALUES ('$version')
      ON CONFLICT (version) DO NOTHING;
    " > /dev/null
  fi
done

echo "==> All migrations applied."
