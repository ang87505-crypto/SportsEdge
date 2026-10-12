-- Staging-only schema proposal. NOT APPLIED TO ANY DATABASE.
-- Before use: create a proper timestamped Supabase migration with the CLI
-- (supabase migration new nba_paper_command_receipts_v1), copy this SQL into it,
-- then verify on an isolated staging project. Do not run against production.
--
-- A command ID is unique forever; no HTTP retry can create a second batch
-- with the same ID. Only one running or uncertain command per NBA account may
-- exist at a time, even when multiple browser tabs or server instances submit.
-- An uncertain command holds the slot until an operator reconciles results
-- and explicitly resolves the receipt under a separately reviewed procedure.
create table if not exists public.paper_command_receipts (
 id uuid primary key,
 owner_id uuid not null,
 account_slug text not null check(account_slug = 'nba-elo-research-v1'),
 action text not null check(action = 'run'),
 state text not null check(state in ('running','completed','uncertain')),
 summary jsonb,
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 constraint paper_receipt_completion_consistency check (
   (state = 'running' and finished_at is null)
   or (state in ('completed','uncertain') and finished_at is not null)
 )
);
create unique index if not exists paper_command_one_unresolved_account
 on public.paper_command_receipts(account_slug)
 where state in ('running','uncertain');
create index if not exists paper_command_history
 on public.paper_command_receipts(owner_id,created_at desc);
alter table public.paper_command_receipts enable row level security;
-- Public schema is a Data API surface; deny direct browser access.
revoke all on table public.paper_command_receipts from public,anon,authenticated;
grant select,insert,update on table public.paper_command_receipts to service_role;
-- No RLS policies. Only the trusted server's service-role connection can access.
-- A separate, reviewed operator reconciliation procedure is required before
-- resolving an uncertain receipt. Never auto-expire or erase unresolved rows.
