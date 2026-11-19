import test from 'node:test';
import assert from 'node:assert/strict';
import {BUDGET_POLICY_V1 as P,BUDGET_POLICY_V2,ACTIVE_BUDGET_POLICY,canSpend,chooseEvents,eventOddsWorstCost,providerUsage} from './budget.ts';

test('worst-case event cost is markets x regions',()=>{
 assert.equal(eventOddsWorstCost(),3);
 assert.equal(eventOddsWorstCost(3,2),6);
 assert.throws(()=>eventOddsWorstCost(0,1));
});

test('daily, monthly and provider-floor limits are enforced conservatively',()=>{
 assert.equal(canSpend(P,{used24h:9,used30d:0,providerRemaining:null},3).reason,'OK');
 assert.equal(canSpend(P,{used24h:10,used30d:0,providerRemaining:null},3).reason,'DAILY_CAP');
 assert.equal(canSpend(P,{used24h:0,used30d:198,providerRemaining:null},3).reason,'MONTHLY_CAP');
 assert.equal(canSpend(P,{used24h:0,used30d:0,providerRemaining:62},3).reason,'PROVIDER_FLOOR');
 assert.equal(canSpend(P,{used24h:-1,used30d:0,providerRemaining:null},3).reason,'INVALID');
 assert.equal(canSpend(P,{used24h:0,used30d:0,providerRemaining:1.5},3).reason,'INVALID');
});

test('event choice is earliest-first, skips collected/too-soon/far games and stops at budget',()=>{
 const ev=(id,h)=>({id,commenceTime:new Date(Date.parse('2026-11-07T20:00:00Z')+h*3600_000).toISOString()});
 const r=chooseEvents({events:[ev('e5',5),ev('e1',1),ev('e0',0.1),ev('e2',2),ev('e3',3),ev('e9',30),ev('c',2)],
  alreadyCollected:new Set(['c']),nowIso:'2026-11-07T20:00:00Z',lockBufferMs:600_000,horizonMs:8*3600_000,
  policy:P,state:{used24h:4,used30d:4,providerRemaining:null}});
 // 12-4=8 credits left -> two 3-credit events, even though maxEventsPerRun is 3.
 assert.deepEqual(r.chosen.map(e=>e.id),['e1','e2']);
 assert.deepEqual(Object.fromEntries(r.skipped.map(s=>[s.id,s.reason])),
  {e0:'too_soon',c:'collected',e3:'budget',e5:'budget',e9:'beyond_horizon'});
});

test('budget exhaustion chooses nothing rather than forcing a quota',()=>{
 const r=chooseEvents({events:[{id:'x',commenceTime:'2026-11-07T23:00:00Z'}],alreadyCollected:new Set(),
  nowIso:'2026-11-07T20:00:00Z',lockBufferMs:600_000,horizonMs:8*3600_000,policy:P,
  state:{used24h:12,used30d:12,providerRemaining:500}});
 assert.equal(r.chosen.length,0);
});

test('usage headers are parsed strictly',()=>{
 const h=new Map([['x-requests-remaining','493'],['x-requests-used','7'],['x-requests-last','3x']]);
 assert.deepEqual(providerUsage({get:k=>h.get(k)??null}),{remaining:493,used:7,last:null});
});

test('v2 is active: one collect prices at most two games inside 7 credits per 24 h',()=>{
 assert.equal(ACTIVE_BUDGET_POLICY,BUDGET_POLICY_V2);
 const ev=(id,h)=>({id,commenceTime:new Date(Date.parse('2026-11-07T19:00:00Z')+h*3600_000).toISOString()});
 const fresh=chooseEvents({events:[ev('a',5),ev('b',5.5),ev('c',6)],alreadyCollected:new Set(),nowIso:'2026-11-07T19:00:00Z',
  lockBufferMs:1_200_000,horizonMs:10*3600_000,policy:BUDGET_POLICY_V2,state:{used24h:1,used30d:1,providerRemaining:499}});
 assert.deepEqual(fresh.chosen.map(e=>e.id),['a','b']);           // 1 (list) + 3 + 3 = 7
 assert.equal(canSpend(BUDGET_POLICY_V2,{used24h:7,used30d:7,providerRemaining:490},4).reason,'DAILY_CAP');
 // 30-day share: 200 / 7 per day leaves room for 28 full days.
 assert.equal(canSpend(BUDGET_POLICY_V2,{used24h:0,used30d:196,providerRemaining:300},4).reason,'OK');
 assert.equal(canSpend(BUDGET_POLICY_V2,{used24h:0,used30d:197,providerRemaining:300},4).reason,'MONTHLY_CAP');
});

test('effective policy: stricter of database row and reviewed source; a DB row alone never raises spending',async()=>{
 const {effectiveBudgetPolicy,ACTIVE_BUDGET_POLICY}=await import('./budget.ts');
 assert.equal(effectiveBudgetPolicy(null),ACTIVE_BUDGET_POLICY);
 const loose=effectiveBudgetPolicy({version:'props-budget-v1',daily_credits:12,monthly_credits:200,provider_floor:60});
 assert.deepEqual([loose.version,loose.dailyCredits,loose.monthlyCredits,loose.providerFloor,loose.maxEventsPerRun],['props-budget-v1',7,200,60,2]);
 const tight=effectiveBudgetPolicy({version:'props-budget-v9',daily_credits:3,monthly_credits:50,provider_floor:100});
 assert.deepEqual([tight.dailyCredits,tight.monthlyCredits,tight.providerFloor],[3,50,100]);
 const junk=effectiveBudgetPolicy({version:'x',daily_credits:'n/a',monthly_credits:null,provider_floor:undefined});
 assert.deepEqual([junk.dailyCredits,junk.monthlyCredits,junk.providerFloor],[7,200,60]);
});
