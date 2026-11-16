#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
COMMAND="${1:-all}"

case "$COMMAND" in
  db-start)
    PG_CTL="${PG_CTL:-$(command -v pg_ctl || true)}"
    if [[ -z "$PG_CTL" ]]; then
      echo "pg_ctl was not found; install PostgreSQL server tools or set PG_CTL." >&2
      exit 1
    fi
    PGDATA="${PGDATA:-$REPO_ROOT/pgdata}"
    PGPORT="${PGPORT:-${DB_PORT:-5432}}"
    if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
      echo "PostgreSQL data directory is not initialized: $PGDATA (set PGDATA or run initdb first)." >&2
      exit 1
    fi
    "$PG_CTL" -D "$PGDATA" \
      -o "-p $PGPORT -c listen_addresses=localhost" \
      -l "${PG_LOG:-$REPO_ROOT/pg.log}" start
    ;;
  db-check)
    node "$SCRIPT_DIR/db-ready.mjs" \
      --host "${DB_HOST:-${PGHOST:-localhost}}" \
      --port "${DB_PORT:-${PGPORT:-5432}}"
    ;;
  db-init)
    npm run db:init --workspace=backend
    ;;
  lint)
    npm run lint --workspaces --if-present
    ;;
  test)
    npm test
    ;;
  typecheck)
    npm run typecheck --workspaces --if-present
    ;;
  all)
    npm run lint --workspaces --if-present
    npm test
    npm run typecheck --workspaces --if-present
    npm run build
    ;;
  *)
    echo "Usage: $0 {db-start|db-check|db-init|lint|test|typecheck|all}" >&2
    exit 2
    ;;
esac
