/** Fail-closed audit of the learning engine and the props safety brake (2026-11-24). Synthetic data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {advance,transition,TRANSITIONS} from './experiments.ts';
import {nextStatus,meetsSample} from './evaluate.ts';
import {forwardResult} from './forward.ts';
import {sportsDrift,DRIFT_POLICY} from './drift.ts';
import {safetyBrake,BRAKE_MIN} from '../../props/brake.ts';

const ROOT=new URL('../../../../',import.meta.url);
const exp=(status,extra={})=>({id:'audit-x',domain:'sports',hypothesisKey:'sports:audit-x',hypothesis:'h',dataDependencies:[],
 frozen:{features:[],parameters:{}},dataCutoff:'2026-11-01T00:00:00Z',codeFingerprint:'c',datasetFingerprints:[],
 metrics:{primary:'brier',secondary:[]},sampleRequirements:{minObservations:500,minDates:14,minClusters:50,minDecisions:100},
 baseline:'b',costAssumptions:null,decisionRule:'r',status,result:null,disposition:null,source:'existing',
 registeredAt:'2026-11-01T00:00:00Z',history:[{at:'2026-11-01T00:00:00Z',from:null,to:status,reason:'seed',inputFingerprint:null}],...extra});
const reg=e=>({schema:'sportsedge-learning-registry-v1',experiments:[e]});
const big={observations:900,dates:20,clusters:80,decisions:150};

test('defect fixed: a PROPOSED experiment can record any legal outcome via RUNNING instead of failing the run',()=>{
 for(const to of ['INSUFFICIENT_DATA','PROMISING','READY_FOR_REVIEW']){
  assert.equal(TRANSITIONS.PROPOSED.includes(to),false,'the lifecycle forbids the direct move');
  assert.throws(()=>transition(reg(exp('PROPOSED')),'audit-x',to,'r','2026-11-24T00:00:00Z','fp'),/ILLEGAL_TRANSITION/);
  const r=advance(reg(exp('PROPOSED')),'audit-x',to,'r','2026-11-24T00:00:00Z','fp');
  const h=r.registry.experiments[0].history.map(x=>x.to);
  assert.deepEqual(h,['PROPOSED','RUNNING',to]);assert.equal(r.changed,true);
  const again=advance(r.registry,'audit-x',to,'r','2026-11-25T00:00:00Z','fp');
  assert.equal(again.changed,false,'the same input is applied once');
 }
 // Terminal and illegal moves still throw: REJECTED never comes back, and nothing skips owner review.
 assert.throws(()=>advance(reg(exp('REJECTED')),'audit-x','RUNNING','r','2026-11-24T00:00:00Z','fp'),/ILLEGAL_TRANSITION/);
 assert.throws(()=>advance(reg(exp('READY_FOR_REVIEW')),'audit-x','PROMISING','r','2026-11-24T00:00:00Z','fp'),/ILLEGAL_TRANSITION/);
});

test('defect fixed end to end: an owner-supplied result for a PROPOSED experiment no longer fails and reverts the whole run',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fail-closed-'));
 const seed=JSON.parse(readFileSync(new URL('research/engine/registry.json',ROOT),'utf8'));
 const proposed=exp('PROPOSED',{id:'audit-proposed',hypothesisKey:'sports:audit-proposed'});
 writeFileSync(join(dir,'seed.json'),JSON.stringify({...seed,experiments:[...seed.experiments,proposed]}));
 writeFileSync(join(dir,'result.json'),JSON.stringify([{experimentId:'audit-proposed',
  result:{evidence:'retrospective',disposition:'PROMISING',observations:5000,reason:'SYNTHETIC audit result'}}]));
 let code=0;
 try{execFileSync(process.execPath,['--experimental-strip-types','--no-warnings','scripts/research-engine.ts','--registry',join(dir,'seed.json'),
  '--out',join(dir,'out'),'--now','2026-11-28T00:00:00Z','--result',join(dir,'result.json')],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
 catch(e){code=e.status;}
 const report=JSON.parse(readFileSync(join(dir,'out','report.json'),'utf8'));
 assert.equal(code,0,'run failed: '+report.failure);assert.equal(report.status,'OK');
 const e=JSON.parse(readFileSync(join(dir,'out','registry.json'),'utf8')).experiments.find(x=>x.id==='audit-proposed');
 assert.deepEqual(e.history.map(h=>h.to),['PROPOSED','RUNNING','PROMISING'],'retrospective evidence stops at PROMISING');
 assert.notEqual(e.status,'READY_FOR_REVIEW');
});

test('missing or invalid evidence can never reach review',()=>{
 const running=exp('RUNNING');
 // Forward PROMISING without the registered sample is held at INSUFFICIENT_DATA.
 assert.equal(nextStatus(running,{evidence:'forward',disposition:'PROMISING',observations:900,reason:'x'}).to,'INSUFFICIENT_DATA');
 assert.equal(nextStatus(running,{evidence:'forward',disposition:'PROMISING',observations:499,dates:20,clusters:80,decisions:150,reason:'x'}).to,'INSUFFICIENT_DATA');
 for(const bad of [NaN,-1,1.5])assert.equal(meetsSample({observations:bad},running.sampleRequirements).ok,false);
 assert.equal(meetsSample({...big,dates:-3},running.sampleRequirements).ok,false);
 // Retrospective evidence, however large, is capped at PROMISING; only forward evidence can request review.
 assert.equal(nextStatus(running,{evidence:'retrospective',disposition:'PROMISING',...big,reason:'x'}).to,'PROMISING');
 assert.equal(nextStatus(running,{evidence:'forward',disposition:'PROMISING',...big,reason:'x'}).to,'READY_FOR_REVIEW');
 assert.equal(nextStatus(running,{evidence:'forward',disposition:'ERROR',...big,reason:'x'}).to,'FAILED');
});

test('stale or absent forward predictions fail closed as ERROR, never as evidence',()=>{
 const spec={kind:'ledger-models',candidate:'c',baseline:'b',maxStaleDays:7};
 const empty={rows:[],refusedAfterLock:0,invalidPredictions:0,excludedBeforeRegistration:0,invalidGrades:0,metadataConflicts:0,unpaired:0,ungraded:0,latestCandidateAt:null};
 assert.equal(forwardResult(spec,empty,'2026-11-28T00:00:00Z').disposition,'ERROR');
 assert.equal(forwardResult(spec,{...empty,latestCandidateAt:'2026-11-10T00:00:00Z'},'2026-11-28T00:00:00Z').disposition,'ERROR');
 const fresh=forwardResult(spec,{...empty,latestCandidateAt:'2026-11-27T00:00:00Z'},'2026-11-28T00:00:00Z');
 assert.equal(fresh.disposition,'NO_CLEAR_EFFECT','no rows: collecting, never promising');
 assert.equal(nextStatus(exp('RUNNING'),fresh).to,'INSUFFICIENT_DATA');
});

function rows({recentPMore,recentOutcomeMore,refPMore=0.6,refOutcomeMore=0.6,n=300,future=0}){
 const out=[];let k=0;const now=Date.parse('2026-11-28T00:00:00Z'),day=86400e3;
 const push=(lockMs,p,hit)=>{const i=k++,more=(i%1000)/1000<hit;
  out.push({key:'k'+i,game:'g'+Math.floor(i/6),date:'d',stat:'points',predictedAt:new Date(lockMs-3600e3).toISOString(),
   lockAt:new Date(lockMs).toISOString(),gradedAt:new Date(lockMs+3600e3).toISOString(),pMore:p,outcome:more?'more':'less',
   picked:'more',modelVersion:'m',lineGapRel:null,minutesCv:null,games:null,booksAgree:null});};
 for(let i=0;i<n;i++)push(now-(8+(i%27))*day,refPMore,refOutcomeMore);
 for(let i=0;i<n;i++)push(now-(1+(i%6))*day,recentPMore,recentOutcomeMore);
 for(let i=0;i<future;i++)push(now+day,0.99,0);   // graded in the future: must be ignored
 return out;
}
test('deterioration and excessive confidence are detected, and only ever request review',()=>{
 const now='2026-11-28T00:00:00Z';
 const worse=sportsDrift(rows({recentPMore:0.8,recentOutcomeMore:0.45}),now);
 assert.equal(worse.status,'REVIEW_REQUESTED');
 assert.ok(worse.changes.some(c=>c.metric==='confidence_gap'&&c.review),'confidence well above hit rate is flagged');
 assert.match(worse.reason,/active model and promotion requirements are unchanged/);
 assert.equal(sportsDrift(rows({recentPMore:0.6,recentOutcomeMore:0.6}),now).status,'NO_CLEAR_DRIFT');
 assert.equal(sportsDrift(rows({recentPMore:0.8,recentOutcomeMore:0.45,n:40}),now).status,'COLLECTING','too little evidence: no conclusion');
 const withFuture=sportsDrift(rows({recentPMore:0.6,recentOutcomeMore:0.6,future:400}),now);
 assert.equal(withFuture.status,'NO_CLEAR_DRIFT','rows graded after now never enter the windows');
 assert.throws(()=>sportsDrift([],'not-a-date'),/INVALID_CLOCK/);
 assert.equal(DRIFT_POLICY.minLinesPerWindow,100);
});

test('the safety brake pauses only a RUNNING control, needs real evidence, and never resumes',()=>{
 const picks=(n,hits)=>Array.from({length:n},(_,i)=>({key:'p'+i,correct:i<hits,gradedAt:new Date(Date.UTC(2026,10,1)+i*3600e3).toISOString()}));
 assert.equal(safetyBrake(picks(120,40),'RUNNING').trip,true,'33% hit rate is confidently below 57.7%');
 assert.equal(safetyBrake(picks(120,40),'PAUSED').trip,false,'already paused: nothing to do');
 assert.equal(safetyBrake(picks(120,40),'STOPPED').trip,false);
 assert.equal(safetyBrake(picks(BRAKE_MIN-1,0),'RUNNING').trip,false,'below the minimum sample: no conclusion');
 assert.equal(safetyBrake(picks(150,95),'RUNNING').trip,false,'63% is not below break-even');
 const dup=[...picks(60,20),...picks(60,20)];
 assert.equal(safetyBrake(dup,'RUNNING').n,60,'duplicate picks count once');
 assert.equal(safetyBrake([],'RUNNING').trip,false);
});
