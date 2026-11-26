import test from 'node:test';
import assert from 'node:assert/strict';
import {traceForecasts,TRACE_POLICY} from './forecast-trace.ts';
import {loadForecastTraceRaw} from '../server/props-research-data.ts';

const NOW='2026-11-24T20:00:00Z',START='2026-10-25T20:00:00Z';
const obs=(id,lock,extra={})=>({id,platform:'prizepicks',provider_event_id:'e'+id,home_team:'H',away_team:'A',lock_at:lock,player_name:'P'+id,
 stat:'points',line:20.5,provider_last_update:'2026-11-20T10:00:00Z',ingested_at:'2026-11-20T10:00:00Z',recorded_at:'2026-11-20T10:00:05Z',...extra});
const pred=(id,observation_id,model_version,extra={})=>({id,observation_id,model_version,status:'scored',athlete_id:'a',p_more:0.62,p_less:0.38,p_tie:0,
 data_cutoff:'2026-11-20T10:00:00Z',predicted_at:'2026-11-20T10:00:10Z',mean:22,...extra});
const res=(observation_id,outcome,graded_at,revision=1)=>({observation_id,revision,outcome,actual:outcome.startsWith('void')?null:25,graded_at});
const base=(over={})=>({nowIso:NOW,windowStart:START,control:{state:'RUNNING',reason:''},observations:[],predictions:[],picks:[],results:[],entryLegs:[],...over});

test('every prediction of every model, picked or not, traces to its frozen line, confidence, model and outcome',()=>{
 const t=traceForecasts(base({
  observations:[obs(1,'2026-11-21T00:00:00Z'),obs(2,'2026-11-21T00:00:00Z')],
  predictions:[pred(10,1,'props-nb-minutes-rate-v1'),pred(11,1,'props-learn-v3',{p_more:0.3,p_less:0.7}),pred(12,1,'props-nb-monotone-cal-v1'),
   pred(13,2,'props-nb-minutes-rate-v1')],
  picks:[{id:100,prediction_id:10,selection_version:'props-select-v1',status:'recorded',side:'more'},
   {id:101,prediction_id:13,selection_version:'props-select-v1',status:'skipped',side:null}],
  entryLegs:[{entry_id:7,pick_id:100}],
  results:[res(1,'more','2026-11-21T05:00:00Z'),res(2,'less','2026-11-21T05:00:00Z')]}));
 assert.equal(t.state,'TRACEABLE');assert.equal(t.predictions,4);
 const r=Object.fromEntries(t.rows.map(x=>[x.predictionId,x]));
 assert.deepEqual([r[10].decision,r[11].decision,r[12].decision,r[13].decision],['entered','none','none','skipped']);
 for(const x of t.rows){assert.equal(x.outcome,'graded');assert.equal(x.line,20.5);assert.ok(x.confidence>=0.5);assert.ok(x.modelVersion);}
 assert.equal(r[11].side,'less');assert.equal(r[11].confidence,0.7);assert.equal(r[11].result,'more');
 assert.deepEqual(Object.keys(t.byModel).sort(),['props-learn-v3','props-nb-minutes-rate-v1','props-nb-monotone-cal-v1']);
 assert.equal(t.byModel['props-nb-minutes-rate-v1'].entered,1);assert.equal(t.byModel['props-nb-minutes-rate-v1'].skipped,1);
});

test('a missing outcome is OVERDUE after 36 hours past lock, not silently pending; future grades are ignored',()=>{
 const t=traceForecasts(base({observations:[obs(1,'2026-11-22T00:00:00Z'),obs(2,'2026-11-24T10:00:00Z'),obs(3,'2026-11-25T00:00:00Z')],
  predictions:[pred(1,1,'m'),pred(2,2,'m'),pred(3,3,'m')],results:[res(2,'more','2026-11-25T08:00:00Z')]}));
 assert.deepEqual(t.rows.map(x=>x.outcome),['overdue','pending','pending']);
 assert.equal(t.state,'MISSING_OUTCOMES');assert.equal(t.overdue,1);
 assert.equal(t.examples[0].predictionId,1);
});

test('chronology and integrity breaks are named, never repaired',()=>{
 const t=traceForecasts(base({observations:[obs(1,'2026-11-21T00:00:00Z'),obs(2,'2026-11-21T00:00:00Z')],
  predictions:[pred(1,1,'m',{predicted_at:'2026-11-21T00:00:00Z'}),pred(2,1,'m',{data_cutoff:'2026-11-20T11:00:00Z'}),
   pred(3,1,'m',{predicted_at:'2026-11-20T10:00:01Z'}),pred(4,1,'m',{p_more:0.9,p_less:0.9}),pred(5,1,''),
   pred(6,2,'m'),pred(7,999,'m',{predicted_at:'2026-11-20T10:00:10Z'}),pred(8,1,'m',{predicted_at:'not a date'})],
  results:[res(1,'more','2026-11-21T05:00:00Z'),res(2,'more','2026-11-20T23:00:00Z')]}));
 const issues=Object.fromEntries(t.rows.map(x=>[x.predictionId,x.issues]));
 assert.deepEqual(issues[1],['PREDICTED_AT_OR_AFTER_LOCK']);
 assert.deepEqual(issues[2],['CUTOFF_AFTER_PREDICTION']);
 assert.deepEqual(issues[3],['PREDICTED_BEFORE_LINE_RECORDED']);
 assert.deepEqual(issues[4],['INVALID_PROBABILITIES']);assert.equal(t.rows.find(x=>x.predictionId===4).confidence,null);
 assert.deepEqual(issues[5],['MISSING_MODEL_VERSION']);
 assert.deepEqual(issues[6],['GRADED_BEFORE_LOCK']);
 assert.deepEqual(issues[7],['MISSING_OBSERVATION']);
 assert.deepEqual(issues[8],['INVALID_TIMESTAMP']);
 assert.equal(t.state,'INTEGRITY_ISSUES');
});

test('corrections keep every revision; an early-window prediction without its line is a window edge, not a break',()=>{
 const t=traceForecasts(base({observations:[obs(1,'2026-11-21T00:00:00Z')],
  predictions:[pred(1,1,'m'),pred(2,555,'m',{predicted_at:'2026-10-26T00:00:00Z',data_cutoff:'2026-10-26T00:00:00Z'}),pred(3,2,'m',{status:'unscorable',p_more:null,p_less:null,p_tie:null})],
  results:[res(1,'more','2026-11-21T05:00:00Z',1),res(1,'void_dnp','2026-11-22T05:00:00Z',2)]}));
 const r=t.rows.find(x=>x.predictionId===1);
 assert.equal(r.revisions,2);assert.equal(r.outcome,'void');assert.equal(r.result,'void_dnp');
 assert.equal(t.windowEdgeExcluded,1);
 assert.equal(t.rows.find(x=>x.predictionId===3).outcome,'unscorable');
 assert.equal(TRACE_POLICY.overdueHours,36);
 assert.throws(()=>traceForecasts(base({nowIso:'x'})),/TRACE_INVALID_CLOCK/);
});

test('the trace loader reads every model and selection version, GET-only, with entry legs for all recorded picks',async()=>{
 const calls=[];
 const store={select:async(table,query)=>{calls.push({table,query});
  if(table==='props_control')return [{state:'RUNNING',reason:''}];
  if(table==='props_picks'&&query.includes('offset=0'))return Array.from({length:150},(_,i)=>({id:i+1,prediction_id:i+1,selection_version:i%2?'props-select-v2':'props-select-v1',status:'recorded',side:'more'}));
  return [];}};
 const r=await loadForecastTraceRaw(store,NOW,30);
 const q=t=>calls.filter(c=>c.table===t).map(c=>c.query).join('\n');
 assert.doesNotMatch(q('props_predictions'),/model_version=eq/);
 assert.doesNotMatch(q('props_picks'),/selection_version=eq/);
 assert.equal(calls.filter(c=>c.table==='props_entry_legs').length,2,'150 recorded picks are read in chunks of 100');
 assert.equal(r.windowStart,'2026-10-25T20:00:00.000Z');
 await assert.rejects(loadForecastTraceRaw(store,NOW,91),/INVALID_CLOCK/);
});
