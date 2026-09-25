#!/usr/bin/env sh
set -eu
compose='docker compose -f compose.portability.yaml'
dump="${TMPDIR:-/tmp}/skdora-portability-$$.sql"
cleanup() { $compose down -v --remove-orphans >/dev/null 2>&1 || true; rm -f "$dump"; }
trap cleanup EXIT
$compose up -d --wait source-db target-db
$compose run --rm source-migrate
$compose exec -T source-db mysqldump -uroot -psource-root --single-transaction --quick --routines --events --triggers skdora_source > "$dump"
sha=$(sha256sum "$dump" | awk '{print $1}')
$compose exec -T target-db mysql -uroot -ptarget-root skdora_target < "$dump"
reference=$($compose exec -T target-db mysql -uroot -ptarget-root -N -B skdora_target -e 'SELECT public_reference FROM appointments WHERE id=1;' | tr -d '\r\n ')
test "$reference" = 'RECOVERY-SENTINEL-00000001'
$compose up -d --build --wait target-app
curl --fail --silent http://127.0.0.1:13100/health >/dev/null
curl --fail --silent http://127.0.0.1:13100/api/public/hospital | grep -F 'Recovery Rehearsal Hospital' >/dev/null
echo "Portability rehearsal passed. Target application served migrated data. SHA256: $sha"
