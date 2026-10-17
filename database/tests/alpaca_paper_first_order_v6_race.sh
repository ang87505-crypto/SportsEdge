#!/usr/bin/env bash
# Two independent PostgreSQL connections race the v6 approve and claim RPCs.
# Disposable database with staging v1-v6 applied; uses PG* environment variables.
set -euo pipefail
q(){ psql -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
q -c "SELECT sportsedge_private.paper_force_halt('sportsedge-paper-stage','RACE_BASE');" >/dev/null
approve(){ q -c "SELECT public.sportsedge_paper_first_order_approve('preview-$1','sepaper_$1','F',1299,
 repeat('c',64),'owner-$1',clock_timestamp(),clock_timestamp()+interval '2 minutes',
 clock_timestamp()+interval '2 hours',1295,1298);" >/dev/null 2>&1 && echo won || echo lost; }
A=$(printf 'a%.0s' {1..32}); B=$(printf 'b%.0s' {1..32})
approve "$A" > $tmp/a & approve "$B" > $tmp/b & wait
wins=$(cat $tmp/a $tmp/b | grep -c won || true)
[ "$wins" = 1 ] || { echo "APPROVE_RACE_FAILED wins=$wins"; exit 1; }
winner=$(grep -q won $tmp/a && echo "$A" || echo "$B")
claim(){ q -c "SELECT public.sportsedge_paper_first_order_claim('preview-$winner');" >/dev/null 2>&1 && echo won || echo lost; }
claim > $tmp/c & claim > $tmp/d & wait
wins=$(cat $tmp/c $tmp/d | grep -c won || true)
[ "$wins" = 1 ] || { echo "CLAIM_RACE_FAILED wins=$wins"; exit 1; }
events=$(q -c "SELECT count(*) FROM sportsedge_private.alpaca_paper_receipt_events WHERE intent_id='preview-$winner';")
[ "$events" = 2 ] || { echo "CLAIM_RECEIPTS_UNEXPECTED=$events"; exit 1; }
echo ALPACA_V6_TWO_CONNECTION_RACE_PASS
