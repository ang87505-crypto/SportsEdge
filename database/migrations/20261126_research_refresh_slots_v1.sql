-- research_refresh_slots_v1: at most one moneyline (h2h) refresh dispatch per UTC day.
--
-- PROPOSAL. Not applied anywhere. The owner applies it to the research project (fzyjazhvkstvwwzjhlrr) only after
-- review, and re-runs database/verify/research_refresh_contract_readonly.sql afterwards.
--
-- Verified production contract (read-only review of the installed functions, 2026-11-27):
-- * public.research_dispatch(boolean) RETURNS bigint: the new run id.
-- * It returns NULL when its 25-minute cooldown prevents a dispatch. In that case no run exists.
-- * Credit caps (research_reserve_credit) are shared across both sports: 8 reservations per rolling 24 h and
--   240 per rolling 30 d.
-- * anon and authenticated cannot execute the research_* functions. service_role cannot execute
--   research_dispatch directly. That restriction is preserved: only this SECURITY DEFINER wrapper calls it.
-- * Neither research_refresh_slots nor research_refresh_slot_dispatch exists in production yet.
--
-- Additive only. One table and one function. No existing table, function, grant, budget or cap is changed.
-- The wrapper calls research_dispatch(false) exactly as an operator does by hand. That issues the single-use,
-- ten-minute capability and queues the pg_net request to /api/internal/research-cycle, where research_claim →
-- research_reserve_credit → collect → research_finish run unchanged. Credits are only ever reserved inside a
-- claimed run.
--
-- Slot rules:
-- * A slot row is written ONLY together with a positive run id returned by research_dispatch, so a committed slot
--   always names a real run.
-- * NULL (cooldown) or any non-positive result writes nothing and returns not_dispatched. The day's slot stays
--   available, and a later call the same day may dispatch.
-- * An exception rolls back the whole call. No slot is written, and pg_net sends nothing: "HTTP requests are not
--   started until the transaction is committed", https://supabase.github.io/pg_net/api/.
-- * Concurrent calls for one slot serialise on a transaction-scoped advisory lock, so only the first can
--   dispatch; the others then see its committed row and return duplicate_slot. The primary key is a backstop:
--   a second insert would raise and roll back its own dispatch.
-- * Once a run is recorded, the slot is spent even if that run later fails. Failed runs are reviewed through
--   their research_runs receipt and never retried automatically, so one slot reserves credits at most once.

do $$
begin
  if to_regprocedure('public.research_dispatch(boolean)') is null then
    raise exception 'PREREQUISITE_MISSING: public.research_dispatch(boolean)';
  end if;
  if pg_get_function_result('public.research_dispatch(boolean)'::regprocedure) <> 'bigint' then
    raise exception 'CONTRACT_MISMATCH: research_dispatch(boolean) must return bigint, found %',
      pg_get_function_result('public.research_dispatch(boolean)'::regprocedure);
  end if;
end $$;

create table if not exists public.research_refresh_slots (
  slot_key text primary key
    check (slot_key ~ '^moneyline-h2h-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  claimed_at timestamptz not null default now(),
  run_id bigint not null check (run_id > 0)
);
alter table public.research_refresh_slots enable row level security;
revoke all on table public.research_refresh_slots from public, anon, authenticated, service_role;
grant select on table public.research_refresh_slots to service_role;

create or replace function public.research_refresh_slot_dispatch(p_slot text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing bigint;
  v_run bigint;
begin
  if p_slot is null or p_slot !~ '^moneyline-h2h-[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'INVALID_SLOT' using errcode = '22023';
  end if;
  -- Only today's UTC slot. A replayed or pre-computed key for another day cannot dispatch.
  if substring(p_slot from 15)::date <> (now() at time zone 'utc')::date then
    raise exception 'SLOT_NOT_TODAY' using errcode = '22023';
  end if;
  -- Held until commit or rollback. A waiter's next statement sees the holder's committed row (READ COMMITTED,
  -- which PostgREST uses).
  perform pg_advisory_xact_lock(hashtextextended('research_refresh_slots:' || p_slot, 0));
  select run_id into v_existing from public.research_refresh_slots where slot_key = p_slot;
  if found then
    return jsonb_build_object('status', 'duplicate_slot', 'slot', p_slot, 'run_id', v_existing);
  end if;
  v_run := public.research_dispatch(false);
  if v_run is null or v_run <= 0 then
    -- Cooldown (NULL) or an unexpected non-positive id: nothing dispatched, nothing recorded, slot still open.
    return jsonb_build_object('status', 'not_dispatched', 'slot', p_slot,
      'reason', case when v_run is null then 'dispatcher_returned_null' else 'dispatcher_returned_non_positive' end);
  end if;
  insert into public.research_refresh_slots (slot_key, run_id) values (p_slot, v_run);
  return jsonb_build_object('status', 'dispatched', 'slot', p_slot, 'run_id', v_run);
end;
$$;
revoke all on function public.research_refresh_slot_dispatch(text) from public, anon, authenticated;
grant execute on function public.research_refresh_slot_dispatch(text) to service_role;
