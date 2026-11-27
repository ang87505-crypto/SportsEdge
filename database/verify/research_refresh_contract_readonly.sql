-- READ-ONLY contract check for the moneyline refresh. Run in the Supabase SQL editor of the research project
-- (fzyjazhvkstvwwzjhlrr) BEFORE applying database/migrations/20261126_research_refresh_slots_v1.sql.
-- Every statement is a catalogue or table SELECT inside a READ ONLY transaction that is rolled back.
-- It returns no token or token hash. Paste all four result sets into PR #229 (or send them to the reviewer).
begin transaction read only;

-- 1. The installed research functions: exact signatures, return types, SECURITY DEFINER, settings and full bodies.
select p.oid::regprocedure as signature,
       pg_get_function_result(p.oid) as returns,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('research_dispatch', 'research_claim', 'research_finish', 'research_reserve_credit',
                    'research_refresh_slot_dispatch')
order by p.proname;

-- 2. Who may execute them (browser roles must be false; the migration's wrapper needs the owner to be able to call
--    research_dispatch, which a SECURITY DEFINER function owned by the same role can).
select p.oid::regprocedure as signature, r.rolname,
       has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute,
       pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
where n.nspname = 'public' and p.proname like 'research\_%'
order by 1, 2;

-- 3. Tables the functions use (columns only), plus constraints, and whether the slot table already exists.
select c.table_name, c.ordinal_position, c.column_name, c.data_type, c.is_nullable, c.column_default
from information_schema.columns c
where c.table_schema = 'public' and c.table_name like 'research\_%'
order by c.table_name, c.ordinal_position;
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text like 'research\_%'
order by 1, 2;

-- 4. Extensions the dispatcher depends on.
select extname, extversion from pg_extension where extname in ('pg_net', 'pg_cron') order by 1;

rollback;

-- Contract status (ChatGPT's read-only production review, 2026-11-27):
--  a. VERIFIED: research_dispatch(boolean) RETURNS bigint. It returns NULL, creating no run, when its 25-minute
--     cooldown prevents a dispatch. The migration now checks the return type and refuses to install otherwise.
--  b. To confirm in the output: it queues its request with net.http_post (pg_net), so a rolled-back transaction
--     sends nothing.
--  c. VERIFIED: research_reserve_credit caps are shared across both sports (8 reservations per rolling 24 h, 240 per
--     rolling 30 d). After the migration it is only ever called inside a claimed research-cycle run.
--  d. To confirm in the output: research_claim accepts only a queued run less than ten minutes old, single use.
--  e. To confirm in the output: research_finish stores the summary against p_id.
--  f. VERIFIED: research_refresh_slots and research_refresh_slot_dispatch do not exist yet.
--  g. VERIFIED: anon and authenticated cannot execute the research_* functions; service_role cannot execute
--     research_dispatch directly. The wrapper keeps that: SECURITY DEFINER, executable by service_role only.
-- After applying the migration, re-run this file. Expect:
--  * research_refresh_slot_dispatch(text) returning jsonb, security_definer = t;
--  * service_role can_execute = t for the wrapper and f for research_dispatch;
--  * anon/authenticated f for both;
--  * research_refresh_slots with run_id bigint NOT NULL CHECK (run_id > 0).
