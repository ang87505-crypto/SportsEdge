\set ON_ERROR_STOP on
-- Disposable database only: real schema/triggers with synthetic source entries and outcomes.
SELECT props_test.at('2026-12-20T12:00:00Z');
SELECT public.props_set_control('RUNNING','penny test','owner-test');
SELECT (public.props_begin_run('collect','collect-penny-test','test:penny',NULL,1800)->>'runId')::bigint AS penny_run \gset
-- Fixture helpers run as the disposable database owner, never deployed.
CREATE FUNCTION props_test.penny_source(r bigint,nonce integer,p numeric DEFAULT 0.65,same_game boolean DEFAULT false) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE raw bigint; obs bigint; pred bigint; pick bigint; eid bigint; j integer;
BEGIN
 INSERT INTO public.props_raw_responses(run_id,source,endpoint,external_id,http_status,received_at,content_sha256,body)
 VALUES(r,'the_odds_api','event_odds','evtPENNY'||nonce,200,public.props_now(),repeat('d',64),'{}') RETURNING id INTO raw;
 INSERT INTO public.props_entries(account_id,run_id,entry_key,entry_type,pick_count,stake_cents,payout_terms_version,lock_at)
 SELECT id,r,encode(sha256(convert_to('penny-test-'||nonce,'UTF8')),'hex'),'power',2,500,'prizepicks-power-standard-20261107','2026-12-21T00:00:00Z'
 FROM public.props_accounts WHERE platform='prizepicks' ORDER BY id LIMIT 1 RETURNING id INTO eid;
 FOR j IN 1..2 LOOP
  obs:=props_test.obs(r,raw,'evtPENNY'||nonce||CASE WHEN same_game THEN '0' ELSE j::text END,'Synthetic Penny '||nonce||' '||j,'points',10.5,
   '2026-12-21T00:00:00Z',public.props_now()::text,public.props_now()::text);
  INSERT INTO public.props_predictions(observation_id,run_id,model_version,status,reason,athlete_id,p_more,p_less,p_tie,mean,data_cutoff,inputs)
  VALUES(obs,r,'props-nb-minutes-rate-v1','scored','ok',(nonce*2+j)::text,p,1-p,0,20,public.props_now(),'{}') RETURNING id INTO pred;
  INSERT INTO public.props_picks(prediction_id,run_id,selection_version,status,side,reason) VALUES(pred,r,'props-select-v1','recorded','more','edge') RETURNING id INTO pick;
  INSERT INTO public.props_entry_legs(entry_id,pick_id) VALUES(eid,pick);
 END LOOP;RETURN eid;
END $$;
CREATE FUNCTION props_test.penny_grades(source_id bigint,rev integer,kind text) RETURNS bigint[] LANGUAGE plpgsql AS $$
DECLARE o record; pg bigint; rid bigint; ids bigint[]:='{}'; outcome text; points integer; k integer:=0;
BEGIN
 FOR o IN SELECT ob.* FROM public.props_entry_legs l JOIN public.props_picks p ON p.id=l.pick_id JOIN public.props_predictions pr ON pr.id=p.prediction_id
 JOIN public.props_observations ob ON ob.id=pr.observation_id WHERE l.entry_id=source_id ORDER BY l.pick_id LOOP
  k:=k+1;
  IF kind='refund' OR (kind='partial' AND k=2) THEN
   INSERT INTO public.props_line_results(observation_id,revision,outcome) VALUES(o.id,rev,'void_postponed') RETURNING id INTO rid;
  ELSE
   points:=CASE WHEN kind='loss' THEN 5 ELSE 20 END;outcome:=CASE WHEN kind='loss' THEN 'less' ELSE 'more' END;
   INSERT INTO public.props_player_games(source,espn_event_id,athlete_id,athlete_name,team_abbr,opponent_abbr,game_start,game_status,did_not_play,
    minutes,points,rebounds,assists,retrieved_at,content_sha256,revision)
   VALUES('espn_summary',(900000+o.id)::text,'1',o.player_name,'LAL','BOS',o.lock_at,'final',false,30,points,4,4,public.props_now(),repeat('e',64),rev) RETURNING id INTO pg;
   INSERT INTO public.props_line_results(observation_id,revision,outcome,actual,player_game_id) VALUES(o.id,rev,outcome,points,pg) RETURNING id INTO rid;
  END IF;ids:=array_append(ids,rid);
 END LOOP;RETURN ids;
END $$;
SELECT props_test.penny_source(:penny_run,1) AS old_source \gset
SELECT props_test.at('2026-12-20T12:00:01Z');
SET ROLE service_role;
INSERT INTO public.props_penny_cohorts(id,policy_sha256,policy,registered_at) VALUES('penny-paper-entry-v1',
 '0b79bd54409a9dd01d14c1c208263c3ecb8f0f08e05db5434e4822346716e68b',
 '{"comparison":"same_entries_flat_ten_cents","dailyRiskCents":1500,"dependenceHaircutPercent":2,"entryType":"two_pick_power_different_games","fractionalCentReturn":"floor","grossMultiplierMilli":3000,"id":"penny-paper-entry-v1","initialCents":50000,"maxStakeCents":50,"paperOnly":true,"probabilityBasis":"recorded_model_estimate_not_calibrated","probabilityScale":1000000,"promotion":"none","referenceStakeCents":10,"sizingPolicy":"penny-excess-probability-v1","termsVersion":"prizepicks-power-standard-20261107","version":1}',
 '2020-01-01T00:00:00Z');
SELECT props_test.eq((SELECT registered_at::text FROM public.props_penny_cohorts),public.props_now()::text,'cohort cannot be backdated');
SELECT props_test.raises(format($$INSERT INTO public.props_penny_entries(cohort_id,source_entry_id) VALUES('penny-paper-entry-v1',%s)$$,:old_source),'PROPS_PENNY_BEFORE_COHORT');
RESET ROLE;
SELECT props_test.at('2026-12-20T12:00:02Z');
SELECT props_test.penny_source(:penny_run,2) AS source \gset
SELECT props_test.penny_source(:penny_run,3,0.60) AS small_source \gset
SELECT props_test.penny_source(:penny_run,4,0.75,true) AS same_source \gset
SET ROLE service_role;
INSERT INTO public.props_penny_entries(cohort_id,source_entry_id,stake_cents,probability_ppm,recorded_at)
 VALUES('penny-paper-entry-v1',:source,50,1000000,'2020-01-01T00:00:00Z') RETURNING id AS penny_id \gset
SELECT props_test.eq((SELECT probability_ppm||'/'||stake_cents||'/'||reference_stake_cents FROM public.props_penny_entries WHERE id=:penny_id),'414050/8/10','DB recomputes sizing from whole entry');
SELECT props_test.eq((SELECT recorded_at::text FROM public.props_penny_entries WHERE id=:penny_id),public.props_now()::text,'stake cannot be backdated');
INSERT INTO public.props_penny_entries(cohort_id,source_entry_id) VALUES('penny-paper-entry-v1',:small_source) RETURNING id AS small_id \gset
SELECT props_test.eq((SELECT stake_cents::text FROM public.props_penny_entries WHERE id=:small_id),'1','one-cent stake');
INSERT INTO public.props_penny_entries(cohort_id,source_entry_id) VALUES('penny-paper-entry-v1',:same_source);
SELECT props_test.eq((SELECT reason||'/'||stake_cents FROM public.props_penny_entries WHERE source_entry_id=:same_source),'DEPENDENCE_UNKNOWN/0','same game has no known payout/dependence');
SELECT props_test.raises(format($$INSERT INTO public.props_penny_entries(cohort_id,source_entry_id) VALUES('penny-paper-entry-v1',%s)$$,:source),'duplicate key');
SELECT props_test.raises($$UPDATE public.props_penny_entries SET stake_cents=50$$,'permission denied');
SELECT props_test.raises($$DELETE FROM public.props_penny_settlements$$,'permission denied');
SELECT public.props_set_control('PAUSED','test pause','owner-test');
RESET ROLE;
SELECT props_test.penny_source(:penny_run,5) AS paused_source \gset
SET ROLE service_role;
SELECT props_test.raises(format($$INSERT INTO public.props_penny_entries(cohort_id,source_entry_id) VALUES('penny-paper-entry-v1',%s)$$,:paused_source),'PROPS_PENNY_PAUSED');
SELECT public.props_set_control('RUNNING','test resume','owner-test');
RESET ROLE;
-- Many synthetic source entries prove per-entry and independent daily limits at the serialization point.
DO $$ DECLARE r bigint; source_id bigint; BEGIN
 SELECT id INTO r FROM public.props_runs WHERE slot_key='collect-penny-test';
 FOR n IN 10..45 LOOP
  source_id:=props_test.penny_source(r,n,0.99);
  INSERT INTO public.props_penny_entries(cohort_id,source_entry_id) VALUES('penny-paper-entry-v1',source_id);
 END LOOP;
END $$;
SELECT props_test.eq((SELECT sum(stake_cents)::text FROM public.props_penny_entries),'1500','daily stake cap');
SELECT props_test.eq((SELECT max(stake_cents)::text FROM public.props_penny_entries),'50','entry cap');
SELECT props_test.eq((SELECT count(*)>0 FROM public.props_penny_entries WHERE reason='NO_ROOM')::text,'true','exhausted room recorded');
SELECT props_test.eq((SELECT count(*)::text FROM public.props_penny_tampering),'0','frozen rows sealed');
SELECT props_test.at('2026-12-21T02:00:00Z');
SELECT props_test.penny_grades(:source,1,'win')::text AS grades \gset
SELECT props_test.penny_grades(:small_source,1,'partial')::text AS small_grades \gset
SET ROLE service_role;
SELECT props_test.raises(format($$INSERT INTO public.props_penny_entries(cohort_id,source_entry_id) VALUES('penny-paper-entry-v1',%s)$$,:paused_source),'PROPS_PENNY_AFTER_LOCK');
INSERT INTO public.props_penny_settlements(penny_entry_id,grade_ids,return_cents) VALUES(:penny_id,:'grades',9999);
SELECT props_test.eq((SELECT return_cents||'/'||profit_cents||'/'||reference_profit_cents FROM public.props_penny_settlements WHERE penny_entry_id=:penny_id),'24/16/20','actual grade computes both arms');
INSERT INTO public.props_penny_settlements(penny_entry_id,grade_ids) VALUES(:small_id,:'small_grades');
SELECT props_test.eq((SELECT return_cents||'/'||profit_cents FROM public.props_penny_settlements WHERE penny_entry_id=:small_id),'1/0','partial payout rounds down');
SELECT props_test.raises(format($$INSERT INTO public.props_penny_settlements(penny_entry_id,grade_ids) VALUES(%s,'{1,2}')$$,:penny_id),'PROPS_PENNY_GRADE_MISMATCH');
RESET ROLE;
SELECT props_test.at('2026-12-21T03:00:00Z');
SELECT props_test.penny_grades(:source,2,'loss')::text AS correction \gset
SET ROLE service_role;
INSERT INTO public.props_penny_settlements(penny_entry_id,grade_ids) VALUES(:penny_id,:'correction');
SELECT props_test.eq((SELECT count(*)::text FROM public.props_penny_settlements WHERE penny_entry_id=:penny_id),'2','correction appends');
SELECT props_test.eq((SELECT profit_cents::text FROM public.props_penny_settlements WHERE penny_entry_id=:penny_id ORDER BY revision DESC LIMIT 1),'-8','latest corrected result');
SELECT props_test.raises($$DELETE FROM public.props_penny_entries$$,'permission denied');
RESET ROLE;
SELECT props_test.raises($$UPDATE public.props_penny_entries SET stake_cents=2$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$UPDATE public.props_penny_settlements SET profit_cents=999$$,'PROPS_IMMUTABLE');
SELECT props_test.eq((SELECT count(*)::text FROM public.props_penny_tampering),'0','settlements sealed');
ALTER TABLE public.props_penny_entries DISABLE TRIGGER props_append_only;
UPDATE public.props_penny_entries SET stake_cents=7 WHERE id=:penny_id;
ALTER TABLE public.props_penny_entries ENABLE TRIGGER props_append_only;
SELECT props_test.eq((SELECT count(*)::text FROM public.props_penny_tampering),'1','out of band changes detected');
ALTER TABLE public.props_penny_entries DISABLE TRIGGER props_append_only;
UPDATE public.props_penny_entries SET stake_cents=8 WHERE id=:penny_id;
ALTER TABLE public.props_penny_entries ENABLE TRIGGER props_append_only;
SET ROLE anon;
SELECT props_test.raises($$SELECT * FROM public.props_penny_entries$$,'permission denied');
SELECT props_test.raises($$SELECT * FROM public.props_penny_settlements$$,'permission denied');
RESET ROLE;
SELECT 'PROPS_PENNY_PAPER_V1_SQL_TESTS_PASS';
