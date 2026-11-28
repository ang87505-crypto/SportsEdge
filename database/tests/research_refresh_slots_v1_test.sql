-- Single-session contract tests for research_refresh_slots_v1 (run after the production-shaped stub and the migration).
\set ON_ERROR_STOP 1
create or replace function pg_temp.reset() returns void language sql as $$
  truncate public.research_refresh_slots, public.test_runs; delete from public.test_dispatch_control;
  select setval('public.test_dispatch_calls', 1, false); $$;
create or replace function pg_temp.today() returns text language sql as $$
  select 'moneyline-h2h-' || to_char(now() at time zone 'utc', 'YYYY-MM-DD') $$;
create or replace function pg_temp.n(t text) returns bigint language plpgsql as $$
  declare c bigint; begin execute format('select count(*) from public.%I', t) into c; return c; end $$;

do $$
declare r jsonb; yesterday text := 'moneyline-h2h-' || to_char((now() at time zone 'utc') - interval '1 day', 'YYYY-MM-DD');
  v_run bigint;
begin
  perform pg_temp.reset();
  -- Malformed and other-day slots are refused before anything is dispatched.
  begin perform public.research_refresh_slot_dispatch('moneyline-h2h-x'); raise exception 'expected INVALID_SLOT';
  exception when sqlstate '22023' then null; end;
  begin perform public.research_refresh_slot_dispatch(null); raise exception 'expected INVALID_SLOT';
  exception when sqlstate '22023' then null; end;
  begin perform public.research_refresh_slot_dispatch(yesterday); raise exception 'expected SLOT_NOT_TODAY';
  exception when sqlstate '22023' then null; end;
  if pg_temp.n('test_runs') <> 0 then raise exception 'refused slots dispatched'; end if;

  -- NULL / cooldown: a run 5 minutes ago (for example the owner's manual refresh) blocks dispatch. No slot is
  -- recorded and success is never reported.
  insert into public.test_runs (probe, created_at) values (false, clock_timestamp() - interval '5 minutes');
  r := public.research_refresh_slot_dispatch(pg_temp.today());
  if r <> jsonb_build_object('status','not_dispatched','slot',pg_temp.today(),'reason','dispatcher_returned_null') then
    raise exception 'cooldown result: %', r; end if;
  if pg_temp.n('research_refresh_slots') <> 0 then raise exception 'cooldown consumed the slot'; end if;
  if pg_temp.n('test_runs') <> 1 then raise exception 'cooldown created a run'; end if;
  -- Repeated calls during the cooldown stay not_dispatched and keep the slot open.
  r := public.research_refresh_slot_dispatch(pg_temp.today());
  if r->>'status' <> 'not_dispatched' or pg_temp.n('research_refresh_slots') <> 0 then raise exception 'second cooldown call: %', r; end if;

  -- Subsequent successful retry once the cooldown has passed: exactly one run, recorded with its positive id.
  update public.test_runs set created_at = clock_timestamp() - interval '26 minutes';
  r := public.research_refresh_slot_dispatch(pg_temp.today());
  select max(id) into v_run from public.test_runs;
  if r->>'status' <> 'dispatched' or (r->>'run_id')::bigint <> v_run or v_run <= 0 then raise exception 'retry: %', r; end if;
  if (select run_id from public.research_refresh_slots where slot_key = pg_temp.today()) <> v_run then
    raise exception 'slot does not record the dispatched run'; end if;

  -- Successful replay prevention: the slot, not the cooldown, blocks a second dispatch, even after the cooldown
  -- ends (and even if that run later failed downstream).
  r := public.research_refresh_slot_dispatch(pg_temp.today());
  if r <> jsonb_build_object('status','duplicate_slot','slot',pg_temp.today(),'run_id',v_run) then raise exception 'replay: %', r; end if;
  update public.test_runs set created_at = clock_timestamp() - interval '2 hours';
  r := public.research_refresh_slot_dispatch(pg_temp.today());
  if r->>'status' <> 'duplicate_slot' or pg_temp.n('test_runs') <> 2 then raise exception 'replay after cooldown: %', r; end if;
  if exists (select 1 from public.test_runs where probe) then raise exception 'scheduled slot issued a probe'; end if;

  -- Exception rollback: the dispatcher creates its run and then fails. Neither the run nor the slot survives,
  -- and the next call dispatches once.
  perform pg_temp.reset();
  insert into public.test_dispatch_control values ('fail_upto', '1');
  begin perform public.research_refresh_slot_dispatch(pg_temp.today()); raise exception 'expected stub failure';
  exception when others then if sqlerrm <> 'STUB_DISPATCH_FAILED' then raise; end if; end;
  if pg_temp.n('research_refresh_slots') <> 0 or pg_temp.n('test_runs') <> 0 then raise exception 'failure was not rolled back'; end if;
  r := public.research_refresh_slot_dispatch(pg_temp.today());
  if r->>'status' <> 'dispatched' or (r->>'run_id')::bigint <= 0 then raise exception 'retry after exception: %', r; end if;

  -- Non-positive ids are not runs: slot stays open, nothing reported as dispatched.
  perform pg_temp.reset();
  foreach v_run in array array[0, -7]::bigint[] loop
    delete from public.test_dispatch_control; insert into public.test_dispatch_control values ('return_value', v_run::text);
    r := public.research_refresh_slot_dispatch(pg_temp.today());
    if r->>'status' <> 'not_dispatched' or r->>'reason' <> 'dispatcher_returned_non_positive' then raise exception 'id %: %', v_run, r; end if;
  end loop;
  if pg_temp.n('research_refresh_slots') <> 0 then raise exception 'non-positive id consumed the slot'; end if;
  raise notice 'research_refresh_slots_v1 single-session: OK';
end $$;

-- Grants: the restricted chain is preserved.
do $$ begin
  if has_function_privilege('anon', 'public.research_refresh_slot_dispatch(text)', 'EXECUTE') then raise exception 'anon can execute wrapper'; end if;
  if has_function_privilege('authenticated', 'public.research_refresh_slot_dispatch(text)', 'EXECUTE') then raise exception 'authenticated can execute wrapper'; end if;
  if not has_function_privilege('service_role', 'public.research_refresh_slot_dispatch(text)', 'EXECUTE') then raise exception 'service_role cannot execute wrapper'; end if;
  if has_function_privilege('service_role', 'public.research_dispatch(boolean)', 'EXECUTE') then raise exception 'service_role can execute research_dispatch directly'; end if;
  if has_table_privilege('anon', 'public.research_refresh_slots', 'SELECT') then raise exception 'anon can read slots'; end if;
  if has_table_privilege('service_role', 'public.research_refresh_slots', 'INSERT')
     or has_table_privilege('service_role', 'public.research_refresh_slots', 'UPDATE')
     or has_table_privilege('service_role', 'public.research_refresh_slots', 'DELETE') then raise exception 'service_role can write slots directly'; end if;
  raise notice 'research_refresh_slots_v1 grants: OK';
end $$;

-- As service_role (the production caller): the wrapper dispatches; research_dispatch itself is refused.
select pg_temp.reset();
set role service_role;
select case when public.research_refresh_slot_dispatch(pg_temp.today())->>'status' = 'dispatched'
  then 'service_role via wrapper: dispatched' else 'service_role via wrapper: FAIL' end;
do $$ begin perform public.research_dispatch(false); raise exception 'service_role executed research_dispatch';
exception when insufficient_privilege then raise notice 'service_role direct research_dispatch: refused (OK)'; end $$;
reset role;
select 'research_refresh_slots_v1_test: PASS';
