#!/usr/bin/env bash
# Concurrency: N simultaneous scheduler firings for one slot must produce exactly one dispatch, including when the
# first holder of the slot fails while the others are waiting on it. Disposable local database only.
set -Eeuo pipefail
db=${1:?database}; n=${2:-20}
psql_() { su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d $db -c \"$1\""; }
today=$(psql_ "select 'moneyline-h2h-' || to_char(now() at time zone 'utc', 'YYYY-MM-DD')")
run_race() {
  local out; out=$(mktemp -d)
  for i in $(seq 1 "$n"); do
    ( su postgres -c "psql -qAt -d $db -c \"select public.research_refresh_slot_dispatch('$today')->>'status'\"" >"$out/$i" 2>&1 || true ) &
  done
  wait
  for f in "$out"/*; do head -1 "$f"; done | sed 's/.*STUB_DISPATCH_FAILED.*/failed (rolled back)/' | sort | uniq -c | tr -s ' ' | sed 's/^ /  /'
  rm -rf "$out"
}
reset() { psql_ "truncate public.research_refresh_slots, public.test_dispatches; delete from public.test_dispatch_control; insert into public.test_dispatch_control values ('sleep','0.3')"; }

reset
echo "race A ($n concurrent firings):"; run_race
a=$(psql_ "select count(*) from public.test_dispatches"); s=$(psql_ "select count(*) from public.research_refresh_slots")
[ "$a" = 1 ] && [ "$s" = 1 ] || { echo "FAIL: $a dispatches, $s slots"; exit 1; }

reset; psql_ "insert into public.test_dispatch_control values ('fail_upto','1'); select setval('public.test_dispatch_calls', 1, false)" >/dev/null
echo "race B ($n concurrent firings; the first dispatch fails):"; run_race
b=$(psql_ "select count(*) from public.test_dispatches"); s=$(psql_ "select count(*) from public.research_refresh_slots")
[ "$b" = 1 ] && [ "$s" = 1 ] || { echo "FAIL: $b dispatches, $s slots"; exit 1; }
echo "research_refresh_slots_v1_race: PASS (one dispatch per slot in both races)"
