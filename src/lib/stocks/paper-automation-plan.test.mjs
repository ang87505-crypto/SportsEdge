import test from 'node:test';
import assert from 'node:assert/strict';
import {PAPER_AUTOMATION_RELEASE,planPaperIntent} from './paper-automation-plan.ts';

const now='2026-10-14T12:10:00.000Z';
const reviewedSignal=()=>({
 id:'research-signal-1',symbol:'AAPL',side:'buy',publishedAt:'2026-10-14T11:50:00.000Z',
 quoteAt:'2026-10-14T12:09:10.000Z',quoteCents:2400,limitCents:2500,
 shares:3,sourceReviewed:true,sourceDigest:'a'.repeat(64),modelVersion:'registered-v1'
});
const paperAccount=()=>({
 accountType:'paper',status:'ACTIVE',accountBlocked:false,tradingBlocked:false,
 snapshotAt:'2026-10-14T12:09:45.000Z',
 equityCents:1_000_000,cashCents:200_000,buyingPowerCents:200_000,
 positions:[],openOrderSymbols:[],positionsComplete:true,openOrdersComplete:true,
 submittedNotionalTodayCents:0,acceptedOrderCountToday:0,uncertainReceiptCount:0
});
function run(signal=reviewedSignal(),account=paperAccount(),seen=[]){
 return planPaperIntent({signal,account,previouslySeenSignalIds:seen,now});
}
test('ALL runtime broker order and schedule capabilities remain disabled',()=>{
 assert.equal(PAPER_AUTOMATION_RELEASE.paperOnly,true);
 assert.equal(PAPER_AUTOMATION_RELEASE.placeOrdersEnabled,false);
 assert.equal(PAPER_AUTOMATION_RELEASE.scheduledOrdersEnabled,false);
 assert.equal(PAPER_AUTOMATION_RELEASE.realMoneyEnabled,false);
 assert.equal(PAPER_AUTOMATION_RELEASE.durableReceiptStoreReady,false);
 assert.equal(PAPER_AUTOMATION_RELEASE.emergencyStopOperational,false);
});
test('Valid synthetic economics yields ONLY a non-executable dry-run intent',()=>{
 const p=run();
 assert.equal(p.state,'PREVIEW_ONLY');
 assert.ok(p.intent);
 assert.deepEqual({
  mode:p.intent.mode,execution:p.intent.executionPermitted,notional:p.intent.notionalCents,
  type:p.intent.orderType,tif:p.intent.timeInForce,side:p.intent.side
 },{mode:'offline_preview_only',execution:false,notional:7500,type:'limit',tif:'day',side:'buy'});
 assert.ok(p.blockers.includes('PAPER_EXECUTION_DISABLED'));
 assert.ok(p.blockers.includes('EMERGENCY_STOP_NOT_OPERATIONAL'));
 assert.equal(p.intent.intentId,run().intent.intentId);
 assert.notEqual(p.intent.intentId,run({...reviewedSignal(),id:'other'}).intent.intentId);
});
test('Stale, future, unreviewed and shifted market evidence block preview',()=>{
 const s=reviewedSignal();
 for(const [bad,reason] of [
  [{...s,quoteAt:'2026-10-14T12:01:00Z'},'STALE_QUOTE'],
  [{...s,quoteAt:'2026-10-14T12:11:00Z'},'STALE_QUOTE'],
  [{...s,publishedAt:'2026-10-13T11:00:00Z'},'STALE_SIGNAL'],
  [{...s,publishedAt:'2026-10-14T12:09:59Z'},'STALE_SIGNAL'],
  [{...s,sourceReviewed:false},'UNVERIFIED_SIGNAL_SOURCE'],
  [{...s,sourceDigest:'not-a-hash'},'UNVERIFIED_SIGNAL_SOURCE'],
  [{...s,quoteCents:0},'UNVERIFIED_MARKET_PRICE'],
  [{...s,limitCents:s.quoteCents-1},'UNVERIFIED_MARKET_PRICE'],
  [{...s,side:'sell'},'UNSUPPORTED_SIDE'],
  [{...s,symbol:'AAPL;bad'},'INVALID_SYMBOL']
 ]){
  const p=run(bad);
  assert.equal(p.intent,null,JSON.stringify(bad));
  assert.ok(p.blockers.includes(reason),JSON.stringify({bad,blockers:p.blockers}));
 }
});
test('No real account or blocked broker snapshot can produce a proposal',()=>{
 const a=paperAccount();
 for(const [bad,reason] of [
  [{...a,accountType:'live'},'NON_PAPER_ACCOUNT'],
  [{...a,accountType:'unknown'},'NON_PAPER_ACCOUNT'],
  [{...a,status:'CLOSED'},'ACCOUNT_UNAVAILABLE'],
  [{...a,tradingBlocked:true},'BROKER_BLOCKED'],
  [{...a,accountBlocked:true},'BROKER_BLOCKED'],
  [{...a,snapshotAt:'2026-10-14T12:00:00Z'},'INCOMPLETE_BROKER_SNAPSHOT'],
  [{...a,positionsComplete:false},'INCOMPLETE_BROKER_SNAPSHOT'],
  [{...a,openOrdersComplete:false},'INCOMPLETE_BROKER_SNAPSHOT'],
  [{...a,uncertainReceiptCount:1},'UNRECONCILED_ORDER'],
  [{...a,openOrderSymbols:['AAPL']},'UNRECONCILED_ORDER'],
  [{...a,positions:[{symbol:'AAPL',marketValueCents:2400}]},'OPEN_POSITION_EXISTS'],
  [{...a,openOrderSymbols:['A','B','C','D','E']},'OPEN_ORDER_LIMIT']
 ]){
  const p=run(reviewedSignal(),bad);
  assert.equal(p.intent,null,JSON.stringify(bad));
  assert.ok(p.blockers.includes(reason),JSON.stringify({bad,blockers:p.blockers}));
 }
});
test('Spending, share, daily, account and duplicate bounds reject invalid candidates',()=>{
 const s=reviewedSignal(),a=paperAccount();
 assert.ok(run(s,a,[s.id]).blockers.includes('DUPLICATE_SIGNAL'));
 for(const [bad,reason] of [
  [{...s,shares:5},'POSITION_LIMIT'],
  [{...s,shares:1000000},'UNVERIFIED_MARKET_PRICE'],
  [{...s,shares:-1},'UNVERIFIED_MARKET_PRICE'],
 ]){
  const p=run(bad);
  assert.equal(p.intent,null);
  assert.ok(p.blockers.includes(reason),JSON.stringify(p.blockers));
 }
 for(const [bad,reason] of [
  [{...a,cashCents:2000},'INSUFFICIENT_CASH'],
  [{...a,buyingPowerCents:1000},'INSUFFICIENT_CASH'],
  [{...a,submittedNotionalTodayCents:15000},'DAILY_LIMIT'],
  [{...a,acceptedOrderCountToday:5},'ORDER_LIMIT'],
  [{...a,positions:[{symbol:'MSFT',marketValueCents:195_000}]},'PORTFOLIO_LIMIT'],
  [{...a,equityCents:0},'INVALID_ACCOUNT_VALUE'],
  [{...a,equityCents:NaN},'INVALID_ACCOUNT_VALUE']
 ]){
  const p=run(s,bad);
  assert.equal(p.intent,null);
  assert.ok(p.blockers.includes(reason),JSON.stringify(p.blockers));
 }
});
test('Planner fails closed for missing inputs and invalid evaluation clock',()=>{
 assert.deepEqual(planPaperIntent({signal:null,account:null,previouslySeenSignalIds:[],now}).state,'BLOCKED');
 assert.throws(()=>planPaperIntent({signal:reviewedSignal(),account:paperAccount(),
  previouslySeenSignalIds:[],now:'bad-date'}),/clock/);
});
