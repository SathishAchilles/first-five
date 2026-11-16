#!/usr/bin/env bash
# Copies the Render Postgres database straight into Supabase schema first_five
# in one streamed transaction (pg_dump | psql). Nothing is written to disk and
# Render is only read; any error rolls the whole copy back.
#
#   SRC  Render external connection string, with sslmode=require
#   DST  Supabase session pooler (port 5432)
#   PG_BIN  directory with pg_dump/psql 17 (default: Homebrew libpq); the
#           client must be >= the Render server (16)
#
# Usage: SRC=... DST=... scripts/db-copy/copy-render-to-supabase.sh
set -euo pipefail

: "${SRC:?Set SRC to the Render external connection string (sslmode=require)}"
: "${DST:?Set DST to the Supabase session pooler connection string (port 5432)}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/libpq/bin}"
PG_DUMP="$PG_BIN/pg_dump"
PSQL="$PG_BIN/psql"

major="$("$PG_DUMP" --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
if (( major < 17 )); then
  echo "$PG_DUMP is version $major; need 17 or later (brew install libpq)." >&2
  exit 1
fi

echo "Copying Render -> Supabase first_five (single transaction)..."
{ "$PG_DUMP" --no-owner --no-acl --no-comments "$SRC"; cat "$HERE/move-to-first-five.sql"; } \
  | "$PSQL" -X -q -v ON_ERROR_STOP=1 --single-transaction "$DST" > /dev/null
echo "Copy committed."

counts() { # $1 = connection string, $2 = schema
  "$PSQL" -X -q -At -F '|' -v ON_ERROR_STOP=1 -v schema="$2" "$1" -f "$HERE/row-counts.sql" | grep '|'
}

src_counts="$(counts "$SRC" public)"
dst_counts="$(counts "$DST" first_five)"

printf '%-34s %10s %10s\n' table render supabase
mismatch=0
while IFS='|' read -r table n; do
  m="$(printf '%s\n' "$dst_counts" | awk -F'|' -v t="$table" '$1 == t { print $2 }')"
  flag=""
  if [[ "$n" != "$m" ]]; then flag="  MISMATCH"; mismatch=1; fi
  printf '%-34s %10s %10s%s\n' "$table" "$n" "${m:--}" "$flag"
done <<< "$src_counts"

if (( mismatch )); then
  echo "Row counts differ." >&2
  exit 1
fi
echo "All row counts match."
