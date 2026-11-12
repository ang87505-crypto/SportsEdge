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

test('per-run counts come from the saved rows: decisions, qualifying picks and entries stay separate',async()=>{
 const picks=[...Array(36)].map((_,i)=>({run_id:10,status:i<10?'recorded':'skipped'}));
 const store={select:async(t,q)=>{
  if(t==='props_runs')return [{id:10,kind:'collect',slot_key:'collect-2026-11-09T19',status:'completed',outcome:'COMPLETED',
   started_at:'2026-11-10T02:00:07Z',finished_at:'2026-11-10T02:00:14Z',start_delay_seconds:24607,summary:{receipt:{picks:36}}},
   {id:9,kind:'settle',slot_key:'settle-2026-11-09T15',status:'completed',outcome:'COMPLETED',started_at:'x',finished_at:'x',start_delay_seconds:1,summary:{}}];
  if(t==='props_picks'&&q.startsWith('select=run_id,status')){assert.match(q,/run_id=in\.\(10\)/);return picks;}
  if(t==='props_entries'&&q.startsWith('select=run_id'))return [];
  return [];
 },rpc:async()=>{},insert:async()=>{}};
 const r=await loadPropsDashboardFrom(store,'2026-11-10T05:00:00Z');
 assert.deepEqual(r.runCounts,{'10':{decisions:36,qualifyingPicks:10,entries:0}});
 // If the rows cannot be read, the counts are absent (shown as unknown), never a partial number.
 const failing={...store,select:async(t,q)=>{if(t==='props_picks'&&q.startsWith('select=run_id'))throw new Error('down');return store.select(t,q);}};
 assert.equal((await loadPropsDashboardFrom(failing,'2026-11-10T05:00:00Z')).runCounts,null);
});

test('v3 dashboard uses active database limits and confirmed charges; missing receipts stay reserved',async()=>{
 const credits=[
  {id:11,credits:1,reserved_at:'2026-11-10T16:00:00Z'},
  {id:12,credits:3,reserved_at:'2026-11-10T16:01:00Z'},
  {id:13,credits:3,reserved_at:'2026-11-10T16:02:00Z'},
 ];
 const store={select:async(t,q)=>{
  if(t==='props_credit_reservations'){assert.match(q,/select=id,credits,reserved_at/);return credits;}
  if(t==='props_budget_policy')return [{version:'props-budget-v3',daily_credits:7,monthly_credits:200,
   provider_floor:60,count_provider_actuals:true}];
  if(t==='props_provider_usage'&&q.startsWith('select=reservation_id,requests_last'))return [
   {reservation_id:11,requests_last:0},{reservation_id:12,requests_last:2},
  ];
  return [];
 }};
 const r=await loadPropsDashboardFrom(store,'2026-11-10T21:00:00Z');
 assert.equal(r.budgetPolicy.version,'props-budget-v3');
 assert.equal(r.budgetPolicy.count_provider_actuals,true);
 assert.deepEqual(r.credits.map(c=>c.effective_credits),[0,2,3]); // unknown third charge is never assumed free
});

test('pre-v3 policy falls back to conservative reservations when column is missing',async()=>{
 const store={select:async(t,q)=>{
  if(t==='props_budget_policy'){
   if(q.includes('count_provider_actuals'))throw new Error('column does not exist');
   return [{version:'props-budget-v2',daily_credits:7,monthly_credits:200,provider_floor:60}];
  }
  if(t==='props_credit_reservations')return [{id:21,credits:3,reserved_at:'2026-11-10T20:00:00Z'}];
  return [];
 }};
 const r=await loadPropsDashboardFrom(store,'2026-11-10T21:00:00Z');
 assert.equal(r.budgetPolicy.count_provider_actuals,false);
 assert.equal(r.credits[0].effective_credits,3);
});

test('runs are read per kind, so a day of capture ticks never pushes settles out of view',async()=>{
 const seen=[];
 const store={select:async(t,q)=>{
  if(t==='props_runs'){seen.push(q);
   if(q.includes('kind=eq.collect'))return Array.from({length:30},(_,i)=>({id:900-i,kind:'collect',slot_key:'collect-tick-x'+i,status:'completed',outcome:'NOTHING_DUE',started_at:'2026-11-10T20:00:00Z',finished_at:null,start_delay_seconds:null,summary:{}}));
   if(q.includes('kind=in.(settle,backfill)'))return [{id:12,kind:'settle',slot_key:'settle-2026-11-10T09',status:'completed',outcome:'COMPLETED',started_at:'2026-11-10T10:33:00Z',finished_at:'2026-11-10T10:33:38Z',start_delay_seconds:4390,summary:{}}];
  }
  return [];}};
 const r=await loadPropsDashboardFrom(store,'2026-11-10T21:00:00Z');
 assert.equal(seen.length,2);
 assert.equal(r.runs.length,31);assert.equal(r.runs.at(-1).kind,'settle');
 assert.ok(r.runs.every((x,i,a)=>i===0||a[i-1].id>x.id));
});
