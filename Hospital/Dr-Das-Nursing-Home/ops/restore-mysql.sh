#!/usr/bin/env sh
set -eu

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:=3306}"
: "${DB_NAME:?DB_NAME is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"

case "$BACKUP_FILE" in
  *.age)
    : "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE is required for .age backups}"
    command -v age >/dev/null 2>&1 || { echo "age is unavailable" >&2; exit 1; }
    age -d -i "$AGE_IDENTITY_FILE" "$BACKUP_FILE" | MYSQL_PWD="$DB_PASSWORD" mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" "$DB_NAME"
    ;;
  *)
    test -f "$BACKUP_FILE"
    if [ -f "$BACKUP_FILE.sha256" ]; then sha256sum -c "$BACKUP_FILE.sha256"; fi
    MYSQL_PWD="$DB_PASSWORD" mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" "$DB_NAME" < "$BACKUP_FILE"
    ;;
esac
printf '%s\n' "Restore completed into $DB_NAME. Run the documented smoke checks before switching traffic."
