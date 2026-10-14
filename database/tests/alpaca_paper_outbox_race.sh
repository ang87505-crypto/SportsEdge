#!/usr/bin/env bash
set -euo pipefail
# Run only against disposable postgresql service configured in CI.
# Competing sessions must serialize by row lock. Exactly one CAS may commit.
: "${PGHOST:?PGHOST required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${PGUSER:?PGUSER required}"
id='preview-cccccccccccccccccccccccccccccccc'
psql -X -v ON_ERROR_STOP=1 -q -c "
 INSERT INTO sportsedge_private.alpaca_paper_order_outbox
 (intent_id,account_alias,signal_id,signal_digest,model_version,client_order_id,symbol,shares,limit_cents)
 VALUES ('$id','concurrency-paper','signal-C',repeat('c',64),
 'model-v1','se_paper_C','TSLA',2,1900);"
one="$(mktemp)"
two="$(mktemp)"
trap 'rm -f "$one" "$two"' EXIT
(
 psql -X -v ON_ERROR_STOP=1 -A -t -c "
  BEGIN;
  SELECT sportsedge_private.paper_advance_receipt('$id',0,'stopped',clock_timestamp());
  SELECT pg_sleep(2);
  COMMIT;" > "$one"
) &
pid1=$!
sleep .3
(
 psql -X -v ON_ERROR_STOP=1 -A -t -c "
  SELECT sportsedge_private.paper_advance_receipt('$id',0,'stopped',clock_timestamp());" > "$two"
) &
pid2=$!
wait "$pid1"
wait "$pid2"
grep -qx 't' "$one"
grep -qx 'f' "$two"
version="$(psql -X -v ON_ERROR_STOP=1 -A -t -c "SELECT lock_version FROM sportsedge_private.alpaca_paper_order_outbox WHERE intent_id='$id'")"
audit="$(psql -X -v ON_ERROR_STOP=1 -A -t -c "SELECT count(*) FROM sportsedge_private.alpaca_paper_receipt_events WHERE intent_id='$id'")"
test "$version" = 1
test "$audit" = 1
echo "ALPACA_CAS_TWO_CONNECTION_RACE_PASS"
