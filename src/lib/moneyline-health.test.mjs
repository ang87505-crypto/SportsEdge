// SYNTHETIC slots and aggregate run receipts only; never provider data or executed refreshes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {moneylineHealth,MONEYLINE_HEALTH_POLICY as P} from './moneyline-health.ts';
import {moneylineReceiptFixture as receipt} from './moneyline-health-fixture.mjs';
const NOW='2026-11-28T13:00:00.000Z';
const run=(x=receipt(),now=NOW,enabled=true,p=P)=>moneylineHealth(now,enabled,x.slots,x.runs,p);
test('a dispatch or first planned slot is pending, not a completed collection',()=>{
 assert.equal(run({slots:[],runs:[]},'2026-11-28T10:59:00Z').state,'PENDING');
 assert.equal(run({slots:[],runs:[]},'2026-11-28T12:59:59Z').state,'PENDING');
 const missing=run({slots:[],runs:[]});assert.equal(missing.state,'ATTENTION');assert.deepEqual(missing.issues,['MISSING_SLOT']);
 assert.deepEqual(missing.slots7d,{due:1,missed:1,lastMissedAt:P.firstSlotUtc});
 const queued=receipt();Object.assign(queued.runs[0],{status:'queued',claimed_at:null,finished_at:null,summary:null});
 assert.equal(run(queued,'2026-11-28T11:03:00Z').state,'PENDING');assert.ok(run(queued).issues.includes('RUN_INCOMPLETE'));
});
test('the off state reports no scheduled execution, independent of saved rows',()=>{
 const h=run(receipt(),NOW,false);assert.equal(h.state,'OFF');assert.equal(h.enabled,false);assert.equal(h.expectedSlot,null);assert.deepEqual(h.nextPlanned,[]);
});
test('healthy status needs the slot, exact run and both completed sport receipts',()=>{
 const h=run();assert.equal(h.state,'OK');assert.equal(h.run.id,42);assert.equal(h.tracks.nba.outcome,'saved');
 assert.ok(!JSON.stringify(h).includes('NEVER_PUBLIC'));assert.ok(!JSON.stringify(h).includes('capability_hash'));
 for(const change of [x=>x.slots[0].run_id=43,x=>x.runs[0].summary.runId=43,x=>x.runs[0].probe=true,
  x=>x.runs[0].summary.status='no_new_quotes',x=>x.runs[0].summary.tracks.soccer='unchanged',
  x=>x.runs[0].finished_at=null,x=>x.runs[0].claimed_at='2026-11-28T11:01:59Z']){
  const x=receipt();change(x);assert.notEqual(run(x).state,'OK');
 }
});
test('partial failure, unverified storage or unpriced fixtures cannot hide behind one saved sport',()=>{
 for(const outcome of ['store_failed','unverified','no_prices']){
  const x=receipt();x.runs[0].summary.report.tracks.soccer.outcome=outcome;x.runs[0].summary.tracks.soccer=outcome;
  assert.equal(run(x).state,'ATTENTION');
 }
 const rejected=receipt();rejected.runs[0].summary.report.tracks.soccer.rejectedEvents=1;
 assert.ok(run(rejected).issues.includes('SOCCER_SOURCE_REJECTED'));
});
test('an explicit clean empty slate is distinct from failed or rejected data',()=>{
 const x=receipt(),t=x.runs[0].summary.report.tracks.soccer;
 Object.assign(t,{outcome:'empty_slate',providerGames:0,gamesStored:0,pricesOffered:0,oddsInserted:0,oddsVerified:0,newestSourceObservedAt:null});
 x.runs[0].summary.tracks.soccer='empty_slate';assert.equal(run(x).state,'OK');
 t.rejectedEvents=1;assert.equal(run(x).state,'ATTENTION');
});
test('stale or future source prices are not cured by a new run timestamp',()=>{
 const stale=receipt();stale.runs[0].summary.report.tracks.nba.newestSourceObservedAt='2026-10-30T07:04:57Z';
 assert.ok(run(stale).issues.includes('NBA_SOURCE_STALE'));
 const future=receipt();future.runs[0].summary.report.tracks.soccer.newestSourceObservedAt='2026-11-28T13:00:01Z';
 assert.ok(run(future).issues.includes('SOCCER_SOURCE_FUTURE'));
});
test('bad database shapes, duplicate IDs and future times stay unavailable',()=>{
 for(const change of [x=>x.slots.push({...x.slots[0]}),x=>x.runs.push({...x.runs[0]}),x=>x.slots[0].claimed_at='2026-11-29T11:00:00Z',
  x=>x.runs[0].created_at='invalid',x=>x.slots[0].slot_key='moneyline-h2h-2026-02-30']){
  const x=receipt();change(x);assert.equal(run(x).state,'UNAVAILABLE');
 }
});
test('scheduled statistics use only the actual seven-day window and the configured first slot',()=>{
 const p={...P,firstSlotUtc:'2026-11-01T11:00:00.000Z'};
 const h=run({slots:[],runs:[]},NOW,true,p);assert.equal(h.slots7d.due,7);assert.equal(h.slots7d.missed,7);
 assert.deepEqual(h.nextPlanned,['2026-11-29T11:00:00.000Z','2026-11-30T11:00:00.000Z']);
 const outside=receipt();outside.slots[0].claimed_at='2026-11-28T10:00:00Z';assert.ok(run(outside).issues.includes('SLOT_OUTSIDE_WINDOW'));
});
