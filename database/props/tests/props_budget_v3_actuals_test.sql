\set ON_ERROR_STOP on
-- props_budget_v3_actuals (proposal) tests: unchanged behaviour until a policy opts in; then provider-reported
-- charges count, unknown outcomes still count at the reservation. Disposable DB; props_v1_test.sql helpers.
SET ROLE service_role;
SELECT props_test.at('2026-12-01T18:00:00Z');
SELECT props_test.eq(public.props_begin_run('collect','collect-v3-a','gha:v3a',NULL,600)->>'outcome','STARTED','v3 run a');
SELECT id AS ra FROM public.props_runs WHERE slot_key='collect-v3-a' \gset
-- The legacy shape: events list reserved at 1 but charged 0; one game charged 3; one empty reply charged 0.
SELECT public.props_reserve_credits(:ra,'events',NULL,1) AS e1 \gset
SELECT public.props_record_usage(:e1,200,485,15,0);
SELECT public.props_reserve_credits(:ra,'event_odds','evtV3TEST0001',3) AS o1 \gset
SELECT public.props_record_usage(:o1,200,482,18,3);
SELECT public.props_reserve_credits(:ra,'event_odds','evtV3TEST0002',3) AS o2 \gset
SELECT public.props_record_usage(:o2,200,482,18,0);
-- 7 reserved under v2 (7/day): a further request is refused, exactly as before this migration.
SELECT props_test.raises(format('SELECT public.props_reserve_credits(%s,%L,%L,3)',:ra,'event_odds','evtV3TEST0003'),'PROPS_BUDGET_DAILY_CAP');
SELECT props_test.eq((SELECT count(*)::text FROM public.props_budget_policy WHERE count_provider_actuals),'0','no policy opts in');
RESET ROLE;

-- Owner step (approval): a policy that counts provider-reported charges, same limits.
INSERT INTO public.props_budget_policy(version,daily_credits,monthly_credits,provider_floor,active_from,count_provider_actuals)
 VALUES('props-budget-v3',7,200,60,'2026-12-01T18:05:00Z',true);
SET ROLE service_role;
SELECT props_test.at('2026-12-01T18:06:00Z');
-- Effective 24 h use is now 0 + 3 + 0 = 3, so one more 3-credit request fits (3 + 3 <= 7) ...
SELECT public.props_reserve_credits(:ra,'event_odds','evtV3TEST0003',3) AS o3 \gset
SELECT props_test.eq((SELECT policy_version FROM public.props_credit_reservations WHERE id=:o3),'props-budget-v3','v3 row used');
-- ... and while o3 has no recorded reply (e.g. a transport failure) it counts in full, so the next is refused.
SELECT props_test.raises(format('SELECT public.props_reserve_credits(%s,%L,%L,3)',:ra,'event_odds','evtV3TEST0004'),'PROPS_BUDGET_DAILY_CAP');
-- Once o3's reply is recorded as charged 0 it stops counting: exactly one more fits, then the cap holds again.
SELECT public.props_record_usage(:o3,200,482,18,0);
SELECT public.props_reserve_credits(:ra,'event_odds','evtV3TEST0004',3) AS o4 \gset
SELECT props_test.raises(format('SELECT public.props_reserve_credits(%s,%L,%L,3)',:ra,'event_odds','evtV3TEST0005'),'PROPS_BUDGET_DAILY_CAP');
-- A reported charge above the reservation never counts above it (least of the two).
SELECT public.props_record_usage(:o4,200,470,30,9);
SELECT props_test.raises(format('SELECT public.props_reserve_credits(%s,%L,%L,2)',:ra,'event_odds','evtV3TEST0005'),'PROPS_BUDGET_DAILY_CAP');
SELECT public.props_reserve_credits(:ra,'event_odds','evtV3TEST0005',1) AS o5 \gset
RESET ROLE;
SELECT 'PROPS_BUDGET_V3_ACTUALS_SQL_TESTS_PASS' AS result;
