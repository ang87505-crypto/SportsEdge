-- SportsEdge recurring Alpaca PAPER controller, schema v1. STAGING FIRST.
-- Independent of staging v1-v6: the lifetime one-order gate is NOT modified.
-- Every experiment starts STOPPED. No function contacts a broker; a server-side
-- worker calls these RPCs around each broker request. Only service_role may
-- execute the public RPCs; no role receives table or schema privileges.
-- Requires Supabase-style roles anon, authenticated and service_role.
-- Lock order: the experiment's gate row is always locked before runs, leases
-- and intents, so STOP, claims and lease changes serialize without deadlocks.
BEGIN;
CREATE SCHEMA sportsedge_paper_auto;
REVOKE ALL ON SCHEMA sportsedge_paper_auto FROM PUBLIC;
REVOKE ALL ON SCHEMA sportsedge_paper_auto FROM anon, authenticated, service_role;

-- ---------------------------------------------------------------- helpers
-- The single clock behind every rule and default. Disposable test databases
-- replace it to pin time; only the schema owner can.
CREATE FUNCTION sportsedge_paper_auto._now() RETURNS timestamptz
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$ SELECT clock_timestamp() $$;
CREATE FUNCTION sportsedge_paper_auto._sha(t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(t,'UTF8')),'hex')
$$;
CREATE FUNCTION sportsedge_paper_auto._ny_date(t timestamptz) RETURNS date
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT (t AT TIME ZONE 'America/New_York')::date
$$;
-- Coarse defense in depth only: holidays and early closes come from the broker
-- calendar in the worker. A valid order is never outside these bounds.
CREATE FUNCTION sportsedge_paper_auto._regular_hours(t timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT extract(isodow FROM t AT TIME ZONE 'America/New_York') BETWEEN 1 AND 5
  AND (t AT TIME ZONE 'America/New_York')::time>=time '09:30'
  AND (t AT TIME ZONE 'America/New_York')::time<time '16:00'
$$;
-- After 16:15 New York on the given session (or any later day): a DAY order
-- placed during that session can no longer be live.
CREATE FUNCTION sportsedge_paper_auto._after_close(at timestamptz,day date) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT (at AT TIME ZONE 'America/New_York')::date>day
  OR ((at AT TIME ZONE 'America/New_York')::date=day AND (at AT TIME ZONE 'America/New_York')::time>=time '16:15')
$$;
CREATE FUNCTION sportsedge_paper_auto._text(p jsonb,k text,re text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR jsonb_typeof(p->k) IS DISTINCT FROM 'string'
  OR (p->>k) !~ re THEN
  RAISE EXCEPTION 'PAPER_AUTO_INVALID_%',upper(k);
 END IF;
 RETURN p->>k;
END $$;
CREATE FUNCTION sportsedge_paper_auto._int(p jsonb,k text,lo bigint,hi bigint) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE v numeric;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR jsonb_typeof(p->k) IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'PAPER_AUTO_INVALID_%',upper(k);
 END IF;
 v:=(p->>k)::numeric;
 IF v<>trunc(v) OR v<lo OR v>hi THEN RAISE EXCEPTION 'PAPER_AUTO_INVALID_%',upper(k); END IF;
 RETURN v::bigint;
END $$;
CREATE FUNCTION sportsedge_paper_auto._ts(p jsonb,k text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
BEGIN
 RETURN sportsedge_paper_auto._text(p,k,
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$')::timestamptz;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'PAPER_AUTO_INVALID_%',upper(k);
END $$;
CREATE FUNCTION sportsedge_paper_auto._qty(p jsonb,k text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 RETURN sportsedge_paper_auto._text(p,k,'^[0-9]{1,10}(\.[0-9]{1,9})?$')::numeric;
END $$;

-- ---------------------------------------------------------------- tables
CREATE TABLE sportsedge_paper_auto.experiments(
 experiment_id text PRIMARY KEY CHECK(experiment_id ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
 model_version text NOT NULL CHECK(model_version IN (
  'stock-mom252-skip21-trend200-v1','stock-mom252-skip21-trend200-holdrank10-v1')),
 signal_version text NOT NULL CHECK(signal_version='stock-forward-signal-v1'),
 planner_version text NOT NULL CHECK(planner_version='stock-forward-rebalance-v1'),
 broker_environment text NOT NULL CHECK(broker_environment='alpaca-paper'),
 broker_account_id text NOT NULL UNIQUE CHECK(broker_account_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 broker_account_number text NOT NULL CHECK(broker_account_number ~ '^[A-Z0-9]{4,32}$'),
 registered_at timestamptz NOT NULL DEFAULT sportsedge_paper_auto._now(),
 registered_by text NOT NULL CHECK(registered_by ~ '^owner-[a-f0-9]{32}$'),
 decision_window_start date NOT NULL,
 decision_window_end date NOT NULL,
 starting_equity_cents bigint NOT NULL CHECK(starting_equity_cents>0),
 capital_limit_cents bigint NOT NULL CHECK(capital_limit_cents>0),
 max_order_notional_cents bigint NOT NULL CHECK(max_order_notional_cents>0),
 max_daily_notional_cents bigint NOT NULL,
 max_orders_per_day integer NOT NULL CHECK(max_orders_per_day BETWEEN 1 AND 200),
 max_open_orders integer NOT NULL CHECK(max_open_orders BETWEEN 1 AND 20),
 max_attempts_per_leg integer NOT NULL CHECK(max_attempts_per_leg BETWEEN 1 AND 5),
 drawdown_stop_bps integer NOT NULL CHECK(drawdown_stop_bps BETWEEN 100 AND 9000),
 fee_reserve_cents integer NOT NULL CHECK(fee_reserve_cents IN (0,100)),
 config_digest text NOT NULL CHECK(config_digest ~ '^[a-f0-9]{64}$'),
 CONSTRAINT experiment_window CHECK(decision_window_end>=decision_window_start),
 CONSTRAINT experiment_daily_cap CHECK(max_daily_notional_cents>=max_order_notional_cents),
 CONSTRAINT experiment_capital CHECK(starting_equity_cents<=capital_limit_cents)
);
CREATE TABLE sportsedge_paper_auto.gates(
 experiment_id text PRIMARY KEY REFERENCES sportsedge_paper_auto.experiments(experiment_id),
 mode text NOT NULL DEFAULT 'STOPPED' CHECK(mode IN ('STOPPED','PAUSED','ARMED')),
 reason text NOT NULL CHECK(reason ~ '^[A-Z0-9_]{3,64}$'),
 version bigint NOT NULL DEFAULT 1,
 changed_at timestamptz NOT NULL DEFAULT sportsedge_paper_auto._now(),
 changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 128),
 last_check_at timestamptz,
 last_check_ok boolean,
 last_check_run text,
 last_check_blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
 last_success_at timestamptz
);
CREATE TABLE sportsedge_paper_auto.gate_events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 experiment_id text NOT NULL REFERENCES sportsedge_paper_auto.experiments(experiment_id),
 from_mode text NOT NULL,
 to_mode text NOT NULL,
 reason text NOT NULL,
 actor text NOT NULL,
 gate_version bigint NOT NULL,
 evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 at timestamptz NOT NULL DEFAULT sportsedge_paper_auto._now()
);
CREATE TABLE sportsedge_paper_auto.runs(
 run_id text PRIMARY KEY CHECK(run_id ~ '^run-[a-f0-9]{32}$'),
 experiment_id text NOT NULL REFERENCES sportsedge_paper_auto.experiments(experiment_id),
 kind text NOT NULL CHECK(kind IN ('decision','execute','monitor','reconcile')),
 slot text NOT NULL CHECK(slot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}Z)?$'),
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 5),
 worker text NOT NULL CHECK(worker ~ '^[A-Za-z0-9:_./-]{1,120}$'),
 status text NOT NULL CHECK(status IN ('running','succeeded','blocked','failed','abandoned')),
 started_at timestamptz NOT NULL,
 heartbeat_at timestamptz NOT NULL,
 finished_at timestamptz,
 result jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE(experiment_id,kind,slot,attempt)
);
CREATE UNIQUE INDEX paper_auto_one_running_run_per_slot
 ON sportsedge_paper_auto.runs(experiment_id,kind,slot) WHERE status='running';
CREATE TABLE sportsedge_paper_auto.leases(
 experiment_id text PRIMARY KEY REFERENCES sportsedge_paper_auto.experiments(experiment_id),
 run_id text NOT NULL REFERENCES sportsedge_paper_auto.runs(run_id),
 acquired_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE sportsedge_paper_auto.decisions(
 decision_id text PRIMARY KEY CHECK(decision_id ~ '^[a-f0-9]{64}$'),
 experiment_id text NOT NULL REFERENCES sportsedge_paper_auto.experiments(experiment_id),
 decision_session date NOT NULL,
 decision_at timestamptz NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('TARGETS','HOLD_NO_TARGETS','MISSED','INPUT_REJECTED')),
 model_version text NOT NULL,
 scoring_report_id text,
 input_digest text CHECK(input_digest IS NULL OR input_digest ~ '^[a-f0-9]{64}$'),
 signal jsonb,
 diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
 run_id text NOT NULL REFERENCES sportsedge_paper_auto.runs(run_id),
 recorded_at timestamptz NOT NULL DEFAULT sportsedge_paper_auto._now(),
 UNIQUE(experiment_id,decision_session),
 CONSTRAINT decision_signal_presence CHECK(
  (outcome IN ('TARGETS','HOLD_NO_TARGETS'))=(signal IS NOT NULL AND input_digest IS NOT NULL))
);
CREATE TABLE sportsedge_paper_auto.broker_snapshots(
 snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 experiment_id text NOT NULL REFERENCES sportsedge_paper_auto.experiments(experiment_id),
 run_id text NOT NULL REFERENCES sportsedge_paper_auto.runs(run_id),
 captured_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT sportsedge_paper_auto._now(),
 account_id text NOT NULL,
 equity_cents bigint NOT NULL,
 cash_cents bigint NOT NULL,
 settled_cash_cents bigint NOT NULL,
 positions jsonb NOT NULL,
 open_orders jsonb NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$')
);
CREATE TABLE sportsedge_paper_auto.intents(
 intent_id text PRIMARY KEY CHECK(intent_id ~ '^pai-[a-f0-9]{32}$'),
 experiment_id text NOT NULL REFERENCES sportsedge_paper_auto.experiments(experiment_id),
 decision_id text NOT NULL REFERENCES sportsedge_paper_auto.decisions(decision_id),
 security_id text NOT NULL CHECK(length(security_id) BETWEEN 1 AND 64),
 symbol text NOT NULL CHECK(symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
 side text NOT NULL CHECK(side IN ('buy','sell')),
 phase text NOT NULL CHECK(phase IN ('SELL','BUY')),
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 5),
 shares bigint NOT NULL CHECK(shares BETWEEN 1 AND 1000000),
 limit_cents bigint NOT NULL CHECK(limit_cents BETWEEN 1 AND 100000000),
 notional_cents bigint GENERATED ALWAYS AS (shares*limit_cents) STORED,
 client_order_id text NOT NULL UNIQUE CHECK(client_order_id ~ '^sepa[a-f0-9]{40}$'),
 plan_id text NOT NULL CHECK(plan_id ~ '^[a-f0-9]{64}$'),
 snapshot_id bigint NOT NULL REFERENCES sportsedge_paper_auto.broker_snapshots(snapshot_id),
 status text NOT NULL CHECK(status IN ('reserved','submitting','open','partially_filled',
  'filled','canceled','expired','rejected','uncertain','not_submitted','confirmed_absent')),
 broker_order_id text UNIQUE CHECK(broker_order_id IS NULL OR length(broker_order_id) BETWEEN 1 AND 128),
 broker_status text CHECK(broker_status IS NULL OR broker_status ~ '^[a-z_]{2,40}$'),
 filled_qty numeric(20,9) NOT NULL DEFAULT 0 CHECK(filled_qty>=0),
 filled_avg_price numeric(20,6) CHECK(filled_avg_price IS NULL OR filled_avg_price>0),
 lock_version integer NOT NULL DEFAULT 0 CHECK(lock_version>=0),
 reserved_by_run text NOT NULL REFERENCES sportsedge_paper_auto.runs(run_id),
 created_at timestamptz NOT NULL DEFAULT sportsedge_paper_auto._now(),
 updated_at timestamptz NOT NULL DEFAULT sportsedge_paper_auto._now(),
 UNIQUE(experiment_id,decision_id,security_id,side,phase,attempt),
 CONSTRAINT intent_side_phase CHECK((side='sell')=(phase='SELL')),
 CONSTRAINT intent_fill_bounds CHECK(filled_qty<=shares)
);
-- At most one live or unresolved order per experiment and security.
CREATE UNIQUE INDEX paper_auto_one_active_intent_per_security
 ON sportsedge_paper_auto.intents(experiment_id,security_id)
 WHERE status IN ('reserved','submitting','open','partially_filled','uncertain');
CREATE TABLE sportsedge_paper_auto.intent_events(
 intent_id text NOT NULL REFERENCES sportsedge_paper_auto.intents(intent_id),
 version integer NOT NULL CHECK(version>0),
 from_status text NOT NULL,
 to_status text NOT NULL,
 broker_status text,
 broker_order_id text,
 filled_qty numeric(20,9) NOT NULL,
 actor text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 at timestamptz NOT NULL DEFAULT sportsedge_paper_auto._now(),
 PRIMARY KEY(intent_id,version)
);
CREATE TABLE sportsedge_paper_auto.activities(
 activity_id text PRIMARY KEY CHECK(length(activity_id) BETWEEN 8 AND 128),
 experiment_id text NOT NULL REFERENCES sportsedge_paper_auto.experiments(experiment_id),
 activity_type text NOT NULL CHECK(activity_type ~ '^[A-Z]{2,8}$'),
 activity_at timestamptz NOT NULL,
 symbol text,
 side text CHECK(side IS NULL OR side IN ('buy','sell')),
 qty numeric(20,9),
 price numeric(20,6),
 net_amount_cents bigint,
 order_id text,
 classification text NOT NULL CHECK(classification IN ('strategy_fill','external_fill',
  'external_cashflow','dividend','fee','corporate_action','other')),
 raw_digest text NOT NULL CHECK(raw_digest ~ '^[a-f0-9]{64}$'),
 run_id text NOT NULL REFERENCES sportsedge_paper_auto.runs(run_id),
 recorded_at timestamptz NOT NULL DEFAULT sportsedge_paper_auto._now()
);
CREATE TABLE sportsedge_paper_auto.daily_equity(
 experiment_id text NOT NULL REFERENCES sportsedge_paper_auto.experiments(experiment_id),
 session_date date NOT NULL,
 captured_at timestamptz NOT NULL,
 equity_cents bigint NOT NULL CHECK(equity_cents>=0),
 cash_cents bigint NOT NULL,
 long_market_value_cents bigint NOT NULL CHECK(long_market_value_cents>=0),
 external_flow_cents bigint NOT NULL,
 fees_cents bigint NOT NULL CHECK(fees_cents>=0),
 dividends_cents bigint NOT NULL CHECK(dividends_cents>=0),
 positions jsonb NOT NULL,
 benchmark_symbol text NOT NULL CHECK(benchmark_symbol ~ '^[A-Z]{1,5}$'),
 benchmark_close numeric(20,6) CHECK(benchmark_close IS NULL OR benchmark_close>0),
 benchmark_source text NOT NULL CHECK(length(benchmark_source) BETWEEN 3 AND 160),
 contaminated boolean NOT NULL,
 cash_unexplained_cents numeric(20,6) NOT NULL,
 cash_reconciled boolean NOT NULL,
 unrealized_pl_cents bigint,
 run_id text NOT NULL REFERENCES sportsedge_paper_auto.runs(run_id),
 recorded_at timestamptz NOT NULL DEFAULT sportsedge_paper_auto._now(),
 PRIMARY KEY(experiment_id,session_date)
);
CREATE TABLE sportsedge_paper_auto.alerts(
 alert_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 experiment_id text NOT NULL REFERENCES sportsedge_paper_auto.experiments(experiment_id),
 severity text NOT NULL CHECK(severity IN ('info','warning','critical')),
 code text NOT NULL CHECK(code ~ '^[A-Z0-9_]{3,64}$'),
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 run_id text REFERENCES sportsedge_paper_auto.runs(run_id),
 created_at timestamptz NOT NULL DEFAULT sportsedge_paper_auto._now(),
 acknowledged_at timestamptz,
 acknowledged_by text
);

DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['experiments','gates','gate_events','runs','leases','decisions',
  'broker_snapshots','intents','intent_events','activities','daily_equity','alerts'] LOOP
  EXECUTE format('ALTER TABLE sportsedge_paper_auto.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sportsedge_paper_auto.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON sportsedge_paper_auto.%I FROM PUBLIC, anon, authenticated, service_role',t);
 END LOOP;
END $$;

-- ---------------------------------------------------------------- guards
-- Registration, decisions, events, snapshots and activities are append-only.
CREATE FUNCTION sportsedge_paper_auto._immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'PAPER_AUTO_APPEND_ONLY_%',upper(TG_TABLE_NAME); END $$;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['experiments','gate_events','decisions','broker_snapshots',
  'intent_events','activities','daily_equity'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON sportsedge_paper_auto.%I '
   'FOR EACH ROW EXECUTE FUNCTION sportsedge_paper_auto._immutable()',t||'_append_only',t);
 END LOOP;
END $$;

-- The gate starts STOPPED; ARMED is reachable only inside the resume RPC.
CREATE FUNCTION sportsedge_paper_auto._gate_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PAPER_AUTO_GATE_NOT_DELETABLE'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.mode<>'STOPPED' OR NEW.version<>1 THEN RAISE EXCEPTION 'PAPER_AUTO_GATE_MUST_START_STOPPED'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.experiment_id IS DISTINCT FROM OLD.experiment_id THEN RAISE EXCEPTION 'PAPER_AUTO_GATE_IDENTITY'; END IF;
 IF NEW.mode IS DISTINCT FROM OLD.mode THEN
  IF NEW.mode='ARMED' AND coalesce(current_setting('sportsedge.paper_auto_resume',true),'')
     IS DISTINCT FROM OLD.experiment_id THEN
   RAISE EXCEPTION 'PAPER_AUTO_ARM_ONLY_VIA_RESUME';
  END IF;
  IF NEW.mode='PAUSED' AND OLD.mode<>'ARMED' THEN RAISE EXCEPTION 'PAPER_AUTO_PAUSE_ONLY_FROM_ARMED'; END IF;
  NEW.version:=OLD.version+1;
  NEW.changed_at:=sportsedge_paper_auto._now();
 ELSE
  NEW.version:=OLD.version;
  NEW.reason:=OLD.reason; NEW.changed_at:=OLD.changed_at; NEW.changed_by:=OLD.changed_by;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gates_guard BEFORE INSERT OR UPDATE OR DELETE ON sportsedge_paper_auto.gates
FOR EACH ROW EXECUTE FUNCTION sportsedge_paper_auto._gate_guard();
CREATE FUNCTION sportsedge_paper_auto._gate_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.mode IS DISTINCT FROM OLD.mode THEN
  INSERT INTO sportsedge_paper_auto.gate_events(experiment_id,from_mode,to_mode,reason,actor,gate_version,evidence)
  VALUES(NEW.experiment_id,OLD.mode,NEW.mode,NEW.reason,NEW.changed_by,NEW.version,
   coalesce(nullif(current_setting('sportsedge.paper_auto_evidence',true),''),'{}')::jsonb);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gates_audit AFTER UPDATE ON sportsedge_paper_auto.gates
FOR EACH ROW EXECUTE FUNCTION sportsedge_paper_auto._gate_audit();

-- Order economics and identities never change after reservation.
CREATE FUNCTION sportsedge_paper_auto._intent_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PAPER_AUTO_INTENT_NOT_DELETABLE'; END IF;
 IF (OLD.intent_id,OLD.experiment_id,OLD.decision_id,OLD.security_id,OLD.symbol,OLD.side,
     OLD.phase,OLD.attempt,OLD.shares,OLD.limit_cents,OLD.client_order_id,OLD.plan_id,
     OLD.snapshot_id,OLD.reserved_by_run,OLD.created_at)
   IS DISTINCT FROM
    (NEW.intent_id,NEW.experiment_id,NEW.decision_id,NEW.security_id,NEW.symbol,NEW.side,
     NEW.phase,NEW.attempt,NEW.shares,NEW.limit_cents,NEW.client_order_id,NEW.plan_id,
     NEW.snapshot_id,NEW.reserved_by_run,NEW.created_at) THEN
  RAISE EXCEPTION 'PAPER_AUTO_INTENT_IMMUTABLE';
 END IF;
 IF OLD.broker_order_id IS NOT NULL AND NEW.broker_order_id IS DISTINCT FROM OLD.broker_order_id THEN
  RAISE EXCEPTION 'PAPER_AUTO_BROKER_ID_IMMUTABLE';
 END IF;
 IF NEW.filled_qty<OLD.filled_qty THEN RAISE EXCEPTION 'PAPER_AUTO_FILL_DECREASED'; END IF;
 IF NEW.lock_version<>OLD.lock_version+1 THEN RAISE EXCEPTION 'PAPER_AUTO_INTENT_CAS'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER intents_guard BEFORE UPDATE OR DELETE ON sportsedge_paper_auto.intents
FOR EACH ROW EXECUTE FUNCTION sportsedge_paper_auto._intent_guard();

-- ---------------------------------------------------------------- internal
CREATE FUNCTION sportsedge_paper_auto._event(i sportsedge_paper_auto.intents,old_status text,actor text,detail jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF length(coalesce(detail,'{}'::jsonb)::text)>8000 THEN RAISE EXCEPTION 'PAPER_AUTO_DETAIL_TOO_LARGE'; END IF;
 INSERT INTO sportsedge_paper_auto.intent_events(intent_id,version,from_status,to_status,
  broker_status,broker_order_id,filled_qty,actor,detail)
 VALUES(i.intent_id,i.lock_version,old_status,i.status,i.broker_status,i.broker_order_id,
  i.filled_qty,actor,coalesce(detail,'{}'::jsonb));
END $$;
CREATE FUNCTION sportsedge_paper_auto._running(run text,want_kind text) RETURNS sportsedge_paper_auto.runs
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE r sportsedge_paper_auto.runs%ROWTYPE;
BEGIN
 SELECT * INTO r FROM sportsedge_paper_auto.runs WHERE run_id=run;
 IF NOT FOUND OR r.status<>'running' OR (want_kind IS NOT NULL AND r.kind<>want_kind)
  OR r.heartbeat_at<sportsedge_paper_auto._now()-interval '10 minutes' THEN
  RAISE EXCEPTION 'PAPER_AUTO_RUN_NOT_ACTIVE';
 END IF;
 RETURN r;
END $$;
-- Locks the run's gate row first, then re-reads the run under that lock.
CREATE FUNCTION sportsedge_paper_auto._lock_run(run text,want_kind text) RETURNS sportsedge_paper_auto.runs
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e text;
BEGIN
 SELECT experiment_id INTO e FROM sportsedge_paper_auto.runs WHERE run_id=run;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAPER_AUTO_RUN_NOT_ACTIVE'; END IF;
 PERFORM 1 FROM sportsedge_paper_auto.gates WHERE experiment_id=e FOR UPDATE;
 RETURN sportsedge_paper_auto._running(run,want_kind);
END $$;
CREATE FUNCTION sportsedge_paper_auto._require_lease(e text,run text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sportsedge_paper_auto.leases
  WHERE experiment_id=e AND run_id=run AND expires_at>sportsedge_paper_auto._now()) THEN
  RAISE EXCEPTION 'PAPER_AUTO_LEASE_NOT_HELD';
 END IF;
END $$;
-- No new reservation or POST while any submission outcome is unknown or a
-- critical alert is unacknowledged.
CREATE FUNCTION sportsedge_paper_auto._require_clear(e text,except_intent text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM sportsedge_paper_auto.intents WHERE experiment_id=e
  AND status IN ('submitting','uncertain') AND intent_id IS DISTINCT FROM except_intent) THEN
  RAISE EXCEPTION 'PAPER_AUTO_UNRESOLVED_SUBMISSION';
 END IF;
 IF EXISTS(SELECT 1 FROM sportsedge_paper_auto.alerts WHERE experiment_id=e
  AND severity='critical' AND acknowledged_at IS NULL) THEN
  RAISE EXCEPTION 'PAPER_AUTO_CRITICAL_ALERT_OPEN';
 END IF;
END $$;
CREATE FUNCTION sportsedge_paper_auto._status(e text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE g sportsedge_paper_auto.gates%ROWTYPE; l sportsedge_paper_auto.leases%ROWTYPE;
DECLARE x sportsedge_paper_auto.experiments%ROWTYPE; t timestamptz:=sportsedge_paper_auto._now();
DECLARE unresolved integer; active integer; state text; critical integer;
BEGIN
 SELECT * INTO STRICT x FROM sportsedge_paper_auto.experiments WHERE experiment_id=e;
 SELECT * INTO STRICT g FROM sportsedge_paper_auto.gates WHERE experiment_id=e;
 SELECT * INTO l FROM sportsedge_paper_auto.leases WHERE experiment_id=e AND expires_at>t;
 SELECT count(*) FILTER (WHERE status IN ('submitting','uncertain')),
        count(*) FILTER (WHERE status IN ('reserved','submitting','open','partially_filled','uncertain'))
 INTO unresolved,active FROM sportsedge_paper_auto.intents WHERE experiment_id=e;
 SELECT count(*) INTO critical FROM sportsedge_paper_auto.alerts
 WHERE experiment_id=e AND severity='critical' AND acknowledged_at IS NULL;
 state:=CASE
  WHEN g.mode='STOPPED' THEN 'STOPPED'
  WHEN g.mode='PAUSED' THEN 'PAUSED'
  WHEN l.run_id IS NOT NULL THEN 'EXECUTING'
  WHEN g.last_check_ok IS TRUE AND g.last_check_at>t-interval '26 hours' AND unresolved=0
   AND critical=0 AND sportsedge_paper_auto._ny_date(t)<=x.decision_window_end THEN 'READY'
  ELSE 'BLOCKED' END;
 RETURN jsonb_build_object(
  'experimentId',e,'state',state,'gateMode',g.mode,'gateReason',g.reason,
  'gateVersion',g.version,'gateChangedAt',g.changed_at,
  'gateChangedBy',CASE WHEN g.changed_by LIKE 'owner-%' THEN 'owner' ELSE g.changed_by END,
  'lastCheckAt',g.last_check_at,'lastCheckOk',g.last_check_ok,
  'lastCheckBlockers',g.last_check_blockers,'lastSuccessAt',g.last_success_at,
  'executingRunId',l.run_id,'leaseExpiresAt',l.expires_at,
  'unresolvedIntents',unresolved,'activeIntents',active,'unacknowledgedCriticalAlerts',critical,
  'brokerEnvironment',x.broker_environment,'modelVersion',x.model_version,
  'decisionWindow',jsonb_build_object('start',x.decision_window_start,'end',x.decision_window_end),
  'limits',jsonb_build_object('capitalLimitCents',x.capital_limit_cents,
   'maxOrderNotionalCents',x.max_order_notional_cents,'maxDailyNotionalCents',x.max_daily_notional_cents,
   'maxOrdersPerDay',x.max_orders_per_day,'maxOpenOrders',x.max_open_orders,
   'maxAttemptsPerLeg',x.max_attempts_per_leg,'drawdownStopBps',x.drawdown_stop_bps,
   'feeReserveCents',x.fee_reserve_cents),
  'checkedAt',t,'realMoneyEnabled',false);
END $$;

-- ---------------------------------------------------------------- public RPCs
CREATE FUNCTION public.sportsedge_paper_auto_register(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e text:=sportsedge_paper_auto._text(p,'experiment_id','^[a-z0-9][a-z0-9-]{2,62}$');
DECLARE owner text:=sportsedge_paper_auto._text(p,'owner_ref','^owner-[a-f0-9]{32}$');
DECLARE observed timestamptz:=sportsedge_paper_auto._ts(p,'account_observed_at');
DECLARE cfg jsonb; digest text; t timestamptz:=sportsedge_paper_auto._now();
BEGIN
 IF observed>t+interval '5 seconds' OR observed<t-interval '5 minutes' THEN
  RAISE EXCEPTION 'PAPER_AUTO_ACCOUNT_OBSERVATION_STALE';
 END IF;
 cfg:=jsonb_build_object(
  'experiment_id',e,
  'model_version',sportsedge_paper_auto._text(p,'model_version','^stock-mom252-skip21-trend200-(v1|holdrank10-v1)$'),
  'broker_account_id',sportsedge_paper_auto._text(p,'broker_account_id','^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  'broker_account_number',sportsedge_paper_auto._text(p,'broker_account_number','^[A-Z0-9]{4,32}$'),
  'decision_window_start',sportsedge_paper_auto._text(p,'decision_window_start','^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  'decision_window_end',sportsedge_paper_auto._text(p,'decision_window_end','^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  'starting_equity_cents',sportsedge_paper_auto._int(p,'starting_equity_cents',1,100000000000),
  'capital_limit_cents',sportsedge_paper_auto._int(p,'capital_limit_cents',1,100000000000),
  'max_order_notional_cents',sportsedge_paper_auto._int(p,'max_order_notional_cents',1,100000000000),
  'max_daily_notional_cents',sportsedge_paper_auto._int(p,'max_daily_notional_cents',1,100000000000),
  'max_orders_per_day',sportsedge_paper_auto._int(p,'max_orders_per_day',1,200),
  'max_open_orders',sportsedge_paper_auto._int(p,'max_open_orders',1,20),
  'max_attempts_per_leg',sportsedge_paper_auto._int(p,'max_attempts_per_leg',1,5),
  'drawdown_stop_bps',sportsedge_paper_auto._int(p,'drawdown_stop_bps',100,9000),
  'fee_reserve_cents',sportsedge_paper_auto._int(p,'fee_reserve_cents',0,100));
 digest:=sportsedge_paper_auto._sha(cfg::text);
 INSERT INTO sportsedge_paper_auto.experiments(experiment_id,model_version,signal_version,
  planner_version,broker_environment,broker_account_id,broker_account_number,registered_by,
  decision_window_start,decision_window_end,starting_equity_cents,capital_limit_cents,
  max_order_notional_cents,max_daily_notional_cents,max_orders_per_day,max_open_orders,
  max_attempts_per_leg,drawdown_stop_bps,fee_reserve_cents,config_digest)
 VALUES(e,cfg->>'model_version','stock-forward-signal-v1','stock-forward-rebalance-v1','alpaca-paper',
  cfg->>'broker_account_id',cfg->>'broker_account_number',owner,
  (cfg->>'decision_window_start')::date,(cfg->>'decision_window_end')::date,
  (cfg->>'starting_equity_cents')::bigint,(cfg->>'capital_limit_cents')::bigint,
  (cfg->>'max_order_notional_cents')::bigint,(cfg->>'max_daily_notional_cents')::bigint,
  (cfg->>'max_orders_per_day')::int,(cfg->>'max_open_orders')::int,
  (cfg->>'max_attempts_per_leg')::int,(cfg->>'drawdown_stop_bps')::int,
  (cfg->>'fee_reserve_cents')::int,digest);
 INSERT INTO sportsedge_paper_auto.gates(experiment_id,mode,reason,changed_by)
 VALUES(e,'STOPPED','REGISTERED_NOT_AUTHORIZED',owner);
 INSERT INTO sportsedge_paper_auto.gate_events(experiment_id,from_mode,to_mode,reason,actor,gate_version,evidence)
 VALUES(e,'NONE','STOPPED','REGISTERED_NOT_AUTHORIZED',owner,1,jsonb_build_object('configDigest',digest));
 RETURN sportsedge_paper_auto._status(e)||jsonb_build_object('configDigest',digest);
END $$;

CREATE FUNCTION public.sportsedge_paper_auto_status(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e text:=sportsedge_paper_auto._text(p,'experiment_id','^[a-z0-9][a-z0-9-]{2,62}$');
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sportsedge_paper_auto.experiments WHERE experiment_id=e) THEN
  RETURN jsonb_build_object('experimentId',e,'state','NOT_REGISTERED','realMoneyEnabled',false);
 END IF;
 RETURN sportsedge_paper_auto._status(e);
END $$;

-- STOP is always allowed, idempotent and audited; reserved unsent work is voided.
CREATE FUNCTION public.sportsedge_paper_auto_stop(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e text:=sportsedge_paper_auto._text(p,'experiment_id','^[a-z0-9][a-z0-9-]{2,62}$');
DECLARE why text:=sportsedge_paper_auto._text(p,'reason','^[A-Z0-9_]{3,64}$');
DECLARE who text:=sportsedge_paper_auto._text(p,'actor','^(owner-[a-f0-9]{32}|worker:[A-Za-z0-9:_./-]{1,100})$');
DECLARE g sportsedge_paper_auto.gates%ROWTYPE; i sportsedge_paper_auto.intents%ROWTYPE;
BEGIN
 SELECT * INTO g FROM sportsedge_paper_auto.gates WHERE experiment_id=e FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAPER_AUTO_UNKNOWN_EXPERIMENT'; END IF;
 IF length(coalesce(p->'evidence','{}'::jsonb)::text)>8000 THEN RAISE EXCEPTION 'PAPER_AUTO_DETAIL_TOO_LARGE'; END IF;
 PERFORM set_config('sportsedge.paper_auto_evidence',coalesce(p->'evidence','{}'::jsonb)::text,true);
 IF g.mode<>'STOPPED' THEN
  UPDATE sportsedge_paper_auto.gates SET mode='STOPPED',reason=why,changed_by=who WHERE experiment_id=e;
 ELSE
  INSERT INTO sportsedge_paper_auto.gate_events(experiment_id,from_mode,to_mode,reason,actor,gate_version,evidence)
  VALUES(e,'STOPPED','STOPPED',why,who,g.version,coalesce(p->'evidence','{}'::jsonb));
 END IF;
 FOR i IN SELECT * FROM sportsedge_paper_auto.intents
  WHERE experiment_id=e AND status='reserved' FOR UPDATE LOOP
  UPDATE sportsedge_paper_auto.intents SET status='not_submitted',lock_version=lock_version+1,
   updated_at=sportsedge_paper_auto._now() WHERE intent_id=i.intent_id RETURNING * INTO i;
  PERFORM sportsedge_paper_auto._event(i,'reserved',who,jsonb_build_object('reason',why));
 END LOOP;
 IF p ? 'alert' THEN
  INSERT INTO sportsedge_paper_auto.alerts(experiment_id,severity,code,detail)
  VALUES(e,'critical',sportsedge_paper_auto._text(p->'alert','code','^[A-Z0-9_]{3,64}$'),
   coalesce(p->'alert'->'detail','{}'::jsonb));
 END IF;
 RETURN sportsedge_paper_auto._status(e);
END $$;

CREATE FUNCTION public.sportsedge_paper_auto_pause(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e text:=sportsedge_paper_auto._text(p,'experiment_id','^[a-z0-9][a-z0-9-]{2,62}$');
DECLARE owner text:=sportsedge_paper_auto._text(p,'owner_ref','^owner-[a-f0-9]{32}$');
DECLARE g sportsedge_paper_auto.gates%ROWTYPE;
BEGIN
 SELECT * INTO g FROM sportsedge_paper_auto.gates WHERE experiment_id=e FOR UPDATE;
 IF NOT FOUND OR g.mode<>'ARMED' THEN RAISE EXCEPTION 'PAPER_AUTO_PAUSE_REQUIRES_ARMED'; END IF;
 UPDATE sportsedge_paper_auto.gates SET mode='PAUSED',reason='OWNER_PAUSE',changed_by=owner WHERE experiment_id=e;
 RETURN sportsedge_paper_auto._status(e);
END $$;

-- RESUME needs the expected gate version, a fresh clean reconciliation run for the
-- registered account, no unresolved intents and no unacknowledged critical alert.
CREATE FUNCTION public.sportsedge_paper_auto_resume(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e text:=sportsedge_paper_auto._text(p,'experiment_id','^[a-z0-9][a-z0-9-]{2,62}$');
DECLARE owner text:=sportsedge_paper_auto._text(p,'owner_ref','^owner-[a-f0-9]{32}$');
DECLARE expected bigint:=sportsedge_paper_auto._int(p,'expected_gate_version',1,1000000000);
DECLARE rec text:=sportsedge_paper_auto._text(p,'reconcile_run_id','^run-[a-f0-9]{32}$');
DECLARE g sportsedge_paper_auto.gates%ROWTYPE; x sportsedge_paper_auto.experiments%ROWTYPE;
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; t timestamptz:=sportsedge_paper_auto._now();
BEGIN
 SELECT * INTO g FROM sportsedge_paper_auto.gates WHERE experiment_id=e FOR UPDATE;
 IF NOT FOUND OR g.mode NOT IN ('STOPPED','PAUSED') THEN RAISE EXCEPTION 'PAPER_AUTO_RESUME_STATE'; END IF;
 IF g.version<>expected THEN RAISE EXCEPTION 'PAPER_AUTO_RESUME_STALE_VERSION'; END IF;
 SELECT * INTO STRICT x FROM sportsedge_paper_auto.experiments WHERE experiment_id=e;
 IF sportsedge_paper_auto._ny_date(t)>x.decision_window_end THEN RAISE EXCEPTION 'PAPER_AUTO_EXPERIMENT_ENDED'; END IF;
 SELECT * INTO r FROM sportsedge_paper_auto.runs WHERE run_id=rec AND experiment_id=e;
 IF NOT FOUND OR r.kind<>'reconcile' OR r.status<>'succeeded' OR r.finished_at<t-interval '15 minutes'
  OR r.finished_at<=g.changed_at OR (r.result->>'clean') IS DISTINCT FROM 'true'
  OR (r.result->>'accountId') IS DISTINCT FROM x.broker_account_id THEN
  RAISE EXCEPTION 'PAPER_AUTO_RESUME_REQUIRES_FRESH_CLEAN_RECONCILIATION';
 END IF;
 IF EXISTS(SELECT 1 FROM sportsedge_paper_auto.intents WHERE experiment_id=e
  AND status IN ('reserved','submitting','uncertain')) THEN
  RAISE EXCEPTION 'PAPER_AUTO_RESUME_UNRESOLVED_INTENTS';
 END IF;
 IF EXISTS(SELECT 1 FROM sportsedge_paper_auto.alerts WHERE experiment_id=e
  AND severity='critical' AND acknowledged_at IS NULL) THEN
  RAISE EXCEPTION 'PAPER_AUTO_RESUME_CRITICAL_ALERT_OPEN';
 END IF;
 PERFORM set_config('sportsedge.paper_auto_resume',e,true);
 PERFORM set_config('sportsedge.paper_auto_evidence',jsonb_build_object('reconcileRunId',rec,
  'reconciledAt',r.finished_at)::text,true);
 UPDATE sportsedge_paper_auto.gates SET mode='ARMED',reason='OWNER_RESUME_AFTER_RECONCILIATION',
  changed_by=owner WHERE experiment_id=e;
 PERFORM set_config('sportsedge.paper_auto_resume','',true);
 RETURN sportsedge_paper_auto._status(e);
END $$;

CREATE FUNCTION public.sportsedge_paper_auto_ack_alert(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e text:=sportsedge_paper_auto._text(p,'experiment_id','^[a-z0-9][a-z0-9-]{2,62}$');
DECLARE owner text:=sportsedge_paper_auto._text(p,'owner_ref','^owner-[a-f0-9]{32}$');
DECLARE a bigint:=sportsedge_paper_auto._int(p,'alert_id',1,9000000000000000000);
BEGIN
 UPDATE sportsedge_paper_auto.alerts SET acknowledged_at=sportsedge_paper_auto._now(),acknowledged_by=owner
 WHERE alert_id=a AND experiment_id=e AND acknowledged_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAPER_AUTO_ALERT_NOT_OPEN'; END IF;
 RETURN sportsedge_paper_auto._status(e);
END $$;

-- Duplicate scheduler deliveries of one slot never run twice concurrently; a
-- crashed run (stale heartbeat) is abandoned before a bounded retry attempt.
CREATE FUNCTION public.sportsedge_paper_auto_begin_run(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e text:=sportsedge_paper_auto._text(p,'experiment_id','^[a-z0-9][a-z0-9-]{2,62}$');
DECLARE k text:=sportsedge_paper_auto._text(p,'kind','^(decision|execute|monitor|reconcile)$');
DECLARE s text:=sportsedge_paper_auto._text(p,'slot','^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}Z)?$');
DECLARE w text:=sportsedge_paper_auto._text(p,'worker','^[A-Za-z0-9:_./-]{1,120}$');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; nxt integer:=1; rid text; t timestamptz:=sportsedge_paper_auto._now();
BEGIN
 PERFORM 1 FROM sportsedge_paper_auto.gates WHERE experiment_id=e FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAPER_AUTO_UNKNOWN_EXPERIMENT'; END IF;
 SELECT * INTO r FROM sportsedge_paper_auto.runs WHERE experiment_id=e AND kind=k AND slot=s
 ORDER BY attempt DESC LIMIT 1;
 IF FOUND THEN
  IF r.status IN ('succeeded','blocked') THEN
   RETURN jsonb_build_object('started',false,'reason','SLOT_ALREADY_FINISHED','runId',r.run_id,'status',r.status);
  END IF;
  IF r.status='running' AND r.heartbeat_at>t-interval '10 minutes' THEN
   RETURN jsonb_build_object('started',false,'reason','SLOT_ALREADY_RUNNING','runId',r.run_id,'status',r.status);
  END IF;
  IF r.status='running' THEN
   UPDATE sportsedge_paper_auto.runs SET status='abandoned',finished_at=t,
    result=jsonb_build_object('reason','HEARTBEAT_EXPIRED') WHERE run_id=r.run_id;
   DELETE FROM sportsedge_paper_auto.leases WHERE experiment_id=e AND run_id=r.run_id;
  END IF;
  IF r.attempt>=5 THEN
   RETURN jsonb_build_object('started',false,'reason','SLOT_ATTEMPTS_EXHAUSTED','runId',r.run_id,'status','abandoned');
  END IF;
  nxt:=r.attempt+1;
 END IF;
 rid:='run-'||left(sportsedge_paper_auto._sha(concat_ws('|','sportsedge-paper-auto-run-v1',e,k,s,nxt::text)),32);
 INSERT INTO sportsedge_paper_auto.runs(run_id,experiment_id,kind,slot,attempt,worker,status,started_at,heartbeat_at)
 VALUES(rid,e,k,s,nxt,w,'running',t,t);
 RETURN jsonb_build_object('started',true,'runId',rid,'attempt',nxt,'startedAt',t);
END $$;

CREATE FUNCTION public.sportsedge_paper_auto_heartbeat(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; t timestamptz:=sportsedge_paper_auto._now();
DECLARE renewed timestamptz;
BEGIN
 r:=sportsedge_paper_auto._lock_run(run,NULL);
 UPDATE sportsedge_paper_auto.runs SET heartbeat_at=t WHERE run_id=run;
 UPDATE sportsedge_paper_auto.leases SET expires_at=t+interval '5 minutes'
 WHERE experiment_id=r.experiment_id AND run_id=run AND expires_at>t RETURNING expires_at INTO renewed;
 RETURN jsonb_build_object('runId',run,'heartbeatAt',t,'leaseExpiresAt',renewed);
END $$;

CREATE FUNCTION public.sportsedge_paper_auto_acquire_lease(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; l sportsedge_paper_auto.leases%ROWTYPE;
DECLARE t timestamptz:=sportsedge_paper_auto._now();
BEGIN
 r:=sportsedge_paper_auto._lock_run(run,NULL);
 IF r.kind NOT IN ('execute','reconcile') THEN RAISE EXCEPTION 'PAPER_AUTO_LEASE_KIND'; END IF;
 SELECT * INTO l FROM sportsedge_paper_auto.leases WHERE experiment_id=r.experiment_id FOR UPDATE;
 IF FOUND AND l.run_id<>run AND l.expires_at>t THEN
  RETURN jsonb_build_object('acquired',false,'heldBy',l.run_id,'expiresAt',l.expires_at);
 END IF;
 INSERT INTO sportsedge_paper_auto.leases(experiment_id,run_id,acquired_at,expires_at)
 VALUES(r.experiment_id,run,t,t+interval '5 minutes')
 ON CONFLICT(experiment_id) DO UPDATE SET run_id=EXCLUDED.run_id,acquired_at=EXCLUDED.acquired_at,
  expires_at=EXCLUDED.expires_at;
 RETURN jsonb_build_object('acquired',true,'runId',run,'expiresAt',t+interval '5 minutes');
END $$;

CREATE FUNCTION public.sportsedge_paper_auto_finish_run(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE st text:=sportsedge_paper_auto._text(p,'status','^(succeeded|blocked|failed)$');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; t timestamptz:=sportsedge_paper_auto._now(); e text;
DECLARE res jsonb:=coalesce(p->'result','{}'::jsonb);
BEGIN
 SELECT experiment_id INTO e FROM sportsedge_paper_auto.runs WHERE run_id=run;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAPER_AUTO_RUN_NOT_ACTIVE'; END IF;
 PERFORM 1 FROM sportsedge_paper_auto.gates WHERE experiment_id=e FOR UPDATE;
 SELECT * INTO r FROM sportsedge_paper_auto.runs WHERE run_id=run FOR UPDATE;
 IF r.status<>'running' THEN RAISE EXCEPTION 'PAPER_AUTO_RUN_NOT_ACTIVE'; END IF;
 IF jsonb_typeof(res)<>'object' OR length(res::text)>200000 THEN RAISE EXCEPTION 'PAPER_AUTO_INVALID_RESULT'; END IF;
 IF r.kind='reconcile' AND st='succeeded' AND jsonb_typeof(res->'clean') IS DISTINCT FROM 'boolean' THEN
  RAISE EXCEPTION 'PAPER_AUTO_RECONCILE_RESULT_REQUIRED';
 END IF;
 UPDATE sportsedge_paper_auto.runs SET status=st,finished_at=t,heartbeat_at=t,result=res WHERE run_id=run;
 DELETE FROM sportsedge_paper_auto.leases WHERE experiment_id=e AND run_id=run;
 IF r.kind IN ('reconcile','execute','monitor') AND p ? 'check' THEN
  UPDATE sportsedge_paper_auto.gates SET last_check_at=t,
   last_check_ok=((p->'check'->>'ok')='true'),last_check_run=run,
   last_check_blockers=coalesce(p->'check'->'blockers','[]'::jsonb),
   last_success_at=CASE WHEN (p->'check'->>'ok')='true' THEN t ELSE last_success_at END
  WHERE experiment_id=e;
 END IF;
 RETURN jsonb_build_object('runId',run,'status',st,'finishedAt',t);
END $$;

-- One immutable decision per experiment session, including HOLD and MISSED.
-- A TARGETS/HOLD signal must be bound to this experiment, model, decision time
-- and a capture no later than sixty seconds after the decision.
CREATE FUNCTION public.sportsedge_paper_auto_record_decision(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE d text:=sportsedge_paper_auto._text(p,'decision_id','^[a-f0-9]{64}$');
DECLARE o text:=sportsedge_paper_auto._text(p,'outcome','^(TARGETS|HOLD_NO_TARGETS|MISSED|INPUT_REJECTED)$');
DECLARE at timestamptz:=sportsedge_paper_auto._ts(p,'decision_at');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; x sportsedge_paper_auto.experiments%ROWTYPE;
DECLARE old sportsedge_paper_auto.decisions%ROWTYPE; sess date; t timestamptz:=sportsedge_paper_auto._now();
DECLARE sig jsonb:=p->'signal'; seen timestamptz;
BEGIN
 r:=sportsedge_paper_auto._running(run,'decision');
 SELECT * INTO STRICT x FROM sportsedge_paper_auto.experiments WHERE experiment_id=r.experiment_id;
 sess:=sportsedge_paper_auto._ny_date(at);
 IF sess<x.decision_window_start OR sess>x.decision_window_end THEN RAISE EXCEPTION 'PAPER_AUTO_DECISION_OUTSIDE_WINDOW'; END IF;
 IF at>t THEN RAISE EXCEPTION 'PAPER_AUTO_DECISION_IN_FUTURE'; END IF;
 IF o IN ('TARGETS','HOLD_NO_TARGETS') THEN
  IF jsonb_typeof(sig) IS DISTINCT FROM 'object' OR (sig->>'modelVersion') IS DISTINCT FROM x.model_version
   OR (sig->>'decisionId') IS DISTINCT FROM d OR (sig->>'experimentId') IS DISTINCT FROM x.experiment_id
   OR (sig->>'version') IS DISTINCT FROM 'stock-forward-signal-v1'
   OR jsonb_typeof(sig->'targets') IS DISTINCT FROM 'array' OR jsonb_typeof(sig->'priorInputs') IS DISTINCT FROM 'object'
   OR (o='TARGETS')<>(jsonb_array_length(sig->'targets')>0)
   OR sportsedge_paper_auto._ts(jsonb_build_object('signal_decision_at',sig->'decisionAt'),'signal_decision_at')<>at THEN
   RAISE EXCEPTION 'PAPER_AUTO_DECISION_SIGNAL_MISMATCH';
  END IF;
  seen:=sportsedge_paper_auto._ts(jsonb_build_object('signal_observed_at',sig->'observedAt'),'signal_observed_at');
  IF seen<at OR seen>at+interval '60 seconds' OR seen>t THEN RAISE EXCEPTION 'PAPER_AUTO_DECISION_CAPTURE_LATE'; END IF;
 ELSIF p ? 'signal' THEN RAISE EXCEPTION 'PAPER_AUTO_DECISION_SIGNAL_MISMATCH';
 END IF;
 SELECT * INTO old FROM sportsedge_paper_auto.decisions WHERE experiment_id=r.experiment_id AND decision_session=sess;
 IF FOUND THEN
  IF old.decision_id=d AND old.outcome=o AND old.signal IS NOT DISTINCT FROM sig THEN
   RETURN jsonb_build_object('recorded',false,'duplicate',true,'decisionId',d);
  END IF;
  RAISE EXCEPTION 'PAPER_AUTO_DECISION_CONFLICT';
 END IF;
 INSERT INTO sportsedge_paper_auto.decisions(decision_id,experiment_id,decision_session,decision_at,
  outcome,model_version,scoring_report_id,input_digest,signal,diagnostics,run_id)
 VALUES(d,r.experiment_id,sess,at,o,x.model_version,
  CASE WHEN p ? 'scoring_report_id' THEN sportsedge_paper_auto._text(p,'scoring_report_id','^[a-f0-9]{64}$') END,
  CASE WHEN p ? 'input_digest' THEN sportsedge_paper_auto._text(p,'input_digest','^[a-f0-9]{64}$') END,
  sig,coalesce(p->'diagnostics','{}'::jsonb),run);
 RETURN jsonb_build_object('recorded',true,'duplicate',false,'decisionId',d,'session',sess);
END $$;

-- Positions use the planner's identity form: [{securityId,symbol,shares}].
CREATE FUNCTION public.sportsedge_paper_auto_record_snapshot(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE cap timestamptz:=sportsedge_paper_auto._ts(p,'captured_at');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; x sportsedge_paper_auto.experiments%ROWTYPE;
DECLARE sid bigint; t timestamptz:=sportsedge_paper_auto._now(); ps jsonb;
BEGIN
 r:=sportsedge_paper_auto._running(run,NULL);
 SELECT * INTO STRICT x FROM sportsedge_paper_auto.experiments WHERE experiment_id=r.experiment_id;
 IF cap>t+interval '5 seconds' OR cap<t-interval '2 minutes' THEN RAISE EXCEPTION 'PAPER_AUTO_SNAPSHOT_STALE'; END IF;
 IF sportsedge_paper_auto._text(p,'account_id','^[0-9a-f-]{36}$')<>x.broker_account_id THEN
  RAISE EXCEPTION 'PAPER_AUTO_WRONG_BROKER_ACCOUNT';
 END IF;
 IF jsonb_typeof(p->'positions')<>'array' OR jsonb_typeof(p->'open_orders')<>'array'
  OR jsonb_array_length(p->'positions')>200 OR jsonb_array_length(p->'open_orders')>500 THEN
  RAISE EXCEPTION 'PAPER_AUTO_INVALID_SNAPSHOT';
 END IF;
 FOR ps IN SELECT value FROM jsonb_array_elements(p->'positions') LOOP
  PERFORM sportsedge_paper_auto._text(ps,'securityId','^[A-Za-z0-9:._-]{1,64}$'),
   sportsedge_paper_auto._text(ps,'symbol','^[A-Z][A-Z0-9.-]{0,9}$'),
   sportsedge_paper_auto._int(ps,'shares',1,1000000000);
 END LOOP;
 IF (SELECT count(DISTINCT value->>'securityId') FROM jsonb_array_elements(p->'positions'))
   <>jsonb_array_length(p->'positions')
  OR (SELECT count(DISTINCT value->>'symbol') FROM jsonb_array_elements(p->'positions'))
   <>jsonb_array_length(p->'positions') THEN
  RAISE EXCEPTION 'PAPER_AUTO_INVALID_SNAPSHOT';
 END IF;
 INSERT INTO sportsedge_paper_auto.broker_snapshots(experiment_id,run_id,captured_at,account_id,
  equity_cents,cash_cents,settled_cash_cents,positions,open_orders,digest)
 VALUES(r.experiment_id,run,cap,x.broker_account_id,
  sportsedge_paper_auto._int(p,'equity_cents',0,100000000000),
  sportsedge_paper_auto._int(p,'cash_cents',-100000000000,100000000000),
  sportsedge_paper_auto._int(p,'settled_cash_cents',0,100000000000),
  p->'positions',p->'open_orders',sportsedge_paper_auto._text(p,'digest','^[a-f0-9]{64}$'))
 RETURNING snapshot_id INTO sid;
 RETURN jsonb_build_object('snapshotId',sid,'recordedAt',t);
END $$;

-- All-or-nothing reservation of one planner phase. Only an ARMED gate, the
-- lease holder, regular hours, a same-session decision and a fresh snapshot
-- may reserve. The frozen planner's invariants are re-checked against the
-- recorded decision inputs and snapshot: BUYs are targets within the per-name
-- budget, settled cash and gross cap; SELLs never exceed held shares; every
-- leg respects the prior 20-day volume cap. Rejected legs are never retried.
CREATE FUNCTION public.sportsedge_paper_auto_reserve_intents(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE dec text:=sportsedge_paper_auto._text(p,'decision_id','^[a-f0-9]{64}$');
DECLARE plan text:=sportsedge_paper_auto._text(p,'plan_id','^[a-f0-9]{64}$');
DECLARE snap bigint:=sportsedge_paper_auto._int(p,'snapshot_id',1,9000000000000000000);
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; g sportsedge_paper_auto.gates%ROWTYPE;
DECLARE x sportsedge_paper_auto.experiments%ROWTYPE; d sportsedge_paper_auto.decisions%ROWTYPE;
DECLARE s sportsedge_paper_auto.broker_snapshots%ROWTYPE; prev sportsedge_paper_auto.intents%ROWTYPE;
DECLARE leg jsonb; out jsonb:='[]'::jsonb; t timestamptz:=sportsedge_paper_auto._now(); today date;
DECLARE v_phase text; v_side text; v_expected text; sec text; sym text; qty bigint; lim bigint; att integer;
DECLARE iid text; cid text; total bigint:=0; exposure bigint:=0; nlegs integer:=0; held bigint; adv numeric;
DECLARE hwm bigint; n bigint;
BEGIN
 r:=sportsedge_paper_auto._lock_run(run,'execute');
 SELECT * INTO g FROM sportsedge_paper_auto.gates WHERE experiment_id=r.experiment_id;
 IF g.mode<>'ARMED' THEN RAISE EXCEPTION 'PAPER_AUTO_NOT_ARMED'; END IF;
 PERFORM sportsedge_paper_auto._require_lease(r.experiment_id,run);
 IF NOT sportsedge_paper_auto._regular_hours(t) THEN RAISE EXCEPTION 'PAPER_AUTO_OUTSIDE_REGULAR_HOURS'; END IF;
 SELECT * INTO STRICT x FROM sportsedge_paper_auto.experiments WHERE experiment_id=r.experiment_id;
 today:=sportsedge_paper_auto._ny_date(t);
 IF today<x.decision_window_start OR today>x.decision_window_end THEN RAISE EXCEPTION 'PAPER_AUTO_OUTSIDE_WINDOW'; END IF;
 PERFORM sportsedge_paper_auto._require_clear(x.experiment_id,NULL);
 SELECT * INTO d FROM sportsedge_paper_auto.decisions WHERE decision_id=dec AND experiment_id=x.experiment_id;
 IF NOT FOUND OR d.outcome NOT IN ('TARGETS','HOLD_NO_TARGETS') OR d.decision_session<>today OR d.decision_at>=t THEN
  RAISE EXCEPTION 'PAPER_AUTO_DECISION_NOT_EXECUTABLE_TODAY';
 END IF;
 SELECT * INTO s FROM sportsedge_paper_auto.broker_snapshots WHERE snapshot_id=snap;
 IF NOT FOUND OR s.experiment_id<>x.experiment_id OR s.run_id<>run OR s.captured_at<t-interval '60 seconds'
  OR s.captured_at>t+interval '2 seconds' OR s.account_id<>x.broker_account_id THEN
  RAISE EXCEPTION 'PAPER_AUTO_SNAPSHOT_NOT_FRESH';
 END IF;
 IF s.equity_cents>x.capital_limit_cents THEN RAISE EXCEPTION 'PAPER_AUTO_EQUITY_ABOVE_CAPITAL_LIMIT'; END IF;
 SELECT greatest(x.starting_equity_cents,coalesce(max(equity_cents),0)) INTO hwm
 FROM sportsedge_paper_auto.daily_equity WHERE experiment_id=x.experiment_id;
 IF s.equity_cents*10000<hwm*(10000-x.drawdown_stop_bps) THEN RAISE EXCEPTION 'PAPER_AUTO_DRAWDOWN_LIMIT'; END IF;
 IF jsonb_typeof(p->'legs')<>'array' OR jsonb_array_length(p->'legs') NOT BETWEEN 1 AND 10 THEN
  RAISE EXCEPTION 'PAPER_AUTO_INVALID_LEGS';
 END IF;
 FOR leg IN SELECT value FROM jsonb_array_elements(p->'legs') LOOP
  v_side:=sportsedge_paper_auto._text(leg,'side','^(buy|sell)$');
  v_expected:=CASE v_side WHEN 'sell' THEN 'SELL' ELSE 'BUY' END;
  IF v_phase IS NULL THEN v_phase:=v_expected;
  ELSIF v_phase<>v_expected THEN RAISE EXCEPTION 'PAPER_AUTO_MIXED_PHASE'; END IF;
  sec:=sportsedge_paper_auto._text(leg,'security_id','^[A-Za-z0-9:._-]{1,64}$');
  sym:=sportsedge_paper_auto._text(leg,'symbol','^[A-Z][A-Z0-9.-]{0,9}$');
  qty:=sportsedge_paper_auto._int(leg,'shares',1,1000000);
  lim:=sportsedge_paper_auto._int(leg,'limit_cents',1,100000000);
  IF qty*lim>x.max_order_notional_cents THEN RAISE EXCEPTION 'PAPER_AUTO_ORDER_NOTIONAL_CAP'; END IF;
  IF (d.signal->'priorInputs'->sec->>'symbol') IS DISTINCT FROM sym
   OR jsonb_typeof(d.signal->'priorInputs'->sec->'prior_adv20_shares') IS DISTINCT FROM 'number' THEN
   RAISE EXCEPTION 'PAPER_AUTO_LEG_NOT_IN_DECISION_INPUTS';
  END IF;
  adv:=(d.signal->'priorInputs'->sec->>'prior_adv20_shares')::numeric;
  IF qty>floor(adv/100) THEN RAISE EXCEPTION 'PAPER_AUTO_LIQUIDITY_CAP'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(s.positions) ps
   WHERE (ps->>'securityId'=sec)<>(ps->>'symbol'=sym)) THEN
   RAISE EXCEPTION 'PAPER_AUTO_POSITION_IDENTITY';
  END IF;
  SELECT coalesce(sum((ps->>'shares')::bigint),0) INTO held FROM jsonb_array_elements(s.positions) ps
  WHERE ps->>'securityId'=sec;
  IF v_side='buy' THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d.signal->'targets') tg
    WHERE tg->>'securityId'=sec AND tg->>'symbol'=sym) THEN
    RAISE EXCEPTION 'PAPER_AUTO_BUY_NOT_A_TARGET';
   END IF;
   IF (qty+held)*lim+x.fee_reserve_cents>s.equity_cents/10 THEN RAISE EXCEPTION 'PAPER_AUTO_NAME_CAP'; END IF;
   exposure:=exposure+(qty+held)*lim;
  ELSIF qty>held THEN RAISE EXCEPTION 'PAPER_AUTO_SELL_EXCEEDS_POSITION';
  END IF;
  total:=total+qty*lim; nlegs:=nlegs+1;
  SELECT * INTO prev FROM sportsedge_paper_auto.intents i WHERE i.experiment_id=x.experiment_id
   AND i.decision_id=dec AND i.security_id=sec AND i.side=v_side
   ORDER BY i.attempt DESC LIMIT 1;
  IF FOUND THEN
   IF prev.status='filled' THEN RAISE EXCEPTION 'PAPER_AUTO_LEG_ALREADY_FILLED'; END IF;
   IF prev.status='rejected' THEN RAISE EXCEPTION 'PAPER_AUTO_LEG_REJECTED'; END IF;
   IF prev.status NOT IN ('canceled','expired','not_submitted','confirmed_absent') THEN
    RAISE EXCEPTION 'PAPER_AUTO_PREVIOUS_ATTEMPT_UNRESOLVED';
   END IF;
   IF prev.attempt>=x.max_attempts_per_leg THEN RAISE EXCEPTION 'PAPER_AUTO_ATTEMPTS_EXHAUSTED'; END IF;
   att:=prev.attempt+1;
  ELSE att:=1; END IF;
  iid:='pai-'||left(sportsedge_paper_auto._sha(concat_ws('|','sportsedge-paper-auto-intent-v1',
   x.experiment_id,dec,sec,v_side,v_phase,att::text)),32);
  cid:='sepa'||left(sportsedge_paper_auto._sha('sportsedge-paper-auto-client-v1|'||iid),40);
  INSERT INTO sportsedge_paper_auto.intents(intent_id,experiment_id,decision_id,security_id,symbol,
   side,phase,attempt,shares,limit_cents,client_order_id,plan_id,snapshot_id,status,reserved_by_run)
  VALUES(iid,x.experiment_id,dec,sec,sym,v_side,v_phase,att,qty,lim,cid,plan,snap,'reserved',run);
  out:=out||jsonb_build_array(jsonb_build_object('intentId',iid,'clientOrderId',cid,'securityId',sec,
   'symbol',sym,'side',v_side,'phase',v_phase,'attempt',att,'shares',qty,'limitCents',lim,'lockVersion',0));
 END LOOP;
 IF v_phase='BUY' THEN
  IF total+nlegs*x.fee_reserve_cents>s.settled_cash_cents THEN RAISE EXCEPTION 'PAPER_AUTO_SETTLED_CASH'; END IF;
  IF exposure>s.equity_cents/2 THEN RAISE EXCEPTION 'PAPER_AUTO_GROSS_CAP'; END IF;
 ELSIF nlegs*x.fee_reserve_cents>s.settled_cash_cents THEN RAISE EXCEPTION 'PAPER_AUTO_SETTLED_CASH';
 END IF;
 SELECT coalesce(sum(notional_cents),0)::bigint INTO n FROM sportsedge_paper_auto.intents
 WHERE experiment_id=x.experiment_id AND status<>'not_submitted'
  AND sportsedge_paper_auto._ny_date(created_at)=today;
 IF n>x.max_daily_notional_cents THEN RAISE EXCEPTION 'PAPER_AUTO_DAILY_NOTIONAL_CAP'; END IF;
 SELECT count(*) INTO n FROM sportsedge_paper_auto.intents
 WHERE experiment_id=x.experiment_id AND status<>'not_submitted' AND sportsedge_paper_auto._ny_date(created_at)=today;
 IF n>x.max_orders_per_day THEN RAISE EXCEPTION 'PAPER_AUTO_DAILY_ORDER_CAP'; END IF;
 SELECT count(*) INTO n FROM sportsedge_paper_auto.intents WHERE experiment_id=x.experiment_id
  AND status IN ('reserved','submitting','open','partially_filled','uncertain');
 IF n>x.max_open_orders THEN RAISE EXCEPTION 'PAPER_AUTO_OPEN_ORDER_CAP'; END IF;
 RETURN jsonb_build_object('reserved',out,'phase',v_phase,'notionalCents',total);
END $$;

-- The linearization point for every broker POST: serialized with STOP on the
-- gate row, one submission in flight at a time, never after STOP commits.
CREATE FUNCTION public.sportsedge_paper_auto_claim_intent(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE iid text:=sportsedge_paper_auto._text(p,'intent_id','^pai-[a-f0-9]{32}$');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; g sportsedge_paper_auto.gates%ROWTYPE;
DECLARE i sportsedge_paper_auto.intents%ROWTYPE; t timestamptz:=sportsedge_paper_auto._now();
BEGIN
 r:=sportsedge_paper_auto._lock_run(run,'execute');
 SELECT * INTO g FROM sportsedge_paper_auto.gates WHERE experiment_id=r.experiment_id;
 IF g.mode<>'ARMED' THEN RAISE EXCEPTION 'PAPER_AUTO_NOT_ARMED'; END IF;
 PERFORM sportsedge_paper_auto._require_lease(r.experiment_id,run);
 IF NOT sportsedge_paper_auto._regular_hours(t) THEN RAISE EXCEPTION 'PAPER_AUTO_OUTSIDE_REGULAR_HOURS'; END IF;
 SELECT * INTO i FROM sportsedge_paper_auto.intents WHERE intent_id=iid AND experiment_id=r.experiment_id FOR UPDATE;
 IF NOT FOUND OR i.status<>'reserved' OR i.lock_version<>0 OR i.reserved_by_run<>run THEN
  RAISE EXCEPTION 'PAPER_AUTO_CLAIM_DENIED';
 END IF;
 IF i.created_at<t-interval '5 minutes' THEN RAISE EXCEPTION 'PAPER_AUTO_RESERVATION_EXPIRED'; END IF;
 PERFORM sportsedge_paper_auto._require_clear(r.experiment_id,iid);
 UPDATE sportsedge_paper_auto.intents SET status='submitting',lock_version=1,updated_at=t
 WHERE intent_id=iid RETURNING * INTO i;
 PERFORM sportsedge_paper_auto._event(i,'reserved','run:'||run,'{}'::jsonb);
 RETURN jsonb_build_object('intentId',i.intent_id,'clientOrderId',i.client_order_id,
  'symbol',i.symbol,'side',i.side,'shares',i.shares,'limitCents',i.limit_cents,
  'lockVersion',i.lock_version,'claimedAt',t);
END $$;

-- Broker-observed transitions only; unknown POST outcomes become 'uncertain'
-- and are never retried. An uncertain intent leaves only through a broker
-- observation of its client order id or explicit owner-confirmed absence. An
-- explicit 400/401/403/422 refusal of the POST itself ends the leg as rejected
-- without a broker order; a duplicate-client-id refusal is never a rejection.
CREATE FUNCTION public.sportsedge_paper_auto_record_order(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE iid text:=sportsedge_paper_auto._text(p,'intent_id','^pai-[a-f0-9]{32}$');
DECLARE expected integer:=sportsedge_paper_auto._int(p,'expected_version',0,1000000)::integer;
DECLARE nxt text:=sportsedge_paper_auto._text(p,'next_status',
 '^(open|partially_filled|filled|canceled|expired|rejected|uncertain|not_submitted)$');
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; who text; detail jsonb:=coalesce(p->'detail','{}'::jsonb);
DECLARE i sportsedge_paper_auto.intents%ROWTYPE; old text; t timestamptz:=sportsedge_paper_auto._now();
DECLARE bid text; bst text; fq numeric; fp numeric; hs bigint; legal boolean;
BEGIN
 r:=sportsedge_paper_auto._running(run,NULL);
 IF r.kind NOT IN ('execute','reconcile','monitor') THEN RAISE EXCEPTION 'PAPER_AUTO_RUN_KIND'; END IF;
 IF jsonb_typeof(detail)<>'object' THEN RAISE EXCEPTION 'PAPER_AUTO_INVALID_DETAIL'; END IF;
 who:='run:'||run;
 SELECT * INTO i FROM sportsedge_paper_auto.intents WHERE intent_id=iid FOR UPDATE;
 IF NOT FOUND OR i.experiment_id<>r.experiment_id OR i.lock_version<>expected THEN
  RAISE EXCEPTION 'PAPER_AUTO_INTENT_VERSION_CONFLICT';
 END IF;
 old:=i.status;
 legal:=(old='reserved' AND nxt='not_submitted') OR
  (old='submitting' AND nxt IN ('open','partially_filled','filled','canceled','expired','rejected','uncertain')) OR
  (old='uncertain' AND nxt IN ('open','partially_filled','filled','canceled','expired','rejected')) OR
  (old='open' AND nxt IN ('open','partially_filled','filled','canceled','expired','rejected')) OR
  (old='partially_filled' AND nxt IN ('partially_filled','filled','canceled','expired'));
 IF NOT legal AND nxt<>old THEN RAISE EXCEPTION 'PAPER_AUTO_ILLEGAL_TRANSITION_%_TO_%',upper(old),upper(nxt); END IF;
 IF nxt IN ('uncertain','not_submitted') THEN
  IF p ? 'broker_order_id' OR p ? 'filled_qty' OR p ? 'rejection' THEN
   RAISE EXCEPTION 'PAPER_AUTO_UNCERTAIN_WITH_BROKER_DATA';
  END IF;
  bid:=i.broker_order_id; bst:=i.broker_status; fq:=i.filled_qty; fp:=i.filled_avg_price;
 ELSIF nxt='rejected' AND p ? 'rejection' THEN
  IF old<>'submitting' OR p ? 'broker_order_id' OR p ? 'filled_qty' OR jsonb_typeof(p->'rejection')<>'object' THEN
   RAISE EXCEPTION 'PAPER_AUTO_REJECTION_EVIDENCE_INVALID';
  END IF;
  hs:=sportsedge_paper_auto._int(p->'rejection','http_status',100,599);
  IF hs NOT IN (400,401,403,422) THEN RAISE EXCEPTION 'PAPER_AUTO_REJECTION_NOT_DEFINITIVE'; END IF;
  IF (p->'rejection'->>'code') IS NOT DISTINCT FROM '40010001' THEN
   RAISE EXCEPTION 'PAPER_AUTO_DUPLICATE_CLIENT_ID_REQUIRES_LOOKUP';
  END IF;
  bid:=NULL; bst:='api_rejected'; fq:=0; fp:=NULL;
  detail:=detail||jsonb_build_object('rejection',p->'rejection');
 ELSE
  bid:=sportsedge_paper_auto._text(p,'broker_order_id','^[A-Za-z0-9-]{1,128}$');
  bst:=sportsedge_paper_auto._text(p,'broker_status','^[a-z_]{2,40}$');
  fq:=sportsedge_paper_auto._qty(p,'filled_qty');
  fp:=CASE WHEN p ? 'filled_avg_price' AND p->>'filled_avg_price' IS NOT NULL
   THEN sportsedge_paper_auto._text(p,'filled_avg_price','^[0-9]{1,10}(\.[0-9]{1,6})?$')::numeric END;
  IF i.broker_order_id IS NOT NULL AND bid<>i.broker_order_id THEN RAISE EXCEPTION 'PAPER_AUTO_BROKER_ID_MISMATCH'; END IF;
  IF fq<i.filled_qty OR fq>i.shares THEN RAISE EXCEPTION 'PAPER_AUTO_FILL_QUANTITY_INVALID'; END IF;
  IF nxt='filled' AND fq<>i.shares THEN RAISE EXCEPTION 'PAPER_AUTO_FILL_QUANTITY_INVALID'; END IF;
  IF nxt='partially_filled' AND (fq<=0 OR fq>=i.shares) THEN RAISE EXCEPTION 'PAPER_AUTO_FILL_QUANTITY_INVALID'; END IF;
  IF nxt='rejected' AND fq<>0 THEN RAISE EXCEPTION 'PAPER_AUTO_FILL_QUANTITY_INVALID'; END IF;
  IF nxt='open' AND fq<>0 THEN RAISE EXCEPTION 'PAPER_AUTO_FILL_QUANTITY_INVALID'; END IF;
  IF fq>0 AND fp IS NULL THEN RAISE EXCEPTION 'PAPER_AUTO_FILL_PRICE_REQUIRED'; END IF;
 END IF;
 -- Re-observing the same broker state is a no-op, including for terminal states.
 IF nxt=old AND bst IS NOT DISTINCT FROM i.broker_status AND fq=i.filled_qty
  AND bid IS NOT DISTINCT FROM i.broker_order_id AND fp IS NOT DISTINCT FROM i.filled_avg_price THEN
  RETURN jsonb_build_object('intentId',iid,'status',old,'lockVersion',i.lock_version,'changed',false);
 END IF;
 IF NOT legal THEN RAISE EXCEPTION 'PAPER_AUTO_ILLEGAL_TRANSITION_%_TO_%',upper(old),upper(nxt); END IF;
 UPDATE sportsedge_paper_auto.intents SET status=nxt,lock_version=lock_version+1,
  broker_order_id=bid,broker_status=bst,filled_qty=fq,filled_avg_price=fp,updated_at=t
 WHERE intent_id=iid RETURNING * INTO i;
 PERFORM sportsedge_paper_auto._event(i,old,who,detail);
 RETURN jsonb_build_object('intentId',iid,'status',i.status,'lockVersion',i.lock_version,'changed',true);
END $$;

-- Owner-only resolution of an uncertain POST after the session is over: the DAY
-- order can no longer exist unseen, and two independent broker reads found nothing.
CREATE FUNCTION public.sportsedge_paper_auto_confirm_absent(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE iid text:=sportsedge_paper_auto._text(p,'intent_id','^pai-[a-f0-9]{32}$');
DECLARE owner text:=sportsedge_paper_auto._text(p,'owner_ref','^owner-[a-f0-9]{32}$');
DECLARE lookup timestamptz:=sportsedge_paper_auto._ts(p,'client_id_lookup_not_found_at');
DECLARE history timestamptz:=sportsedge_paper_auto._ts(p,'complete_history_checked_at');
DECLARE i sportsedge_paper_auto.intents%ROWTYPE; t timestamptz:=sportsedge_paper_auto._now(); day date;
BEGIN
 SELECT * INTO i FROM sportsedge_paper_auto.intents WHERE intent_id=iid FOR UPDATE;
 IF NOT FOUND OR i.status<>'uncertain' THEN RAISE EXCEPTION 'PAPER_AUTO_NOT_UNCERTAIN'; END IF;
 IF (p->>'history_complete') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'PAPER_AUTO_HISTORY_INCOMPLETE'; END IF;
 day:=sportsedge_paper_auto._ny_date(i.updated_at);
 IF NOT sportsedge_paper_auto._after_close(t,day) THEN RAISE EXCEPTION 'PAPER_AUTO_SESSION_NOT_CLOSED'; END IF;
 IF lookup<=i.updated_at OR history<=i.updated_at OR lookup>t OR history>t
  OR NOT sportsedge_paper_auto._after_close(lookup,day) OR NOT sportsedge_paper_auto._after_close(history,day) THEN
  RAISE EXCEPTION 'PAPER_AUTO_ABSENCE_EVIDENCE_INVALID';
 END IF;
 UPDATE sportsedge_paper_auto.intents SET status='confirmed_absent',lock_version=lock_version+1,updated_at=t
 WHERE intent_id=iid RETURNING * INTO i;
 PERFORM sportsedge_paper_auto._event(i,'uncertain',owner,jsonb_build_object(
  'clientIdLookupNotFoundAt',lookup,'completeHistoryCheckedAt',history));
 RETURN jsonb_build_object('intentId',iid,'status',i.status,'lockVersion',i.lock_version);
END $$;

-- Broker activities are attributed by broker order id: a FILL of a recorded
-- intent is a strategy fill and anything else is external. While a submission
-- outcome is unknown, unattributable fills are refused rather than guessed.
CREATE FUNCTION public.sportsedge_paper_auto_record_activities(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; a jsonb; inserted integer:=0; ext integer:=0;
DECLARE k text; typ text; aid text; oid text; ours boolean; dig text;
DECLARE old sportsedge_paper_auto.activities%ROWTYPE;
BEGIN
 r:=sportsedge_paper_auto._running(run,NULL);
 IF jsonb_typeof(p->'activities')<>'array' OR jsonb_array_length(p->'activities')>1000 THEN
  RAISE EXCEPTION 'PAPER_AUTO_INVALID_ACTIVITIES';
 END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(p->'activities') LOOP
  aid:=sportsedge_paper_auto._text(a,'activity_id','^[A-Za-z0-9:._-]{8,128}$');
  typ:=sportsedge_paper_auto._text(a,'activity_type','^[A-Z]{2,8}$');
  k:=sportsedge_paper_auto._text(a,'classification',
   '^(strategy_fill|external_fill|external_cashflow|dividend|fee|corporate_action|other)$');
  oid:=CASE WHEN a ? 'order_id' THEN sportsedge_paper_auto._text(a,'order_id','^[A-Za-z0-9-]{1,128}$') END;
  dig:=sportsedge_paper_auto._text(a,'raw_digest','^[a-f0-9]{64}$');
  ours:=oid IS NOT NULL AND EXISTS(SELECT 1 FROM sportsedge_paper_auto.intents
   WHERE experiment_id=r.experiment_id AND broker_order_id=oid);
  IF typ='FILL' AND NOT ours AND EXISTS(SELECT 1 FROM sportsedge_paper_auto.intents
   WHERE experiment_id=r.experiment_id AND status IN ('submitting','uncertain')) THEN
   RAISE EXCEPTION 'PAPER_AUTO_FILL_ATTRIBUTION_PENDING';
  END IF;
  IF (typ='FILL')<>(k IN ('strategy_fill','external_fill')) OR (k='strategy_fill')<>(typ='FILL' AND ours) THEN
   RAISE EXCEPTION 'PAPER_AUTO_ACTIVITY_MISCLASSIFIED';
  END IF;
  INSERT INTO sportsedge_paper_auto.activities(activity_id,experiment_id,activity_type,activity_at,
   symbol,side,qty,price,net_amount_cents,order_id,classification,raw_digest,run_id)
  VALUES(aid,r.experiment_id,typ,sportsedge_paper_auto._ts(a,'activity_at'),
   CASE WHEN a ? 'symbol' THEN sportsedge_paper_auto._text(a,'symbol','^[A-Z][A-Z0-9.-]{0,15}$') END,
   CASE WHEN a ? 'side' THEN sportsedge_paper_auto._text(a,'side','^(buy|sell)$') END,
   CASE WHEN a ? 'qty' THEN sportsedge_paper_auto._qty(a,'qty') END,
   CASE WHEN a ? 'price' THEN sportsedge_paper_auto._text(a,'price','^[0-9]{1,10}(\.[0-9]{1,6})?$')::numeric END,
   CASE WHEN a ? 'net_amount_cents' THEN sportsedge_paper_auto._int(a,'net_amount_cents',-100000000000,100000000000) END,
   oid,k,dig,run)
  ON CONFLICT(activity_id) DO NOTHING;
  IF FOUND THEN
   inserted:=inserted+1;
   IF k IN ('external_fill','external_cashflow','corporate_action','other') THEN ext:=ext+1; END IF;
  ELSE
   SELECT * INTO old FROM sportsedge_paper_auto.activities WHERE activity_id=aid;
   IF old.experiment_id<>r.experiment_id OR old.raw_digest<>dig OR old.classification<>k THEN
    RAISE EXCEPTION 'PAPER_AUTO_ACTIVITY_CONFLICT';
   END IF;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('inserted',inserted,'newExternalOrUnsupported',ext);
END $$;

-- One immutable after-close mark per session, observed that evening and recorded at
-- once, so a mark is never backdated or relabeled. Flows, fees and dividends come
-- from activities recorded since the previous mark. Any external fill, external
-- cash flow, corporate action or unsupported activity on or before the session
-- contaminates the series from then on. Cash must equal the flat starting equity
-- plus every recorded activity; an unexplained difference leaves the mark
-- unreconciled (an unreported balance change can never pass as strategy return).
CREATE FUNCTION public.sportsedge_paper_auto_record_daily(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; x sportsedge_paper_auto.experiments%ROWTYPE; d date;
DECLARE old sportsedge_paper_auto.daily_equity%ROWTYPE; row_in sportsedge_paper_auto.daily_equity%ROWTYPE;
DECLARE t timestamptz:=sportsedge_paper_auto._now(); since timestamptz; expected numeric; rounding bigint;
BEGIN
 r:=sportsedge_paper_auto._running(run,'monitor');
 SELECT * INTO STRICT x FROM sportsedge_paper_auto.experiments WHERE experiment_id=r.experiment_id;
 d:=sportsedge_paper_auto._text(p,'session_date','^[0-9]{4}-[0-9]{2}-[0-9]{2}$')::date;
 row_in.captured_at:=sportsedge_paper_auto._ts(p,'captured_at');
 IF sportsedge_paper_auto._ny_date(row_in.captured_at)=d AND NOT sportsedge_paper_auto._after_close(row_in.captured_at,d) THEN
  RAISE EXCEPTION 'PAPER_AUTO_DAILY_NOT_AFTER_CLOSE';
 END IF;
 IF sportsedge_paper_auto._ny_date(row_in.captured_at)<>d OR row_in.captured_at<t-interval '15 minutes'
  OR row_in.captured_at>t+interval '5 seconds' OR row_in.captured_at<x.registered_at THEN
  RAISE EXCEPTION 'PAPER_AUTO_DAILY_CAPTURE_NOT_FRESH';
 END IF;
 row_in.equity_cents:=sportsedge_paper_auto._int(p,'equity_cents',0,100000000000);
 row_in.cash_cents:=sportsedge_paper_auto._int(p,'cash_cents',-100000000000,100000000000);
 row_in.long_market_value_cents:=sportsedge_paper_auto._int(p,'long_market_value_cents',0,100000000000);
 IF jsonb_typeof(p->'positions')<>'array' OR jsonb_typeof(p->'contaminated')<>'boolean' THEN
  RAISE EXCEPTION 'PAPER_AUTO_INVALID_DAILY';
 END IF;
 SELECT coalesce(max(captured_at),x.registered_at) INTO since FROM sportsedge_paper_auto.daily_equity
 WHERE experiment_id=x.experiment_id AND session_date<d;
 SELECT coalesce(sum(net_amount_cents) FILTER (WHERE classification='external_cashflow'),0),
  greatest(0,coalesce(-sum(net_amount_cents) FILTER (WHERE classification='fee'),0)),
  greatest(0,coalesce(sum(net_amount_cents) FILTER (WHERE classification='dividend'),0))
 INTO row_in.external_flow_cents,row_in.fees_cents,row_in.dividends_cents
 FROM sportsedge_paper_auto.activities
 WHERE experiment_id=x.experiment_id AND activity_at>since AND activity_at<=row_in.captured_at;
 row_in.contaminated:=(p->>'contaminated')::boolean OR EXISTS(SELECT 1 FROM sportsedge_paper_auto.activities
  WHERE experiment_id=x.experiment_id
   AND classification IN ('external_fill','external_cashflow','corporate_action','other')
   AND sportsedge_paper_auto._ny_date(activity_at)<=d);
 -- Registration requires a flat account, so cash starts at the starting equity. A fill
 -- moves cash by quantity x price (each fractional-cent notional may round by a cent);
 -- every other activity by its net amount. A missing amount stays unexplained.
 SELECT x.starting_equity_cents+coalesce(sum(CASE
   WHEN classification IN ('strategy_fill','external_fill') THEN
    CASE side WHEN 'sell' THEN qty*price*100 WHEN 'buy' THEN -qty*price*100 END
   ELSE net_amount_cents END),0),
  count(*) FILTER (WHERE classification IN ('strategy_fill','external_fill') AND qty*price*100<>trunc(qty*price*100))
 INTO expected,rounding
 FROM sportsedge_paper_auto.activities WHERE experiment_id=x.experiment_id AND activity_at<=row_in.captured_at;
 row_in.cash_unexplained_cents:=round(row_in.cash_cents-expected,6);
 row_in.cash_reconciled:=abs(row_in.cash_unexplained_cents)<=rounding;
 -- Unrealized P&L from the broker's per-position cost basis; unknown if any position lacks it.
 SELECT CASE WHEN count(*)=0 THEN 0
  -- A missing key is SQL NULL, which bool_and would skip: count it as a missing cost basis.
  WHEN bool_and(coalesce(jsonb_typeof(ps->'marketValueCents')='number' AND jsonb_typeof(ps->'costBasisCents')='number',false))
  THEN round(sum(CASE WHEN jsonb_typeof(ps->'marketValueCents')='number' AND jsonb_typeof(ps->'costBasisCents')='number'
   THEN (ps->>'marketValueCents')::numeric-(ps->>'costBasisCents')::numeric END))::bigint END
 INTO row_in.unrealized_pl_cents FROM jsonb_array_elements(p->'positions') ps;
 SELECT * INTO old FROM sportsedge_paper_auto.daily_equity WHERE experiment_id=x.experiment_id AND session_date=d;
 IF FOUND THEN
  IF old.equity_cents=row_in.equity_cents AND old.cash_cents=row_in.cash_cents
   AND old.long_market_value_cents=row_in.long_market_value_cents
   AND old.external_flow_cents=row_in.external_flow_cents AND old.contaminated=row_in.contaminated
   AND old.cash_unexplained_cents=row_in.cash_unexplained_cents AND old.cash_reconciled=row_in.cash_reconciled
   AND old.unrealized_pl_cents IS NOT DISTINCT FROM row_in.unrealized_pl_cents THEN
   RETURN jsonb_build_object('recorded',false,'duplicate',true,'sessionDate',d);
  END IF;
  RAISE EXCEPTION 'PAPER_AUTO_DAILY_CONFLICT';
 END IF;
 INSERT INTO sportsedge_paper_auto.daily_equity(experiment_id,session_date,captured_at,equity_cents,cash_cents,
  long_market_value_cents,external_flow_cents,fees_cents,dividends_cents,positions,benchmark_symbol,
  benchmark_close,benchmark_source,contaminated,cash_unexplained_cents,cash_reconciled,unrealized_pl_cents,run_id)
 VALUES(x.experiment_id,d,row_in.captured_at,row_in.equity_cents,row_in.cash_cents,row_in.long_market_value_cents,
  row_in.external_flow_cents,row_in.fees_cents,row_in.dividends_cents,p->'positions',
  sportsedge_paper_auto._text(p,'benchmark_symbol','^[A-Z]{1,5}$'),
  CASE WHEN p->>'benchmark_close' IS NULL THEN NULL
   ELSE sportsedge_paper_auto._text(p,'benchmark_close','^[0-9]{1,10}(\.[0-9]{1,6})?$')::numeric END,
  sportsedge_paper_auto._text(p,'benchmark_source','^[A-Za-z0-9 :/._=-]{3,160}$'),
  row_in.contaminated,row_in.cash_unexplained_cents,row_in.cash_reconciled,row_in.unrealized_pl_cents,run);
 RETURN jsonb_build_object('recorded',true,'duplicate',false,'sessionDate',d,
  'externalFlowCents',row_in.external_flow_cents,'feesCents',row_in.fees_cents,
  'dividendsCents',row_in.dividends_cents,'contaminated',row_in.contaminated,
  'cashUnexplainedCents',trim_scale(row_in.cash_unexplained_cents)::text,'cashReconciled',row_in.cash_reconciled,
  'unrealizedPlCents',row_in.unrealized_pl_cents);
END $$;

CREATE FUNCTION public.sportsedge_paper_auto_raise_alert(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; id bigint;
BEGIN
 SELECT * INTO r FROM sportsedge_paper_auto.runs WHERE run_id=run;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAPER_AUTO_RUN_NOT_ACTIVE'; END IF;
 IF length(coalesce(p->'detail','{}'::jsonb)::text)>8000 THEN RAISE EXCEPTION 'PAPER_AUTO_DETAIL_TOO_LARGE'; END IF;
 INSERT INTO sportsedge_paper_auto.alerts(experiment_id,severity,code,detail,run_id)
 VALUES(r.experiment_id,sportsedge_paper_auto._text(p,'severity','^(info|warning|critical)$'),
  sportsedge_paper_auto._text(p,'code','^[A-Z0-9_]{3,64}$'),coalesce(p->'detail','{}'::jsonb),run)
 RETURNING alert_id INTO id;
 RETURN jsonb_build_object('alertId',id);
END $$;

-- Read model for the owner dashboard. Contains no credentials or full account id.
CREATE FUNCTION public.sportsedge_paper_auto_ledger(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e text:=sportsedge_paper_auto._text(p,'experiment_id','^[a-z0-9][a-z0-9-]{2,62}$');
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sportsedge_paper_auto.experiments WHERE experiment_id=e) THEN
  RETURN jsonb_build_object('experimentId',e,'state','NOT_REGISTERED');
 END IF;
 RETURN jsonb_build_object(
  'status',sportsedge_paper_auto._status(e),
  'experiment',(SELECT jsonb_build_object('registeredAt',registered_at,'startingEquityCents',starting_equity_cents,
    'brokerAccountNumberSuffix',right(broker_account_number,4),'configDigest',config_digest)
   FROM sportsedge_paper_auto.experiments WHERE experiment_id=e),
  'decisions',coalesce((SELECT jsonb_agg(jsonb_build_object('decisionId',decision_id,'session',decision_session,
    'decisionAt',decision_at,'outcome',outcome,'targets',coalesce(signal->'targets','[]'::jsonb),
    'diagnostics',diagnostics,'recordedAt',recorded_at) ORDER BY decision_session DESC)
   FROM (SELECT * FROM sportsedge_paper_auto.decisions WHERE experiment_id=e
    ORDER BY decision_session DESC LIMIT 36) d),'[]'::jsonb),
  'intents',coalesce((SELECT jsonb_agg(jsonb_build_object('intentId',intent_id,'decisionId',decision_id,
    'symbol',symbol,'side',side,'phase',phase,'attempt',attempt,'shares',shares,'limitCents',limit_cents,
    'status',status,'brokerStatus',broker_status,'filledQty',filled_qty::text,'filledAvgPrice',filled_avg_price::text,
    'createdAt',created_at,'updatedAt',updated_at) ORDER BY created_at DESC)
   FROM (SELECT * FROM sportsedge_paper_auto.intents WHERE experiment_id=e
    ORDER BY created_at DESC LIMIT 200) i),'[]'::jsonb),
  'daily',coalesce((SELECT jsonb_agg(jsonb_build_object('session',session_date,'capturedAt',captured_at,
    'equityCents',equity_cents,'cashCents',cash_cents,'longMarketValueCents',long_market_value_cents,
    'externalFlowCents',external_flow_cents,'feesCents',fees_cents,'dividendsCents',dividends_cents,
    'benchmarkSymbol',benchmark_symbol,'benchmarkClose',benchmark_close::text,'benchmarkSource',benchmark_source,
    'contaminated',contaminated,'cashUnexplainedCents',trim_scale(cash_unexplained_cents)::text,
    'cashReconciled',cash_reconciled,'unrealizedPlCents',unrealized_pl_cents) ORDER BY session_date)
   FROM sportsedge_paper_auto.daily_equity WHERE experiment_id=e),'[]'::jsonb),
  'alerts',coalesce((SELECT jsonb_agg(jsonb_build_object('alertId',alert_id,'severity',severity,'code',code,
    'createdAt',created_at,'acknowledgedAt',acknowledged_at) ORDER BY created_at DESC)
   FROM (SELECT * FROM sportsedge_paper_auto.alerts WHERE experiment_id=e
    ORDER BY created_at DESC LIMIT 50) a),'[]'::jsonb),
  'runs',coalesce((SELECT jsonb_agg(jsonb_build_object('runId',run_id,'kind',kind,'slot',slot,
    'attempt',attempt,'status',status,'startedAt',started_at,'finishedAt',finished_at,
    'summary',result->'summary') ORDER BY started_at DESC)
   FROM (SELECT * FROM sportsedge_paper_auto.runs WHERE experiment_id=e
    ORDER BY started_at DESC LIMIT 60) r),'[]'::jsonb),
  'gateEvents',coalesce((SELECT jsonb_agg(jsonb_build_object('fromMode',from_mode,'toMode',to_mode,
    'reason',reason,'actor',CASE WHEN actor LIKE 'owner-%' THEN 'owner' ELSE actor END,'at',at)
    ORDER BY event_id DESC)
   FROM (SELECT * FROM sportsedge_paper_auto.gate_events WHERE experiment_id=e
    ORDER BY event_id DESC LIMIT 50) ge),'[]'::jsonb),
  'activityCounts',coalesce((SELECT jsonb_object_agg(classification,n) FROM (SELECT classification,count(*) n
    FROM sportsedge_paper_auto.activities WHERE experiment_id=e GROUP BY classification) c),'{}'::jsonb));
END $$;

-- Read model for the server-side worker only (it holds the broker account id).
CREATE FUNCTION public.sportsedge_paper_auto_worker_state(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e text:=sportsedge_paper_auto._text(p,'experiment_id','^[a-z0-9][a-z0-9-]{2,62}$');
DECLARE x sportsedge_paper_auto.experiments%ROWTYPE; d sportsedge_paper_auto.decisions%ROWTYPE;
BEGIN
 SELECT * INTO x FROM sportsedge_paper_auto.experiments WHERE experiment_id=e;
 IF NOT FOUND THEN RETURN jsonb_build_object('experimentId',e,'state','NOT_REGISTERED'); END IF;
 SELECT * INTO d FROM sportsedge_paper_auto.decisions WHERE experiment_id=e
 ORDER BY decision_session DESC LIMIT 1;
 RETURN jsonb_build_object(
  'status',sportsedge_paper_auto._status(e),
  'experiment',jsonb_build_object('experimentId',x.experiment_id,'modelVersion',x.model_version,
   'brokerAccountId',x.broker_account_id,'brokerAccountNumber',x.broker_account_number,
   'registeredAt',x.registered_at,
   'startingEquityCents',x.starting_equity_cents,'capitalLimitCents',x.capital_limit_cents,
   'decisionWindowStart',x.decision_window_start,'decisionWindowEnd',x.decision_window_end,
   'maxOrderNotionalCents',x.max_order_notional_cents,'maxDailyNotionalCents',x.max_daily_notional_cents,
   'maxOrdersPerDay',x.max_orders_per_day,'maxOpenOrders',x.max_open_orders,
   'maxAttemptsPerLeg',x.max_attempts_per_leg,'drawdownStopBps',x.drawdown_stop_bps,
   'feeReserveCents',x.fee_reserve_cents,'configDigest',x.config_digest),
  -- Compact signal: full universe members and prior inputs stay in the stored row
  -- (reserve_intents reads them there); the worker needs only targets and holdings.
  'latestDecision',CASE WHEN d.decision_id IS NULL THEN NULL ELSE jsonb_build_object(
   'decisionId',d.decision_id,'session',d.decision_session,'decisionAt',d.decision_at,
   'outcome',d.outcome,'signal',CASE WHEN d.signal IS NULL THEN NULL ELSE
    (d.signal-'members'-'priorInputs')||jsonb_build_object('priorInputs',coalesce((
     SELECT jsonb_object_agg(pi.key,pi.value) FROM jsonb_each(d.signal->'priorInputs') pi
     WHERE pi.key IN (SELECT t->>'securityId' FROM jsonb_array_elements(d.signal->'targets') t)
      OR pi.key IN (SELECT jsonb_array_elements_text(coalesce(d.signal->'heldSecurityIds','[]'::jsonb)))
      OR pi.key IN (SELECT security_id FROM sportsedge_paper_auto.intents WHERE experiment_id=e
       GROUP BY security_id HAVING sum(CASE side WHEN 'buy' THEN filled_qty ELSE -filled_qty END)<>0)),
     '{}'::jsonb)) END) END,
  'intents',coalesce((SELECT jsonb_agg(jsonb_build_object('intentId',intent_id,'decisionId',decision_id,
    'securityId',security_id,'symbol',symbol,'side',side,'phase',phase,'attempt',attempt,
    'shares',shares,'limitCents',limit_cents,'clientOrderId',client_order_id,'status',status,
    'brokerOrderId',broker_order_id,'brokerStatus',broker_status,'filledQty',filled_qty::text,
    'filledAvgPrice',filled_avg_price::text,'lockVersion',lock_version,'createdAt',created_at,
    'updatedAt',updated_at) ORDER BY created_at,intent_id)
   FROM sportsedge_paper_auto.intents WHERE experiment_id=e
    AND (status IN ('reserved','submitting','open','partially_filled','uncertain')
     OR decision_id=d.decision_id)),'[]'::jsonb),
  'filledBySecurity',coalesce((SELECT jsonb_agg(jsonb_build_object('securityId',security_id,'symbol',symbol,
    'netShares',net::text) ORDER BY security_id)
   FROM (SELECT security_id,symbol,sum(CASE side WHEN 'buy' THEN filled_qty ELSE -filled_qty END) net
    FROM sportsedge_paper_auto.intents WHERE experiment_id=e GROUP BY security_id,symbol) f
   WHERE net<>0),'[]'::jsonb),
  'brokerOrderIds',coalesce((SELECT jsonb_agg(broker_order_id ORDER BY broker_order_id)
   FROM sportsedge_paper_auto.intents WHERE experiment_id=e AND broker_order_id IS NOT NULL),'[]'::jsonb),
  'equityHighWaterCents',(SELECT greatest(x.starting_equity_cents,max(equity_cents))
   FROM sportsedge_paper_auto.daily_equity WHERE experiment_id=e),
  'lastDaily',(SELECT jsonb_build_object('session',session_date,'equityCents',equity_cents,'capturedAt',captured_at)
   FROM sportsedge_paper_auto.daily_equity WHERE experiment_id=e ORDER BY session_date DESC LIMIT 1),
  'activityCursor',(SELECT jsonb_build_object('activityId',activity_id,'activityAt',activity_at)
   FROM sportsedge_paper_auto.activities WHERE experiment_id=e ORDER BY activity_at DESC,activity_id DESC LIMIT 1),
  'knownActivityIds',coalesce((SELECT jsonb_agg(activity_id) FROM (SELECT activity_id FROM sportsedge_paper_auto.activities
   WHERE experiment_id=e ORDER BY activity_at DESC LIMIT 500) k),'[]'::jsonb));
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sportsedge_paper_auto FROM PUBLIC, anon, authenticated, service_role;
DO $$
DECLARE f text;
BEGIN
 FOREACH f IN ARRAY ARRAY['register','status','stop','pause','resume','ack_alert','begin_run',
  'heartbeat','acquire_lease','finish_run','record_decision','record_snapshot','reserve_intents',
  'claim_intent','record_order','confirm_absent','record_activities','record_daily','raise_alert','ledger',
  'worker_state'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(jsonb) FROM PUBLIC, anon, authenticated',
   'sportsedge_paper_auto_'||f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(jsonb) TO service_role','sportsedge_paper_auto_'||f);
 END LOOP;
END $$;
COMMIT;
