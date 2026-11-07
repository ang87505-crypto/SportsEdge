\set ON_ERROR_STOP on
-- Disposable PostgreSQL only: props_v1 contract tests with synthetic TEST identities.
-- The schema clock is pinned so chronology rules can be exercised deterministically.
CREATE OR REPLACE FUNCTION public.props_now() RETURNS timestamptz
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT coalesce(nullif(current_setting('props_test.now',true),'')::timestamptz,clock_timestamp())
$$;
GRANT EXECUTE ON FUNCTION public.props_now() TO service_role;
ALTER ROLE service_role BYPASSRLS;  -- as on Supabase
CREATE SCHEMA props_test;
GRANT USAGE,CREATE ON SCHEMA props_test TO service_role;
GRANT USAGE ON SCHEMA props_test TO anon;
CREATE FUNCTION props_test.at(ts text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('props_test.now',ts,false); END $$;
CREATE FUNCTION props_test.raises(stmt text,pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE stmt;
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM !~ pattern THEN RAISE EXCEPTION 'WRONG_ERROR [%] wanted [%] for: %',SQLERRM,pattern,left(stmt,200); END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'EXPECTED_ERROR [%] for: %',pattern,left(stmt,200);
END $$;
CREATE FUNCTION props_test.eq(got text,want text,what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'MISMATCH % got [%] want [%]',what,got,want; END IF; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA props_test TO service_role,anon;

SET ROLE service_role;
SELECT props_test.at('2026-11-07T20:00:00Z');

-- 1. Starts PAUSED: a scheduled run is recorded as skipped, not executed.
SELECT props_test.eq(public.props_begin_run('collect','collect-2026-11-07T20','gha:1',
 '2026-11-07T19:50:00Z',600)->>'outcome','CONTROL_PAUSED','paused start');
SELECT props_test.eq((SELECT status||'/'||start_delay_seconds FROM public.props_runs WHERE slot_key='collect-2026-11-07T20'),
 'skipped/600','skipped run + delay recorded');
SELECT props_test.raises($$UPDATE public.props_runs SET status='running'$$,'permission denied');
SELECT props_test.raises($$UPDATE public.props_control SET state='RUNNING'$$,'permission denied');

-- 2. Owner resume; duplicate slot and concurrent run are refused.
SELECT public.props_set_control('RUNNING','test resume','owner-test');
SELECT props_test.eq(public.props_begin_run('collect','collect-2026-11-07T20','gha:2',NULL,600)->>'outcome','DUPLICATE','dup slot');
SELECT props_test.eq(public.props_begin_run('collect','collect-2026-11-07T20b','gha:3',NULL,600)->>'outcome','STARTED','start');
SELECT props_test.eq(public.props_begin_run('collect','collect-2026-11-07T20c','gha:4',NULL,600)->>'outcome','BUSY','concurrent');
SELECT props_test.eq(public.props_begin_run('settle','settle-2026-11-07','gha:5',NULL,600)->>'outcome','STARTED','other kind ok');
SELECT id AS run FROM public.props_runs WHERE slot_key='collect-2026-11-07T20b' \gset
SELECT id AS settle_run FROM public.props_runs WHERE slot_key='settle-2026-11-07' \gset

-- 3. Budget: 12/day cap, conservative (never refunded), provider floor.
SELECT public.props_reserve_credits(:run,'events',NULL,1);
SELECT public.props_reserve_credits(:run,'event_odds','evtTEST000001',3);
SELECT public.props_reserve_credits(:run,'event_odds','evtTEST000002',3);
SELECT public.props_reserve_credits(:run,'event_odds','evtTEST000003',3);
SELECT props_test.raises(format('SELECT public.props_reserve_credits(%s,%L,%L,3)',:run,'event_odds','evtTEST000004'),'PROPS_BUDGET_DAILY_CAP');
SELECT public.props_record_usage(id,200,60,440,3) FROM public.props_credit_reservations ORDER BY id DESC LIMIT 1;
SELECT props_test.raises(format('SELECT public.props_reserve_credits(%s,%L,NULL,1)',:run,'events'),'PROPS_BUDGET_PROVIDER_FLOOR');
SELECT props_test.at('2026-11-08T20:01:00Z');
SELECT props_test.raises(format('SELECT public.props_heartbeat(%s,600)',:run),'PROPS_RUN_NOT_ACTIVE');
SELECT props_test.at('2026-11-07T20:01:00Z');
SELECT public.props_heartbeat(:run,600);

-- 4. Observations: chronology, staleness, duplicates, immutability, no fixtures.
INSERT INTO public.props_raw_responses(run_id,source,endpoint,external_id,http_status,received_at,content_sha256,body)
 VALUES(:run,'the_odds_api','event_odds','evtTEST000001',200,'2026-11-07T20:00:30Z',repeat('a',64),'{"id":"evtTEST000001"}');
SELECT id AS raw FROM public.props_raw_responses LIMIT 1 \gset
CREATE FUNCTION props_test.obs(p_run bigint,p_raw bigint,ev text,player text,stat text,line numeric,lock text,ingested text,updated text,platform text DEFAULT 'prizepicks')
RETURNS bigint LANGUAGE sql AS $$
 INSERT INTO public.props_observations(run_id,raw_response_id,provider,platform,bookmaker_key,provider_event_id,home_team,away_team,
  commence_time,lock_at,player_name,stat,market_key,period,line,over_price,under_price,provider_last_update,ingested_at,
  normalizer_version,response_sha256,source_fields)
 VALUES(p_run,p_raw,'the_odds_api',platform,platform,ev,'Test Home','Test Away',lock::timestamptz,lock::timestamptz,player,stat,
  'player_'||stat,'full_game',line,-137,-137,updated::timestamptz,ingested::timestamptz,'props-normalize-v1',repeat('a',64),'{}')
 RETURNING id $$;
GRANT EXECUTE ON FUNCTION props_test.obs TO service_role;
SELECT props_test.obs(:run,:raw,'evtTEST000001','Player A','points',24.5,'2026-11-08T00:00:00Z','2026-11-07T20:00:30Z','2026-11-07T19:30:00Z') AS o1 \gset
SELECT props_test.obs(:run,:raw,'evtTEST000002','Player B','rebounds',9.5,'2026-11-08T00:30:00Z','2026-11-07T20:00:30Z','2026-11-07T19:30:00Z') AS o2 \gset
SELECT props_test.obs(:run,:raw,'evtTEST000001','Player C','assists',6.5,'2026-11-08T00:00:00Z','2026-11-07T20:00:30Z','2026-11-07T19:30:00Z') AS o3 \gset
SELECT props_test.obs(:run,:raw,'evtTEST000003','Player D','points',10.5,'2026-11-08T01:00:00Z','2026-11-07T20:00:30Z','2026-11-07T19:30:00Z','pick6') AS o4 \gset
SELECT props_test.obs(:run,:raw,'evtTEST000004','Player E','points',12.5,'2026-11-08T01:00:00Z','2026-11-07T20:00:30Z','2026-11-07T19:30:00Z','pick6') AS o5 \gset
SELECT props_test.raises(format('SELECT props_test.obs(%s,%s,%L,%L,%L,24.5,%L,%L,%L)',:run,:raw,'evtTEST000001','Player A','points',
 '2026-11-08T00:00:00Z','2026-11-07T20:00:30Z','2026-11-07T19:30:00Z'),'duplicate key');
SELECT props_test.raises(format('SELECT props_test.obs(%s,%s,%L,%L,%L,5.5,%L,%L,%L)',:run,:raw,'evtTEST000009','Late','points',
 '2026-11-07T20:00:45Z','2026-11-07T20:00:30Z','2026-11-07T19:30:00Z'),'PROPS_OBSERVATION_CHRONOLOGY');
SELECT props_test.raises(format('SELECT props_test.obs(%s,%s,%L,%L,%L,5.5,%L,%L,%L)',:run,:raw,'evtTEST000009','Future','points',
 '2026-11-08T00:00:00Z','2026-11-07T20:05:00Z','2026-11-07T19:30:00Z'),'PROPS_OBSERVATION_CHRONOLOGY');
SELECT props_test.raises(format('SELECT props_test.obs(%s,%s,%L,%L,%L,5.5,%L,%L,%L)',:run,:raw,'evtTEST000009','Stale','points',
 '2026-11-08T00:00:00Z','2026-11-07T20:00:30Z','2026-11-07T17:00:00Z'),'PROPS_OBSERVATION_CHRONOLOGY');
SELECT props_test.raises(format('SELECT props_test.obs(%s,%s,%L,%L,%L,5.4,%L,%L,%L)',:run,:raw,'evtTEST000009','Odd','points',
 '2026-11-08T00:00:00Z','2026-11-07T20:00:30Z','2026-11-07T19:30:00Z'),'check constraint');
SELECT props_test.raises($$UPDATE public.props_observations SET line=1.5$$,'permission denied|PROPS_IMMUTABLE');
SELECT props_test.raises($$INSERT INTO public.props_observations(run_id,raw_response_id,provider,platform,bookmaker_key,provider_event_id,home_team,away_team,
 commence_time,lock_at,player_name,stat,market_key,period,line,provider_last_update,ingested_at,normalizer_version,response_sha256,source_fields,is_fixture)
 SELECT run_id,raw_response_id,provider,platform,bookmaker_key,'evtTEST000077',home_team,away_team,commence_time,lock_at,'Fixture',stat,market_key,period,line,
 provider_last_update,ingested_at,normalizer_version,response_sha256,source_fields,true FROM public.props_observations LIMIT 1$$,'check constraint');

-- 5. Predictions and picks: refused at/after lock or with post-lock data.
CREATE FUNCTION props_test.pred(p_run bigint,obs bigint,pm numeric,cutoff text) RETURNS bigint LANGUAGE sql AS $$
 INSERT INTO public.props_predictions(observation_id,run_id,model_version,status,reason,athlete_id,p_more,p_less,p_tie,mean,data_cutoff,inputs)
 VALUES(obs,p_run,'props-nb-minutes-rate-v1','scored','ok','1',pm,1-pm,0,20,cutoff::timestamptz,'{}') RETURNING id $$;
GRANT EXECUTE ON FUNCTION props_test.pred TO service_role;
SELECT props_test.pred(:run,:o1,0.62,'2026-11-07T12:00:00Z') AS p1 \gset
SELECT props_test.pred(:run,:o2,0.35,'2026-11-07T12:00:00Z') AS p2 \gset
SELECT props_test.pred(:run,:o3,0.61,'2026-11-07T12:00:00Z') AS p3 \gset
SELECT props_test.pred(:run,:o4,0.70,'2026-11-07T12:00:00Z') AS p4 \gset
SELECT props_test.pred(:run,:o5,0.30,'2026-11-07T12:00:00Z') AS p5 \gset
SELECT props_test.raises(format('SELECT props_test.pred(%s,%s,0.5,%L)',:run,:o1,'2026-11-07T21:00:00Z'),'PROPS_PREDICTION_AFTER_LOCK|duplicate key');
INSERT INTO public.props_picks(prediction_id,run_id,selection_version,status,side,reason) VALUES
 (:p1,:run,'props-select-v1','recorded','more','edge'),(:p2,:run,'props-select-v1','recorded','less','edge'),
 (:p3,:run,'props-select-v1','recorded','more','edge'),(:p4,:run,'props-select-v1','recorded','more','edge'),
 (:p5,:run,'props-select-v1','recorded','less','edge');
SELECT id AS k1 FROM public.props_picks WHERE prediction_id=:p1 \gset
SELECT id AS k2 FROM public.props_picks WHERE prediction_id=:p2 \gset
SELECT id AS k3 FROM public.props_picks WHERE prediction_id=:p3 \gset
SELECT id AS k4 FROM public.props_picks WHERE prediction_id=:p4 \gset
SELECT id AS k5 FROM public.props_picks WHERE prediction_id=:p5 \gset

-- 6. Entries: same-game legs refused, cross-platform refused, idempotent, daily limit.
SELECT id AS pp FROM public.props_accounts WHERE slug='props-prizepicks-v1' \gset
SELECT id AS p6 FROM public.props_accounts WHERE slug='props-pick6-v1' \gset
SELECT props_test.raises(format('SELECT public.props_record_entry(%s,%s,ARRAY[%s,%s]::bigint[],%L,%L)',:pp,:run,:k1,:k3,'power','pp-standard-v1'),'PROPS_ENTRY_CORRELATED');
SELECT props_test.raises(format('SELECT public.props_record_entry(%s,%s,ARRAY[%s,%s]::bigint[],%L,%L)',:pp,:run,:k1,:k4,'power','pp-standard-v1'),'PROPS_ENTRY_INELIGIBLE_PICK');
SELECT props_test.eq(public.props_record_entry(:pp,:run,ARRAY[:k1,:k2]::bigint[],'power','pp-standard-v1')->>'outcome','RECORDED','pp entry');
SELECT props_test.eq(public.props_record_entry(:pp,:run,ARRAY[:k2,:k1]::bigint[],'power','pp-standard-v1')->>'outcome','DUPLICATE','idempotent');
SELECT props_test.raises(format('SELECT public.props_record_entry(%s,%s,ARRAY[%s,%s]::bigint[],%L,%L)',:pp,:run,:k3,:k2,'power','pp-standard-v1'),'PROPS_PICK_ALREADY_ENTERED');
SELECT props_test.eq(public.props_record_entry(:p6,:run,ARRAY[:k4,:k5]::bigint[],'pick6_standard',NULL)->>'outcome','RECORDED','pick6 entry');

-- 7. STOP mid-run blocks further provider spend.
SELECT public.props_set_control('PAUSED','owner pause test','owner-test');
SELECT props_test.raises(format('SELECT public.props_reserve_credits(%s,%L,NULL,1)',:run,'events'),'PROPS_CONTROL_PAUSED');
SELECT public.props_set_control('RUNNING','owner resume test','owner-test');

-- 8. Interrupted run: lease lapses, next start abandons it; its late writes are refused.
SELECT props_test.at('2026-11-07T20:20:00Z');
SELECT props_test.eq(public.props_begin_run('collect','collect-2026-11-07T21','gha:6',NULL,600)->>'abandoned','1','abandoned');
SELECT props_test.eq((SELECT status||'/'||outcome FROM public.props_runs WHERE id=:run),'abandoned/LEASE_EXPIRED','recovered');
SELECT props_test.raises(format('SELECT props_test.obs(%s,%s,%L,%L,%L,7.5,%L,%L,%L)',:run,:raw,'evtTEST000005','Zombie','points',
 '2026-11-08T00:00:00Z','2026-11-07T20:19:00Z','2026-11-07T19:30:00Z'),'PROPS_RUN_NOT_ACTIVE');

-- 9. Results: not before lock; must match the box score; DNP voids; corrections are revisions.
INSERT INTO public.props_player_games(source,espn_event_id,athlete_id,athlete_name,team_abbr,opponent_abbr,game_start,game_status,did_not_play,minutes,points,rebounds,assists,retrieved_at,content_sha256)
 VALUES('espn_summary','401999001','1','Player A','TST','OPP','2026-11-08T00:00:00Z','final',false,34,27,5,4,'2026-11-08T03:00:00Z',repeat('b',64)),
       ('espn_summary','401999002','2','Player B','TST','OPP','2026-11-08T00:30:00Z','final',true,NULL,NULL,NULL,NULL,'2026-11-08T03:00:00Z',repeat('c',64));
SELECT props_test.raises($$INSERT INTO public.props_player_games(source,espn_event_id,athlete_id,athlete_name,team_abbr,opponent_abbr,game_start,game_status,did_not_play,minutes,points,rebounds,assists,retrieved_at,content_sha256)
 VALUES('espn_summary','401999003','3','Missing','TST','OPP','2026-11-08T00:00:00Z','final',false,30,NULL,4,4,'2026-11-08T03:00:00Z',repeat('d',64))$$,'check constraint');
SELECT id AS g1 FROM public.props_player_games WHERE athlete_id='1' \gset
SELECT id AS g2 FROM public.props_player_games WHERE athlete_id='2' \gset
SELECT props_test.raises(format('INSERT INTO public.props_line_results(observation_id,player_game_id,actual,outcome) VALUES(%s,%s,27,%L)',:o1,:g1,'more'),'PROPS_RESULT_BEFORE_LOCK');
SELECT props_test.at('2026-11-08T03:10:00Z');
SELECT props_test.raises(format('INSERT INTO public.props_line_results(observation_id,player_game_id,actual,outcome) VALUES(%s,%s,27,%L)',:o1,:g1,'less'),'PROPS_RESULT_INCONSISTENT');
SELECT props_test.raises(format('INSERT INTO public.props_line_results(observation_id,player_game_id,actual,outcome) VALUES(%s,%s,26,%L)',:o1,:g1,'more'),'PROPS_RESULT_INCONSISTENT');
INSERT INTO public.props_line_results(observation_id,player_game_id,actual,outcome) VALUES(:o1,:g1,27,'more');
SELECT props_test.raises(format('INSERT INTO public.props_line_results(observation_id,player_game_id,actual,outcome) VALUES(%s,%s,9,%L)',:o2,:g2,'less'),'PROPS_RESULT_INCONSISTENT');
-- Settlement waits until every leg has a result.
SELECT props_test.raises(format('SELECT public.props_record_settlement(e.id,%L,1500,1500,%L) FROM public.props_entries e WHERE account_id=%s',
 'won','pp-standard-v1',:pp),'PROPS_SETTLEMENT_UNGRADED_LEG');
INSERT INTO public.props_line_results(observation_id,player_game_id,actual,outcome) VALUES(:o2,:g2,NULL,'void_dnp');
-- PrizePicks 2-pick Power with one win and one DNP pays 1.5x per the captured table.
SELECT props_test.raises(format('SELECT public.props_record_settlement(e.id,%L,1500,1500,%L) FROM public.props_entries e WHERE account_id=%s',
 'won','pp-standard-v1',:pp),'PROPS_SETTLEMENT_INCONSISTENT');
SELECT props_test.eq((SELECT public.props_record_settlement(e.id,'won',1500,750,'pp-standard-v1')->>'voids' FROM public.props_entries e WHERE account_id=:pp),'1','settled');
SELECT props_test.eq((SELECT profit_cents::text FROM public.props_entry_settlements s JOIN public.props_entries e ON e.id=s.entry_id WHERE e.account_id=:pp),'250','profit');
SELECT props_test.eq((SELECT public.props_record_settlement(e.id,'won',1500,750,'pp-standard-v1')->>'outcome' FROM public.props_entries e WHERE account_id=:pp),'DUPLICATE','settle once');
-- Stat correction: append a revision; prior rows are immutable.
SELECT props_test.raises($$UPDATE public.props_player_games SET points=28$$,'permission denied|PROPS_IMMUTABLE');
SELECT props_test.raises($$DELETE FROM public.props_line_results$$,'permission denied|PROPS_IMMUTABLE');

-- Pick6: a winning set has an unknown total payout (peer-to-peer Extra Winnings, base table not captured).
INSERT INTO public.props_player_games(source,espn_event_id,athlete_id,athlete_name,team_abbr,opponent_abbr,game_start,game_status,did_not_play,minutes,points,rebounds,assists,retrieved_at,content_sha256)
 VALUES('espn_summary','401999004','4','Player D','TST','OPP','2026-11-08T01:00:00Z','final',false,30,14,3,3,'2026-11-08T04:00:00Z',repeat('e',64)),
       ('espn_summary','401999005','5','Player E','TST','OPP','2026-11-08T01:00:00Z','final',false,30,9,3,3,'2026-11-08T04:00:00Z',repeat('f',64));
INSERT INTO public.props_line_results(observation_id,player_game_id,actual,outcome)
 SELECT :o4,id,14,'more' FROM public.props_player_games WHERE athlete_id='4';
INSERT INTO public.props_line_results(observation_id,player_game_id,actual,outcome)
 SELECT :o5,id,9,'less' FROM public.props_player_games WHERE athlete_id='5';
SELECT props_test.raises(format('SELECT public.props_record_settlement(e.id,%L,3000,1500,NULL) FROM public.props_entries e WHERE account_id=%s','payout_unknown',:p6),'PROPS_SETTLEMENT_INCONSISTENT');
SELECT props_test.eq((SELECT public.props_record_settlement(e.id,'payout_unknown',NULL,NULL,NULL)->>'wins' FROM public.props_entries e WHERE account_id=:p6),'2','pick6 unknown');

RESET ROLE;
-- 10. Anonymous and signed-in web roles see nothing.
SET ROLE anon;
SELECT props_test.raises($$SELECT count(*) FROM public.props_observations$$,'permission denied');
SELECT props_test.raises($$SELECT public.props_set_control('RUNNING','x','anon')$$,'permission denied');
RESET ROLE;
SELECT 'PROPS_V1_SQL_TESTS_PASS' AS result;
