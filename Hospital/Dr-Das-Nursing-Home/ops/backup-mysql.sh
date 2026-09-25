#!/usr/bin/env sh
set -eu

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:=3306}"
: "${DB_NAME:?DB_NAME is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
OUTPUT_DIR=${BACKUP_DIR:-backups}
mkdir -p "$OUTPUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BASE="$OUTPUT_DIR/${DB_NAME}_${STAMP}"
DUMP="$BASE.sql"
META="$BASE.json"

umask 077
MYSQL_PWD="$DB_PASSWORD" mysqldump --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
  --single-transaction --quick --routines --events --triggers --hex-blob \
  --set-gtid-purged=OFF --databases "$DB_NAME" > "$DUMP"
sha256sum "$DUMP" > "$DUMP.sha256"
cat > "$META" <<EOF
{"database":"$DB_NAME","createdAtUtc":"$STAMP","dump":"$(basename "$DUMP")","sha256":"$(sha256sum "$DUMP" | awk '{print $1}')","schemaMigration":"${SCHEMA_MIGRATION:-unknown}"}
EOF
if [ -n "${AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null 2>&1 || { echo "AGE_RECIPIENT is set but age is unavailable" >&2; exit 1; }
  age -r "$AGE_RECIPIENT" -o "$DUMP.age" "$DUMP"
  rm "$DUMP" "$DUMP.sha256"
  echo "Created encrypted backup: $DUMP.age"
else
  echo "Created unencrypted local backup: $DUMP"
  echo "Do not transfer this artifact off-host without encryption."
fi
printf '%s\n' "$META"
