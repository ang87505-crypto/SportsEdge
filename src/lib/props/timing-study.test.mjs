// Timing study: prospective-only comparison, no invented opening/closing lines, CLV only when comparable,
// uncertainty and sample-size gates. Synthetic rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {timingStudy,compareArms,wilson,groupStats} from './timing-study.ts';

const MV='props-nb-minutes-rate-v1';
function fixture(){
 const obs=[],preds=[],picks=[],results=[];let id=0;
 const add=(run,platform,event,player,stat,line,ingested,lock,{pMore=0.65,pick=true,side='more',outcome='more'}={})=>{
  const o={id:++id,run_id:run,platform,provider_event_id:event,player_name:player,stat,line,lock_at:lock,ingested_at:ingested,provider_last_update:new Date(Date.parse(ingested)-30_000).toISOString()};
  obs.push(o);preds.push({id:o.id,observation_id:o.id,model_version:MV,status:'scored',p_more:pMore,p_less:1-pMore-0.02});
  if(pick)picks.push({id:o.id,prediction_id:o.id,status:'recorded',side,selection_version:'props-select-v1'});
  else picks.push({id:o.id,prediction_id:o.id,status:'skipped',side:null,selection_version:'props-select-v1'});
  if(outcome)results.push({observation_id:o.id,revision:1,outcome});
  return o;
 };
 // Run 10: a tick capturing evtEARLY (EARLY arm) 8 h before tip; run 11: a recheck 60 min before tip (line moved up).
 const tip='2026-11-13T01:00:00.000Z';
 const a=add(10,'prizepicks','evtEARLY01','P One','points',22.5,'2026-11-12T17:00:00.000Z',tip,{outcome:'more'});
 add(11,'prizepicks','evtEARLY01','P One','points',23.5,'2026-11-13T00:00:00.000Z',tip,{pick:false,outcome:'more'});
 // Same game, pick6, no later observation: no closing, no CLV.
 add(10,'pick6','evtEARLY01','P One','points',23.5,'2026-11-12T17:00:00.000Z',tip,{outcome:'less'});
 // Run 12: LATE arm game, captured 2 h before; a skipped line.
 add(12,'prizepicks','evtLATE001','P Two','rebounds',7.5,'2026-11-12T23:30:00.000Z','2026-11-13T01:30:00.000Z',{side:'less',pMore:0.3,outcome:'less'});
 add(12,'prizepicks','evtLATE001','P Three','assists',4.5,'2026-11-12T23:30:00.000Z','2026-11-13T01:30:00.000Z',{pick:false,pMore:0.52,outcome:'tie'});
 // Run 5: a legacy slot collect (no plan): observational only.
 add(5,'prizepicks','evtLEGACY1','P Four','points',18.5,'2026-11-09T02:00:00.000Z','2026-11-09T03:00:00.000Z',{outcome:'less'});
 const plans=[{provider_event_id:'evtEARLY01',slate_date:'2026-11-12',arm:'early',selected:true,planned_at:'2026-11-11T21:00:00Z'},
  {provider_event_id:'evtLATE001',slate_date:'2026-11-12',arm:'late',selected:true,planned_at:'2026-11-11T21:00:00Z'}];
 const captures=[{run_id:10,provider_event_id:'evtEARLY01',capture_key:'primary',window_name:'early',claimed_at:'2026-11-12T17:00:00Z'},
  {run_id:11,provider_event_id:'evtEARLY01',capture_key:'recheck',window_name:'late',claimed_at:'2026-11-13T00:00:00Z'},
  {run_id:12,provider_event_id:'evtLATE001',capture_key:'primary',window_name:'late',claimed_at:'2026-11-12T23:30:00Z'}];
 return {nowIso:'2026-11-13T09:00:00Z',observations:obs,predictions:preds,picks,results,legs:[{entry_id:1,pick_id:a.id},{entry_id:1,pick_id:4}],
  entries:[{id:1,account_id:1,stake_cents:500}],accounts:[{id:1,platform:'prizepicks'}],settlements:[{entry_id:1,outcome:'won',profit_cents:1000}],
  plans,captures,modelVersion:MV};
}

test('prospective picks are grouped by assigned arm; legacy slot lines stay observational',()=>{
 const s=timingStudy(fixture());
 assert.equal(s.counts.qualifyingPicks,4);
 assert.equal(s.counts.prospectivePicks,3);
 assert.equal(s.counts.observationalPicks,1);
 assert.equal(s.picks.byArm.early.lines,2);assert.equal(s.picks.byArm.late.lines,1);
 assert.equal(s.picks.byArm.early.wins,1);assert.equal(s.picks.byArm.early.graded,2);
 assert.equal(s.picks.observational.lines,1);
 // The recheck observation never becomes a pick or a prospective line of its own.
 assert.ok(s.rows.every(r=>r.captureKey!=='recheck'));
});

test('first observed is ours, closing only when a comparable late observation exists, CLV signed for the pick side',()=>{
 const s=timingStudy(fixture());
 const pp=s.rows.find(r=>r.platform==='prizepicks'&&r.event==='evtEARLY01');
 assert.equal(pp.firstObservedLine,22.5);assert.equal(pp.lineChanges,1);
 assert.deepEqual(pp.closing,{line:23.5,minutesToTip:60});
 assert.equal(pp.clvPoints,1);                                          // took More at 22.5, closed 23.5
 const p6=s.rows.find(r=>r.platform==='pick6');
 assert.equal(p6.closing,null);assert.equal(p6.clvPoints,null);          // never invented
 assert.match(s.definitions.firstObserved,/not the market opening line/);
 const late=s.rows.find(r=>r.event==='evtLATE001');assert.equal(late.side,'less');assert.equal(late.outcome,'win');
});

test('entries: PrizePicks dollars are attributed only to single-arm entries; mixed entries are labelled mixed',()=>{
 const s=timingStudy(fixture());
 assert.deepEqual(Object.keys(s.entries.prizepicks),['mixed']);         // one EARLY leg + one LATE leg
 assert.equal(s.entries.prizepicks.mixed.profitCents,1000);assert.equal(s.entries.prizepicks.mixed.roi,2);
});

test('minutes-to-tip and quote-age buckets cover every pick',()=>{
 const s=timingStudy(fixture());
 const total=Object.values(s.picks.byMinutesToTip).reduce((a,g)=>a+g.lines,0);
 assert.equal(total,4);
 assert.equal(s.picks.byMinutesToTip['6h+'].lines,2);
 assert.equal(s.picks.byQuoteAge['<=1m'].lines,4);
});

test('the comparison stays INSUFFICIENT_DATA below the sample gates and reports a bootstrap interval when it can',()=>{
 const s=timingStudy(fixture());
 assert.equal(s.comparison.picks.verdict,'INSUFFICIENT_DATA');
 const mk=(arm,slates,perSlate,winRate,seed)=>{let k=seed;const rows=[];
  for(let d=0;d<slates;d++)for(let i=0;i<perSlate;i++){k=(k*1103515245+12345)%2147483648;
   rows.push({arm,slate:'s'+arm+d,event:'e'+arm+d,outcome:k/2147483648<winRate?'win':'loss'});}return rows;};
 const same=compareArms(mk('early',30,8,0.55,1),mk('late',30,8,0.55,2));
 assert.equal(same.verdict,'NO_CLEAR_DIFFERENCE');assert.ok(same.ci95[0]<0&&same.ci95[1]>0);
 const diff=compareArms(mk('early',40,10,0.70,3),mk('late',40,10,0.45,4));
 assert.equal(diff.verdict,'EARLY_BETTER');assert.ok(diff.ci95[0]>0);
 const small=compareArms(mk('early',5,8,0.9,5),mk('late',5,8,0.1,6));
 assert.equal(small.verdict,'INSUFFICIENT_DATA');assert.ok(small.difference>0.5);   // a big gap on 5 slates is not a finding
 // Deterministic.
 assert.deepEqual(compareArms(mk('early',30,8,0.55,1),mk('late',30,8,0.55,2)),same);
});

test('Wilson interval and group stats basics',()=>{
 const [lo,hi]=wilson(55,100);assert.ok(lo>0.45&&lo<0.46&&hi>0.64&&hi<0.65);
 assert.equal(wilson(0,0),null);
 const g=groupStats([]);assert.equal(g.hitRate,null);assert.equal(g.calibrationGap,null);
});
