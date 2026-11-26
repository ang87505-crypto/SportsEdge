-- Single-session contract tests for research_refresh_slots_v1 (run after the stub and the migration).
\set ON_ERROR_STOP 1
do $$
declare r jsonb; today text := 'moneyline-h2h-' || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  yesterday text := 'moneyline-h2h-' || to_char((now() at time zone 'utc') - interval '1 day', 'YYYY-MM-DD');
  n int;
begin
  truncate public.research_refresh_slots, public.test_dispatches; delete from public.test_dispatch_control;
  -- Malformed and other-day slots are refused before anything is written.
  begin perform public.research_refresh_slot_dispatch('moneyline-h2h-x'); raise exception 'expected INVALID_SLOT';
  exception when sqlstate '22023' then null; end;
  begin perform public.research_refresh_slot_dispatch(null); raise exception 'expected INVALID_SLOT';
  exception when sqlstate '22023' then null; end;
  begin perform public.research_refresh_slot_dispatch(yesterday); raise exception 'expected SLOT_NOT_TODAY';
  exception when sqlstate '22023' then null; end;
  select count(*) into n from public.test_dispatches; if n <> 0 then raise exception 'refused slots dispatched %', n; end if;

  -- Replay after a failed dispatch: the failure rolls back the slot, so exactly one later call dispatches.
  insert into public.test_dispatch_control values ('fail_upto', '1'); perform setval('public.test_dispatch_calls', 1, false);
  begin perform public.research_refresh_slot_dispatch(today); raise exception 'expected stub failure';
  exception when others then if sqlerrm <> 'STUB_DISPATCH_FAILED' then raise; end if; end;
  select count(*) into n from public.research_refresh_slots; if n <> 0 then raise exception 'failed dispatch kept its slot'; end if;
  select count(*) into n from public.test_dispatches; if n <> 0 then raise exception 'failed dispatch was recorded'; end if;
  r := public.research_refresh_slot_dispatch(today);
  if r->>'status' <> 'dispatched' or (r->>'dispatch') !~ '^[0-9]+$' then raise exception 'retry did not dispatch: %', r; end if;
  if (select dispatch_result from public.research_refresh_slots where slot_key = today) <> r->>'dispatch' then
    raise exception 'slot does not record the dispatched run'; end if;

  -- Replay after success (including a downstream run that later failed): never a second dispatch for the slot.
  r := public.research_refresh_slot_dispatch(today);
  if r->>'status' <> 'duplicate_slot' then raise exception 'second call was not a duplicate: %', r; end if;
  select count(*) into n from public.test_dispatches; if n <> 1 then raise exception 'slot dispatched % times', n; end if;
  if exists (select 1 from public.test_dispatches where probe) then raise exception 'scheduled slot issued a probe'; end if;
  raise notice 'research_refresh_slots_v1 single-session: OK';
end $$;

-- Grants: browser roles cannot run or read it; service_role can.
do $$ begin
  if has_function_privilege('anon', 'public.research_refresh_slot_dispatch(text)', 'EXECUTE') then raise exception 'anon can execute'; end if;
  if has_function_privilege('authenticated', 'public.research_refresh_slot_dispatch(text)', 'EXECUTE') then raise exception 'authenticated can execute'; end if;
  if not has_function_privilege('service_role', 'public.research_refresh_slot_dispatch(text)', 'EXECUTE') then raise exception 'service_role cannot execute'; end if;
  if has_table_privilege('anon', 'public.research_refresh_slots', 'SELECT') then raise exception 'anon can read slots'; end if;
  if has_table_privilege('service_role', 'public.research_refresh_slots', 'INSERT') then raise exception 'service_role can write slots directly'; end if;
  raise notice 'research_refresh_slots_v1 grants: OK';
end $$;
select 'research_refresh_slots_v1_test: PASS';
