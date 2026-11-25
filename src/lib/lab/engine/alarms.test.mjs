import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sportsAlarms,ALARM_POLICY} from './alarms.ts';

const NOW='2026-11-28T00:00:00Z',day=86400e3,now=Date.parse(NOW);
const ROOT=new URL('../../../../',import.meta.url);
/** SYNTHETIC picks: confidence `conf` on the picked side, `hit` share correct, spread over `games` games in the last `days`. */
function picks(n,conf,hit,{games=40,days=25,picked='more'}={}){
 return Array.from({length:n},(_,i)=>{const lock=now-(1+(i%days))*day,correct=(i%100)/100<hit;
  return {key:'k'+i,game:'g'+(i%games),date:'d',stat:'points',predictedAt:new Date(lock-3600e3).toISOString(),lockAt:new Date(lock).toISOString(),
   gradedAt:new Date(lock+3600e3).toISOString(),pMore:picked==='more'?conf:1-conf,outcome:correct?picked:(picked==='more'?'less':'more'),picked,
   modelVersion:'m',lineGapRel:null,minutesCv:null,games:null,booksAgree:null};});
}
const fresh={scored:500,locked:480,graded:478,overdue:2,contradictoryGrades:0,
 newestPredictedAt:new Date(now-0.5*day).toISOString(),newestGradedAt:new Date(now-0.6*day).toISOString()};
const codes=r=>r.alarms.map(a=>a.code).sort();

test('a calibrated, accurate, fresh ledger raises no alarm',()=>{
 const r=sportsAlarms(picks(200,0.64,0.64),fresh,null,NOW);
 assert.equal(r.status,'OK');assert.deepEqual(r.alarms,[]);
 assert.match(r.reason,/does not establish accuracy or profitability/);
});

test('absolute overconfidence is detected even when it never changed (drift cannot see it)',()=>{
 const r=sportsAlarms(picks(300,0.72,0.60),fresh,{status:'NO_CLEAR_DRIFT'},NOW);
 assert.deepEqual(codes(r),['OVERCONFIDENT']);assert.ok(r.calibration.lower95>0.03);
 assert.match(r.reason,/unchanged by this report/);
 // Below the minimum sample: no conclusion either way.
 assert.equal(sportsAlarms(picks(60,0.72,0.60),fresh,null,NOW).status,'COLLECTING');
 assert.equal(sportsAlarms(picks(300,0.72,0.60,{games:10}),fresh,null,NOW).status,'COLLECTING','too few games');
});

test('accuracy confidently below break-even is detected',()=>{
 const r=sportsAlarms(picks(200,0.55,0.45),fresh,null,NOW);   // exactly 90/200 correct
 assert.ok(codes(r).includes('ACCURACY_BELOW_BREAK_EVEN'));
 assert.equal(sportsAlarms(picks(30,0.55,0.30),fresh,null,NOW).alarms.some(a=>a.code==='ACCURACY_BELOW_BREAK_EVEN'),false,'fewer than 50 picks');
});

test('missing and contradictory outcomes, stale predictions and stale outcomes are detected',()=>{
 const p=picks(200,0.64,0.64);
 assert.deepEqual(codes(sportsAlarms(p,{...fresh,overdue:20},null,NOW)),['MISSING_OUTCOMES']);
 assert.deepEqual(codes(sportsAlarms(p,{...fresh,overdue:5,locked:1000},null,NOW)),[],'0.5% overdue is within tolerance');
 assert.deepEqual(codes(sportsAlarms(p,{...fresh,contradictoryGrades:1},null,NOW)),['CONTRADICTORY_GRADES']);
 assert.deepEqual(codes(sportsAlarms(p,{...fresh,newestPredictedAt:new Date(now-5*day).toISOString()},null,NOW)),['STALE_PREDICTIONS']);
 assert.deepEqual(codes(sportsAlarms(p,{...fresh,newestGradedAt:new Date(now-4*day).toISOString()},null,NOW)),['STALE_OUTCOMES']);
 assert.deepEqual(codes(sportsAlarms(p,{...fresh,newestGradedAt:null},null,NOW)),['STALE_OUTCOMES'],'locked lines but never a grade');
 const idle=sportsAlarms([],{...fresh,newestPredictedAt:new Date(now-30*day).toISOString(),newestGradedAt:new Date(now-30*day).toISOString(),overdue:0},null,NOW);
 assert.equal(idle.status,'IDLE','an off-season ledger is idle, not reported fresh');
});

test('relative deterioration from the drift rule is carried into the alarm list; a bad clock fails',()=>{
 const r=sportsAlarms(picks(200,0.64,0.64),fresh,{status:'REVIEW_REQUESTED',reason:'Recent probability errors worsened.'},NOW);
 assert.deepEqual(codes(r),['PERFORMANCE_DETERIORATED']);
 assert.throws(()=>sportsAlarms([],fresh,null,'nope'),/ALARM_INVALID_CLOCK/);
 assert.equal(ALARM_POLICY.version,'sports-alarms-v1');
});

test('end to end: the engine reports alarms from ledger coverage and changes nothing because of them',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alarms-'));
 writeFileSync(join(dir,'rows.json'),JSON.stringify(picks(300,0.72,0.60)));
 writeFileSync(join(dir,'fwd.json'),JSON.stringify({predictions:[],grades:[]}));
 writeFileSync(join(dir,'coverage.json'),JSON.stringify({...fresh,overdue:30}));
 const args=['--experimental-strip-types','--no-warnings','scripts/research-engine.ts','--registry','research/engine/registry.json',
  '--out',join(dir,'out'),'--now',NOW,'--sports-rows',join(dir,'rows.json'),'--forward-input',join(dir,'fwd.json'),'--sports-coverage',join(dir,'coverage.json')];
 execFileSync(process.execPath,args,{cwd:ROOT,stdio:['ignore','pipe','pipe']});
 const report=JSON.parse(readFileSync(join(dir,'out','report.json'),'utf8'));
 assert.equal(report.status,'OK');
 assert.deepEqual(report.domains.sports.alarms.alarms.map(a=>a.code).sort(),['MISSING_OUTCOMES','OVERCONFIDENT']);
 const seed=JSON.parse(readFileSync(new URL('research/engine/registry.json',ROOT),'utf8'));
 const out=JSON.parse(readFileSync(join(dir,'out','registry.json'),'utf8'));
 for(const e of seed.experiments)assert.equal(out.experiments.find(x=>x.id===e.id)?.status,e.status,'alarms never move an experiment');
});
