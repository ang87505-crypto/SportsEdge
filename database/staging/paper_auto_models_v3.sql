-- Upgrade an installed recurring PAPER schema to accept the steady-stocks model
-- `stock-lowvol252-trend200-v1` (analytics/stock_lowvol_weekly_v1.py) for a separately
-- registered experiment on its own PAPER account. Idempotent. Only the model allowlist
-- changes: no table data, gates, limits, grants, policies, broker calls or schedules.
-- CREATE OR REPLACE keeps the function's owner and its EXECUTE grant (service_role only).
-- Use paper_auto_v1.sql instead for a fresh installation; it already includes this.
BEGIN;
ALTER TABLE sportsedge_paper_auto.experiments DROP CONSTRAINT IF EXISTS experiments_model_version_check;
ALTER TABLE sportsedge_paper_auto.experiments ADD CONSTRAINT experiments_model_version_check CHECK(model_version IN (
  'stock-mom252-skip21-trend200-v1','stock-mom252-skip21-trend200-holdrank10-v1',
  'stock-lowvol252-trend200-v1'));

-- Identical to the function in paper_auto_v1.sql (a test compares them).
CREATE OR REPLACE FUNCTION public.sportsedge_paper_auto_register(p jsonb) RETURNS jsonb
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
  'model_version',sportsedge_paper_auto._text(p,'model_version','^(stock-mom252-skip21-trend200-(v1|holdrank10-v1)|stock-lowvol252-trend200-v1)$'),
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
COMMIT;
