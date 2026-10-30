-- Upgrade an installed recurring PAPER v1 schema with atomic daily risk halts.
-- Idempotent; no broker calls, order release, schedules or account/config changes.
-- Use paper_auto_v1.sql instead for a fresh installation.
BEGIN;
CREATE OR REPLACE FUNCTION sportsedge_paper_auto._risk_reason(equity bigint,hwm bigint,capital bigint,bps integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN equity>capital THEN 'CAPITAL_LIMIT_REACHED'
  WHEN equity::numeric*10000<hwm::numeric*(10000-bps) THEN 'DRAWDOWN_LIMIT' END
$$;
CREATE OR REPLACE FUNCTION sportsedge_paper_auto._halt_for_risk(e text,equity bigint,who text,evidence jsonb)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE x sportsedge_paper_auto.experiments%ROWTYPE; hwm bigint; reason text;
BEGIN
 SELECT * INTO STRICT x FROM sportsedge_paper_auto.experiments WHERE experiment_id=e;
 SELECT greatest(x.starting_equity_cents,coalesce(max(equity_cents),0)) INTO hwm
 FROM sportsedge_paper_auto.daily_equity WHERE experiment_id=e;
 reason:=sportsedge_paper_auto._risk_reason(equity,hwm,x.capital_limit_cents,x.drawdown_stop_bps);
 IF reason IS NOT NULL THEN
  PERFORM sportsedge_paper_auto._halt(e,reason,who,
   evidence||jsonb_build_object('equityCents',equity,'highWaterCents',hwm));
 END IF;
 RETURN reason;
END $$;

-- One immutable after-close mark per session, observed that evening and recorded at
-- once, so a mark is never backdated or relabeled. Flows, fees and dividends come
-- from activities recorded since the previous mark. Any external fill, external
-- cash flow, corporate action or unsupported activity on or before the session
-- contaminates the series from then on. Cash must equal the flat starting equity
-- plus every recorded activity; an unexplained difference leaves the mark
-- unreconciled (an unreported balance change can never pass as strategy return).
CREATE OR REPLACE FUNCTION public.sportsedge_paper_auto_record_daily(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run text:=sportsedge_paper_auto._text(p,'run_id','^run-[a-f0-9]{32}$');
DECLARE r sportsedge_paper_auto.runs%ROWTYPE; x sportsedge_paper_auto.experiments%ROWTYPE; d date;
DECLARE old sportsedge_paper_auto.daily_equity%ROWTYPE; row_in sportsedge_paper_auto.daily_equity%ROWTYPE;
DECLARE t timestamptz:=sportsedge_paper_auto._now(); since timestamptz; expected numeric; rounding bigint; risk text;
BEGIN
 r:=sportsedge_paper_auto._lock_run(run,'monitor');
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
   IF old.cash_reconciled AND NOT old.contaminated THEN
    risk:=sportsedge_paper_auto._halt_for_risk(x.experiment_id,old.equity_cents,'worker:'||r.worker,
     jsonb_build_object('runId',run,'session',d));
   END IF;
   RETURN jsonb_build_object('recorded',false,'duplicate',true,'sessionDate',d,
    'contaminated',old.contaminated,'cashUnexplainedCents',trim_scale(old.cash_unexplained_cents)::text,
    'cashReconciled',old.cash_reconciled,'unrealizedPlCents',old.unrealized_pl_cents,'riskStopCode',risk);
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
 -- Cash that no recorded activity explains, while no submission is unresolved, is an
 -- external balance change: stop in this transaction rather than trusting a later call.
 IF NOT row_in.cash_reconciled AND NOT EXISTS(SELECT 1 FROM sportsedge_paper_auto.intents
  WHERE experiment_id=x.experiment_id AND status IN ('submitting','uncertain')) THEN
  PERFORM sportsedge_paper_auto._halt(x.experiment_id,'UNEXPLAINED_CASH_CHANGE','worker:'||r.worker,
   jsonb_build_object('runId',run,'session',d,'cashUnexplainedCents',trim_scale(row_in.cash_unexplained_cents)::text));
 END IF;
 -- Keep the mark and its risk halt in one transaction. Losing the worker reply
 -- or its later STOP call cannot leave a clean-mark breach ARMED.
 IF row_in.cash_reconciled AND NOT row_in.contaminated THEN
  risk:=sportsedge_paper_auto._halt_for_risk(x.experiment_id,row_in.equity_cents,'worker:'||r.worker,
   jsonb_build_object('runId',run,'session',d));
 END IF;
 RETURN jsonb_build_object('recorded',true,'duplicate',false,'sessionDate',d,
  'externalFlowCents',row_in.external_flow_cents,'feesCents',row_in.fees_cents,
  'dividendsCents',row_in.dividends_cents,'contaminated',row_in.contaminated,
  'cashUnexplainedCents',trim_scale(row_in.cash_unexplained_cents)::text,'cashReconciled',row_in.cash_reconciled,
  'unrealizedPlCents',row_in.unrealized_pl_cents,'riskStopCode',risk);
END $$;

REVOKE ALL ON FUNCTION sportsedge_paper_auto._risk_reason(bigint,bigint,bigint,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION sportsedge_paper_auto._halt_for_risk(text,bigint,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sportsedge_paper_auto_record_daily(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sportsedge_paper_auto_record_daily(jsonb) TO service_role;
COMMIT;
