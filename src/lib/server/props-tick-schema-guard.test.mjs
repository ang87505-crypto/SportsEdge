// A capture tick released before props_capture_v1.sql is applied stops before any provider call (fake store).
import test from 'node:test';
import assert from 'node:assert/strict';
import {runTick} from './props-tick.ts';
import {PropsStoreError} from './props-store.ts';

function deps(selectError){
 const calls={rpc:[],odds:0};
 const store={
  async rpc(fn,args){calls.rpc.push({fn,args});return fn==='props_begin_run'?{outcome:'STARTED',runId:41,abandoned:0,startDelaySeconds:0}:null;},
  async insert(){throw new Error('no insert expected');},
  async select(table){if(table==='props_capture_plans'&&selectError)throw selectError;return [];}};
 const odds={async events(){calls.odds++;throw new Error('no provider call expected');},async eventOdds(){calls.odds++;throw new Error('no provider call expected');}};
 return {calls,d:{store,odds,espn:{},model:{},now:()=>'2026-11-12T18:07:00.000Z',worker:'test',seasonStart:'2026-10-21',trigger:'manual'}};
}
for(const code of ['STORE_HTTP_404','DB_42P01']){
 test(`missing capture schema (${code}): CAPTURE_SCHEMA_MISSING, recorded as failed, zero provider calls`,async()=>{
  const {calls,d}=deps(new PropsStoreError(code,true));
  const r=await runTick(d,'collect-tick-manual-1');
  assert.equal(r.outcome,'CAPTURE_SCHEMA_MISSING');
  assert.equal(calls.odds,0);
  const fin=calls.rpc.find(c=>c.fn==='props_finish_run');
  assert.equal(fin.args.p_status,'failed');assert.equal(fin.args.p_outcome,'CAPTURE_SCHEMA_MISSING');
  assert.match(fin.args.p_summary.reason,/props_capture_v1\.sql is not applied/);
  assert.equal(calls.rpc.some(c=>c.fn==='props_reserve_credits'),false);
 });
}
test('any other store error is not mistaken for a missing schema',async()=>{
 const {calls,d}=deps(new PropsStoreError('STORE_OUTCOME_UNKNOWN',false));
 const r=await runTick(d,'collect-tick-manual-2');
 assert.notEqual(r.outcome,'CAPTURE_SCHEMA_MISSING');
 assert.equal(calls.odds,0);
});
