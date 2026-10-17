\set ON_ERROR_STOP on
-- Disposable PostgreSQL only: recurring PAPER controller schema v1 contract tests.
-- Synthetic identities, prices and broker ids. No broker or network access.
-- The schema clock is pinned to explicit New York session times.
CREATE OR REPLACE FUNCTION sportsedge_paper_auto._now() RETURNS timestamptz
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT coalesce(nullif(current_setting('paper_auto_test.now',true),'')::timestamptz,clock_timestamp())
$$;
CREATE SCHEMA paper_auto_test;
CREATE FUNCTION paper_auto_test.at(ts text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('paper_auto_test.now',ts,false); END $$;
CREATE FUNCTION paper_auto_test.now_text(o interval DEFAULT '0') RETURNS text
LANGUAGE sql AS $$ SELECT to_char((sportsedge_paper_auto._now()+o) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
CREATE FUNCTION paper_auto_test.raises(stmt text, pattern text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  EXECUTE stmt;
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM !~ pattern THEN
   RAISE EXCEPTION 'WRONG_ERROR [%] wanted [%] for: %',SQLERRM,pattern,left(stmt,240);
  END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'EXPECTED_ERROR [%] for: %',pattern,left(stmt,240);
END $$;
CREATE FUNCTION paper_auto_test.eq(got text, want text, what text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'MISMATCH % got [%] want [%]',what,got,want; END IF;
END $$;
CREATE FUNCTION paper_auto_test.rpc(name text, p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
 EXECUTE format('SELECT public.%I($1)','sportsedge_paper_auto_'||name) INTO r USING p;
 RETURN r;
END $$;
CREATE FUNCTION paper_auto_test.call(name text, p jsonb) RETURNS text
LANGUAGE sql AS $$ SELECT format('SELECT public.%I(%L::jsonb)','sportsedge_paper_auto_'||name,p::text) $$;
CREATE FUNCTION paper_auto_test.owner() RETURNS text LANGUAGE sql AS $$ SELECT 'owner-'||repeat('a',32) $$;
CREATE FUNCTION paper_auto_test.begin(e text, k text, slot text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
 r:=paper_auto_test.rpc('begin_run',jsonb_build_object('experiment_id',e,'kind',k,'slot',slot,'worker','test:'||k));
 IF (r->>'started') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'RUN_NOT_STARTED %',r; END IF;
 RETURN r->>'runId';
END $$;
CREATE FUNCTION paper_auto_test.account(run text) RETURNS text
LANGUAGE sql AS $$
 SELECT x.broker_account_id FROM sportsedge_paper_auto.runs r
 JOIN sportsedge_paper_auto.experiments x USING (experiment_id) WHERE r.run_id=run
$$;
CREATE FUNCTION paper_auto_test.snap_args(run text, equity bigint, cash bigint, settled bigint,
 positions jsonb, o interval DEFAULT '0') RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',run,'captured_at',paper_auto_test.now_text(o),
  'account_id',paper_auto_test.account(run),'equity_cents',equity,'cash_cents',cash,
  'settled_cash_cents',settled,'positions',positions,'open_orders','[]'::jsonb,'digest',repeat('1',64))
$$;
CREATE FUNCTION paper_auto_test.snapshot(run text, equity bigint, cash bigint, settled bigint,
 positions jsonb DEFAULT '[]', o interval DEFAULT '0') RETURNS bigint
LANGUAGE sql AS $$
 SELECT (paper_auto_test.rpc('record_snapshot',
  paper_auto_test.snap_args(run,equity,cash,settled,positions,o))->>'snapshotId')::bigint
$$;
CREATE FUNCTION paper_auto_test.leg(sym text, side text, shares integer, lim integer) RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('security_id','id-'||sym,'symbol',sym,'side',side,'shares',shares,'limit_cents',lim)
$$;
CREATE FUNCTION paper_auto_test.position(sym text, shares integer) RETURNS jsonb
LANGUAGE sql AS $$ SELECT jsonb_build_object('securityId','id-'||sym,'symbol',sym,'shares',shares) $$;
CREATE FUNCTION paper_auto_test.reserve_args(run text, did text, snap bigint, legs jsonb) RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',run,'decision_id',did,'plan_id',repeat('7',64),'snapshot_id',snap,'legs',legs)
$$;
CREATE FUNCTION paper_auto_test.reserve(run text, did text, snap bigint, legs jsonb) RETURNS jsonb
LANGUAGE sql AS $$ SELECT paper_auto_test.rpc('reserve_intents',paper_auto_test.reserve_args(run,did,snap,legs)) $$;
CREATE FUNCTION paper_auto_test.reserve_call(run text, did text, snap bigint, legs jsonb) RETURNS text
LANGUAGE sql AS $$ SELECT paper_auto_test.call('reserve_intents',paper_auto_test.reserve_args(run,did,snap,legs)) $$;
CREATE FUNCTION paper_auto_test.claim(run text, iid text) RETURNS jsonb
LANGUAGE sql AS $$ SELECT paper_auto_test.rpc('claim_intent',jsonb_build_object('run_id',run,'intent_id',iid)) $$;
CREATE FUNCTION paper_auto_test.claim_call(run text, iid text) RETURNS text
LANGUAGE sql AS $$ SELECT paper_auto_test.call('claim_intent',jsonb_build_object('run_id',run,'intent_id',iid)) $$;
CREATE FUNCTION paper_auto_test.broker(bid text, st text, qty text, price text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('broker_order_id',bid,'broker_status',st,'filled_qty',qty)
  ||CASE WHEN price IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('filled_avg_price',price) END
$$;
CREATE FUNCTION paper_auto_test.order_args(run text, iid text, ver integer, nxt text, extra jsonb) RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',run,'intent_id',iid,'expected_version',ver,'next_status',nxt)||extra
$$;
CREATE FUNCTION paper_auto_test.record(run text, iid text, ver integer, nxt text, extra jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql AS $$ SELECT paper_auto_test.rpc('record_order',paper_auto_test.order_args(run,iid,ver,nxt,extra)) $$;
CREATE FUNCTION paper_auto_test.record_call(run text, iid text, ver integer, nxt text, extra jsonb DEFAULT '{}') RETURNS text
LANGUAGE sql AS $$ SELECT paper_auto_test.call('record_order',paper_auto_test.order_args(run,iid,ver,nxt,extra)) $$;
CREATE FUNCTION paper_auto_test.version(e text) RETURNS bigint
LANGUAGE sql AS $$ SELECT (paper_auto_test.rpc('status',jsonb_build_object('experiment_id',e))->>'gateVersion')::bigint $$;
CREATE FUNCTION paper_auto_test.state(e text) RETURNS text
LANGUAGE sql AS $$ SELECT paper_auto_test.rpc('status',jsonb_build_object('experiment_id',e))->>'state' $$;
CREATE FUNCTION paper_auto_test.reconcile(e text, slot text, clean boolean DEFAULT true, acct text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE rec text:=paper_auto_test.begin(e,'reconcile',slot);
BEGIN
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',rec,'status','succeeded',
  'result',jsonb_build_object('clean',clean,'accountId',coalesce(acct,paper_auto_test.account(rec))),
  'check',jsonb_build_object('ok',clean,'blockers','[]'::jsonb)));
 RETURN rec;
END $$;
CREATE FUNCTION paper_auto_test.resume_args(e text, rec text, ver bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('experiment_id',e,'owner_ref',paper_auto_test.owner(),
  'expected_gate_version',coalesce(ver,paper_auto_test.version(e)),'reconcile_run_id',rec)
$$;
CREATE FUNCTION paper_auto_test.arm(e text, slot text) RETURNS jsonb
LANGUAGE sql AS $$
 SELECT paper_auto_test.rpc('resume',paper_auto_test.resume_args(e,paper_auto_test.reconcile(e,slot)))
$$;
CREATE FUNCTION paper_auto_test.target(sym text, sector text) RETURNS jsonb
LANGUAGE sql AS $$ SELECT jsonb_build_object('securityId','id-'||sym,'symbol',sym,'sector',sector) $$;
CREATE FUNCTION paper_auto_test.prior(sym text, adv bigint) RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('id-'||sym,jsonb_build_object('symbol',sym,'prior_adv20_shares',adv,'price','30.00'))
$$;
CREATE FUNCTION paper_auto_test.signal(e text, model text, did text, dat text, seen text,
 targets jsonb, prior jsonb) RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('version','stock-forward-signal-v1','experimentId',e,'modelVersion',model,
  'decisionId',did,'decisionAt',dat,'observedAt',seen,'targets',targets,'priorInputs',prior,
  'heldSecurityIds','[]'::jsonb,'executionPermitted',false,'sourceIndependentlyVerified',false)
$$;
CREATE FUNCTION paper_auto_test.experiment(e text, model text, acct text, number text, attempts integer,
 fee integer, drawdown integer, orders integer, daily bigint, open integer) RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('experiment_id',e,'owner_ref',paper_auto_test.owner(),
  'account_observed_at',paper_auto_test.now_text(),'model_version',model,
  'broker_account_id',acct,'broker_account_number',number,
  'decision_window_start','2026-10-01','decision_window_end','2026-12-31',
  'starting_equity_cents',100000,'capital_limit_cents',120000,'max_order_notional_cents',15000,
  'max_daily_notional_cents',daily,'max_orders_per_day',orders,'max_open_orders',open,
  'max_attempts_per_leg',attempts,'drawdown_stop_bps',drawdown,'fee_reserve_cents',fee)
$$;
CREATE FUNCTION paper_auto_test.activity(id text, typ text, at text, cents bigint, k text) RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('activity_id',id,'activity_type',typ,'activity_at',at,'net_amount_cents',cents,
  'classification',k,'raw_digest',repeat('e',64))
$$;
-- One after-close monitor run: optional activities, then a flat-account mark captured at 16:29 EDT.
CREATE FUNCTION paper_auto_test.mark(e text, day text, cash bigint, acts jsonb DEFAULT '[]',
 positions jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE m text; r jsonb;
BEGIN
 PERFORM paper_auto_test.at(day||'T20:30:00Z');
 m:=paper_auto_test.begin(e,'monitor',day);
 IF jsonb_array_length(acts)>0 THEN
  PERFORM paper_auto_test.rpc('record_activities',jsonb_build_object('run_id',m,'activities',acts));
 END IF;
 r:=paper_auto_test.rpc('record_daily',jsonb_build_object('run_id',m,'session_date',day,
  'captured_at',day||'T20:29:00Z','equity_cents',cash,'cash_cents',cash,'long_market_value_cents',0,
  'positions',positions,'benchmark_symbol','SPY','benchmark_close','580.00','benchmark_source','test:sip',
  'contaminated',false));
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',m,'status','succeeded'));
 RETURN r;
END $$;
CREATE TABLE paper_auto_test.ctx(k text PRIMARY KEY, v text NOT NULL);
CREATE FUNCTION paper_auto_test.put(key text, val text) RETURNS void
LANGUAGE sql AS $$ INSERT INTO paper_auto_test.ctx VALUES(key,val) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v $$;
CREATE FUNCTION paper_auto_test.get(key text) RETURNS text
LANGUAGE sql AS $$ SELECT v FROM paper_auto_test.ctx WHERE k=key $$;

-- 1. Role boundary: only service_role executes RPCs; nobody gets schema, table or clock access.
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
 WHERE s.nspname='public' AND p.proname LIKE 'sportsedge_paper_auto_%';
 PERFORM paper_auto_test.eq(n::text,'21','public RPC count');
 SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
 WHERE s.nspname='public' AND p.proname LIKE 'sportsedge_paper_auto_%'
  AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
   OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') OR NOT p.prosecdef
   OR NOT coalesce(p.proconfig,'{}') @> ARRAY['search_path=pg_catalog']
   OR pg_get_userbyid(p.proowner) IN ('service_role','anon','authenticated'));
 PERFORM paper_auto_test.eq(n::text,'0','RPC role boundary violations');
 SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
 WHERE s.nspname='sportsedge_paper_auto'
  AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE')
   OR p.prosecdef OR NOT coalesce(p.proconfig,'{}') @> ARRAY['search_path=pg_catalog']);
 PERFORM paper_auto_test.eq(n::text,'0','internal functions exposed');
 IF has_schema_privilege('anon','sportsedge_paper_auto','USAGE')
  OR has_schema_privilege('authenticated','sportsedge_paper_auto','USAGE')
  OR has_schema_privilege('service_role','sportsedge_paper_auto','USAGE')
  OR has_schema_privilege('service_role','sportsedge_paper_auto','CREATE') THEN
  RAISE EXCEPTION 'SCHEMA_EXPOSED';
 END IF;
 SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
 WHERE s.nspname='sportsedge_paper_auto' AND c.relkind='r'
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
   OR has_table_privilege('service_role',c.oid,'SELECT') OR has_table_privilege('service_role',c.oid,'INSERT')
   OR has_table_privilege('service_role',c.oid,'UPDATE') OR has_table_privilege('anon',c.oid,'SELECT')
   OR has_table_privilege('authenticated',c.oid,'SELECT'));
 PERFORM paper_auto_test.eq(n::text,'0','tables exposed');
END $$;

-- 2. Registration starts STOPPED and is immutable (Monday 2026-10-19 07:00 New York).
SELECT paper_auto_test.at('2026-10-19T11:00:00Z');
DO $$
DECLARE r jsonb;
DECLARE base jsonb:=paper_auto_test.experiment('fwd-2026-baseline','stock-mom252-skip21-trend200-v1',
 '11111111-2222-3333-4444-555555555555','PA0SYNTHETIC',3,0,2500,12,60000,5);
BEGIN
 PERFORM paper_auto_test.raises(paper_auto_test.call('register',
  base||jsonb_build_object('account_observed_at',paper_auto_test.now_text('-10 minutes'))),'ACCOUNT_OBSERVATION_STALE');
 PERFORM paper_auto_test.raises(paper_auto_test.call('register',
  base||jsonb_build_object('account_observed_at',paper_auto_test.now_text('1 minute'))),'ACCOUNT_OBSERVATION_STALE');
 PERFORM paper_auto_test.raises(paper_auto_test.call('register',
  base||jsonb_build_object('starting_equity_cents',130000)),'experiment_capital');
 PERFORM paper_auto_test.raises(paper_auto_test.call('register',
  base||jsonb_build_object('model_version','stock-mom252-skip21-trend200-v2')),'PAPER_AUTO_INVALID_MODEL_VERSION');
 PERFORM paper_auto_test.raises(paper_auto_test.call('register',
  base||jsonb_build_object('fee_reserve_cents',50)),'fee_reserve_cents');
 r:=paper_auto_test.rpc('register',base);
 PERFORM paper_auto_test.eq(r->>'state','STOPPED','registered state');
 PERFORM paper_auto_test.eq(r->>'gateReason','REGISTERED_NOT_AUTHORIZED','registered reason');
 PERFORM paper_auto_test.eq(r->>'realMoneyEnabled','false','real money flag');
 IF (r->>'configDigest') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CONFIG_DIGEST %',r; END IF;
 PERFORM paper_auto_test.raises(paper_auto_test.call('register',base),'duplicate key');
 PERFORM paper_auto_test.raises(paper_auto_test.call('register',
  base||jsonb_build_object('experiment_id','fwd-2026-other')),'duplicate key');
 PERFORM paper_auto_test.raises($q$UPDATE sportsedge_paper_auto.experiments SET capital_limit_cents=1$q$,
  'APPEND_ONLY_EXPERIMENTS');
 PERFORM paper_auto_test.raises($q$UPDATE sportsedge_paper_auto.gates SET mode='ARMED'$q$,'ARM_ONLY_VIA_RESUME');
 PERFORM paper_auto_test.raises($q$DELETE FROM sportsedge_paper_auto.gates$q$,'GATE_NOT_DELETABLE');
 PERFORM paper_auto_test.raises(paper_auto_test.call('pause',jsonb_build_object(
  'experiment_id','fwd-2026-baseline','owner_ref',paper_auto_test.owner())),'PAUSE_REQUIRES_ARMED');
 PERFORM paper_auto_test.eq(paper_auto_test.rpc('status',jsonb_build_object('experiment_id','unknown-exp'))->>'state',
  'NOT_REGISTERED','unknown experiment');
 r:=paper_auto_test.rpc('register',paper_auto_test.experiment('fwd-2026-holdrank','stock-mom252-skip21-trend200-holdrank10-v1',
  '22222222-3333-4444-5555-666666666666','PA0SECOND',2,100,1000,6,50000,1));
 PERFORM paper_auto_test.eq(r->>'state','STOPPED','second experiment state');
END $$;

-- 3. Clock rules, including the November 1 2026 DST change.
DO $$
BEGIN
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._regular_hours('2026-10-19T13:30:00Z')::text,'true','09:30 EDT open');
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._regular_hours('2026-10-19T13:29:59Z')::text,'false','09:29:59 EDT');
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._regular_hours('2026-10-19T19:59:59Z')::text,'true','15:59:59 EDT');
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._regular_hours('2026-10-19T20:00:00Z')::text,'false','16:00 EDT');
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._regular_hours('2026-11-02T14:30:00Z')::text,'true','09:30 EST open');
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._regular_hours('2026-11-02T13:30:00Z')::text,'false','08:30 EST');
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._regular_hours('2026-10-24T15:00:00Z')::text,'false','Saturday');
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._after_close('2026-10-19T20:14:59Z','2026-10-19')::text,'false','16:14:59');
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._after_close('2026-10-19T20:15:00Z','2026-10-19')::text,'true','16:15');
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._after_close('2026-10-20T04:00:00Z','2026-10-19')::text,'true','next day');
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._ny_date('2026-10-20T03:59:59Z')::text,'2026-10-19','NY date');
 PERFORM paper_auto_test.eq(sportsedge_paper_auto._ny_date('2026-11-02T04:59:59Z')::text,'2026-11-01','NY date EST');
END $$;

-- 4. Decisions: one immutable record per session, bound to experiment, model and capture time.
SELECT paper_auto_test.at('2026-10-19T12:00:30Z');
DO $$
DECLARE e text:='fwd-2026-baseline'; run text; mon text; r jsonb; sig jsonb; d text:=repeat('d',64);
DECLARE prior jsonb:=paper_auto_test.prior('AAA',100000)||paper_auto_test.prior('BBB',100000)
 ||paper_auto_test.prior('CCC',150)||paper_auto_test.prior('DDD',100000);
DECLARE targets jsonb:=jsonb_build_array(paper_auto_test.target('AAA','Tech'),
 paper_auto_test.target('BBB','Health'),paper_auto_test.target('CCC','Energy'));
DECLARE args jsonb;
BEGIN
 run:=paper_auto_test.begin(e,'decision','2026-10-19');
 r:=paper_auto_test.rpc('begin_run',jsonb_build_object('experiment_id',e,'kind','decision',
  'slot','2026-10-19','worker','gha:2:1'));
 PERFORM paper_auto_test.eq(r->>'reason','SLOT_ALREADY_RUNNING','duplicate delivery');
 sig:=paper_auto_test.signal(e,'stock-mom252-skip21-trend200-v1',d,'2026-10-19T12:00:00+00:00',
  '2026-10-19T12:00:20Z',targets,prior);
 args:=jsonb_build_object('run_id',run,'decision_id',d,'outcome','TARGETS','decision_at','2026-10-19T12:00:00Z',
  'input_digest',repeat('e',64),'scoring_report_id',repeat('f',64),'signal',sig);
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',args||jsonb_build_object('signal',
  sig||jsonb_build_object('modelVersion','stock-mom252-skip21-trend200-holdrank10-v1'))),'DECISION_SIGNAL_MISMATCH');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',args||jsonb_build_object('signal',
  sig||jsonb_build_object('experimentId','fwd-2026-holdrank'))),'DECISION_SIGNAL_MISMATCH');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',args||jsonb_build_object('signal',
  sig||jsonb_build_object('decisionAt','2026-10-19T12:00:01+00:00'))),'DECISION_SIGNAL_MISMATCH');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',args||jsonb_build_object('signal',
  sig||jsonb_build_object('decisionId',repeat('c',64)))),'DECISION_SIGNAL_MISMATCH');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',args||jsonb_build_object('signal',
  sig||jsonb_build_object('targets','[]'::jsonb))),'DECISION_SIGNAL_MISMATCH');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',args||jsonb_build_object('signal',
  sig||jsonb_build_object('observedAt','2026-10-19T12:01:01Z'))),'DECISION_CAPTURE_LATE');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',args||jsonb_build_object('signal',
  sig||jsonb_build_object('observedAt','2026-10-19T11:59:59Z'))),'DECISION_CAPTURE_LATE');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',args||jsonb_build_object(
  'outcome','MISSED')),'DECISION_SIGNAL_MISMATCH');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',(args-'signal'-'input_digest')
  ||jsonb_build_object('outcome','MISSED','decision_at','2026-10-19T12:05:00Z')),'DECISION_IN_FUTURE');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',(args-'signal'-'input_digest')
  ||jsonb_build_object('outcome','MISSED','decision_at','2026-09-30T12:00:00Z')),'DECISION_OUTSIDE_WINDOW');
 mon:=paper_auto_test.begin(e,'monitor','2026-10-19');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',args||jsonb_build_object('run_id',mon)),
  'RUN_NOT_ACTIVE');
 r:=paper_auto_test.rpc('record_decision',args);
 PERFORM paper_auto_test.eq(r->>'recorded','true','decision recorded');
 r:=paper_auto_test.rpc('record_decision',args);
 PERFORM paper_auto_test.eq(r->>'duplicate','true','decision idempotent');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_decision',(args-'signal'-'input_digest')
  ||jsonb_build_object('decision_id',repeat('c',64),'outcome','MISSED')),'DECISION_CONFLICT');
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',run,'status','succeeded',
  'result',jsonb_build_object('summary','synthetic decision')));
 r:=paper_auto_test.rpc('begin_run',jsonb_build_object('experiment_id',e,'kind','decision',
  'slot','2026-10-19','worker','gha:3:1'));
 PERFORM paper_auto_test.eq(r->>'reason','SLOT_ALREADY_FINISHED','finished slot rerun');
 PERFORM paper_auto_test.raises($q$UPDATE sportsedge_paper_auto.decisions SET outcome='MISSED'$q$,
  'APPEND_ONLY_DECISIONS');
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',mon,'status','failed'));
 -- The holdrank experiment's decision for the same session.
 run:=paper_auto_test.begin('fwd-2026-holdrank','decision','2026-10-19');
 sig:=paper_auto_test.signal('fwd-2026-holdrank','stock-mom252-skip21-trend200-holdrank10-v1',repeat('b',64),
  '2026-10-19T12:00:00Z','2026-10-19T12:00:09.5Z',jsonb_build_array(paper_auto_test.target('EEE','Tech'),
  paper_auto_test.target('FFF','Health'),paper_auto_test.target('GGG','Energy'),paper_auto_test.target('HHH','Retail')),
  paper_auto_test.prior('EEE',100000)||paper_auto_test.prior('FFF',100000)||paper_auto_test.prior('GGG',100000)
  ||paper_auto_test.prior('HHH',100000)||paper_auto_test.prior('ZZZ',100000))
  ||jsonb_build_object('members',jsonb_build_object('id-ZZZ',jsonb_build_object('symbol','ZZZ','status','SCORED')));
 PERFORM paper_auto_test.rpc('record_decision',jsonb_build_object('run_id',run,'decision_id',repeat('b',64),
  'outcome','TARGETS','decision_at','2026-10-19T08:00:00-04:00','input_digest',repeat('e',64),'signal',sig));
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',run,'status','succeeded'));
END $$;

-- 5. Arming requires a fresh clean reconciliation of the registered account (09:44).
SELECT paper_auto_test.at('2026-10-19T13:44:00Z');
DO $$
DECLARE e text:='fwd-2026-baseline'; ex1 text; ex2 text; mon text; rec text; r jsonb; ver bigint; s bigint;
BEGIN
 ex1:=paper_auto_test.begin(e,'execute','2026-10-19T13:44Z');
 r:=paper_auto_test.rpc('acquire_lease',jsonb_build_object('run_id',ex1));
 PERFORM paper_auto_test.eq(r->>'acquired','true','lease acquired');
 ex2:=paper_auto_test.begin(e,'execute','2026-10-19T13:59Z');
 r:=paper_auto_test.rpc('acquire_lease',jsonb_build_object('run_id',ex2));
 PERFORM paper_auto_test.eq(r->>'acquired','false','lease exclusive');
 PERFORM paper_auto_test.eq(r->>'heldBy',ex1,'lease holder');
 mon:=paper_auto_test.begin(e,'monitor','2026-10-19T13:44Z');
 PERFORM paper_auto_test.raises(paper_auto_test.call('acquire_lease',jsonb_build_object('run_id',mon)),'LEASE_KIND');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_snapshot',paper_auto_test.snap_args(ex1,1,1,1,'[]')
  ||jsonb_build_object('account_id','99999999-2222-3333-4444-555555555555')),'WRONG_BROKER_ACCOUNT');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_snapshot',
  paper_auto_test.snap_args(ex1,1,1,1,'[]','-3 minutes')),'SNAPSHOT_STALE');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_snapshot',paper_auto_test.snap_args(ex1,1,1,1,
  jsonb_build_array(paper_auto_test.position('DDD',2),paper_auto_test.position('DDD',1)))),'INVALID_SNAPSHOT');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_snapshot',paper_auto_test.snap_args(ex1,1,1,1,
  jsonb_build_array(jsonb_build_object('securityId','id-DDD','symbol','DDD','shares',1.5)))),'INVALID_SHARES');
 s:=paper_auto_test.snapshot(ex1,100000,100000,100000,jsonb_build_array(paper_auto_test.position('DDD',2)));
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,repeat('d',64),s,
  jsonb_build_array(paper_auto_test.leg('DDD','sell',2,1500))),'NOT_ARMED');
 PERFORM paper_auto_test.eq(paper_auto_test.state(e),'STOPPED','default state');
 ver:=paper_auto_test.version(e);
 rec:=paper_auto_test.begin(e,'reconcile','2026-10-19T13:40Z');
 PERFORM paper_auto_test.raises(paper_auto_test.call('resume',paper_auto_test.resume_args(e,rec)),
  'FRESH_CLEAN_RECONCILIATION');
 PERFORM paper_auto_test.raises(paper_auto_test.call('finish_run',jsonb_build_object('run_id',rec,
  'status','succeeded','result','{}'::jsonb)),'RECONCILE_RESULT_REQUIRED');
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',rec,'status','succeeded',
  'result',jsonb_build_object('clean',false,'accountId','11111111-2222-3333-4444-555555555555')));
 PERFORM paper_auto_test.raises(paper_auto_test.call('resume',paper_auto_test.resume_args(e,rec)),
  'FRESH_CLEAN_RECONCILIATION');
 rec:=paper_auto_test.reconcile(e,'2026-10-19T13:41Z',true,'99999999-2222-3333-4444-555555555555');
 PERFORM paper_auto_test.raises(paper_auto_test.call('resume',paper_auto_test.resume_args(e,rec)),
  'FRESH_CLEAN_RECONCILIATION');
 rec:=paper_auto_test.reconcile('fwd-2026-holdrank','2026-10-19T13:42Z');
 PERFORM paper_auto_test.raises(paper_auto_test.call('resume',paper_auto_test.resume_args(e,rec)),
  'FRESH_CLEAN_RECONCILIATION');
 rec:=paper_auto_test.reconcile(e,'2026-10-19T13:43Z');
 PERFORM paper_auto_test.raises(paper_auto_test.call('resume',paper_auto_test.resume_args(e,rec,ver+7)),
  'RESUME_STALE_VERSION');
 r:=paper_auto_test.rpc('resume',paper_auto_test.resume_args(e,rec,ver));
 PERFORM paper_auto_test.eq(r->>'gateMode','ARMED','armed');
 PERFORM paper_auto_test.eq(r->>'state','EXECUTING','lease holder executing');
 PERFORM paper_auto_test.raises(paper_auto_test.call('resume',paper_auto_test.resume_args(e,rec)),'RESUME_STATE');
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',mon,'status','succeeded'));
 PERFORM paper_auto_test.put('ex1',ex1); PERFORM paper_auto_test.put('ex2',ex2);
END $$;

-- 6. Reservations re-check the frozen planner's invariants and are all-or-nothing (09:45).
SELECT paper_auto_test.at('2026-10-19T13:45:00Z');
DO $$
DECLARE e text:='fwd-2026-baseline'; d text:=repeat('d',64); r jsonb; s bigint; s2 bigint; i text; k integer;
DECLARE ex1 text:=paper_auto_test.get('ex1'); ex2 text:=paper_auto_test.get('ex2'); many jsonb:='[]';
BEGIN
 s:=paper_auto_test.snapshot(ex1,100000,100000,15000,jsonb_build_array(paper_auto_test.position('DDD',2)));
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('AAA','buy',3,3001),paper_auto_test.leg('DDD','sell',2,1500))),'MIXED_PHASE');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('AAA','buy',6,3001))),'ORDER_NOTIONAL_CAP');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('AAA','buy',4,3001))),'NAME_CAP');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('DDD','buy',1,1500))),'BUY_NOT_A_TARGET');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('ZZZ','buy',1,1500))),'LEG_NOT_IN_DECISION_INPUTS');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('AAA','buy',1,3001)||jsonb_build_object('symbol','AAB'))),'LEG_NOT_IN_DECISION_INPUTS');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('CCC','buy',2,2000))),'LIQUIDITY_CAP');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('AAA','buy',3,3001),paper_auto_test.leg('BBB','buy',2,4400))),'SETTLED_CASH');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('DDD','sell',3,1500))),'SELL_EXCEEDS_POSITION');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('DDD','sell',1,1500),paper_auto_test.leg('DDD','sell',1,1500))),'PREVIOUS_ATTEMPT_UNRESOLVED');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex2,d,s,jsonb_build_array(
  paper_auto_test.leg('DDD','sell',2,1500))),'LEASE_NOT_HELD');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,'[]'),'INVALID_LEGS');
 FOR k IN 1..11 LOOP many:=many||jsonb_build_array(paper_auto_test.leg('AAA','buy',1,3001)); END LOOP;
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,many),'INVALID_LEGS');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,repeat('b',64),s,jsonb_build_array(
  paper_auto_test.leg('EEE','buy',1,3001))),'DECISION_NOT_EXECUTABLE_TODAY');
 PERFORM paper_auto_test.at('2026-10-19T13:29:59Z');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('DDD','sell',2,1500))),'OUTSIDE_REGULAR_HOURS');
 PERFORM paper_auto_test.at('2026-10-19T13:45:00Z');
 PERFORM paper_auto_test.eq((SELECT count(*) FROM sportsedge_paper_auto.intents)::text,'0','nothing persisted');
 -- SELL phase first, exactly as the planner orders it.
 r:=paper_auto_test.reserve(ex1,d,s,jsonb_build_array(paper_auto_test.leg('DDD','sell',2,1500)));
 i:=r->'reserved'->0->>'intentId';
 PERFORM paper_auto_test.eq(r->>'phase','SELL','sell phase');
 PERFORM paper_auto_test.eq(i,'pai-'||left(sportsedge_paper_auto._sha(concat_ws('|','sportsedge-paper-auto-intent-v1',
  e,d,'id-DDD','sell','SELL','1')),32),'deterministic intent id');
 PERFORM paper_auto_test.eq(r->'reserved'->0->>'clientOrderId','sepa'||left(sportsedge_paper_auto._sha(
  'sportsedge-paper-auto-client-v1|'||i),40),'deterministic client order id');
 PERFORM paper_auto_test.claim(ex1,i);
 PERFORM paper_auto_test.record(ex1,i,1,'filled',paper_auto_test.broker('b-sell-1','filled','2','15.00'));
 -- BUY phase with a fresh snapshot after the sale (proceeds excluded from settled cash).
 s2:=paper_auto_test.snapshot(ex1,100000,103000,100000);
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s,jsonb_build_array(
  paper_auto_test.leg('DDD','sell',2,1500))),'LEG_ALREADY_FILLED');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s2,jsonb_build_array(
  paper_auto_test.leg('AAA','buy',3,3001),paper_auto_test.leg('BBB','buy',2,4400),
  paper_auto_test.leg('CCC','buy',1,2000),paper_auto_test.leg('AAA','buy',1,3001))),'PREVIOUS_ATTEMPT_UNRESOLVED');
 r:=paper_auto_test.reserve(ex1,d,s2,jsonb_build_array(paper_auto_test.leg('AAA','buy',3,3001),
  paper_auto_test.leg('BBB','buy',2,4400),paper_auto_test.leg('CCC','buy',1,2000)));
 PERFORM paper_auto_test.eq(r->>'notionalCents',(3*3001+2*4400+2000)::text,'buy notional');
 PERFORM paper_auto_test.eq(jsonb_array_length(r->'reserved')::text,'3','buy legs');
 PERFORM paper_auto_test.put('aaa',r->'reserved'->0->>'intentId');
 PERFORM paper_auto_test.put('bbb',r->'reserved'->1->>'intentId');
 PERFORM paper_auto_test.put('ccc',r->'reserved'->2->>'intentId');
 PERFORM paper_auto_test.put('s2',s2::text);
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s2,jsonb_build_array(
  paper_auto_test.leg('AAA','buy',3,3001))),'PREVIOUS_ATTEMPT_UNRESOLVED');
 r:=paper_auto_test.claim(ex1,paper_auto_test.get('aaa'));
 PERFORM paper_auto_test.eq(r->>'lockVersion','1','claim version');
 IF r->>'clientOrderId' !~ '^sepa[a-f0-9]{40}$' THEN RAISE EXCEPTION 'CLAIM %',r; END IF;
 PERFORM paper_auto_test.raises(paper_auto_test.claim_call(ex1,paper_auto_test.get('aaa')),'CLAIM_DENIED');
 PERFORM paper_auto_test.raises(paper_auto_test.claim_call(ex2,paper_auto_test.get('bbb')),'LEASE_NOT_HELD');
 PERFORM paper_auto_test.raises(paper_auto_test.claim_call(ex1,paper_auto_test.get('bbb')),'UNRESOLVED_SUBMISSION');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,d,s2,jsonb_build_array(
  paper_auto_test.leg('AAA','buy',1,3001))),'UNRESOLVED_SUBMISSION');
END $$;

-- 7. Broker-observed transitions: monotonic fills, immutable broker ids, no laundering (09:46).
SELECT paper_auto_test.at('2026-10-19T13:46:00Z');
DO $$
DECLARE ex1 text:=paper_auto_test.get('ex1'); a text:=paper_auto_test.get('aaa'); b text:=paper_auto_test.get('bbb');
DECLARE c text:=paper_auto_test.get('ccc'); r jsonb;
BEGIN
 PERFORM paper_auto_test.record(ex1,a,1,'open',paper_auto_test.broker('b-000001','accepted','0'));
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(ex1,a,1,'open',paper_auto_test.broker('b-000001','new','0')),
  'VERSION_CONFLICT');
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(ex1,a,2,'open',paper_auto_test.broker('b-000001','new','1')),
  'FILL_QUANTITY_INVALID');
 PERFORM paper_auto_test.record(ex1,a,2,'partially_filled',
  paper_auto_test.broker('b-000001','partially_filled','2','30.00'));
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(ex1,a,3,'partially_filled',
  paper_auto_test.broker('b-000001','partially_filled','1','30.00')),'FILL_QUANTITY_INVALID');
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(ex1,a,3,'filled',
  paper_auto_test.broker('b-999999','filled','3','30.00')),'BROKER_ID_MISMATCH');
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(ex1,a,3,'open',
  paper_auto_test.broker('b-000001','new','2')),'ILLEGAL_TRANSITION_PARTIALLY_FILLED_TO_OPEN');
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(ex1,a,3,'filled',
  paper_auto_test.broker('b-000001','filled','3')),'FILL_PRICE_REQUIRED');
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(ex1,a,3,'filled',
  paper_auto_test.broker('b-000001','filled','2','30.00')),'FILL_QUANTITY_INVALID');
 r:=paper_auto_test.record(ex1,a,3,'filled',paper_auto_test.broker('b-000001','filled','3','30.004'));
 PERFORM paper_auto_test.eq(r->>'status','filled','fill recorded');
 r:=paper_auto_test.record(ex1,a,4,'filled',paper_auto_test.broker('b-000001','filled','3','30.004'));
 PERFORM paper_auto_test.eq(r->>'changed','false','identical observation is a no-op');
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(ex1,a,4,'canceled',
  paper_auto_test.broker('b-000001','canceled','3','30.004')),'ILLEGAL_TRANSITION_FILLED_TO_CANCELED');
 -- Unknown POST outcome: uncertain carries no invented broker data, blocks all new POSTs.
 PERFORM paper_auto_test.claim(ex1,b);
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(ex1,b,1,'uncertain',
  jsonb_build_object('broker_order_id','b-x')),'UNCERTAIN_WITH_BROKER_DATA');
 PERFORM paper_auto_test.record(ex1,b,1,'uncertain',jsonb_build_object('detail',jsonb_build_object('reason','POST_TIMEOUT')));
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(ex1,b,2,'not_submitted'),
  'ILLEGAL_TRANSITION_UNCERTAIN_TO_NOT_SUBMITTED');
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(ex1,b,2,'rejected',
  jsonb_build_object('rejection',jsonb_build_object('http_status',403,'code',40310000))),'REJECTION_EVIDENCE_INVALID');
 PERFORM paper_auto_test.eq(paper_auto_test.rpc('status',jsonb_build_object('experiment_id','fwd-2026-baseline'))
  ->>'unresolvedIntents','1','uncertain counted');
 PERFORM paper_auto_test.raises(paper_auto_test.claim_call(ex1,c),'UNRESOLVED_SUBMISSION');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_activities',jsonb_build_object('run_id',ex1,
  'activities',jsonb_build_array(jsonb_build_object('activity_id','20261019134500000::fill-x','activity_type','FILL',
  'activity_at','2026-10-19T13:45:30Z','order_id','b-unknown','classification','external_fill',
  'raw_digest',repeat('a',64))))),'FILL_ATTRIBUTION_PENDING');
 PERFORM paper_auto_test.eq((SELECT count(*) FROM sportsedge_paper_auto.intent_events WHERE intent_id=a)::text,
  '4','intent event trail');
 PERFORM paper_auto_test.raises($q$UPDATE sportsedge_paper_auto.intents SET shares=99$q$,'INTENT_IMMUTABLE');
 PERFORM paper_auto_test.raises($q$UPDATE sportsedge_paper_auto.intents SET updated_at=now()$q$,'INTENT_CAS');
 PERFORM paper_auto_test.raises($q$DELETE FROM sportsedge_paper_auto.intents$q$,'INTENT_NOT_DELETABLE');
 PERFORM paper_auto_test.raises($q$DELETE FROM sportsedge_paper_auto.intent_events$q$,'APPEND_ONLY_INTENT_EVENTS');
END $$;

-- 8. STOP voids unsent work, blocks claims, is audited and idempotent (09:50).
SELECT paper_auto_test.at('2026-10-19T13:50:00Z');
DO $$
DECLARE e text:='fwd-2026-baseline'; ex1 text:=paper_auto_test.get('ex1'); c text:=paper_auto_test.get('ccc');
DECLARE r jsonb; events integer; rec text;
BEGIN
 events:=(SELECT count(*) FROM sportsedge_paper_auto.gate_events WHERE experiment_id=e);
 r:=paper_auto_test.rpc('stop',jsonb_build_object('experiment_id',e,'reason','OWNER_STOP','actor',paper_auto_test.owner(),
  'evidence',jsonb_build_object('source','synthetic test')));
 PERFORM paper_auto_test.eq(r->>'state','STOPPED','stopped');
 PERFORM paper_auto_test.eq((SELECT status FROM sportsedge_paper_auto.intents WHERE intent_id=c),'not_submitted',
  'reserved work voided');
 PERFORM paper_auto_test.raises(paper_auto_test.claim_call(ex1,c),'NOT_ARMED');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex1,repeat('d',64),paper_auto_test.get('s2')::bigint,
  jsonb_build_array(paper_auto_test.leg('CCC','buy',1,2000))),'NOT_ARMED');
 r:=paper_auto_test.rpc('stop',jsonb_build_object('experiment_id',e,'reason','WORKER_KILL_SWITCH',
  'actor','worker:gha:20:1','alert',jsonb_build_object('code','EXTERNAL_ORDER_DETECTED')));
 PERFORM paper_auto_test.eq((SELECT count(*) FROM sportsedge_paper_auto.gate_events WHERE experiment_id=e)::text,
  (events+2)::text,'every STOP audited');
 PERFORM paper_auto_test.eq(r->>'unacknowledgedCriticalAlerts','1','kill-switch alert');
 PERFORM paper_auto_test.raises(paper_auto_test.call('stop',jsonb_build_object('experiment_id',e,'reason','X',
  'actor',paper_auto_test.owner())),'INVALID_REASON');
 PERFORM paper_auto_test.raises(paper_auto_test.call('stop',jsonb_build_object('experiment_id',e,'reason','OWNER_STOP',
  'actor','anonymous')),'INVALID_ACTOR');
 PERFORM paper_auto_test.at('2026-10-19T13:50:30Z');
 rec:=paper_auto_test.reconcile(e,'2026-10-19T13:50Z');
 PERFORM paper_auto_test.raises(paper_auto_test.call('resume',paper_auto_test.resume_args(e,rec)),
  'RESUME_UNRESOLVED_INTENTS');
 PERFORM paper_auto_test.raises(paper_auto_test.call('confirm_absent',jsonb_build_object('intent_id',
  paper_auto_test.get('bbb'),'owner_ref',paper_auto_test.owner(),'client_id_lookup_not_found_at','2026-10-19T13:49:00Z',
  'complete_history_checked_at','2026-10-19T13:49:30Z','history_complete',true)),'SESSION_NOT_CLOSED');
END $$;

-- 9. Second experiment: retries, API rejections, limits, drawdown and lease expiry (09:55-10:01).
SELECT paper_auto_test.at('2026-10-19T13:39:00Z');
SELECT paper_auto_test.put('stale_rec',paper_auto_test.reconcile('fwd-2026-holdrank','2026-10-19T13:39Z'));
SELECT paper_auto_test.at('2026-10-19T13:55:00Z');
DO $$
DECLARE e text:='fwd-2026-holdrank'; d text:=repeat('b',64); bx text; bx2 text; r jsonb; s bigint; i text;
BEGIN
 PERFORM paper_auto_test.raises(paper_auto_test.call('resume',paper_auto_test.resume_args(e,
  paper_auto_test.get('stale_rec'))),'FRESH_CLEAN_RECONCILIATION');
 PERFORM paper_auto_test.arm(e,'2026-10-19T13:54Z');
 bx:=paper_auto_test.begin(e,'execute','2026-10-19T13:55Z');
 PERFORM paper_auto_test.rpc('acquire_lease',jsonb_build_object('run_id',bx));
 s:=paper_auto_test.snapshot(bx,100000,100000,8099);
 -- Fee reserve, open-order cap and stale or foreign snapshots.
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,s,jsonb_build_array(
  paper_auto_test.leg('EEE','buy',2,4000))),'SETTLED_CASH');
 s:=paper_auto_test.snapshot(bx,100000,100000,100000);
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,s,jsonb_build_array(
  paper_auto_test.leg('EEE','buy',2,4000),paper_auto_test.leg('FFF','buy',2,4000))),'OPEN_ORDER_CAP');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,
  paper_auto_test.snapshot(bx,100000,100000,100000,'[]','-90 seconds'),jsonb_build_array(
  paper_auto_test.leg('EEE','buy',2,4000))),'SNAPSHOT_NOT_FRESH');
 bx2:=paper_auto_test.begin(e,'execute','2026-10-19T14:10Z');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,paper_auto_test.snapshot(bx2,100000,100000,100000),
  jsonb_build_array(paper_auto_test.leg('EEE','buy',2,4000))),'SNAPSHOT_NOT_FRESH');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,paper_auto_test.snapshot(bx,150000,150000,150000),
  jsonb_build_array(paper_auto_test.leg('EEE','buy',2,4000))),'EQUITY_ABOVE_CAPITAL_LIMIT');
 -- Drawdown is measured from the starting equity until after-close marks exist (marks: section 14).
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,paper_auto_test.snapshot(bx,89999,89999,89999),
  jsonb_build_array(paper_auto_test.leg('EEE','buy',2,4000))),'DRAWDOWN_LIMIT');
 -- EEE: expired, then an explicit API refusal ends the leg for good.
 s:=paper_auto_test.snapshot(bx,99000,99000,99000);
 r:=paper_auto_test.reserve(bx,d,s,jsonb_build_array(paper_auto_test.leg('EEE','buy',2,4000)));
 i:=r->'reserved'->0->>'intentId';
 PERFORM paper_auto_test.claim(bx,i);
 PERFORM paper_auto_test.record(bx,i,1,'open',paper_auto_test.broker('b-e1','new','0'));
 PERFORM paper_auto_test.record(bx,i,2,'expired',paper_auto_test.broker('b-e1','expired','0'));
 r:=paper_auto_test.reserve(bx,d,s,jsonb_build_array(paper_auto_test.leg('EEE','buy',2,4000)));
 i:=r->'reserved'->0->>'intentId';
 PERFORM paper_auto_test.eq(r->'reserved'->0->>'attempt','2','retry attempt');
 PERFORM paper_auto_test.claim(bx,i);
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(bx,i,1,'rejected',jsonb_build_object('rejection',
  jsonb_build_object('http_status',422,'code',40010001))),'DUPLICATE_CLIENT_ID_REQUIRES_LOOKUP');
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(bx,i,1,'rejected',jsonb_build_object('rejection',
  jsonb_build_object('http_status',503))),'REJECTION_NOT_DEFINITIVE');
 PERFORM paper_auto_test.raises(paper_auto_test.record_call(bx,i,1,'rejected',jsonb_build_object('rejection',
  jsonb_build_object('http_status',429))),'REJECTION_NOT_DEFINITIVE');
 r:=paper_auto_test.record(bx,i,1,'rejected',jsonb_build_object('rejection',
  jsonb_build_object('http_status',403,'code',40310000,'message','insufficient buying power')));
 PERFORM paper_auto_test.eq((SELECT broker_status||':'||coalesce(broker_order_id,'none') FROM sportsedge_paper_auto.intents
  WHERE intent_id=i),'api_rejected:none','API rejection recorded');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,s,jsonb_build_array(
  paper_auto_test.leg('EEE','buy',2,4000))),'LEG_REJECTED');
 -- FFF: an uncertain POST later observed by client order id, then retried and filled.
 r:=paper_auto_test.reserve(bx,d,s,jsonb_build_array(paper_auto_test.leg('FFF','buy',2,4000)));
 i:=r->'reserved'->0->>'intentId';
 PERFORM paper_auto_test.claim(bx,i);
 PERFORM paper_auto_test.record(bx,i,1,'uncertain');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,s,jsonb_build_array(
  paper_auto_test.leg('GGG','buy',2,4000))),'UNRESOLVED_SUBMISSION');
 PERFORM paper_auto_test.record(bx,i,2,'canceled',paper_auto_test.broker('b-f1','canceled','0'));
 r:=paper_auto_test.reserve(bx,d,s,jsonb_build_array(paper_auto_test.leg('FFF','buy',2,4000)));
 i:=r->'reserved'->0->>'intentId';
 PERFORM paper_auto_test.claim(bx,i);
 PERFORM paper_auto_test.record(bx,i,1,'filled',paper_auto_test.broker('b-f2','filled','2','39.99'));
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,s,jsonb_build_array(
  paper_auto_test.leg('FFF','buy',1,4000))),'LEG_ALREADY_FILLED');
 -- GGG: partial fill then cancel; the residual top-up is sized against the held share.
 r:=paper_auto_test.reserve(bx,d,s,jsonb_build_array(paper_auto_test.leg('GGG','buy',2,4000)));
 i:=r->'reserved'->0->>'intentId';
 PERFORM paper_auto_test.claim(bx,i);
 PERFORM paper_auto_test.record(bx,i,1,'partially_filled',paper_auto_test.broker('b-g1','partially_filled','1','40.00'));
 PERFORM paper_auto_test.record(bx,i,2,'canceled',paper_auto_test.broker('b-g1','canceled','1','40.00'));
 s:=paper_auto_test.snapshot(bx,99000,95000,91000,jsonb_build_array(paper_auto_test.position('FFF',2),
  paper_auto_test.position('GGG',1)));
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,s,jsonb_build_array(
  paper_auto_test.leg('GGG','buy',2,4000))),'NAME_CAP');
 r:=paper_auto_test.reserve(bx,d,s,jsonb_build_array(paper_auto_test.leg('GGG','buy',1,4000)));
 i:=r->'reserved'->0->>'intentId';
 PERFORM paper_auto_test.claim(bx,i);
 PERFORM paper_auto_test.record(bx,i,1,'expired',paper_auto_test.broker('b-g2','expired','0'));
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,s,jsonb_build_array(
  paper_auto_test.leg('GGG','buy',1,4000))),'ATTEMPTS_EXHAUSTED');
 -- Daily notional (44000 of 50000 used) and daily order count (6 of 6 used).
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,s,jsonb_build_array(
  paper_auto_test.leg('HHH','buy',2,4000))),'DAILY_NOTIONAL_CAP');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,d,s,jsonb_build_array(
  paper_auto_test.leg('HHH','buy',1,4000))),'DAILY_ORDER_CAP');
 PERFORM paper_auto_test.put('bx',bx); PERFORM paper_auto_test.put('bx2',bx2);
END $$;

-- 10. Lease expiry fences a stalled run: it cannot reserve, and its heartbeat cannot revive the lease.
SELECT paper_auto_test.at('2026-10-19T14:01:00Z');
DO $$
DECLARE e text:='fwd-2026-holdrank'; bx text:=paper_auto_test.get('bx'); bx2 text:=paper_auto_test.get('bx2'); r jsonb;
BEGIN
 r:=paper_auto_test.rpc('acquire_lease',jsonb_build_object('run_id',bx2));
 PERFORM paper_auto_test.eq(r->>'acquired','true','expired lease taken over');
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(bx,repeat('b',64),paper_auto_test.snapshot(bx,99000,95000,91000),
  jsonb_build_array(paper_auto_test.leg('HHH','buy',1,10))),'LEASE_NOT_HELD');
 r:=paper_auto_test.rpc('heartbeat',jsonb_build_object('run_id',bx));
 IF r->>'leaseExpiresAt' IS NOT NULL THEN RAISE EXCEPTION 'STALE_RUN_REVIVED_LEASE %',r; END IF;
 PERFORM paper_auto_test.eq(paper_auto_test.state(e),'EXECUTING','new lease holder executing');
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',bx,'status','blocked',
  'result',jsonb_build_object('summary','lease lost')));
 PERFORM paper_auto_test.eq((SELECT run_id FROM sportsedge_paper_auto.leases WHERE experiment_id=e),bx2,
  'finishing a fenced run keeps the new lease');
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',bx2,'status','succeeded',
  'result',jsonb_build_object('summary','synthetic execution'),'check',jsonb_build_object('ok',true)));
 PERFORM paper_auto_test.eq(paper_auto_test.state(e),'READY','ready after clean execution');
 PERFORM paper_auto_test.eq((SELECT count(*) FROM sportsedge_paper_auto.leases WHERE experiment_id=e)::text,'0',
  'lease released');
END $$;

-- 11. After the close: owner-confirmed absence, alert acknowledgement, resume and pause (16:20).
SELECT paper_auto_test.at('2026-10-19T20:20:00Z');
DO $$
DECLARE e text:='fwd-2026-baseline'; b text:=paper_auto_test.get('bbb'); r jsonb; rec text; alert bigint;
DECLARE args jsonb;
BEGIN
 args:=jsonb_build_object('intent_id',b,'owner_ref',paper_auto_test.owner(),
  'client_id_lookup_not_found_at','2026-10-19T20:16:00Z','complete_history_checked_at','2026-10-19T20:18:00Z',
  'history_complete',true);
 PERFORM paper_auto_test.raises(paper_auto_test.call('confirm_absent',args||jsonb_build_object('history_complete',false)),
  'HISTORY_INCOMPLETE');
 PERFORM paper_auto_test.raises(paper_auto_test.call('confirm_absent',args||jsonb_build_object(
  'client_id_lookup_not_found_at','2026-10-19T20:00:00Z')),'ABSENCE_EVIDENCE_INVALID');
 PERFORM paper_auto_test.raises(paper_auto_test.call('confirm_absent',args||jsonb_build_object(
  'complete_history_checked_at','2026-10-19T20:25:00Z')),'ABSENCE_EVIDENCE_INVALID');
 r:=paper_auto_test.rpc('confirm_absent',args);
 PERFORM paper_auto_test.eq(r->>'status','confirmed_absent','absence confirmed');
 PERFORM paper_auto_test.raises(paper_auto_test.call('confirm_absent',args),'NOT_UNCERTAIN');
 rec:=paper_auto_test.reconcile(e,'2026-10-19T20:20Z');
 PERFORM paper_auto_test.raises(paper_auto_test.call('resume',paper_auto_test.resume_args(e,rec)),'CRITICAL_ALERT_OPEN');
 alert:=(SELECT alert_id FROM sportsedge_paper_auto.alerts WHERE experiment_id=e AND acknowledged_at IS NULL);
 PERFORM paper_auto_test.rpc('ack_alert',jsonb_build_object('experiment_id',e,'owner_ref',paper_auto_test.owner(),
  'alert_id',alert));
 PERFORM paper_auto_test.raises(paper_auto_test.call('ack_alert',jsonb_build_object('experiment_id',e,
  'owner_ref',paper_auto_test.owner(),'alert_id',alert)),'ALERT_NOT_OPEN');
 r:=paper_auto_test.rpc('resume',paper_auto_test.resume_args(e,rec));
 PERFORM paper_auto_test.eq(r->>'gateMode','ARMED','resumed after resolution');
 PERFORM paper_auto_test.eq(r->>'state','READY','ready');
 r:=paper_auto_test.rpc('pause',jsonb_build_object('experiment_id',e,'owner_ref',paper_auto_test.owner()));
 PERFORM paper_auto_test.eq(r->>'state','PAUSED','paused');
 PERFORM paper_auto_test.raises(paper_auto_test.call('resume',paper_auto_test.resume_args(e,rec)),
  'FRESH_CLEAN_RECONCILIATION');
 PERFORM paper_auto_test.raises($q$UPDATE sportsedge_paper_auto.gate_events SET reason='X'$q$,'APPEND_ONLY_GATE_EVENTS');
END $$;

-- 12. No backdated or late orders: a decision executes only in its own session's regular hours.
SELECT paper_auto_test.at('2026-10-20T14:00:00Z');
DO $$
DECLARE e text:='fwd-2026-baseline'; ex text; s bigint;
BEGIN
 PERFORM paper_auto_test.arm(e,'2026-10-20T14:00Z');
 ex:=paper_auto_test.begin(e,'execute','2026-10-20T14:00Z');
 PERFORM paper_auto_test.rpc('acquire_lease',jsonb_build_object('run_id',ex));
 s:=paper_auto_test.snapshot(ex,100000,100000,100000);
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex,repeat('d',64),s,jsonb_build_array(
  paper_auto_test.leg('CCC','buy',1,2000))),'DECISION_NOT_EXECUTABLE_TODAY');
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',ex,'status','blocked'));
END $$;
SELECT paper_auto_test.at('2026-10-24T15:00:00Z');
DO $$
DECLARE e text:='fwd-2026-baseline'; ex text; s bigint;
BEGIN
 ex:=paper_auto_test.begin(e,'execute','2026-10-24T15:00Z');
 PERFORM paper_auto_test.rpc('acquire_lease',jsonb_build_object('run_id',ex));
 s:=paper_auto_test.snapshot(ex,100000,100000,100000);
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex,repeat('d',64),s,jsonb_build_array(
  paper_auto_test.leg('CCC','buy',1,2000))),'OUTSIDE_REGULAR_HOURS');
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',ex,'status','blocked'));
END $$;
SELECT paper_auto_test.at('2027-01-04T15:00:00Z');
DO $$
DECLARE e text:='fwd-2026-baseline';
BEGIN
 PERFORM paper_auto_test.rpc('stop',jsonb_build_object('experiment_id',e,'reason','WINDOW_ENDED','actor','worker:test'));
 PERFORM paper_auto_test.raises(paper_auto_test.call('resume',paper_auto_test.resume_args(e,'run-'||repeat('0',32))),
  'EXPERIMENT_ENDED');
 PERFORM paper_auto_test.eq(paper_auto_test.state(e),'STOPPED','ended experiment stays stopped');
END $$;

-- 13. Crashed runs, attributed activities, the daily ledger and both read models (16:30-16:45).
SELECT paper_auto_test.at('2026-10-19T20:30:00Z');
SELECT paper_auto_test.put('m1',paper_auto_test.begin('fwd-2026-holdrank','monitor','2026-10-19'));
SELECT paper_auto_test.at('2026-10-19T20:45:00Z');
DO $$
DECLARE e text:='fwd-2026-holdrank'; m text:=paper_auto_test.get('m1'); m2 text; r jsonb; a jsonb; k integer;
DECLARE base jsonb; daily jsonb;
BEGIN
 PERFORM paper_auto_test.raises(paper_auto_test.call('heartbeat',jsonb_build_object('run_id',m)),'RUN_NOT_ACTIVE');
 r:=paper_auto_test.rpc('begin_run',jsonb_build_object('experiment_id',e,'kind','monitor',
  'slot','2026-10-19','worker','gha:41:1'));
 PERFORM paper_auto_test.eq(r->>'attempt','2','retry attempt after crash');
 PERFORM paper_auto_test.eq((SELECT status FROM sportsedge_paper_auto.runs WHERE run_id=m),'abandoned','crashed run');
 m2:=r->>'runId';
 PERFORM paper_auto_test.raises(paper_auto_test.call('finish_run',jsonb_build_object('run_id',m,'status','succeeded')),
  'RUN_NOT_ACTIVE');
 FOR k IN 1..5 LOOP
  PERFORM paper_auto_test.begin(e,'reconcile','2026-10-17');
  UPDATE sportsedge_paper_auto.runs SET heartbeat_at='2026-10-19T20:00:00Z'
  WHERE experiment_id=e AND slot='2026-10-17' AND status='running';
 END LOOP;
 r:=paper_auto_test.rpc('begin_run',jsonb_build_object('experiment_id',e,'kind','reconcile',
  'slot','2026-10-17','worker','gha:42:1'));
 PERFORM paper_auto_test.eq(r->>'reason','SLOT_ATTEMPTS_EXHAUSTED','bounded attempts');
 base:=jsonb_build_object('activity_type','FILL','activity_at','2026-10-19T13:58:00Z','symbol','FFF',
  'side','buy','qty','2','price','39.99','raw_digest',repeat('a',64));
 a:=jsonb_build_array(
  base||jsonb_build_object('activity_id','20261019135800000::fill-f2','order_id','b-f2','classification','strategy_fill'),
  base||jsonb_build_object('activity_id','20261019140000000::fill-manual','order_id','b-manual-1','symbol','ZZZ',
   'classification','external_fill','raw_digest',repeat('c',64)),
  jsonb_build_object('activity_id','20261019150000000::csd-1','activity_type','CSD','activity_at','2026-10-19T15:00:00Z',
   'net_amount_cents',50000,'classification','external_cashflow','raw_digest',repeat('b',64)),
  jsonb_build_object('activity_id','20261019160000000::fee-1','activity_type','FEE','activity_at','2026-10-19T16:00:00Z',
   'net_amount_cents',-12,'classification','fee','raw_digest',repeat('d',64)));
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_activities',jsonb_build_object('run_id',m2,'activities',
  jsonb_build_array(base||jsonb_build_object('activity_id','20261019135800000::fill-q','order_id','b-nope',
  'classification','strategy_fill')))),'ACTIVITY_MISCLASSIFIED');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_activities',jsonb_build_object('run_id',m2,'activities',
  jsonb_build_array(base||jsonb_build_object('activity_id','20261019135800000::fill-q','order_id','b-f2',
  'classification','external_fill')))),'ACTIVITY_MISCLASSIFIED');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_activities',jsonb_build_object('run_id',m2,'activities',
  jsonb_build_array(a->2||jsonb_build_object('classification','strategy_fill')))),'ACTIVITY_MISCLASSIFIED');
 r:=paper_auto_test.rpc('record_activities',jsonb_build_object('run_id',m2,'activities',a));
 PERFORM paper_auto_test.eq(r->>'inserted','4','activities inserted');
 PERFORM paper_auto_test.eq(r->>'newExternalOrUnsupported','2','external activity counted');
 r:=paper_auto_test.rpc('record_activities',jsonb_build_object('run_id',m2,'activities',a));
 PERFORM paper_auto_test.eq(r->>'inserted','0','activities idempotent');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_activities',jsonb_build_object('run_id',m2,'activities',
  jsonb_build_array(a->2||jsonb_build_object('raw_digest',repeat('9',64))))),'ACTIVITY_CONFLICT');
 daily:=jsonb_build_object('run_id',m2,'session_date','2026-10-19','captured_at','2026-10-19T20:14:59Z',
  'equity_cents',149120,'cash_cents',140999,'long_market_value_cents',8121,'positions',jsonb_build_array(
   jsonb_build_object('symbol','FFF','qty','2','marketValueCents',8121,'costBasisCents',7998)),
  'benchmark_symbol','SPY','benchmark_close','581.25','benchmark_source','alpaca:sip:1Day:adjustment=all',
  'contaminated',false);
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_daily',daily),'DAILY_NOT_AFTER_CLOSE');
 -- A mark is observed on its own session's evening and recorded fresh: never backdated or relabeled.
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_daily',daily||jsonb_build_object(
  'session_date','2026-10-16','captured_at','2026-10-17T10:00:00Z')),'DAILY_CAPTURE_NOT_FRESH');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_daily',daily||jsonb_build_object(
  'session_date','2026-10-16','captured_at','2026-10-19T20:44:00Z')),'DAILY_CAPTURE_NOT_FRESH');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_daily',daily||jsonb_build_object(
  'captured_at','2026-10-19T20:29:59Z')),'DAILY_CAPTURE_NOT_FRESH');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_daily',daily||jsonb_build_object(
  'captured_at','2026-10-19T20:45:06Z')),'DAILY_CAPTURE_NOT_FRESH');
 daily:=daily||jsonb_build_object('captured_at','2026-10-19T20:44:00Z');
 r:=paper_auto_test.rpc('record_daily',daily);
 PERFORM paper_auto_test.eq(r->>'externalFlowCents','50000','deposit derived from activities');
 PERFORM paper_auto_test.eq(r->>'contaminated','true','manual fill contaminates');
 -- Cash is reconciled against every recorded activity: 100000 - 7998 - 7998 + 50000 - 12 = 133992.
 PERFORM paper_auto_test.eq(r->>'cashReconciled'||':'||(r->>'cashUnexplainedCents'),'false:7007',
  'cash not explained by recorded activities');
 PERFORM paper_auto_test.eq(r->>'unrealizedPlCents','123','unrealized P&L from broker cost basis');
 PERFORM paper_auto_test.eq((SELECT fees_cents::text FROM sportsedge_paper_auto.daily_equity
  WHERE experiment_id=e AND session_date='2026-10-19'),'12','fees derived');
 r:=paper_auto_test.rpc('record_daily',daily);
 PERFORM paper_auto_test.eq(r->>'duplicate','true','daily idempotent');
 PERFORM paper_auto_test.raises(paper_auto_test.call('record_daily',daily||jsonb_build_object('equity_cents',1)),
  'DAILY_CONFLICT');
 PERFORM paper_auto_test.raises($q$UPDATE sportsedge_paper_auto.daily_equity SET equity_cents=1$q$,
  'APPEND_ONLY_DAILY_EQUITY');
 r:=paper_auto_test.rpc('worker_state',jsonb_build_object('experiment_id',e));
 PERFORM paper_auto_test.eq(r->'experiment'->>'brokerAccountId','22222222-3333-4444-5555-666666666666','worker account');
 PERFORM paper_auto_test.eq((r->'experiment'->>'registeredAt')::timestamptz::text,
  '2026-10-19T11:00:00Z'::timestamptz::text,'activity window anchor');
 PERFORM paper_auto_test.eq(r->'latestDecision'->>'outcome','TARGETS','worker decision');
 -- The worker's signal copy keeps prior inputs only for targets and held or filled securities.
 PERFORM paper_auto_test.eq((SELECT string_agg(pk,',' ORDER BY pk) FROM jsonb_object_keys(
  r->'latestDecision'->'signal'->'priorInputs') pk),'id-EEE,id-FFF,id-GGG,id-HHH','compact prior inputs');
 PERFORM paper_auto_test.eq(((r->'latestDecision'->'signal') ? 'members')::text,'false','members omitted');
 PERFORM paper_auto_test.eq(r->>'filledBySecurity',
  '[{"symbol": "FFF", "netShares": "2.000000000", "securityId": "id-FFF"}, '
  ||'{"symbol": "GGG", "netShares": "1.000000000", "securityId": "id-GGG"}]','expected positions from fills');
 PERFORM paper_auto_test.eq(r->>'equityHighWaterCents','149120','high-water mark');
 PERFORM paper_auto_test.eq(r->>'brokerOrderIds','["b-e1", "b-f1", "b-f2", "b-g1", "b-g2"]',
  'every recorded broker order id is attributable');
 PERFORM paper_auto_test.eq(jsonb_array_length(r->'knownActivityIds')::text,'4','known activities');
 r:=paper_auto_test.rpc('ledger',jsonb_build_object('experiment_id',e));
 PERFORM paper_auto_test.eq(jsonb_array_length(r->'daily')::text,'1','daily series');
 PERFORM paper_auto_test.eq(r->'daily'->0->>'cashUnexplainedCents','7007','ledger shows unexplained cash');
 PERFORM paper_auto_test.eq(r->'experiment'->>'brokerAccountNumberSuffix','COND','account suffix only');
 PERFORM paper_auto_test.eq(r->'activityCounts'->>'external_fill','1','activity counts');
 IF r::text ~ '22222222-3333' OR r::text ~ 'owner-a' THEN RAISE EXCEPTION 'LEDGER_LEAKS_IDENTITY %',r; END IF;
END $$;

-- 14. Marks across sessions: flows since the previous mark, permanent contamination by external
-- cash flows, cash reconciled against all recorded activities, and the drawdown high-water mark.
SELECT paper_auto_test.at('2026-10-20T11:00:00Z');
DO $$
DECLARE e text:='fwd-2026-ledger'; r jsonb;
BEGIN
 r:=paper_auto_test.rpc('register',paper_auto_test.experiment(e,'stock-mom252-skip21-trend200-v1',
  '33333333-4444-5555-6666-777777777777','PA0THIRD',3,0,2500,12,60000,5));
 PERFORM paper_auto_test.eq(r->>'state','STOPPED','third experiment state');
 r:=paper_auto_test.mark(e,'2026-10-20',100000);
 PERFORM paper_auto_test.eq(concat_ws(':',r->>'cashReconciled',r->>'cashUnexplainedCents',r->>'contaminated',
  r->>'externalFlowCents',r->>'unrealizedPlCents'),'true:0:false:0:0','flat account reconciles to the starting equity');
 r:=paper_auto_test.mark(e,'2026-10-21',100500,jsonb_build_array(paper_auto_test.activity(
  '20261021140000000::div-1','DIV','2026-10-21T14:00:00Z',500,'dividend')));
 PERFORM paper_auto_test.eq(concat_ws(':',r->>'cashReconciled',r->>'contaminated',r->>'dividendsCents'),
  'true:false:500','a recorded dividend explains the cash');
 -- Unexplained cash leaves the mark unreconciled without contaminating later marks.
 r:=paper_auto_test.mark(e,'2026-10-22',100600);
 PERFORM paper_auto_test.eq(concat_ws(':',r->>'cashReconciled',r->>'cashUnexplainedCents',r->>'contaminated'),
  'false:100:false','unexplained cash');
 r:=paper_auto_test.mark(e,'2026-10-23',100600,jsonb_build_array(paper_auto_test.activity(
  '20261022040000000::div-2','DIV','2026-10-22T04:00:00Z',100,'dividend')));
 PERFORM paper_auto_test.eq(concat_ws(':',r->>'cashReconciled',r->>'dividendsCents'),'true:0',
  'a late activity reconciles the next mark; its flow stays in its own window');
 -- A Saturday deposit is a flow of Monday's period and contaminates every later mark.
 r:=paper_auto_test.mark(e,'2026-10-26',120600,jsonb_build_array(paper_auto_test.activity(
  '20261024040000000::csd-1','CSD','2026-10-24T04:00:00Z',20000,'external_cashflow')));
 PERFORM paper_auto_test.eq(concat_ws(':',r->>'cashReconciled',r->>'contaminated',r->>'externalFlowCents'),
  'true:true:20000','weekend deposit');
 r:=paper_auto_test.mark(e,'2026-10-27',120600,'[]',jsonb_build_array(jsonb_build_object('symbol','ZZZ','qty','1',
  'marketValueCents',0),jsonb_build_object('symbol','YYY','qty','1','marketValueCents',500,'costBasisCents',400)));
 PERFORM paper_auto_test.eq(concat_ws(':',r->>'contaminated',r->>'externalFlowCents',
  coalesce(r->>'unrealizedPlCents','unknown')),'true:0:unknown',
  'a deposit contaminates later marks; one position without a cost basis makes unrealized P&L unknown');
 r:=paper_auto_test.rpc('ledger',jsonb_build_object('experiment_id',e));
 PERFORM paper_auto_test.eq((SELECT string_agg(concat_ws('/',x->>'session',x->>'cashReconciled',x->>'contaminated'),
  ',' ORDER BY x->>'session') FROM jsonb_array_elements(r->'daily') x),
  '2026-10-20/true/false,2026-10-21/true/false,2026-10-22/false/false,2026-10-23/true/false,'
  ||'2026-10-26/true/true,2026-10-27/true/true','ledger marks');
END $$;
SELECT paper_auto_test.at('2026-10-28T12:00:30Z');
DO $$
DECLARE e text:='fwd-2026-ledger'; run text:=paper_auto_test.begin('fwd-2026-ledger','decision','2026-10-28');
DECLARE d text:=repeat('9',64);
BEGIN
 PERFORM paper_auto_test.rpc('record_decision',jsonb_build_object('run_id',run,'decision_id',d,
  'outcome','HOLD_NO_TARGETS','decision_at','2026-10-28T12:00:00Z','input_digest',repeat('e',64),
  'signal',paper_auto_test.signal(e,'stock-mom252-skip21-trend200-v1',d,'2026-10-28T12:00:00Z',
   '2026-10-28T12:00:10Z','[]'::jsonb,paper_auto_test.prior('AAA',100000))));
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',run,'status','succeeded'));
END $$;
SELECT paper_auto_test.at('2026-10-28T14:00:00Z');
DO $$
DECLARE e text:='fwd-2026-ledger'; ex text;
BEGIN
 PERFORM paper_auto_test.arm(e,'2026-10-28T14:00Z');
 ex:=paper_auto_test.begin(e,'execute','2026-10-28T14:00Z');
 PERFORM paper_auto_test.rpc('acquire_lease',jsonb_build_object('run_id',ex));
 -- 25% below the 120600 high-water mark of recorded marks, though only 10% below the starting equity.
 PERFORM paper_auto_test.raises(paper_auto_test.reserve_call(ex,repeat('9',64),
  paper_auto_test.snapshot(ex,90449,90449,90449),jsonb_build_array(paper_auto_test.leg('AAA','sell',1,2000))),
  'DRAWDOWN_LIMIT');
 PERFORM paper_auto_test.rpc('finish_run',jsonb_build_object('run_id',ex,'status','blocked'));
END $$;
DROP SCHEMA paper_auto_test CASCADE;
SELECT 'PAPER_AUTO_V1_POSTGRES_PASS' AS result;
