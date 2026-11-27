#!/usr/bin/env bash
# Disposable local PostgreSQL verification for research_refresh_slots_v1 against a PRODUCTION-SHAPED stub of
# research_dispatch(boolean) (BIGINT run id; NULL during its 25-minute cooldown; not executable by service_role).
# Run as root (uses `su postgres`). No Supabase, provider or network access.
set -Eeuo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d /var/tmp/refresh-sql.XXXXXX); chmod 755 "$work"
cp "$repo/database/tests/research_refresh_slots_v1_stub.sql" "$repo/database/migrations/20261126_research_refresh_slots_v1.sql" \
   "$repo/database/tests/research_refresh_slots_v1_test.sql" "$work/"; chmod 644 "$work"/*.sql
for r in anon authenticated service_role; do
  su postgres -c "psql -qAt -c \"DO \\\$\\\$ BEGIN CREATE ROLE $r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \\\$\\\$;\""
done
psqlf() { su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d $1 -f $2"; }

# The migration refuses to install without the verified contract.
su postgres -c "dropdb --if-exists refresh_c; createdb refresh_c"
if psqlf refresh_c "$work/20261126_research_refresh_slots_v1.sql" >/dev/null 2>"$work/e1"; then echo "FAIL: installed without research_dispatch"; exit 1; fi
grep -q PREREQUISITE_MISSING "$work/e1" && echo "guard: missing research_dispatch refused"
printf '%s\n' 'create function public.research_dispatch(p boolean) returns void language sql as $f$ select $f$;' >"$work/void.sql"; chmod 644 "$work/void.sql"
psqlf refresh_c "$work/void.sql" >/dev/null
if psqlf refresh_c "$work/20261126_research_refresh_slots_v1.sql" >/dev/null 2>"$work/e2"; then echo "FAIL: installed over a void dispatcher"; exit 1; fi
grep -q "CONTRACT_MISMATCH" "$work/e2" && echo "guard: non-bigint research_dispatch refused"
su postgres -c "dropdb refresh_c"

su postgres -c "dropdb --if-exists refresh_t; createdb refresh_t"
psqlf refresh_t "$work/research_refresh_slots_v1_stub.sql" >/dev/null
psqlf refresh_t "$work/20261126_research_refresh_slots_v1.sql" >/dev/null
psqlf refresh_t "$work/20261126_research_refresh_slots_v1.sql" >/dev/null   # idempotent re-apply
psqlf refresh_t "$work/research_refresh_slots_v1_test.sql" 2>&1 | grep -E "OK|PASS|FAIL|refused|dispatched|ERROR"
bash "$repo/database/tests/research_refresh_slots_v1_race.sh" refresh_t 20
su postgres -c "dropdb refresh_t"; rm -rf "$work"
