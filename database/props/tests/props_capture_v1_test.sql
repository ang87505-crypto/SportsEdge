\set ON_ERROR_STOP on
-- props_capture_v1 contract tests (disposable DB; assumes props_v1_test.sql helpers and the pinned clock).
SET ROLE service_role;
SELECT props_test.at('2026-11-20T16:00:00Z');
SELECT public.props_set_control('RUNNING','capture v1 test','owner-test');
SELECT props_test.eq(public.props_begin_run('collect','collect-tick-2026-11-20T16:00','gha:c1',NULL,600)->>'outcome','STARTED','tick run');
SELECT id AS crun FROM public.props_runs WHERE slot_key='collect-tick-2026-11-20T16:00' \gset

-- 1. A plan row is stored; a second plan for the same game and version is refused (plans are written once).
INSERT INTO public.props_capture_plans(plan_version,slate_date,provider_event_id,home_team,away_team,commence_time,selected,selection_rank,arm,reason,run_id)
 VALUES('props-capture-v1','2026-11-20','evtCAPTURE0001','Home T','Away T','2026-11-21T01:00:00Z',true,1,'early','selected_by_hash',:crun),
       ('props-capture-v1','2026-11-20','evtCAPTURE0002','Home U','Away U','2026-11-21T02:00:00Z',false,2,NULL,'budget_games_per_slate',:crun);
SELECT props_test.raises(format($$INSERT INTO public.props_capture_plans(plan_version,slate_date,provider_event_id,home_team,away_team,commence_time,selected,selection_rank,arm,reason,run_id)
 VALUES('props-capture-v1','2026-11-20','evtCAPTURE0001','Home T','Away T','2026-11-21T01:00:00Z',true,1,'late','selected_by_hash',%s)$$,:crun),'duplicate key');
SELECT props_test.raises(format($$INSERT INTO public.props_capture_plans(plan_version,slate_date,provider_event_id,home_team,away_team,commence_time,selected,selection_rank,arm,reason,run_id)
 VALUES('props-capture-v1','2026-11-20','evtCAPTURE0003','Home V','Away V','2026-11-21T02:00:00Z',true,1,NULL,'selected_by_hash',%s)$$,:crun),'check constraint');
-- A selected game that has already started cannot be planned.
SELECT props_test.raises(format($$INSERT INTO public.props_capture_plans(plan_version,slate_date,provider_event_id,home_team,away_team,commence_time,selected,selection_rank,arm,reason,run_id)
 VALUES('props-capture-v1','2026-11-20','evtCAPTURE0004','Home W','Away W','2026-11-20T15:00:00Z',true,1,'late','selected_by_hash',%s)$$,:crun),'PROPS_CAPTURE_PLAN_CHRONOLOGY');
SELECT id AS plan1 FROM public.props_capture_plans WHERE provider_event_id='evtCAPTURE0001' \gset
SELECT id AS plan2 FROM public.props_capture_plans WHERE provider_event_id='evtCAPTURE0002' \gset

-- 2. Claims: one per (plan, key); unselected or mismatched games and after-lock claims are refused.
INSERT INTO public.props_captures(plan_id,provider_event_id,run_id,capture_key,window_name) VALUES(:plan1,'evtCAPTURE0001',:crun,'primary','early');
SELECT props_test.raises(format($$INSERT INTO public.props_captures(plan_id,provider_event_id,run_id,capture_key,window_name) VALUES(%s,'evtCAPTURE0001',%s,'primary','late')$$,:plan1,:crun),'duplicate key');
SELECT props_test.raises(format($$INSERT INTO public.props_captures(plan_id,provider_event_id,run_id,capture_key,window_name) VALUES(%s,'evtCAPTURE0002',%s,'primary','late')$$,:plan2,:crun),'PROPS_CAPTURE_NOT_PLANNED');
SELECT props_test.raises(format($$INSERT INTO public.props_captures(plan_id,provider_event_id,run_id,capture_key,window_name) VALUES(%s,'evtCAPTURE0009',%s,'retry','late')$$,:plan1,:crun),'PROPS_CAPTURE_NOT_PLANNED');
SELECT id AS cap1 FROM public.props_captures WHERE plan_id=:plan1 AND capture_key='primary' \gset

-- 3. Outcomes: one per claim; "stored" needs lines; the reservation must belong to this run and game.
SELECT public.props_reserve_credits(:crun,'event_odds','evtCAPTURE0001',3) AS res1 \gset
SELECT props_test.raises(format($$INSERT INTO public.props_capture_outcomes(capture_id,outcome,reservation_id,dfs_lines) VALUES(%s,'stored',%s,0)$$,:cap1,:res1),'PROPS_CAPTURE_STORED_WITHOUT_LINES');
INSERT INTO public.props_capture_outcomes(capture_id,outcome,reservation_id,http_status,provider_cost_last,dfs_lines,lines_by_platform,minutes_to_tip)
 VALUES(:cap1,'stored',:res1,200,3,36,'{"prizepicks":29,"pick6":7}',540);
SELECT props_test.raises(format($$INSERT INTO public.props_capture_outcomes(capture_id,outcome) VALUES(%s,'no_dfs_lines')$$,:cap1),'duplicate key');
SELECT props_test.raises(format($$INSERT INTO public.props_capture_outcomes(capture_id,outcome) VALUES(%s,'made_up')$$,:cap1),'check constraint');

-- 4. Append-only: service_role has no UPDATE/DELETE grant, and even a superuser is stopped by the trigger.
SELECT props_test.raises($$UPDATE public.props_capture_plans SET arm='late' WHERE provider_event_id='evtCAPTURE0001'$$,'permission denied');
SELECT props_test.raises($$DELETE FROM public.props_captures$$,'permission denied');
RESET ROLE;
SELECT props_test.raises($$UPDATE public.props_capture_plans SET arm='late' WHERE provider_event_id='evtCAPTURE0001'$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$DELETE FROM public.props_captures$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$UPDATE public.props_capture_outcomes SET outcome='no_dfs_lines'$$,'PROPS_IMMUTABLE');
SET ROLE service_role;

-- 5. Inside the 20-minute margin a claim is refused; after the run finishes nothing more can be written.
SELECT props_test.at('2026-11-21T00:45:00Z');
SELECT props_test.raises(format($$INSERT INTO public.props_captures(plan_id,provider_event_id,run_id,capture_key,window_name) VALUES(%s,'evtCAPTURE0001',%s,'recheck','late')$$,:plan1,:crun),'PROPS_');
SELECT public.props_finish_run(:crun,'completed','COMPLETED','{}'::jsonb);
SELECT props_test.at('2026-11-20T18:00:00Z');
SELECT props_test.raises(format($$INSERT INTO public.props_captures(plan_id,provider_event_id,run_id,capture_key,window_name) VALUES(%s,'evtCAPTURE0001',%s,'retry','early')$$,:plan1,:crun),'PROPS_RUN_NOT_ACTIVE');
RESET ROLE;

-- 6. Only service_role can see or write these tables.
SET ROLE anon;
SELECT props_test.raises($$SELECT count(*) FROM public.props_capture_plans$$,'permission denied');
SELECT props_test.raises($$SELECT count(*) FROM public.props_captures$$,'permission denied');
RESET ROLE;
GRANT USAGE ON SCHEMA props_test TO authenticated;
GRANT EXECUTE ON FUNCTION props_test.raises(text,text) TO authenticated;
SET ROLE authenticated;
SELECT props_test.raises($$SELECT count(*) FROM public.props_capture_outcomes$$,'permission denied');
RESET ROLE;
SELECT 'PROPS_CAPTURE_V1_SQL_TESTS_PASS' AS result;
