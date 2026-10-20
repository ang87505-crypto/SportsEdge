#!/usr/bin/env bash
# Independent PostgreSQL connections race the recurring PAPER controller RPCs.
# Disposable database with paper_auto_v1 applied; uses PG* environment variables.
# Each connection pins the schema clock with PGOPTIONS. Synthetic data only.
set -euo pipefail
q(){ psql -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }
at(){ local t=$1; shift; PGOPTIONS="-c paper_auto_test.now=$t" q "$@"; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail(){ echo "$1"; exit 1; }
printf 'Race setup: creating synthetic fixtures...\n'
q >/dev/null <<'SQL'
CREATE OR REPLACE FUNCTION sportsedge_paper_auto._now() RETURNS timestamptz
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT coalesce(nullif(current_setting('paper_auto_test.now',true),'')::timestamptz,clock_timestamp())
$$;
CREATE SCHEMA race;
CREATE FUNCTION race.rpc(name text, p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN EXECUTE format('SELECT public.%I($1)','sportsedge_paper_auto_'||name) INTO r USING p; RETURN r; END $$;
CREATE FUNCTION race.owner() RETURNS text LANGUAGE sql AS $$ SELECT 'owner-'||repeat('a',32) $$;
CREATE FUNCTION race.begin(k text, slot text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb:=race.rpc('begin_run',jsonb_build_object('experiment_id','race-2026','kind',k,'slot',slot,
 'worker','race:'||pg_backend_pid()));
BEGIN
 IF (r->>'started')<>'true' THEN RAISE EXCEPTION 'NOT_STARTED %',r->>'reason'; END IF;
 RETURN r->>'runId';
END $$;
CREATE FUNCTION race.lease(run text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 IF (race.rpc('acquire_lease',jsonb_build_object('run_id',run))->>'acquired')<>'true' THEN
  RAISE EXCEPTION 'LEASE_HELD_ELSEWHERE';
 END IF;
 RETURN run;
END $$;
CREATE FUNCTION race.snap(run text) RETURNS bigint LANGUAGE sql AS $$
 SELECT (race.rpc('record_snapshot',jsonb_build_object('run_id',run,
  'captured_at',to_char(sportsedge_paper_auto._now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'account_id','33333333-4444-5555-6666-777777777777','equity_cents',100000,'cash_cents',100000,
  'settled_cash_cents',100000,'positions','[]'::jsonb,'open_orders','[]'::jsonb,
  'digest',repeat('1',64)))->>'snapshotId')::bigint
$$;
CREATE FUNCTION race.reserve(run text, snap bigint, sym text) RETURNS text LANGUAGE sql AS $$
 SELECT race.rpc('reserve_intents',jsonb_build_object('run_id',run,'decision_id',repeat('d',64),
  'plan_id',repeat('7',64),'snapshot_id',snap,'legs',jsonb_build_array(jsonb_build_object(
  'security_id','id-'||sym,'symbol',sym,'side','buy','shares',2,'limit_cents',3000))))->'reserved'->0->>'intentId'
$$;
CREATE FUNCTION race.claim(run text, iid text) RETURNS text LANGUAGE sql AS $$
 SELECT race.rpc('claim_intent',jsonb_build_object('run_id',run,'intent_id',iid))->>'intentId'
$$;
CREATE FUNCTION race.record(run text, iid text, ver integer, nxt text, bid text) RETURNS text LANGUAGE sql AS $$
 SELECT race.rpc('record_order',jsonb_build_object('run_id',run,'intent_id',iid,'expected_version',ver,
  'next_status',nxt,'broker_order_id',bid,'broker_status',nxt,'filled_qty',CASE nxt WHEN 'filled' THEN '2' ELSE '0' END,
  'filled_avg_price','30.00'))->>'status'
$$;
CREATE FUNCTION race.stop(actor text) RETURNS text LANGUAGE sql AS $$
 SELECT race.rpc('stop',jsonb_build_object('experiment_id','race-2026','reason','RACE_STOP','actor',actor))->>'state'
$$;
CREATE FUNCTION race.arm(slot text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE rec text:=race.begin('reconcile',slot); ver bigint;
BEGIN
 PERFORM race.rpc('finish_run',jsonb_build_object('run_id',rec,'status','succeeded','result',
  jsonb_build_object('clean',true,'accountId','33333333-4444-5555-6666-777777777777')));
 ver:=(race.rpc('status',jsonb_build_object('experiment_id','race-2026'))->>'gateVersion')::bigint;
 RETURN race.rpc('resume',jsonb_build_object('experiment_id','race-2026','owner_ref',race.owner(),
  'expected_gate_version',ver,'reconcile_run_id',rec))->>'gateMode';
END $$;
SELECT set_config('paper_auto_test.now','2026-10-19T11:00:00Z',false);
SELECT race.rpc('register',jsonb_build_object('experiment_id','race-2026','owner_ref',race.owner(),
 'account_observed_at','2026-10-19T11:00:00Z','model_version','stock-mom252-skip21-trend200-v1',
 'broker_account_id','33333333-4444-5555-6666-777777777777','broker_account_number','PA0RACE',
 'decision_window_start','2026-10-01','decision_window_end','2026-12-31','starting_equity_cents',100000,
 'capital_limit_cents',120000,'max_order_notional_cents',15000,'max_daily_notional_cents',10000000,
 'max_orders_per_day',200,'max_open_orders',20,'max_attempts_per_leg',5,'drawdown_stop_bps',2500,
 'fee_reserve_cents',0));
SELECT set_config('paper_auto_test.now','2026-10-19T12:00:30Z',false);
DO $$
DECLARE run text:=race.begin('decision','2026-10-19'); targets jsonb:='[]'; prior jsonb:='{}'; s text;
BEGIN
 FOREACH s IN ARRAY ARRAY['TA','TB','TC','TD','TE','TF','TG','TH','TI','TJ'] LOOP
  targets:=targets||jsonb_build_array(jsonb_build_object('securityId','id-'||s,'symbol',s,'sector','S'||s));
  prior:=prior||jsonb_build_object('id-'||s,jsonb_build_object('symbol',s,'prior_adv20_shares',100000));
 END LOOP;
 PERFORM race.rpc('record_decision',jsonb_build_object('run_id',run,'decision_id',repeat('d',64),
  'outcome','TARGETS','decision_at','2026-10-19T12:00:00Z','input_digest',repeat('e',64),
  'signal',jsonb_build_object('version','stock-forward-signal-v1','experimentId','race-2026',
   'modelVersion','stock-mom252-skip21-trend200-v1','decisionId',repeat('d',64),
   'decisionAt','2026-10-19T12:00:00Z','observedAt','2026-10-19T12:00:05Z','targets',targets,'priorInputs',prior)));
 PERFORM race.rpc('finish_run',jsonb_build_object('run_id',run,'status','succeeded'));
END $$;
SQL
printf 'Race setup: arming the synthetic experiment...\n'
T0=2026-10-19T14:00:00Z
[ "$(at $T0 -c "SELECT race.arm('2026-10-19T13:59Z')")" = ARMED ] || fail ARM_FAILED

# R1: eight duplicate scheduler deliveries of one slot start exactly one run.
printf 'R1: duplicate scheduler deliveries\n'
for n in 1 2 3 4 5 6 7 8; do
 (at $T0 -c "SELECT race.begin('monitor','2026-10-19')" >/dev/null 2>&1 && echo won || echo lost) > $tmp/r1.$n &
done; wait
wins=$(cat $tmp/r1.* | grep -c won || true)
[ "$wins" = 1 ] || fail "BEGIN_RUN_RACE_FAILED wins=$wins"

# R2: two execute runs race for the experiment lease; exactly one holds it.
printf 'R2: experiment lease\n'
A=$(at $T0 -c "SELECT race.begin('execute','2026-10-19T14:00Z')")
B=$(at $T0 -c "SELECT race.begin('execute','2026-10-19T14:15Z')")
(at $T0 -c "SELECT race.lease('$A')" >/dev/null 2>&1 && echo "$A" || echo lost) > $tmp/r2.a &
(at $T0 -c "SELECT race.lease('$B')" >/dev/null 2>&1 && echo "$B" || echo lost) > $tmp/r2.b &
wait
holders=$(cat $tmp/r2.a $tmp/r2.b | grep -c '^run-' || true)
[ "$holders" = 1 ] || fail "LEASE_RACE_FAILED holders=$holders"
EX=$(cat $tmp/r2.a $tmp/r2.b | grep '^run-')
SNAP=$(at $T0 -c "SELECT race.snap('$EX')")

# R3: the lease holder reserving the same leg twice concurrently persists one intent.
printf 'R3: duplicate intent reservation\n'
for n in 1 2; do
 (at $T0 -c "SELECT race.reserve('$EX',$SNAP,'TA')" 2>/dev/null || echo lost) > $tmp/r3.$n &
done; wait
ids=$(cat $tmp/r3.* | grep -c '^pai-' || true)
[ "$ids" = 1 ] || fail "RESERVE_RACE_FAILED reserved=$ids"
IA=$(cat $tmp/r3.* | grep '^pai-')
[ "$(q -c "SELECT count(*) FROM sportsedge_paper_auto.intents WHERE security_id='id-TA'")" = 1 ] \
 || fail RESERVE_RACE_DUPLICATE_ROW

# R4: two concurrent claims of one intent; exactly one may POST.
printf 'R4: intent claims\n'
for n in 1 2; do
 (at $T0 -c "SELECT race.claim('$EX','$IA')" >/dev/null 2>&1 && echo won || echo lost) > $tmp/r4.$n &
done; wait
wins=$(cat $tmp/r4.* | grep -c won || true)
[ "$wins" = 1 ] || fail "CLAIM_RACE_FAILED wins=$wins"
[ "$(q -c "SELECT count(*) FROM sportsedge_paper_auto.intent_events WHERE intent_id='$IA' AND to_status='submitting'")" = 1 ] \
 || fail CLAIM_RACE_EVENTS

# R5: two broker observations with the same expected version; compare-and-swap admits one.
printf 'R5: order-observation versions\n'
for n in 1 2; do
 (at $T0 -c "SELECT race.record('$EX','$IA',1,'open','b-race-a')" >/dev/null 2>&1 && echo won || echo lost) > $tmp/r5.$n &
done; wait
wins=$(cat $tmp/r5.* | grep -c won || true)
[ "$wins" = 1 ] || fail "CAS_RACE_FAILED wins=$wins"
[ "$(at $T0 -c "SELECT race.record('$EX','$IA',2,'filled','b-race-a')")" = filled ] || fail CAS_RACE_FOLLOWUP

# R6: STOP races a claim. The gate row serializes them: either the claim committed
# first (intent submitting) or STOP voided the reservation and the claim was refused.
printf 'R6: STOP versus an intent claim\n'
k=0
for sym in TB TC TD TE TF TG; do
 k=$((k+1)); T=$(date -u -d "2026-10-19T14:01:00Z + $((k*30)) seconds" +%Y-%m-%dT%H:%M:%SZ)
 T2=$(date -u -d "$T + 10 seconds" +%Y-%m-%dT%H:%M:%SZ)
 I=$(at $T -c "SELECT race.reserve('$EX',race.snap('$EX'),'$sym')")
 (at $T -c "SELECT race.claim('$EX','$I')" >/dev/null 2>&1 && echo won || echo lost) > $tmp/r6.claim &
 (at $T -c "SELECT race.stop('worker:race:$k')" >/dev/null 2>&1 && echo stopped || echo error) > $tmp/r6.stop &
 wait
 [ "$(cat $tmp/r6.stop)" = stopped ] || fail "STOP_FAILED trial=$k"
 st=$(q -c "SELECT status FROM sportsedge_paper_auto.intents WHERE intent_id='$I'")
 case "$(cat $tmp/r6.claim):$st" in
  won:submitting) at $T2 -c "SELECT race.record('$EX','$I',1,'canceled','b-race-$k')" >/dev/null ;;
  lost:not_submitted) ;;
  *) fail "STOP_CLAIM_RACE_FAILED trial=$k claim=$(cat $tmp/r6.claim) status=$st" ;;
 esac
 [ "$(at $T2 -c "SELECT race.arm('2026-10-19T15:0${k}Z')")" = ARMED ] || fail "REARM_FAILED trial=$k"
 at $T2 -c "SELECT race.rpc('heartbeat',jsonb_build_object('run_id','$EX'))" >/dev/null
done

# R7: concurrent STOPs both succeed; the gate changes once and both are audited.
printf 'R7: concurrent STOP requests\n'
T=2026-10-19T14:10:00Z
v0=$(at $T -c "SELECT race.rpc('status','{\"experiment_id\":\"race-2026\"}')->>'gateVersion'")
e0=$(q -c "SELECT count(*) FROM sportsedge_paper_auto.gate_events WHERE experiment_id='race-2026'")
for n in 1 2; do (at $T -c "SELECT race.stop('worker:race:stop$n')" >/dev/null 2>&1 && echo ok || echo error) > $tmp/r7.$n & done; wait
[ "$(cat $tmp/r7.* | grep -c ok)" = 2 ] || fail STOP_STOP_RACE_ERRORED
v1=$(at $T -c "SELECT race.rpc('status','{\"experiment_id\":\"race-2026\"}')->>'gateVersion'")
e1=$(q -c "SELECT count(*) FROM sportsedge_paper_auto.gate_events WHERE experiment_id='race-2026'")
[ $((v1-v0)) = 1 ] && [ $((e1-e0)) = 2 ] || fail "STOP_STOP_RACE_FAILED versions=$v0..$v1 events=$e0..$e1"

# R8: after a crash, duplicate deliveries take over the stale slot exactly once.
printf 'R8: stale-slot takeover\n'
at 2026-10-19T14:20:00Z -c "SELECT race.begin('reconcile','2026-10-18')" >/dev/null
for n in 1 2 3; do
 (at 2026-10-19T14:31:00Z -c "SELECT race.begin('reconcile','2026-10-18')" >/dev/null 2>&1 && echo won || echo lost) > $tmp/r8.$n &
done; wait
[ "$(cat $tmp/r8.* | grep -c won || true)" = 1 ] || fail STALE_TAKEOVER_RACE_FAILED
[ "$(q -c "SELECT string_agg(status||attempt,',' ORDER BY attempt) FROM sportsedge_paper_auto.runs WHERE slot='2026-10-18'")" = "abandoned1,running2" ] \
 || fail STALE_TAKEOVER_STATE

# R9: finishing a lease holder while another run acquires never deadlocks.
printf 'R9: lease release and acquisition\n'
for n in 1 2 3 4 5 6 7 8; do
 T=$(date -u -d "2026-10-19T16:00:00Z + $((n*400)) seconds" +%Y-%m-%dT%H:%M:%SZ)
 X=$(at $T -c "SELECT race.lease(race.begin('reconcile','2026-10-20T0${n}:00Z'))")
 Y=$(at $T -c "SELECT race.begin('reconcile','2026-10-20T0${n}:30Z')")
 (at $T -c "SELECT race.rpc('finish_run',jsonb_build_object('run_id','$X','status','failed','check','{\"ok\":false}'::jsonb))" >/dev/null 2>$tmp/r9.x.err && echo ok || echo error) > $tmp/r9.x &
 (at $T -c "SELECT race.rpc('acquire_lease',jsonb_build_object('run_id','$Y'))" >/dev/null 2>$tmp/r9.y.err && echo ok || echo error) > $tmp/r9.y &
 wait
 [ "$(cat $tmp/r9.x $tmp/r9.y | grep -c ok)" = 2 ] || fail "LOCK_ORDER_RACE_FAILED $(cat $tmp/r9.x.err $tmp/r9.y.err)"
 at $T -c "SELECT race.rpc('finish_run',jsonb_build_object('run_id','$Y','status','failed'))" >/dev/null
done
q -c "SET client_min_messages=warning; DROP SCHEMA race CASCADE" >/dev/null
echo PAPER_AUTO_V1_CONCURRENCY_PASS
