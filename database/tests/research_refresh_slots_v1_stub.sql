-- TEST STUB ONLY (never applied to a hosted project). Stands in for the production research_dispatch(boolean), whose
-- definition is not in the repository. It records each dispatch and can be told to fail or to block, so the race and
-- replay tests can observe exactly how many dispatches (and therefore credit-spending runs) a slot produced.
create table if not exists public.test_dispatches (id bigserial primary key, probe boolean not null, at timestamptz not null default clock_timestamp());
create table if not exists public.test_dispatch_control (k text primary key, v text not null);
-- Sequences are not rolled back, so a failure count survives the failed transaction that consumed it.
create sequence if not exists public.test_dispatch_calls;
create or replace function public.research_dispatch(p_probe boolean) returns bigint language plpgsql as $$
declare v_id bigint; v_fail_upto int; v_sleep text;
begin
  select v into v_sleep from public.test_dispatch_control where k = 'sleep';
  if v_sleep is not null then perform pg_sleep(v_sleep::float8); end if;
  insert into public.test_dispatches (probe) values (p_probe) returning id into v_id;
  -- 'fail_upto' = n: the first n calls since the sequence was reset fail (rolling back their own insert).
  select v::int into v_fail_upto from public.test_dispatch_control where k = 'fail_upto';
  if nextval('public.test_dispatch_calls') <= coalesce(v_fail_upto, 0) then raise exception 'STUB_DISPATCH_FAILED'; end if;
  return v_id;
end $$;
