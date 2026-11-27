#!/usr/bin/env bash
# Concurrency, as service_role (the production caller): N simultaneous firings for one slot.
#  A: plain race → exactly one dispatch.
#  B: the first holder's dispatch fails while the others wait → exactly one dispatch.
#  C: cooldown active → no dispatch and no slot; after the cooldown → exactly one dispatch.
# Disposable local database only.
set -Eeuo pipefail
db=${1:?database}; n=${2:-20}
psql_() { su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d $db -c \"$1\""; }
today=$(psql_ "select 'moneyline-h2h-' || to_char(now() at time zone 'utc', 'YYYY-MM-DD')")
run_race() {
  local out; out=$(mktemp -d)
  for i in $(seq 1 "$n"); do
    ( su postgres -c "psql -qAt -d $db -c \"set role service_role\" -c \"select public.research_refresh_slot_dispatch('$today')->>'status'\"" >"$out/$i" 2>&1 || true ) &
  done
  wait
  for f in "$out"/*; do grep -v '^SET$' "$f" | head -1; done | sed 's/.*STUB_DISPATCH_FAILED.*/failed (rolled back)/' | sort | uniq -c | tr -s ' ' | sed 's/^ /  /'
  rm -rf "$out"
}
count() { psql_ "select (select count(*) from public.test_runs) || ' runs, ' || (select count(*) from public.research_refresh_slots) || ' slots'"; }
reset() { psql_ "truncate public.research_refresh_slots, public.test_runs; delete from public.test_dispatch_control; insert into public.test_dispatch_control values ('sleep','0.2')"; psql_ "select setval('public.test_dispatch_calls', 1, false)" >/dev/null; }
expect() { local got; got=$(count); [ "$got" = "$1" ] || { echo "FAIL: expected $1, got $got"; exit 1; }; echo "  -> $got"; }

reset
echo "race A ($n concurrent firings):"; run_race; expect "1 runs, 1 slots"

reset; psql_ "insert into public.test_dispatch_control values ('fail_upto','1')"
echo "race B ($n concurrent firings; the first dispatch fails after creating its run):"; run_race; expect "1 runs, 1 slots"

reset; psql_ "insert into public.test_runs (probe, created_at) values (false, clock_timestamp() - interval '5 minutes')"
echo "race C1 ($n concurrent firings during the 25-minute cooldown):"; run_race; expect "1 runs, 0 slots"
psql_ "update public.test_runs set created_at = clock_timestamp() - interval '26 minutes'"
echo "race C2 ($n concurrent firings after the cooldown):"; run_race; expect "2 runs, 1 slots"
echo "research_refresh_slots_v1_race: PASS"
