import test from 'node:test';
import assert from 'node:assert/strict';
import {rehearseScheduledPaperTick} from './paper-scheduled-rehearsal.ts';
const date='2026-10-14T14:00:00.000Z'; // 10 AM in New York, during regular hours
const session=()=>({
 venue:'XNYS',source:'reviewed_exchange_calendar',sourceDigest:'c'.repeat(64),
 sessionDate:'2026-10-14',verifiedAt:'2026-10-14T13:55:00.000Z',
 marketOpenAt:'2026-10-14T13:30:00.000Z',marketCloseAt:'2026-10-14T20:00:00.000Z',
 isTradingDay:true
});
const account=()=>({
 accountType:'paper',status:'ACTIVE',accountBlocked:false,tradingBlocked:false,
 snapshotAt:'2026-10-14T13:59:50.000Z',equityCents:1000000,cashCents:300000,
 buyingPowerCents:300000,positions:[],openOrderSymbols:[],positionsComplete:true,
 openOrdersComplete:true,submittedNotionalTodayCents:0,acceptedOrderCountToday:0,uncertainReceiptCount:0
});
const signal=()=>({
 id:'dry-run-fixture-only',symbol:'AAPL',side:'buy',publishedAt:'2026-10-14T13:45:00.000Z',
 quoteAt:'2026-10-14T13:59:00.000Z',quoteCents:2000,limitCents:2100,shares:2,
 sourceReviewed:true,sourceDigest:'b'.repeat(64),modelVersion:'synthetic-fixture'
});
function run(patch={}){
 return rehearseScheduledPaperTick({now:date,session:session(),account:account(),
  signal:signal(),previouslySeenSignalIds:[],gateStatus:'HALTED',unresolvedReceipts:0,...patch});
}
test('Even a synthetic clean tick only previews and can NEVER submit',()=>{
 const x=run(),y=run();
 assert.equal(x.result,'PREVIEW_ONLY');
 assert.equal(x.executionPermitted,false);
 assert.equal(x.brokerCalls,0);
 assert.equal(x.orderSubmissions,0);
 assert.equal(x.scheduledExecutions,0);
 assert.deepEqual(x,y);
 assert.ok(x.blockers.includes('STAGING_GATE_HALTED'));
 assert.ok(x.blockers.includes('PAPER_EXECUTION_DISABLED'));
});
test('Unsettled state, duplicate signals and real account are refused',()=>{
 const cases=[
  [run({unresolvedReceipts:1}),'UNCERTAIN_RECEIPT_LOCK'],
  [run({unresolvedReceipts:NaN}),'UNCERTAIN_RECEIPT_LOCK'],
  [run({gateStatus:'UNKNOWN'}),'STAGING_GATE_UNKNOWN'],
  [run({previouslySeenSignalIds:['dry-run-fixture-only']}),'DUPLICATE_SIGNAL'],
  [run({account:{...account(),accountType:'live'}}),'NON_PAPER_ACCOUNT'],
  [run({account:{...account(),openOrdersComplete:false}}),'INCOMPLETE_BROKER_SNAPSHOT']
 ];
 for(const [r,reason] of cases){assert.ok(r.blockers.includes(reason));assert.equal(r.executionPermitted,false);}
});
test('Closed dates and calendar anomalies cannot unlock a run',()=>{
 for(const [changes,reason] of [
  [{isTradingDay:false},'MARKET_CLOSED'],
  [{sessionDate:'2026-10-13'},'INVALID_CALENDAR'],
  [{sourceDigest:'unchecked'},'INVALID_CALENDAR'],
  [{verifiedAt:'2026-10-14T13:00:00.000Z'},'CALENDAR_STALE'],
  [{verifiedAt:'2026-10-14T14:01:00.000Z'},'CALENDAR_STALE'],
  [{marketCloseAt:'2026-10-14T13:00:00.000Z'},'INVALID_CALENDAR']
 ]){const x=run({session:{...session(),...changes}});assert.ok(x.blockers.includes(reason));assert.equal(x.result,'BLOCKED');}
});
test('Hours, open/close buffers and DST require verified actual exchange session',()=>{
 const m=run({now:'2026-10-14T13:32:00.000Z',
  account:{...account(),snapshotAt:'2026-10-14T13:31:58.000Z'},
  session:{...session(),verifiedAt:'2026-10-14T13:31:59.000Z'},
  signal:{...signal(),publishedAt:'2026-10-14T13:30:00.000Z',quoteAt:'2026-10-14T13:31:58.000Z'}});
 assert.ok(m.blockers.includes('MARKET_OPEN_BUFFER'));
 const close=run({now:'2026-10-14T19:45:00.000Z',
  account:{...account(),snapshotAt:'2026-10-14T19:44:59.000Z'},
  session:{...session(),verifiedAt:'2026-10-14T19:44:59.000Z'},
  signal:{...signal(),publishedAt:'2026-10-14T19:00:00.000Z',quoteAt:'2026-10-14T19:44:58.000Z'}});
 assert.ok(close.blockers.includes('MARKET_CLOSE_BUFFER'));
 const march=run({now:'2026-03-09T14:00:00.000Z',session:{
  ...session(),sessionDate:'2026-03-09',verifiedAt:'2026-03-09T13:59:00.000Z',
  marketOpenAt:'2026-03-09T13:30:00.000Z',marketCloseAt:'2026-03-09T20:00:00.000Z'
 }});
 assert.ok(!march.blockers.includes('INVALID_CALENDAR'));
 assert.ok(march.blockers.includes('STALE_QUOTE'));
 const before=run({now:'2026-10-14T13:00:00.000Z'});
 assert.ok(before.blockers.includes('MARKET_CLOSED'));
 assert.throws(()=>run({now:'2026-10-14'}));
});
