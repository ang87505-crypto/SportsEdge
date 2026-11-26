-- research_refresh_slots_v1: at most one moneyline (h2h) refresh dispatch per UTC day.
--
-- PROPOSAL. Not applied anywhere. The owner applies it to the research project (fzyjazhvkstvwwzjhlrr) only after
-- running database/verify/research_refresh_contract_readonly.sql and confirming the prerequisites listed there.
--
-- Additive only:
-- * It creates one table and one function. No existing table, function, grant, budget or cap is changed.
-- * It calls the existing public.research_dispatch(false) exactly as an operator does by hand. That function issues
--   the single-use, ten-minute capability and queues the pg_net request to /api/internal/research-cycle. There,
--   research_claim, research_reserve_credit (8 per rolling 24 h, 240 per rolling 30 d) and research_finish run
--   unchanged. Credits are therefore only ever reserved inside a claimed run, the only context in which
--   research_reserve_credit has been exercised (run 3, 2026-10-30).
--
-- Atomicity:
-- * The slot row and the dispatch happen in one transaction. Concurrent calls for the same slot serialise on the
--   primary key: the first commits and dispatches; the others see the conflict and dispatch nothing.
-- * If research_dispatch raises, the whole transaction rolls back. The slot stays free and no pg_net request is
--   sent (pg_net: "HTTP requests are not started until the transaction is committed",
--   https://supabase.github.io/pg_net/api/), so a retry within the same day may dispatch once.
-- * Once a dispatch has committed, the slot is spent even if the downstream run later fails. A failed run is
--   reviewed through its research_runs receipt and is never retried automatically, so one slot can reserve
--   credits at most once (two requests).

create table if not exists public.research_refresh_slots (
  slot_key text primary key
    check (slot_key ~ '^moneyline-h2h-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  claimed_at timestamptz not null default now(),
  -- research_dispatch's own return value as text (its run id, if it returns one). It is set inside the same
  -- transaction, so a committed row always records what was dispatched.
  dispatch_result text not null
);
alter table public.research_refresh_slots enable row level security;
revoke all on table public.research_refresh_slots from public, anon, authenticated;
grant select on table public.research_refresh_slots to service_role;

create or replace function public.research_refresh_slot_dispatch(p_slot text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result text;
begin
  if p_slot is null or p_slot !~ '^moneyline-h2h-[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'INVALID_SLOT' using errcode = '22023';
  end if;
  -- Only today's UTC slot. A replayed or pre-computed key for another day cannot dispatch.
  if substring(p_slot from 15)::date <> (now() at time zone 'utc')::date then
    raise exception 'SLOT_NOT_TODAY' using errcode = '22023';
  end if;
  insert into public.research_refresh_slots (slot_key, dispatch_result)
  values (p_slot, '')
  on conflict (slot_key) do nothing;
  if not found then
    return jsonb_build_object('status', 'duplicate_slot', 'slot', p_slot);
  end if;
  -- The existing dispatcher, unchanged. Cast to text so any scalar return type (bigint run id, void) is recorded.
  v_result := coalesce(public.research_dispatch(false)::text, '');
  update public.research_refresh_slots set dispatch_result = v_result where slot_key = p_slot;
  return jsonb_build_object('status', 'dispatched', 'slot', p_slot, 'dispatch', v_result);
end;
$$;
revoke all on function public.research_refresh_slot_dispatch(text) from public, anon, authenticated;
grant execute on function public.research_refresh_slot_dispatch(text) to service_role;
