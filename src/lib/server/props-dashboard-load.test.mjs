// Dashboard loader against a fake store that enforces the real query-length cap. Synthetic TEST-ONLY rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPropsDashboardFrom} from './props-dashboard-load.ts';

test('review fix: a busy fortnight of lines never exceeds the query-length cap',async()=>{
 const N=900;
 const obs=Array.from({length:N},(_,i)=>({id:100000+i,platform:'prizepicks',provider_event_id:'evtTEST000001',home_team:'H',away_team:'A',
  lock_at:'2026-11-08T00:00:00Z',player_name:'P'+i,stat:'points',line:20.5,provider_last_update:'2026-11-07T19:00:00Z',ingested_at:'2026-11-07T19:05:00Z'}));
 const longest={n:0};
 const store={select:async(t,q)=>{
  if(q.length>3000)throw new Error('TABLE_NOT_ALLOWED: query too long for '+t);
  longest.n=Math.max(longest.n,q.length);
  if(t==='props_observations')return obs;
  if(t==='props_predictions'){const ids=/observation_id=in\.\(([^)]*)\)/.exec(q)[1].split(',').map(Number);
   return ids.map(id=>({id:id+1000000,observation_id:id,model_version:'props-nb-minutes-rate-v1',status:'scored',reason:'ok',p_more:0.6,p_less:0.4,p_tie:0,mean:21,inputs:{}}));}
  return [];
 },rpc:async()=>{},insert:async()=>{}};
 const r=await loadPropsDashboardFrom(store,'2026-11-08T12:00:00Z');
 assert.equal(r.observations.length,N);
 assert.equal(r.predictions.length,N);
 assert.ok(longest.n<=3000);
});
