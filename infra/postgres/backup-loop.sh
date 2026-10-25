#!/usr/bin/env bash
# Backup scheduler (TDD §11.4, FR-ADM-06). Runs in the `backup` container, which shares the
# postgres data volume and socket. Every minute it:
#   - runs a requested manual backup (row inserted by POST /api/v1/admin/backups);
#   - at 02:00 local time runs the daily base backup (full on Sunday, differential otherwise);
#   - at 03:00 on Sunday writes the weekly encrypted pg_dump to $DUMP_DIR (kept 12 months).
# Each run is recorded in platform.backup_run so the staff app and backup.verify can see it.
set -uo pipefail

STANZA=bookstore
export PGHOST=/var/run/postgresql PGUSER="${POSTGRES_USER:-bookstore}" PGDATABASE="${POSTGRES_DB:-bookstore}"
DUMP_DIR="${DUMP_DIR:-/dumps}"

q() { psql -X -qAt -v ON_ERROR_STOP=1 -c "$1"; }
esc() { printf "%s" "$1" | sed "s/'/''/g" | tail -c 1500; }

until pg_isready -q; do sleep 5; done
pgbackrest --stanza=$STANZA stanza-create >/dev/null 2>&1 || pgbackrest --stanza=$STANZA check || true

# run <row id> <pgbackrest type|dump>
run() {
  local id=$1 type=$2 out rc label size
  q "update platform.backup_run set status = 'running', started_at = now() where id = '$id'"
  if [ "$type" = dump ]; then
    label="bookstore-$(date +%Y%m%d).dump.enc"
    out=$(pg_dump -Fc | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:DUMP_PASSPHRASE -out "$DUMP_DIR/$label" 2>&1); rc=$?
    size=$(stat -c %s "$DUMP_DIR/$label" 2>/dev/null || echo null)
    find "$DUMP_DIR" -name 'bookstore-*.dump.enc' -mtime +365 -delete
  else
    out=$(pgbackrest --stanza=$STANZA --type="$type" backup 2>&1); rc=$?
    label=$(pgbackrest --stanza=$STANZA info --output=json 2>/dev/null | sed -n 's/.*"label":"\([^"]*\)".*/\1/p' | tail -1)
    size=$(pgbackrest --stanza=$STANZA info --output=json 2>/dev/null | grep -o '"repository":{"delta":[0-9]*' | tail -1 | grep -o '[0-9]*$' || echo null)
  fi
  [ -z "$size" ] && size=null
  if [ $rc -eq 0 ]; then
    q "update platform.backup_run set status = 'succeeded', finished_at = now(), label = '$(esc "$label")', size_bytes = $size where id = '$id'"
  else
    q "update platform.backup_run set status = 'failed', finished_at = now(), error = '$(esc "$out")' where id = '$id'"
    echo "backup $type failed: $out" >&2
  fi
}

scheduled() {
  local kind=$1 type=$2 id
  id=$(q "insert into platform.backup_run (kind, status) values ('$kind', 'requested') on conflict do nothing returning id")
  [ -n "$id" ] && run "$id" "$type"
}

last_daily=""
last_dump=""
while true; do
  manual=$(q "select id from platform.backup_run where status = 'requested' and kind = 'manual' order by requested_at limit 1")
  [ -n "$manual" ] && run "$manual" full

  today=$(TZ=Asia/Ho_Chi_Minh date +%F)
  hour=$(TZ=Asia/Ho_Chi_Minh date +%H)
  dow=$(TZ=Asia/Ho_Chi_Minh date +%u)
  if [ "$hour" = 02 ] && [ "$last_daily" != "$today" ]; then
    if [ "$dow" = 7 ]; then scheduled full full; else scheduled diff diff; fi
    last_daily=$today
  fi
  if [ "$hour" = 03 ] && [ "$dow" = 7 ] && [ "$last_dump" != "$today" ]; then
    scheduled dump dump
    last_dump=$today
  fi
  sleep 60
done
