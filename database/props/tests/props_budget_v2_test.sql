\set ON_ERROR_STOP on
-- props_budget_v2 activation (disposable DB; assumes props_v1_test.sql helpers and clock).
SET ROLE service_role;
SELECT props_test.at('2026-11-08T15:59:00Z');
SELECT public.props_set_control('RUNNING','budget v2 test','owner-test');
-- A fresher provider report (the v1 test ended exactly at the floor).
SELECT public.props_record_usage((SELECT min(id) FROM public.props_credit_reservations),200,450,50,0);
SELECT props_test.eq(public.props_begin_run('collect','collect-v2-before','gha:v2a',NULL,600)->>'outcome','STARTED','v2 before');
SELECT id AS r1 FROM public.props_runs WHERE slot_key='collect-v2-before' \gset
-- Before active_from, v1 still governs (earlier test reservations fall outside 24 h by now).
SELECT public.props_reserve_credits(:r1,'events',NULL,1);
SELECT props_test.eq((SELECT policy_version FROM public.props_credit_reservations ORDER BY id DESC LIMIT 1),'props-budget-v1','v1 before');
SELECT public.props_finish_run(:r1,'completed','COMPLETED','{}');
SELECT props_test.at('2026-11-09T16:30:00Z');
SELECT props_test.eq(public.props_begin_run('collect','collect-v2-after','gha:v2b',NULL,600)->>'outcome','STARTED','v2 after');
SELECT id AS r2 FROM public.props_runs WHERE slot_key='collect-v2-after' \gset
SELECT public.props_reserve_credits(:r2,'events',NULL,1);
SELECT public.props_reserve_credits(:r2,'event_odds','evtTESTV20001',3);
SELECT public.props_reserve_credits(:r2,'event_odds','evtTESTV20002',3);
SELECT props_test.eq((SELECT policy_version FROM public.props_credit_reservations ORDER BY id DESC LIMIT 1),'props-budget-v2','v2 after');
SELECT props_test.raises(format('SELECT public.props_reserve_credits(%s,%L,%L,3)',:r2,'event_odds','evtTESTV20003'),'PROPS_BUDGET_DAILY_CAP');
RESET ROLE;
SELECT 'PROPS_BUDGET_V2_SQL_TESTS_PASS' AS result;
