import test from 'node:test';
import assert from 'node:assert/strict';
import {shadowLedger,SHADOW_STUDY} from './shadow-ledger.ts';

const baseTime='2026-11-14T20:00:00.000Z';
const obs=(id,event='nba-100',platform='prizepicks',other={})=>({
 id,platform,provider_event_id:event,home_team:'Denver Nuggets',away_team:'New York Knicks',
 lock_at:'2026-11-12T23:00:00.000Z',player_name:'Demo Player',stat:'rebounds',line:11.5,
 provider_last_update:'2026-11-12T18:58:00.000Z',
 ingested_at:'2026-11-12T19:00:00.000Z',recorded_at:'2026-11-12T19:00:10.000Z',...other
});
const pred=(id,observation_id=id,p_more=0.62,p_less=0.38,p_tie=0,other={})=>({
 id,observation_id,model_version:'props-nb-minutes-rate-v1',
 status:'scored',athlete_id:'12345',p_more,p_less,p_tie,
 data_cutoff:'2026-11-12T18:55:00.000Z',predicted_at:'2026-11-12T19:00:20.000Z',
 ...other
});
const grade=(observation_id,outcome='more',actual=12,revision=1,graded_at='2026-11-13T03:00:00.000Z')=>({
 observation_id,revision,outcome,actual,graded_at
});
const raw=(o=[obs(1)],p=[pred(1)],results=[grade(1)],picks=[])=>({
 nowIso:baseTime,windowStart:'2026-10-01T00:00:00.000Z',control:{state:'RUNNING',reason:'TEST'},
 observations:o,predictions:p,picks,results,entryLegs:[]
});

test('stores each unique pre-lock >=60% candidate even if not entered, with benchmark not real payouts',()=>{
 const x=shadowLedger(raw());
 assert.equal(x.summary.rows,1);
 const r=x.rows[0];
 assert.equal(r.line,11.5);
 assert.equal(r.side,'more');
 assert.equal(r.probability,0.62);
 assert.equal(r.liveStatus,'no_decision');
 assert.equal(r.outsideLiveBand,false);
 assert.equal(r.state,'win');
 assert.equal(r.hypotheticalNetCents,500);
 assert.equal(r.hypotheticalExpectedNetCents,120);
 assert.equal(x.summary.hypotheticalNetCents,500);
 assert.equal(SHADOW_STUDY.benchmarkDecimalOdds,2);
});
test('losses cost virtual stake, pushes are zero, pending outcomes are null',()=>{
 const os=[obs(1),obs(2,'nba-200','prizepicks',{player_name:'Other Player'}),
  obs(3,'nba-300','prizepicks',{player_name:'Third Player'}),
  obs(4,'nba-400','prizepicks',{player_name:'Fourth Player'})];
 const ps=os.map((o,i)=>pred(i+1,i+1,0.62,0.38,0,{athlete_id:String(12345+i)}));
 const grades=[grade(1,'less',9),grade(2,'tie',11.5),grade(3,'void_dnp',null)];
 const x=shadowLedger(raw(os,ps,grades));
 assert.deepEqual(x.rows.map(r=>r.state).sort(),['loss','pending','push','push']);
 assert.deepEqual(x.rows.map(r=>r.hypotheticalNetCents).sort((a,b)=>(a??1000)-(b??1000)),[-500,0,0,null]);
 assert.equal(x.summary.hypotheticalNetCents,-500);
 assert.equal(x.summary.pending,1);
 assert.equal(x.summary.pushes,2);
});
test('same event, athlete, stat, line on two platforms counts once, first frozen forecast wins',()=>{
 const os=[obs(1),obs(2,'nba-100','pick6',{recorded_at:'2026-11-12T19:01:00.000Z',ingested_at:'2026-11-12T19:00:50.000Z'})];
 const ps=[pred(1),pred(2,2,0.85,0.15,0,{predicted_at:'2026-11-12T19:01:10.000Z'})];
 const x=shadowLedger(raw(os,ps,[grade(1,'more',13),grade(2,'less',8)]));
 assert.equal(x.summary.rows,1);
 assert.equal(x.summary.duplicatesSkipped,1);
 assert.equal(x.rows[0].predictionId,1);
 assert.equal(x.rows[0].hypotheticalNetCents,500);
 assert.equal(x.summary.games,1);
});
test('study includes above 80% but labels exclusion from live rules and does not promote',()=>{
 const x=shadowLedger(raw([obs(1)],[pred(1,1,0.91,0.09,0)],[],[
  {id:4,prediction_id:1,selection_version:'props-select-v1',status:'skipped',side:null}
 ]));
 assert.equal(x.summary.rows,1);
 assert.equal(x.rows[0].outsideLiveBand,true);
 assert.equal(x.rows[0].liveStatus,'skipped');
 assert.equal(x.rows[0].state,'pending');
 assert.equal(x.rows[0].hypotheticalNetCents,null);
});
test('60% threshold is inclusive; under 60% excluded; high tie risk flagged not disguised',()=>{
 const os=[obs(1),obs(2,'nba-200','prizepicks',{player_name:'Other Player'}),
  obs(3,'nba-300','prizepicks',{player_name:'Third Player'})];
 const ps=[pred(1,1,0.60,0.40,0),pred(2,2,0.599,0.401,0,{athlete_id:'2'}),pred(3,3,0.64,0.30,0.06,{athlete_id:'3'})];
 const x=shadowLedger(raw(os,ps,[]));
 assert.equal(x.summary.rows,2);
 assert.equal(x.rows.filter(r=>r.tieRisk).length,1);
});
test('chronology and impossible probabilities reject backfills and future predictions',()=>{
 const os=[obs(1),obs(2,'nba-200','prizepicks',{player_name:'Late Player',recorded_at:'2026-11-13T00:00:00.000Z'}),
  obs(3,'nba-300','prizepicks',{player_name:'Third Player'})];
 const ps=[pred(1,1,0.63,0.4,0),pred(2,2,0.62,0.38,0,{athlete_id:'2'}),
  pred(3,3,0.62,0.38,0,{athlete_id:'3',predicted_at:'2026-11-16T20:00:00.000Z'})];
 const x=shadowLedger(raw(os,ps,[grade(1)]));
 assert.equal(x.summary.rows,0);
 assert.equal(x.summary.invalidSkipped,3);
});
test('grade cannot precede lock or use inconsistent side/actual; revisions pick latest verified',()=>{
 const x=shadowLedger(raw([obs(1)],[pred(1)],[
  grade(1,'more',12,1,'2026-11-13T02:00:00Z'),
  grade(1,'less',9,2,'2026-11-13T04:00:00Z')
 ]));
 assert.equal(x.rows[0].state,'loss');
 const bad=shadowLedger(raw([obs(1)],[pred(1)],[grade(1,'more',8,1,'2026-11-13T04:00:00Z')]));
 assert.equal(bad.rows[0].state,'pending');
 assert.equal(bad.rows[0].hypotheticalNetCents,null);
 const early=shadowLedger(raw([obs(1)],[pred(1)],[grade(1,'more',12,1,'2026-11-12T20:00:00Z')]));
 assert.equal(early.rows[0].state,'pending');
});
test('wrong model versions, malformed data and too many rows fail safely',()=>{
 const wrong=shadowLedger(raw([obs(1)],[pred(1,1,0.63,0.37,0,{model_version:'props-other-v1'})]));
 assert.equal(wrong.summary.rows,0);
 assert.throws(()=>shadowLedger(raw(), 'not-a-time'),/SHADOW_INVALID_TIME/);
 assert.throws(()=>shadowLedger(raw(Array(20001).fill(obs(1))),baseTime),/SHADOW_TOO_MANY_ROWS/);
});
