import test from 'node:test';
import assert from 'node:assert/strict';
import {paperRiskBreach} from './paper-auto-risk.ts';
import {runMonitorSlot,runReconcileSlot,runExecuteSlot} from './paper-auto-controller.ts';

const limits={equityCents:100000,highWaterCents:100000,capitalLimitCents:120000,drawdownStopBps:1000};
test('risk boundaries allow equality and detect a one-cent breach',()=>{
 for(const [equity,want] of [[90000,null],[89999,'DRAWDOWN_LIMIT'],[120000,null],[120001,'CAPITAL_LIMIT_REACHED'],[0,'DRAWDOWN_LIMIT']])
  assert.equal(paperRiskBreach({...limits,equityCents:equity}),want);
});
test('risk products stay exact above Number integer precision',()=>{
 const x={...limits,highWaterCents:9007199254740991,capitalLimitCents:9007199254740991};
 assert.equal(paperRiskBreach({...x,equityCents:8106479329266891}),'DRAWDOWN_LIMIT');
 assert.equal(paperRiskBreach({...x,equityCents:8106479329266892}),null);
});
test('malformed or out-of-policy risk inputs are refused',()=>{
 for(const change of [{equityCents:NaN},{equityCents:-1},{equityCents:0.5},{highWaterCents:0},
  {capitalLimitCents:Infinity},{drawdownStopBps:99},{drawdownStopBps:9001}])
  assert.throws(()=>paperRiskBreach({...limits,...change}),/INVALID_RISK_INPUT/);
});

// Fictional account and RPC replies: exercise observer dispatch, never transport.
function observerWorld(equityCents=90000){
 const now=Date.parse('2026-11-12T21:35:00Z'),calls=[];
 let gateMode='ARMED';
 const account={id:'synthetic-account',accountNumber:'TEST1234',status:'ACTIVE',currency:'USD',
  cashCents:50000,equityCents,lastEquityCents:100000,longMarketValueCents:equityCents-50000,
  buyingPowerCents:50000,tradingBlocked:false,accountBlocked:false,readAt:new Date(now).toISOString()};
 const experiment={experimentId:'synthetic-risk',modelVersion:'stock-mom252-skip21-trend200-v1',
  brokerAccountId:account.id,brokerAccountNumber:account.accountNumber,registeredAt:'2026-11-01T12:00:00Z',
  startingEquityCents:100000,capitalLimitCents:200000,drawdownStopBps:1000,feeReserveCents:0};
 const store={call:async(fn,p)=>{
  calls.push({fn,p});
  if(fn==='begin_run')return {started:true,runId:'synthetic-run'};
  if(fn==='worker_state')return {status:{gateMode},experiment,latestDecision:null,intents:[],
   filledBySecurity:[{symbol:'AAA',securityId:'id-A',netShares:'10'}],equityHighWaterCents:120000,
   brokerOrderIds:[],knownActivityIds:[],activityCursor:{activityAt:'2026-11-11T21:30:00Z'}};
  if(fn==='acquire_lease')return {acquired:true};
  if(fn==='record_daily')return {recorded:true,cashReconciled:true};
  if(fn==='stop')gateMode='STOPPED';
  return {};
 }};
 const broker={writesEnabled:false,account:async()=>account,
  positions:async()=>[{symbol:'AAA',assetId:'asset-A',qty:'10',side:'long',marketValueCents:equityCents-50000,costBasisCents:50000}],
  openOrders:async()=>[],activitiesSince:async()=>[],
  session:async()=>({date:'2026-11-12',openAt:'2026-11-12T14:30:00Z',closeAt:'2026-11-12T21:00:00Z'}),
  dailyClose:async()=>({close:'100',source:'synthetic'})};
 return {deps:{store,broker,now:()=>now,sleep:async()=>{},worker:'synthetic-risk'},calls,gate:()=>gateMode};
}
for(const [kind,run,slot] of [['monitor',runMonitorSlot,'2026-11-12'],
 ['reconcile',runReconcileSlot,'2026-11-12T21:30Z'],['execute',runExecuteSlot,'2026-11-12T21:30Z']]){
 test(`${kind} detects a midmonth drawdown breach without a new decision`,async()=>{
  const x=observerWorld(),r=await run(x.deps,'synthetic-risk',slot);
  assert.equal(r.outcome,'STOPPED');assert.equal(r.reason,'DRAWDOWN_LIMIT');
  assert.equal(x.gate(),'STOPPED');assert.equal(r.posts,0);
  if(kind==='monitor')assert.ok(x.calls.findIndex(c=>c.fn==='record_daily')<x.calls.findIndex(c=>c.fn==='stop'));
 });
}
test('a clean daily observation at the drawdown boundary stays armed',async()=>{
 const x=observerWorld(108000),r=await runMonitorSlot(x.deps,'synthetic-risk','2026-11-12');
 assert.equal(r.reason,'DAILY_RECORDED');assert.equal(x.gate(),'ARMED');
 assert.equal(x.calls.filter(c=>c.fn==='stop').length,0);
});
test('a failed benchmark read cannot hide an observed risk breach',async()=>{
 const x=observerWorld();x.deps.broker.dailyClose=async()=>{throw Error('SYNTHETIC_BENCHMARK_UNAVAILABLE');};
 const r=await runMonitorSlot(x.deps,'synthetic-risk','2026-11-12');
 assert.equal(r.reason,'DRAWDOWN_LIMIT');assert.equal(x.gate(),'STOPPED');
 assert.equal(x.calls.filter(c=>c.fn==='record_daily').length,0,'no invented benchmark or mark');
});
