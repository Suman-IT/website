#!/usr/bin/env sh
set -eu
: "${DB_HOST:?DB_HOST is required}"; : "${DB_NAME:?DB_NAME is required}"; : "${DB_USER:?DB_USER is required}"; : "${DB_PASSWORD:?DB_PASSWORD is required}"; : "${EXPORT_HOSPITAL_ID:?EXPORT_HOSPITAL_ID is required}"; : "${EXPORT_ACTOR_USER_ID:?EXPORT_ACTOR_USER_ID is required}"
[ "${EXPORT_CONFIRMATION:-}" = "I_UNDERSTAND_PROTECTED_EXPORT" ] || { echo "Set EXPORT_CONFIRMATION to I_UNDERSTAND_PROTECTED_EXPORT" >&2; exit 1; }
case "$EXPORT_HOSPITAL_ID:$EXPORT_ACTOR_USER_ID" in (*[!0-9:]*|0:*|*:0) echo "IDs must be positive decimal values" >&2; exit 1;; esac
command -v mysqldump >/dev/null || { echo "mysqldump is required" >&2; exit 1; }; command -v mysql >/dev/null || { echo "mysql is required" >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ); folder="${EXPORT_DIR:-migration-exports}/${DB_NAME}_$stamp"; mkdir -p "$folder"; umask 077; export MYSQL_PWD="$DB_PASSWORD"; port="${DB_PORT:-3306}"
authorized=$(mysql --host="$DB_HOST" --port="$port" --user="$DB_USER" --batch --raw --skip-column-names "$DB_NAME" -e "SELECT COUNT(*) FROM user_roles ur JOIN role_permissions rp ON rp.hospital_id=ur.hospital_id AND rp.role_id=ur.role_id WHERE ur.hospital_id=$EXPORT_HOSPITAL_ID AND ur.user_id=$EXPORT_ACTOR_USER_ID AND rp.permission_code='data.export';" | tr -d '\r\n '); [ "$authorized" = 1 ] || { echo "Export actor is not authorized for data.export" >&2; exit 1; }
mysqldump --host="$DB_HOST" --port="$port" --user="$DB_USER" --single-transaction --quick --routines --events --triggers --hex-blob --set-gtid-purged=OFF "$DB_NAME" > "$folder/database.sql"
sha=$(sha256sum "$folder/database.sql" | awk '{print $1}'); printf '%s  database.sql' "$sha" > "$folder/database.sql.sha256"
printf '{"exportVersion":1,"kind":"protected-migration","createdAtUtc":"%s","sourceDatabase":"%s","hospitalId":"%s","schemaMigration":"%s","encoding":"utf-8","sqlSha256":"%s","includesCredentialHashesOnlyInProtectedSql":true,"actorUserId":"%s"}\n' "$stamp" "$DB_NAME" "$EXPORT_HOSPITAL_ID" "${SCHEMA_MIGRATION:-unknown}" "$sha" "$EXPORT_ACTOR_USER_ID" > "$folder/metadata.json"
mysql --host="$DB_HOST" --port="$port" --user="$DB_USER" "$DB_NAME" -e "INSERT INTO audit_events (hospital_id,actor_user_id,action_code,entity_type,entity_id,details) VALUES ($EXPORT_HOSPITAL_ID,$EXPORT_ACTOR_USER_ID,'portability.export','hospital',$EXPORT_HOSPITAL_ID,JSON_OBJECT('exportVersion',1,'createdAtUtc','$stamp','sha256','$sha'));"
unset MYSQL_PWD; echo "Created protected migration export: $folder"; echo "SQL SHA256: $sha"
