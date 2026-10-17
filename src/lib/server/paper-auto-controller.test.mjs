// End-to-end: the recurring PAPER controller against a fake Alpaca PAPER broker and
// an isolated PostgreSQL database with the real paper_auto_v1 schema. No network.
// Requires PAPER_AUTO_E2E_PG=1 and PG* variables for a disposable server.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDatabase,dropDatabase,psqlStore,fakeClock,FakeBroker,e2eDatabaseAvailable,sqlValue}
 from './paper-auto-test-kit.mjs';
import {runExecuteSlot,runReconcileSlot,runMonitorSlot,recordDecisionSlot,registerExperiment,proceedsCents}
 from './paper-auto-controller.ts';
import {quarterHourSlot} from './paper-auto-time.ts';

const enabled=e2eDatabaseAvailable();
if(!enabled&&process.env.PAPER_AUTO_REQUIRE_E2E==='1')throw Error('PAPER_AUTO_E2E_PG=1 is required in this job');
const DB='paper_auto_e2e_'+process.pid;
if(enabled){createDatabase(DB);process.on('exit',()=>dropDatabase(DB));}
const e2e=enabled?test:test.skip;
const OWNER='owner-'+'a'.repeat(32);
const BASELINE='stock-mom252-skip21-trend200-v1';
let seq=0;

function world({start='2026-10-19T11:00:00Z',writes=true,cash=100000,latencyMs=0}={}){
 seq++;
 const clock=fakeClock(start);
 const accountId=`${String(seq).padStart(8,'0')}-1111-2222-3333-444444444444`;
 const broker=new FakeBroker(clock,{accountId,accountNumber:'PA0E2E'+seq,cashCents:cash,writesEnabled:writes});
 broker.setQuote('AAA',3001);broker.setQuote('BBB',4400);broker.setQuote('CCC',2000);broker.setQuote('DDD',2500);
 const store=psqlStore(DB,clock,latencyMs);
 return {clock,broker,store,experimentId:'e2e-'+seq,
  deps:{store,broker,now:clock.now,sleep:clock.sleep,worker:'test:e2e:'+seq}};
}
async function register(w,limits={}){
 const r=await registerExperiment(w.deps,{experimentId:w.experimentId,ownerRef:OWNER,modelVersion:BASELINE,
  decisionWindowStart:'2026-10-01',decisionWindowEnd:'2026-12-31',capitalLimitCents:120000,
  maxOrderNotionalCents:15000,maxDailyNotionalCents:100000,maxOrdersPerDay:50,maxOpenOrders:10,
  maxAttemptsPerLeg:3,drawdownStopBps:2500,feeReserveCents:0,...limits});
 assert.equal(r.registered,true,JSON.stringify(r));
 assert.equal(r.status.state,'STOPPED');
}
const eightAm=(session)=>session<'2026-11-01'?`${session}T12:00:00.000Z`:`${session}T13:00:00.000Z`;
async function decide(w,session='2026-10-19',targets=[['AAA','Tech'],['BBB','Health'],['CCC','Energy']],
 extra=['DDD'],outcome='TARGETS'){
 const decisionAt=eightAm(session);
 w.clock.set(new Date(Date.parse(decisionAt)+30_000).toISOString());
 const decisionId=createHash('sha256').update(w.experimentId+'|'+session+'|'+outcome).digest('hex');
 const priorInputs={};
 for(const s of [...targets.map(t=>t[0]),...extra])priorInputs['id-'+s]={symbol:s,prior_adv20_shares:100000};
 const signal={version:'stock-forward-signal-v1',experimentId:w.experimentId,modelVersion:BASELINE,decisionId,
  decisionAt,observedAt:new Date(Date.parse(decisionAt)+10_000).toISOString(),
  targets:targets.map(([s,sector])=>({securityId:'id-'+s,symbol:s,sector})),priorInputs,
  heldSecurityIds:[],executionPermitted:false,sourceIndependentlyVerified:false};
 const r=await recordDecisionSlot(w.deps,{experimentId:w.experimentId,session,decisionId,decisionAt,outcome,
  ...(outcome==='TARGETS'?{signal,inputDigest:'e'.repeat(64)}:{})});
 assert.equal(r.outcome,'SUCCEEDED',JSON.stringify(r));
 return decisionId;
}
async function status(w){return w.store.call('status',{experiment_id:w.experimentId});}
async function arm(w,at){
 w.clock.set(at);
 const rec=await runReconcileSlot(w.deps,w.experimentId,at.slice(0,16)+'Z');
 assert.equal(rec.detail.clean,true,JSON.stringify(rec));
 const s=await status(w);
 const r=await w.store.call('resume',{experiment_id:w.experimentId,owner_ref:OWNER,
  expected_gate_version:s.gateVersion,reconcile_run_id:rec.runId});
 assert.equal(r.gateMode,'ARMED');
}
async function execute(w,at){
 w.clock.set(at);
 return runExecuteSlot(w.deps,w.experimentId,quarterHourSlot(Date.parse(at)));
}
async function monitor(w,at,session){
 w.clock.set(at);
 return runMonitorSlot(w.deps,w.experimentId,session);
}
function intents(w){
 return JSON.parse(sqlValue(DB,`SELECT coalesce(jsonb_agg(jsonb_build_object('symbol',symbol,'side',side,
  'attempt',attempt,'shares',shares,'status',status,'filled',filled_qty::int) ORDER BY symbol,attempt),'[]')
  FROM sportsedge_paper_auto.intents WHERE experiment_id='${w.experimentId}'`));
}
async function armedWithDecision(opts={},limits={}){
 const w=world(opts);
 await register(w,limits);
 await decide(w);
 await arm(w,'2026-10-19T13:40:00.000Z');
 return w;
}
const positions=(w)=>Object.fromEntries([...w.broker.positionsBySymbol].filter(([,q])=>q));

e2e('happy path: one decision, three limit BUYs, idempotent slots, HOLD, and an after-close mark',async()=>{
 const w=world();
 // Account history before registration is never attributed to the experiment.
 w.broker.activities.push({id:'20261001000000000::old-fill',activityType:'FILL',at:'2026-10-01T15:00:00.000Z',
  symbol:'ZZZ',side:'buy',qty:'1',price:'10',netAmountCents:null,orderId:'b-old',rawDigest:'c'.repeat(64)});
 await register(w);
 await decide(w);
 await arm(w,'2026-10-19T13:40:00.000Z');
 const r=await execute(w,'2026-10-19T13:45:00.000Z');
 assert.equal(r.outcome,'SUCCEEDED',JSON.stringify(r));
 assert.equal(r.reason,'ORDERS_COMPLETE');
 assert.equal(w.broker.posts.length,3);
 assert.deepEqual(w.broker.posts.map(p=>[p.symbol,p.side,p.shares,p.limitCents]),
  [['AAA','buy',3,3001],['BBB','buy',2,4400],['CCC','buy',5,2000]]);
 assert.ok(w.broker.posts.every(p=>/^sepa[a-f0-9]{40}$/.test(p.clientOrderId)));
 assert.deepEqual(positions(w),{AAA:3,BBB:2,CCC:5});
 assert.deepEqual(intents(w).map(i=>i.status),['filled','filled','filled']);
 // A duplicate delivery of the finished slot does nothing.
 const again=await execute(w,'2026-10-19T13:46:00.000Z');
 assert.equal(again.outcome,'SKIPPED');assert.equal(again.reason,'SLOT_ALREADY_FINISHED');
 // A later slot re-plans from broker state and holds.
 const hold=await execute(w,'2026-10-19T14:00:00.000Z');
 assert.equal(hold.reason,'PLAN_HOLD',JSON.stringify(hold));
 assert.equal(w.broker.posts.length,3);
 // A monitor delivery before the close must not consume the session's slot.
 const early=await monitor(w,'2026-10-19T19:35:00.000Z','2026-10-19');
 assert.equal(early.reason,'BEFORE_CLOSE');assert.equal(early.runId,null);
 const m=await monitor(w,'2026-10-19T20:30:00.000Z','2026-10-19');
 assert.equal(m.reason,'DAILY_RECORDED',JSON.stringify(m));
 const dup=await monitor(w,'2026-10-19T21:30:00.000Z','2026-10-19');
 assert.equal(dup.reason,'SLOT_ALREADY_FINISHED');
 assert.equal(sqlValue(DB,`SELECT string_agg(classification,',' ORDER BY activity_id) FROM sportsedge_paper_auto.activities
  WHERE experiment_id='${w.experimentId}'`),'strategy_fill,strategy_fill,strategy_fill');
 assert.equal(sqlValue(DB,`SELECT equity_cents||':'||contaminated FROM sportsedge_paper_auto.daily_equity
  WHERE experiment_id='${w.experimentId}'`),'100000:false');
 w.clock.set('2026-10-19T20:31:00.000Z');
 assert.equal((await status(w)).state,'READY');
});

e2e('broker writes released OFF: a shadow plan is recorded and nothing is reserved or sent',async()=>{
 const w=await armedWithDecision({writes:false});
 const r=await execute(w,'2026-10-19T13:45:00.000Z');
 assert.equal(r.reason,'SHADOW_PLAN_ONLY',JSON.stringify(r));
 assert.equal(r.detail.rounds[0].legs.length,3);
 assert.equal(w.broker.posts.length,0);
 assert.deepEqual(intents(w),[]);
});

e2e('an unknown POST outcome is never retried; the order found later is recorded, then the rest proceed',async()=>{
 const w=await armedWithDecision();
 w.broker.behaviors.push('timeout_late');
 const r1=await execute(w,'2026-10-19T13:45:00.000Z');
 assert.equal(r1.reason,'SUBMISSIONS_PAUSED',JSON.stringify(r1));
 assert.equal(w.broker.posts.length,1);
 assert.deepEqual(intents(w).map(i=>i.symbol+':'+i.status),['AAA:uncertain','BBB:not_submitted','CCC:not_submitted']);
 const r2=await execute(w,'2026-10-19T14:00:00.000Z');
 assert.equal(r2.reason,'UNRESOLVED_SUBMISSION');
 assert.equal(w.broker.posts.length,1,'a missing lookup alone never triggers a new order');
 w.broker.revealLate();
 const r3=await execute(w,'2026-10-19T14:15:00.000Z');
 assert.equal(r3.reason,'ORDERS_COMPLETE',JSON.stringify(r3));
 assert.deepEqual(w.broker.posts.map(p=>p.symbol),['AAA','BBB','CCC']);
 assert.equal(new Set(w.broker.posts.map(p=>p.clientOrderId)).size,3);
 assert.deepEqual(intents(w).map(i=>i.symbol+':'+i.attempt+':'+i.status),
  ['AAA:1:filled','BBB:1:not_submitted','BBB:2:filled','CCC:1:not_submitted','CCC:2:filled']);
 assert.deepEqual(positions(w),{AAA:3,BBB:2,CCC:5});
});

e2e('a duplicate client order id is resolved by lookup, not treated as a rejection',async()=>{
 const w=await armedWithDecision();
 w.broker.behaviors.push('duplicate');
 const r=await execute(w,'2026-10-19T13:45:00.000Z');
 assert.equal(r.reason,'ORDERS_COMPLETE',JSON.stringify(r));
 assert.equal(w.broker.posts.length,3);
 assert.deepEqual(intents(w).map(i=>i.status),['filled','filled','filled']);
});

e2e('a broker rejection stops the experiment; nothing else is sent until the owner resumes',async()=>{
 const w=await armedWithDecision();
 w.broker.behaviors.push('reject403');
 const r=await execute(w,'2026-10-19T13:45:00.000Z');
 assert.equal(r.outcome,'STOPPED');assert.equal(r.reason,'ORDER_REJECTED');
 assert.equal(w.broker.posts.length,1);
 const s=await status(w);
 assert.equal(s.state,'STOPPED');assert.equal(s.unacknowledgedCriticalAlerts,1);
 assert.deepEqual(intents(w).map(i=>i.symbol+':'+i.status),['AAA:rejected','BBB:not_submitted','CCC:not_submitted']);
 const next=await execute(w,'2026-10-19T14:00:00.000Z');
 assert.equal(next.reason,'GATE_STOPPED');
 assert.equal(w.broker.posts.length,1);
 // After acknowledgement and a clean reconciliation, the rejected leg is still never retried:
 // the all-or-nothing plan is blocked for this decision rather than silently trimmed.
 const alert=sqlValue(DB,`SELECT alert_id FROM sportsedge_paper_auto.alerts WHERE experiment_id='${w.experimentId}'`);
 await w.store.call('ack_alert',{experiment_id:w.experimentId,owner_ref:OWNER,alert_id:Number(alert)});
 await arm(w,'2026-10-19T14:10:00.000Z');
 const blocked=await execute(w,'2026-10-19T14:15:00.000Z');
 assert.equal(blocked.reason,'RESERVE_LEG_REJECTED',JSON.stringify(blocked));
 assert.equal(w.broker.posts.length,1);
});

e2e('a broker rejection stops in the database even when the worker\'s stop call is lost',async()=>{
 const w=await armedWithDecision();
 w.broker.behaviors.push('reject403');
 w.store.failOnce=new Set(['stop']);
 const r=await execute(w,'2026-10-19T13:45:00.000Z');
 assert.equal(r.outcome,'FAILED',JSON.stringify(r));assert.equal(r.reason,'STOP_NOT_CONFIRMED:ORDER_REJECTED');
 const s=await status(w);
 assert.equal(s.state,'STOPPED');assert.equal(s.unacknowledgedCriticalAlerts,1);
 assert.deepEqual(intents(w).map(i=>i.symbol+':'+i.status),['AAA:rejected','BBB:not_submitted','CCC:not_submitted']);
 // The next session's decision is never executed while the experiment is stopped.
 await decide(w,'2026-10-20');
 const next=await execute(w,'2026-10-20T13:45:00.000Z');
 assert.equal(next.reason,'GATE_STOPPED',JSON.stringify(next));
 assert.equal(w.broker.posts.length,1);
});

e2e('external open orders, external positions and a different account each stop the experiment',async()=>{
 for(const tamper of ['order','position','account']){
  const w=await armedWithDecision();
  if(tamper==='order')w.broker.orders.push({id:'b-manual',clientOrderId:'manual-1',symbol:'ZZZ',side:'buy',
   type:'limit',timeInForce:'day',status:'new',qty:'1',filledQty:'0',filledAvgPrice:null,limitPrice:'10.00',
   submittedAt:'2026-10-19T13:41:00.000Z',extendedHours:false});
  if(tamper==='position')w.broker.positionsBySymbol.set('ZZZ',5);
  if(tamper==='account')w.broker.reportedAccountId='99999999-1111-2222-3333-444444444444';
  const r=await execute(w,'2026-10-19T13:45:00.000Z');
  assert.equal(r.outcome,'STOPPED',tamper+' '+JSON.stringify(r));
  assert.equal(r.reason,{order:'EXTERNAL_OPEN_ORDER',position:'POSITION_MISMATCH',
   account:'ACCOUNT_IDENTITY_MISMATCH'}[tamper]);
  assert.equal(w.broker.posts.length,0);
  assert.equal((await status(w)).state,'STOPPED');
 }
});

e2e('drawdown from the after-close high-water mark stops the experiment before any order',async()=>{
 const w=await armedWithDecision({},{drawdownStopBps:1000});
 assert.equal((await execute(w,'2026-10-19T13:45:00.000Z')).reason,'ORDERS_COMPLETE');
 // The holdings close higher, so the after-close mark sets a 109000 high-water mark.
 w.broker.setQuote('AAA',6001);
 const m=await monitor(w,'2026-10-19T20:30:00.000Z','2026-10-19');
 assert.equal(m.reason,'DAILY_RECORDED',JSON.stringify(m));
 // Next session, 91000 is within 10% of the starting equity but more than 10% below the high-water mark.
 w.broker.setQuote('AAA',1);
 const r=await execute(w,'2026-10-20T13:45:00.000Z');
 assert.equal(r.outcome,'STOPPED',JSON.stringify(r));
 assert.equal(r.reason,'DRAWDOWN_LIMIT');
 assert.equal(w.broker.posts.length,3);
});

e2e('a session is marked only on its own evening, and cash no activity explains stops the experiment',async()=>{
 const w=await armedWithDecision();
 assert.equal((await execute(w,'2026-10-19T13:45:00.000Z')).reason,'ORDERS_COMPLETE');
 // A late or manual delivery can never record today's equity as an earlier session's mark.
 const late=await monitor(w,'2026-10-20T20:30:00.000Z','2026-10-19');
 assert.equal(late.outcome,'SKIPPED',JSON.stringify(late));
 assert.equal(late.reason,'MARK_WINDOW_PASSED');assert.equal(late.runId,null);
 // A balance change no broker activity reports (an account reset, say) is never strategy return.
 w.broker.cashCents+=5000;
 const m=await monitor(w,'2026-10-20T20:31:00.000Z','2026-10-20');
 assert.equal(m.outcome,'STOPPED',JSON.stringify(m));
 assert.equal(m.reason,'UNEXPLAINED_CASH_CHANGE');
 assert.equal(sqlValue(DB,`SELECT session_date||':'||cash_reconciled||':'||trim_scale(cash_unexplained_cents)
  FROM sportsedge_paper_auto.daily_equity WHERE experiment_id='${w.experimentId}'`),'2026-10-20:false:5000');
 assert.equal((await status(w)).state,'STOPPED');
});

e2e('a mark taken while a submission is unresolved is unreconciled and blocks; the next mark reconciles',async()=>{
 const w=await armedWithDecision();
 // The POST times out but reached the broker and filled; lookups cannot see the order yet.
 w.broker.behaviors.push('timeout_exists');
 w.broker.lookupBlind=true;
 assert.equal((await execute(w,'2026-10-19T13:45:00.000Z')).reason,'SUBMISSIONS_PAUSED');
 const m=await monitor(w,'2026-10-19T20:30:00.000Z','2026-10-19');
 assert.equal(m.outcome,'BLOCKED',JSON.stringify(m));
 assert.equal(m.reason,'MARK_PENDING_ATTRIBUTION');
 assert.equal((await status(w)).gateMode,'ARMED');
 w.broker.lookupBlind=false;
 w.clock.set('2026-10-20T13:40:00.000Z');
 const rec=await runReconcileSlot(w.deps,w.experimentId,'2026-10-20T13:40Z');
 assert.equal(rec.detail.clean,true,JSON.stringify(rec));
 const m2=await monitor(w,'2026-10-20T20:30:00.000Z','2026-10-20');
 assert.equal(m2.reason,'DAILY_RECORDED',JSON.stringify(m2));
 assert.equal(sqlValue(DB,`SELECT string_agg(session_date||':'||cash_reconciled,',' ORDER BY session_date)
  FROM sportsedge_paper_auto.daily_equity WHERE experiment_id='${w.experimentId}'`),'2026-10-19:false,2026-10-20:true');
});

e2e('stale quotes and late slots never place orders',async()=>{
 const w=await armedWithDecision();
 w.broker.quoteAgeMs=120_000;
 const stale=await execute(w,'2026-10-19T13:45:00.000Z');
 assert.equal(stale.outcome,'BLOCKED');assert.equal(stale.reason,'PLANNER_STALE_QUOTE');
 w.broker.quoteAgeMs=1000;
 const late=await execute(w,'2026-10-19T19:45:00.000Z');
 assert.equal(late.reason,'OUTSIDE_EXECUTION_WINDOW');
 assert.equal(w.broker.posts.length,0);
 assert.equal((await status(w)).gateMode,'ARMED');
});

e2e('a partial fill left working is canceled when stale and the residual is re-planned',async()=>{
 const w=await armedWithDecision();
 w.broker.behaviors.push('partial:1');
 const r1=await execute(w,'2026-10-19T13:45:00.000Z');
 assert.equal(r1.reason,'ORDERS_WORKING',JSON.stringify(r1));
 const r2=await execute(w,'2026-10-19T14:00:00.000Z');
 assert.equal(r2.reason,'ORDERS_COMPLETE',JSON.stringify(r2));
 assert.equal(r2.cancels,1);
 assert.deepEqual(w.broker.posts.map(p=>p.symbol+':'+p.shares),['AAA:3','BBB:2','CCC:5','AAA:2']);
 assert.deepEqual(intents(w).filter(i=>i.symbol==='AAA').map(i=>i.attempt+':'+i.status+':'+i.filled),
  ['1:canceled:1','2:filled:2']);
 assert.deepEqual(positions(w),{AAA:3,BBB:2,CCC:5});
});

e2e('owner STOP is a kill switch: working orders are canceled and nothing new is sent',async()=>{
 const w=await armedWithDecision();
 w.broker.behaviors.push('rest');
 const r1=await execute(w,'2026-10-19T13:45:00.000Z');
 assert.equal(r1.reason,'ORDERS_WORKING');
 await w.store.call('stop',{experiment_id:w.experimentId,reason:'OWNER_STOP',actor:OWNER});
 const r2=await execute(w,'2026-10-19T14:00:00.000Z');
 assert.equal(r2.reason,'GATE_STOPPED');
 assert.equal(r2.cancels,1);
 assert.equal(w.broker.posts.length,3);
 assert.deepEqual(intents(w).map(i=>i.symbol+':'+i.status),['AAA:canceled','BBB:filled','CCC:filled']);
});

e2e('STOP cancels working strategy orders even while external state persists; the owner\'s orders are untouched',
 async()=>{
 for(const kind of ['execute','reconcile'])for(const when of ['owner','armed','owner+lost']){
  const label=kind+' '+when;
  const w=await armedWithDecision();
  w.broker.behaviors.push('rest','rest','rest');
  assert.equal((await execute(w,'2026-10-19T13:45:00.000Z')).reason,'ORDERS_WORKING',label);
  if(when!=='armed')await w.store.call('stop',{experiment_id:w.experimentId,reason:'OWNER_STOP',actor:OWNER});
  // The worker's own stop call can be lost in transit; the owner's STOP still cancels.
  if(when==='owner+lost')w.store.failOnce=new Set(['stop']);
  // A manual order in the dedicated account is external state that persists across runs.
  w.broker.orders.push({id:'b-manual',clientOrderId:'manual-1',symbol:'ZZZ',side:'buy',type:'limit',
   timeInForce:'day',status:'new',qty:'1',filledQty:'0',filledAvgPrice:null,limitPrice:'10.00',
   submittedAt:'2026-10-19T13:50:00.000Z',extendedHours:false});
  w.clock.set('2026-10-19T14:00:00.000Z');
  const r=await (kind==='execute'?runExecuteSlot:runReconcileSlot)(w.deps,w.experimentId,'2026-10-19T14:00Z');
  const lost=when==='owner+lost';
  assert.equal(r.outcome,lost?'FAILED':'STOPPED',label+' '+JSON.stringify(r));
  assert.equal(r.reason,(lost?'STOP_NOT_CONFIRMED:':'')+'EXTERNAL_OPEN_ORDER',label);
  assert.equal(r.cancels,3,label);
  assert.deepEqual(intents(w).map(i=>i.status),['canceled','canceled','canceled'],label);
  assert.deepEqual(w.broker.cancels.filter(id=>id==='b-manual'),[],label);
  assert.equal(w.broker.orders.find(o=>o.id==='b-manual').status,'new',label);
  assert.equal(w.broker.posts.length,3,label);
  const s=await status(w);
  assert.equal(s.state,'STOPPED',label);assert.equal(s.unacknowledgedCriticalAlerts,lost?0:1,label);
 }
});

e2e('a different account behind the credentials stops without canceling anything in it',async()=>{
 const w=await armedWithDecision();
 w.broker.behaviors.push('rest','rest','rest');
 assert.equal((await execute(w,'2026-10-19T13:45:00.000Z')).reason,'ORDERS_WORKING');
 w.broker.reportedAccountId='99999999-1111-2222-3333-444444444444';
 const r=await execute(w,'2026-10-19T14:00:00.000Z');
 assert.equal(r.outcome,'STOPPED',JSON.stringify(r));assert.equal(r.reason,'ACCOUNT_IDENTITY_MISMATCH');
 assert.equal(r.cancels,0);assert.deepEqual(w.broker.cancels,[]);
 assert.deepEqual(intents(w).map(i=>i.status),['open','open','open']);
});

e2e('duplicate deliveries and overlapping slots share one lease and one set of orders',async()=>{
 const w=await armedWithDecision();
 w.clock.set('2026-10-19T13:45:00.000Z');
 const [a,b,c]=await Promise.all([
  runExecuteSlot(w.deps,w.experimentId,'2026-10-19T13:45Z'),
  runExecuteSlot(w.deps,w.experimentId,'2026-10-19T13:45Z'),
  runExecuteSlot(w.deps,w.experimentId,'2026-10-19T14:00Z')]);
 const reasons=[a,b,c].map(r=>r.reason).sort();
 assert.ok(reasons.includes('SLOT_ALREADY_RUNNING'),reasons.join());
 assert.ok(reasons.includes('LEASE_HELD'),reasons.join());
 assert.equal(w.broker.posts.length,3);
});

e2e('rotation across the DST change: SELL first, then BUY with conservative settled cash',async()=>{
 const w=world({latencyMs:400});
 await register(w);
 await decide(w,'2026-10-19',[['DDD','Energy']],['AAA']);
 await arm(w,'2026-10-19T13:40:00.000Z');
 assert.equal((await execute(w,'2026-10-19T13:45:00.000Z')).reason,'ORDERS_COMPLETE');
 assert.deepEqual(positions(w),{DDD:4});
 await decide(w,'2026-11-02',[['AAA','Tech']],['DDD']);
 // The SELL fills only on the 12th poll (60 s later); the BUY phase must still follow in this slot.
 w.broker.behaviors.push('slowfill:12');
 const r=await execute(w,'2026-11-02T14:45:00.000Z');
 assert.equal(r.reason,'ORDERS_COMPLETE',JSON.stringify(r));
 assert.deepEqual(r.detail.rounds.map(x=>x.phase),['SELL','BUY']);
 assert.deepEqual(w.broker.posts.slice(1).map(p=>p.symbol+':'+p.side+':'+p.shares+':'+p.limitCents),
  ['DDD:sell:4:2499','AAA:buy:3:3001']);
 assert.deepEqual(positions(w),{AAA:3});
 // The BUY phase was sized on cash minus today's unsettled sale proceeds (T+1), not on raw cash.
 assert.equal(proceedsCents(4,'24.99'),9996);
 assert.equal(sqlValue(DB,`SELECT cash_cents||':'||settled_cash_cents FROM sportsedge_paper_auto.broker_snapshots
  WHERE experiment_id='${w.experimentId}' ORDER BY snapshot_id DESC LIMIT 1`),'99996:90000');
});

e2e('an external deposit contaminates the daily mark, is netted as a flow and stops the experiment',async()=>{
 const w=await armedWithDecision();
 assert.equal((await execute(w,'2026-10-19T13:45:00.000Z')).reason,'ORDERS_COMPLETE');
 w.clock.set('2026-10-19T15:00:00.000Z');
 w.broker.addDeposit(50000);
 const m=await monitor(w,'2026-10-19T20:30:00.000Z','2026-10-19');
 assert.equal(m.outcome,'STOPPED',JSON.stringify(m));
 assert.equal(m.reason,'EXTERNAL_OR_UNSUPPORTED_ACTIVITY');
 // The reported deposit explains the cash, so the mark reconciles, and it is contaminated for good.
 assert.equal(sqlValue(DB,`SELECT external_flow_cents||':'||contaminated||':'||cash_reconciled
  FROM sportsedge_paper_auto.daily_equity WHERE experiment_id='${w.experimentId}'`),'50000:true:true');
 assert.equal((await status(w)).unacknowledgedCriticalAlerts,1);
});

e2e('the database stops atomically: a failed benchmark read or a lost stop call never loses the STOP',async()=>{
 // A deposit is recorded as external activity, then the benchmark read fails before the mark.
 const a=await armedWithDecision();
 assert.equal((await execute(a,'2026-10-19T13:45:00.000Z')).reason,'ORDERS_COMPLETE');
 a.clock.set('2026-10-19T15:00:00.000Z');
 a.broker.addDeposit(50000);
 a.broker.failOnce=new Set(['dailyClose']);
 const m1=await monitor(a,'2026-10-19T20:30:00.000Z','2026-10-19');
 assert.equal(m1.outcome,'FAILED',JSON.stringify(m1));
 let s=await status(a);
 assert.equal(s.state,'STOPPED');assert.equal(s.unacknowledgedCriticalAlerts,1);
 // The retried delivery records the mark, contaminated for good; the gate stays STOPPED.
 const m2=await monitor(a,'2026-10-19T20:40:00.000Z','2026-10-19');
 assert.equal(m2.reason,'DAILY_RECORDED',JSON.stringify(m2));
 assert.equal(sqlValue(DB,`SELECT contaminated||':'||cash_reconciled FROM sportsedge_paper_auto.daily_equity
  WHERE experiment_id='${a.experimentId}'`),'true:true');
 s=await status(a);
 assert.equal(s.state,'STOPPED');assert.equal(s.unacknowledgedCriticalAlerts,1);
 // Cash nothing explains, and the worker's own stop call is lost in transit.
 const b=await armedWithDecision();
 assert.equal((await execute(b,'2026-10-19T13:45:00.000Z')).reason,'ORDERS_COMPLETE');
 b.broker.cashCents+=5000;
 b.store.failOnce=new Set(['stop']);
 const n1=await monitor(b,'2026-10-19T20:30:00.000Z','2026-10-19');
 assert.equal(n1.reason,'STOP_NOT_CONFIRMED:UNEXPLAINED_CASH_CHANGE',JSON.stringify(n1));
 s=await status(b);
 assert.equal(s.state,'STOPPED');assert.equal(s.unacknowledgedCriticalAlerts,1);
 // A retried delivery re-detects it from the recorded mark instead of reporting success.
 const n2=await monitor(b,'2026-10-19T20:40:00.000Z','2026-10-19');
 assert.equal(n2.outcome,'STOPPED',JSON.stringify(n2));assert.equal(n2.reason,'UNEXPLAINED_CASH_CHANGE');
 assert.equal((await status(b)).unacknowledgedCriticalAlerts,1);
});

e2e('HOLD and MISSED sessions are recorded and execute nothing',async()=>{
 const w=world();
 await register(w);
 await decide(w,'2026-10-19',[],[],'MISSED');
 await arm(w,'2026-10-19T13:40:00.000Z');
 const r=await execute(w,'2026-10-19T13:45:00.000Z');
 assert.equal(r.reason,'NO_EXECUTABLE_DECISION_TODAY');
 assert.equal(w.broker.posts.length,0);
 assert.equal(sqlValue(DB,`SELECT outcome FROM sportsedge_paper_auto.decisions WHERE experiment_id='${w.experimentId}'`),
  'MISSED');
});
