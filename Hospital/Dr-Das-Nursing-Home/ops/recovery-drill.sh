#!/usr/bin/env sh
set -eu

COMPOSE="docker compose -f compose.recovery.yaml"
DUMP="${TMPDIR:-/tmp}/skdora-recovery-drill.sql"
cleanup() { $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; rm -f "$DUMP"; }
trap cleanup EXIT
$COMPOSE up -d --wait
$COMPOSE exec -T source-db mysqldump -urecovery -precovery-source --single-transaction --quick --routines --events --triggers recovery_source > "$DUMP"
sha256sum "$DUMP"
cat "$DUMP" | $COMPOSE exec -T restore-db mysql -uroot -precovery-restore-root recovery_source
COUNT=$($COMPOSE exec -T restore-db mysql -uroot -precovery-restore-root -N -B recovery_source -e "SELECT COUNT(*) FROM recovery_sentinel WHERE marker='isolated-recovery-drill';" | tr -d '\r\n ')
test "$COUNT" = 1
echo "Recovery drill passed: isolated restore contains the synthetic sentinel row."
