-- TEST STUB ONLY (never applied to a hosted project). Production-shaped stand-in for the installed
-- research_dispatch(boolean), matching the contract verified read-only on 2026-11-27:
--   * RETURNS bigint: the new run id;
--   * returns NULL, creating no run, while its 25-minute cooldown is active;
--   * not executable by anon, authenticated or service_role (only the owner and its SECURITY DEFINER wrappers).
-- Test controls: block for a while ('sleep'), fail the first n calls AFTER creating the run so rollback can be
-- observed ('fail_upto'), or force a raw return value without dispatching ('return_value').
create table if not exists public.test_runs (id bigserial primary key, probe boolean not null,
  created_at timestamptz not null default clock_timestamp());
create table if not exists public.test_dispatch_control (k text primary key, v text not null);
-- Sequences are not rolled back, so a failure count survives the failed transaction that consumed it.
create sequence if not exists public.test_dispatch_calls;
create or replace function public.research_dispatch(p_probe boolean) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint; v_fail_upto int; v_sleep text; v_forced text;
begin
  select v into v_sleep from public.test_dispatch_control where k = 'sleep';
  if v_sleep is not null then perform pg_sleep(v_sleep::float8); end if;
  select v into v_forced from public.test_dispatch_control where k = 'return_value';
  if v_forced is not null then return v_forced::bigint; end if;
  -- 25-minute cooldown, as in production: NULL and no run.
  if exists (select 1 from public.test_runs where created_at > clock_timestamp() - interval '25 minutes') then
    return null;
  end if;
  insert into public.test_runs (probe) values (p_probe) returning id into v_id;
  select v::int into v_fail_upto from public.test_dispatch_control where k = 'fail_upto';
  if nextval('public.test_dispatch_calls') <= coalesce(v_fail_upto, 0) then raise exception 'STUB_DISPATCH_FAILED'; end if;
  return v_id;
end $$;
revoke all on function public.research_dispatch(boolean) from public, anon, authenticated, service_role;
