#!/usr/bin/env bash
# Destructive against a disposable CI database ONLY. Never invoke against Supabase.
set -euo pipefail
if [[ "${PGHOST:-}" != "127.0.0.1" || "${PGDATABASE:-}" != "sportsedge_receipts_ci" || "${PGUSER:-}" != "postgres" ]]; then
  echo "Refusing receipt SQL tests outside the disposable local CI database" >&2
  exit 2
fi

psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
\i database/ddl/paper_command_receipts_v1.sql
do $$
declare blocked boolean;
begin
 if not (select relrowsecurity from pg_class where oid='public.paper_command_receipts'::regclass) then raise exception 'RLS disabled'; end if;
 if has_table_privilege('anon','public.paper_command_receipts','SELECT')
    or has_table_privilege('authenticated','public.paper_command_receipts','SELECT')
    or has_table_privilege('authenticated','public.paper_command_receipts','INSERT') then
  raise exception 'Receipt table leaked direct browser grants';
 end if;
 if not (has_table_privilege('service_role','public.paper_command_receipts','SELECT') and has_table_privilege('service_role','public.paper_command_receipts','INSERT') and has_table_privilege('service_role','public.paper_command_receipts','UPDATE')) then raise exception 'Server role missing receipt privileges'; end if;
 insert into public.paper_command_receipts(id,owner_id,account_slug,action,state)
 values('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','nba-elo-research-v1','run','running');
 blocked:=false;
 begin
  insert into public.paper_command_receipts(id,owner_id,account_slug,action,state)
  values('00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','nba-elo-research-v1','run','running');
 exception when unique_violation then blocked:=true;
 end;
 if not blocked then raise exception 'Two active commands were allowed'; end if;
 update public.paper_command_receipts set state='completed',finished_at=now(),summary='{"positionIds":[]}'::jsonb
 where id='00000000-0000-4000-8000-000000000001';
 insert into public.paper_command_receipts(id,owner_id,account_slug,action,state)
 values('00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','nba-elo-research-v1','run','running');
 update public.paper_command_receipts set state='uncertain',finished_at=now()
 where id='00000000-0000-4000-8000-000000000002';
 blocked:=false;
 begin
  insert into public.paper_command_receipts(id,owner_id,account_slug,action,state)
  values('00000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','nba-elo-research-v1','run','running');
 exception when unique_violation then blocked:=true;
 end;
 if not blocked then raise exception 'Uncertain command did not lock account'; end if;
 if (select count(*) from public.paper_command_receipts)<>2 then raise exception 'Unexpected receipt count'; end if;
end $$;
truncate table public.paper_command_receipts;
SQL

# Exercise the actual unique index across TWO DB connections, with an in-flight
# transaction. The second transaction must wait and then reject a different ID.
psql -X -v ON_ERROR_STOP=1 -c "begin; insert into public.paper_command_receipts(id,owner_id,account_slug,action,state) values('00000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','nba-elo-research-v1','run','running'); select pg_sleep(2); commit;" >/tmp/sportsedge-first-receipt.txt 2>&1 &
first=$!
sleep 0.5
if psql -X -v ON_ERROR_STOP=1 -c "insert into public.paper_command_receipts(id,owner_id,account_slug,action,state) values('00000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','nba-elo-research-v1','run','running');" >/tmp/sportsedge-second-receipt.txt 2>&1; then
 echo "Concurrent second database connection unexpectedly claimed same NBA account" >&2
 wait "$first" || true
 exit 1
fi
wait "$first"
if ! grep -q 'duplicate key value violates unique constraint' /tmp/sportsedge-second-receipt.txt; then
 echo "Second DB connection failed for an unexpected reason" >&2
 exit 1
fi
printf 'PASS: private RLS grants, permanent UUID receipts, account-wide unresolved lock and concurrent DB claim\n'
