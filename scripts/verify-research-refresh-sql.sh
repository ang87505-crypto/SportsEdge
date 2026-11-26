#!/usr/bin/env bash
# Disposable local PostgreSQL verification for research_refresh_slots_v1 against a STUB research_dispatch.
# Run as root (uses `su postgres`). No Supabase, provider or network access. The real research_dispatch definition
# must still be checked in production with database/verify/research_refresh_contract_readonly.sql.
set -Eeuo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d /var/tmp/refresh-sql.XXXXXX); chmod 755 "$work"
cp "$repo/database/tests/research_refresh_slots_v1_stub.sql" "$repo/database/migrations/20261126_research_refresh_slots_v1.sql" \
   "$repo/database/tests/research_refresh_slots_v1_test.sql" "$work/"; chmod 644 "$work"/*.sql
for r in anon authenticated service_role; do
  su postgres -c "psql -qAt -c \"DO \\\$\\\$ BEGIN CREATE ROLE $r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \\\$\\\$;\""
done
su postgres -c "dropdb --if-exists refresh_t; createdb refresh_t"
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d refresh_t -f $work/research_refresh_slots_v1_stub.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d refresh_t -f $work/20261126_research_refresh_slots_v1.sql" >/dev/null
# Idempotent re-apply.
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d refresh_t -f $work/20261126_research_refresh_slots_v1.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d refresh_t -f $work/research_refresh_slots_v1_test.sql" | tail -1
bash "$repo/database/tests/research_refresh_slots_v1_race.sh" refresh_t 20
# A dispatcher that returns void (if production's does) is recorded as an empty result, not an error.
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d refresh_t" <<'SQL' | tail -1
truncate public.research_refresh_slots; delete from public.test_dispatch_control;
drop function public.research_dispatch(boolean);
create function public.research_dispatch(p_probe boolean) returns void language sql as $$ insert into public.test_dispatches (probe) values (p_probe) $$;
select case when public.research_refresh_slot_dispatch('moneyline-h2h-' || to_char(now() at time zone 'utc','YYYY-MM-DD')) = jsonb_build_object('status','dispatched','slot','moneyline-h2h-' || to_char(now() at time zone 'utc','YYYY-MM-DD'),'dispatch','')
 then 'void dispatcher: PASS' else 'void dispatcher: FAIL' end;
SQL
su postgres -c "dropdb refresh_t"; rm -rf "$work"
