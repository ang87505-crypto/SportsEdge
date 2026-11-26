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

-- Questions the reviewer answers from the output (activation stays blocked until each is answered):
--  a. research_dispatch(boolean) exists, takes the probe flag first and returns a scalar (run id or void), not a set.
--  b. It queues its request with net.http_post (pg_net), so a rolled-back transaction sends nothing.
--  c. research_reserve_credit(text) enforces 8 per rolling 24 h and 240 per rolling 30 d for each call, and whether
--     it requires a claimed run. (After the migration it is only ever called inside a claimed research-cycle run,
--     which is the context in which it has already worked; the answer is still recorded.)
--  d. research_claim accepts only a queued run less than ten minutes old and marks it claimed (single use).
--  e. research_finish stores the summary against p_id (the receipt is tied to the run).
--  f. No object named research_refresh_slots or research_refresh_slot_dispatch exists yet.
--  g. anon and authenticated cannot execute any research_* function.
