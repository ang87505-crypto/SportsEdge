import test from 'node:test';
import assert from 'node:assert/strict';
import {planNbaResultChecks} from '../settlement-worklist.ts';

const f=(id,start='2026-10-10T19:00:00Z')=>({
  id,game_id:id+100,starts_at:start,games:{home:{name:'Home'},away:{name:'Away'}}
});
const p=id=>({id,forecast_id:id});
const now=Date.parse('2026-10-11T20:00:00Z');
const plan=(x={})=>planNbaResultChecks({positions:[p(1),p(2),p(3)],
  settlements:[],results:[],forecasts:[f(1),f(2),f(3,'2026-10-20T19:00:00Z')],
  now,...x});
test('checks only due open bets and does not query future games',()=>{
  const s=plan();assert.deepEqual(s.toVerify.map(x=>x.game_id),[101,102]);
  assert.deepEqual(s.notStarted,[103]);assert.equal(s.openCount,3);
});
test('no positions means no result provider work or fake settlement',()=>{
  const s=plan({positions:[]});assert.deepEqual(s.toVerify,[]);
  assert.equal(s.settledCount,0);assert.equal(s.openCount,0);
});
test('previously settled bets do not trigger another result request',()=>{
  const s=plan({settlements:[{position_id:1},{position_id:2}]});
  assert.equal(s.settledCount,2);assert.deepEqual(s.toVerify,[]);
  assert.deepEqual(s.notStarted,[103]);
});
test('recorded immutable result is reused rather than fetched twice',()=>{
  const s=plan({results:[{game_id:101}]});
  assert.deepEqual(s.toVerify.map(x=>x.game_id),[102]);
  assert.deepEqual(s.alreadyRecorded,[101]);
});
test('duplicate forecasts for same game cause a single source check',()=>{
  const s=plan({forecasts:[f(1),{...f(2),game_id:101},f(3,'2026-10-20T19:00:00Z')]});
  assert.equal(s.toVerify.length,1);
});
test('one missing forecast is an error rather than an omitted old bet',()=>{
  assert.throws(()=>plan({forecasts:[f(1),f(3)]}),/paginate/);
});
test('full query page must be paginated before scoring',()=>{
  const positions=Array.from({length:1000},(_,i)=>p(i+1));
  assert.throws(()=>plan({positions}),/paginate/);
});
test('bad settlement, position, and provider reference inputs fail closed',()=>{
  assert.throws(()=>plan({positions:[p(1),p(1)]}),/duplicated/);
  assert.throws(()=>plan({settlements:[{position_id:999}]}),/settlement/);
  assert.throws(()=>plan({results:[{game_id:101},{game_id:101}]}),/result/);
  assert.throws(()=>plan({forecasts:[f(1),f(1)]}),/forecast/);
  assert.throws(()=>plan({now:NaN}),/Invalid/);
});
test('fixed timestamp equality does not count as completed game',()=>{
  const s=plan({now:Date.parse('2026-10-10T19:00:00Z')});
  assert.deepEqual(s.toVerify,[]);assert.deepEqual(s.notStarted,[101,102,103]);
});
test('report ordering is stable and independent of input DB order',()=>{
  const s=plan({positions:[p(3),p(2),p(1)]});
  assert.deepEqual(s.toVerify.map(x=>x.game_id),[101,102]);
});
