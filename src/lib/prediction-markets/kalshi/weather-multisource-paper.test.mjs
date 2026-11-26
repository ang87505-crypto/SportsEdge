// PAPER forecasts and grading for knyc-multisource-emos-v1-research. SYNTHETIC data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MULTISOURCE_POLICY,buildAnchorDays} from './weather-multisource.ts';
import {freezeMultisourcePaper,gradeMultisourcePaper,verifyPaperForecast,forwardSummary} from './weather-multisource-paper.ts';
import {forwardEngineResult,MULTISOURCE_EXPERIMENT_ID} from './weather-multisource-readiness.ts';

const S='KNYC_CENTRAL_PARK',DAY=86400e3,DIG='d'.repeat(64),ROOT=new URL('../../../../',import.meta.url);
const addDays=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
function rng(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);
 t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const gauss=r=>Math.sqrt(-2*Math.log(r()+1e-12))*Math.cos(2*Math.PI*r());
function world({days=60,start='2026-10-01',members={NBM:[1,2],GFS_MOS:[-2,3]},seed=11}={}){
 const r=rng(seed),forecasts=[],outcomes=[],truth={};
 for(let i=0;i<days;i++){const d=addDays(start,i),t=Math.round(55+gauss(r)*5);truth[d]=t;
  for(const [m,[b,sd]] of Object.entries(members))for(const c of ['T00:00:00.000Z','T06:00:00.000Z']){const cycle=addDays(d,-1)+c;
   forecasts.push({member:m,station:S,targetLocalDate:d,cycle,availableAt:new Date(Date.parse(cycle)+MULTISOURCE_POLICY.latencyHours[m]*3600e3).toISOString(),
    valueF:Math.round(t-b+gauss(r)*sd),sdF:m==='NBM'?2:null});}
  outcomes.push({station:S,localDate:d,observedHighF:t,observedAvailableAt:addDays(d,1)+'T06:37:00.000Z',provenance:'IEM_AFOS_CLI_ARCHIVE'});}
 return {forecasts,outcomes,truth};
}

test('a paper forecast is frozen only at or before its anchor, from history, and is tamper-evident',()=>{
 const {forecasts,outcomes}=world({days:45});const target='2026-11-14';
 const days=buildAnchorDays(forecasts,outcomes.filter(o=>o.localDate<target),S,'DAY_AHEAD');
 const f=freezeMultisourcePaper(days,target,'DAY_AHEAD','2026-11-13T13:10:00.000Z',DIG);
 assert.equal(f.status,'FROZEN');assert.equal(f.trainingDays,30,'the 30-day window comes from verified history: no forward wait');
 assert.equal(f.ladder.probabilityYesPpm.reduce((a,b)=>a+b,0),1_000_000);assert.ok(f.baselines.NBM_NATIVE&&f.baselines.GFS_MOS_CORRECTED);
 assert.equal(f.marketDataUsed,false);assert.equal(f.exchangeAccess,'DISABLED');
 assert.deepEqual(verifyPaperForecast(JSON.parse(JSON.stringify(f))),f);
 assert.throws(()=>verifyPaperForecast({...f,mu:f.mu+1}),/DIGEST_MISMATCH/);
 assert.throws(()=>freezeMultisourcePaper(days,target,'DAY_AHEAD','2026-11-13T14:00:01.000Z',DIG),/WX_MS_PAPER_AFTER_ANCHOR/);
 // Yesterday's outcome (published 06:37Z today) is admitted only when the freeze is after its publication.
 const early=freezeMultisourcePaper(days,target,'DAY_AHEAD','2026-11-13T06:00:00.000Z',DIG),late=freezeMultisourcePaper(days,target,'DAY_AHEAD','2026-11-13T13:00:00.000Z',DIG);
 assert.notEqual(early.trainingDigest,late.trainingDigest,'the training window is as-of the freeze time');
 const thin=freezeMultisourcePaper(buildAnchorDays(forecasts,outcomes.slice(0,10),S,'DAY_AHEAD'),'2026-10-20','DAY_AHEAD','2026-10-19T13:00:00.000Z',DIG);
 assert.equal(thin.status,'AWAITING_VERIFIED_HISTORY');assert.equal(thin.distribution,null);
 assert.throws(()=>gradeMultisourcePaper(thin,outcomes[19]),/NOTHING_TO_GRADE/);
});

test('grading needs the CLI report of the same day, published after the freeze; baselines are graded beside it',()=>{
 const {forecasts,outcomes}=world({days:45});const target='2026-11-14',o=outcomes.find(x=>x.localDate===target);
 const f=freezeMultisourcePaper(buildAnchorDays(forecasts,outcomes.filter(x=>x.localDate<target),S,'SAME_DAY'),target,'SAME_DAY','2026-11-14T10:10:00.000Z',DIG);
 const g=gradeMultisourcePaper(f,o);
 assert.equal(g.forecastId,f.id);assert.ok(g.combined.crps>=0);assert.ok(g.baselines.NBM_CORRECTED&&g.baselines.CLIMATOLOGY);
 assert.match(g.note,/Not a Kalshi settlement/);
 assert.throws(()=>gradeMultisourcePaper(f,{...o,localDate:'2026-11-15'}),/OUTCOME_MISMATCH/);
 assert.throws(()=>gradeMultisourcePaper(f,{...o,observedAvailableAt:'2026-11-14T09:00:00.000Z'}),/OUTCOME_BEFORE_FORECAST/);
});

test('forward summary: missed anchors are counted, fewer than 50 graded days decide nothing, then the rule applies',()=>{
 const {forecasts,outcomes}=world({days:140,members:{NBM:[1,2.5],GFS_MOS:[-2,2.5]}});
 const records=[],grades=[];
 for(let i=40;i<140;i++){const d=addDays('2026-10-01',i);if(i===70)continue;   // one missed anchor
  const f=freezeMultisourcePaper(buildAnchorDays(forecasts,outcomes.filter(o=>o.localDate<d),S,'DAY_AHEAD'),d,'DAY_AHEAD',addDays(d,-1)+'T13:00:00.000Z',DIG);
  records.push(f);grades.push(gradeMultisourcePaper(f,outcomes.find(o=>o.localDate===d)));}
 const few=forwardSummary(records.slice(0,30),grades.slice(0,30),'2027-03-01T00:00:00Z').find(s=>s.anchor==='DAY_AHEAD');
 assert.equal(few.graded,30);assert.equal(few.disposition,'NO_CLEAR_EFFECT');assert.match(few.reason,/30\/50/);assert.deepEqual(few.missedSince,[]);
 const all=forwardSummary(records,grades,'2027-03-01T00:00:00Z'),da=all.find(s=>s.anchor==='DAY_AHEAD'),sd=all.find(s=>s.anchor==='SAME_DAY');
 assert.equal(da.graded,99);assert.equal(sd.frozen,0);assert.deepEqual(da.missedSince,['2026-12-10'],'a skipped anchor is counted, never filled in');
 assert.equal(da.disposition,'PROMISING',da.reason);assert.ok(['NBM_CORRECTED','GFS_MOS_CORRECTED','NBM_NATIVE'].includes(da.vsBest.against));
 const e=forwardEngineResult(all);assert.equal(e.result.evidence,'forward');assert.equal(e.result.disposition,'NO_CLEAR_EFFECT','SAME_DAY has no forward days');
 assert.equal(e.experimentId,MULTISOURCE_EXPERIMENT_ID);
});

// ---- end to end: the daily script on synthetic retrieval output and a synthetic research-data tree
const MON=['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
const AB=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],WD=['SUN','MON','TUE','WED','THU','FRI','SAT'];
function cliText(d,max){const n=new Date(Date.parse(addDays(d,1)+'T00:00:00Z')),r=new Date(Date.parse(d+'T00:00:00Z'));
 return ['CDUS41 KOKX '+String(n.getUTCDate()).padStart(2,'0')+'0637','CLINYC','','CLIMATE REPORT','NATIONAL WEATHER SERVICE NEW YORK, NY',
  `137 AM EST ${WD[n.getUTCDay()]} ${AB[n.getUTCMonth()]} ${n.getUTCDate()} ${n.getUTCFullYear()}`,'','...................................','',
  `...THE CENTRAL PARK NY CLIMATE SUMMARY FOR ${MON[r.getUTCMonth()]} ${r.getUTCDate()} ${r.getUTCFullYear()}...`,'','CLIMATE NORMAL PERIOD 1991 TO 2020','',
  'WEATHER ITEM OBSERVED TIME RECORD YEAR NORMAL','TEMPERATURE (F)',' YESTERDAY',`   MAXIMUM         ${max}   1211 AM  73  1931`,
  '   MINIMUM         38    923 AM  23  2019','   AVERAGE         45','PRECIPITATION (IN)',' TODAY            0.26','$$',''].join('\n');}
function fixture(retrievedAt,lastDay){
 const dir=mkdtempSync(join(tmpdir(),'wx-paper-')),inp=join(dir,'in'),cli=join(dir,'cli'),data=join(dir,'research-data');
 for(const p of [inp,cli,data])mkdirSync(p,{recursive:true});
 const {forecasts,truth}=world({days:62});
 const row=(m,f)=>`KNYC,${m},${f.cycle.slice(0,16).replace('T',' ')},${addDays(f.targetLocalDate,1)} 00:00,${f.valueF}${m==='NBS'?','+f.sdF:',60'}`;
 const g=['station,model,runtime,ftime,n_x,tmp',...forecasts.filter(f=>f.member==='GFS_MOS'&&f.targetLocalDate<=lastDay).map(f=>row('GFS',f))].join('\n')+'\n';
 const n=['station,model,runtime,ftime,txn,xnd',...forecasts.filter(f=>f.member==='NBM'&&f.targetLocalDate<=lastDay).map(f=>row('NBS',f))].join('\n')+'\n';
 writeFileSync(join(inp,'gfs-w.csv'),g);writeFileSync(join(inp,'nbs-w.csv'),n);writeFileSync(join(inp,'cli-w.zip'),'zip-bytes');
 for(const [d,t] of Object.entries(truth))if(addDays(d,1)<=lastDay)writeFileSync(join(cli,d+'.txt'),cliText(d,t));
 const h=p=>createHash('sha256').update(readFileSync(join(inp,p))).digest('hex');
 writeFileSync(join(inp,'receipt.json'),JSON.stringify({status:'RETRIEVED_UNVALIDATED',exchange_requests:0,retrieved_at:retrievedAt,
  files:['gfs-w.csv','nbs-w.csv','cli-w.zip'].map(name=>({name,sha256:h(name)}))}));
 return {dir,inp,cli,data,truth};
}
const run=(x,now)=>{const o=execFileSync(process.execPath,['--experimental-strip-types','--no-warnings','scripts/kalshi-weather-multisource-paper.ts',
 '--inputs',x.inp,'--cli-dir',x.cli,'--data',x.data,'--now',now],{cwd:ROOT,encoding:'utf8'});
 return JSON.parse(o.split('\n')[o.split('\n').indexOf('MULTISOURCE_PAPER_BEGIN')+1]);};

test('end to end: the daily job freezes both anchors before them, refuses late or stale runs, grades next day, never rewrites',()=>{
 const x=fixture('2026-11-28T10:00:00Z','2026-11-29');
 const base=join(x.data,'kalshi-independent','nyc-weather','multisource-v1');
 const a=run(x,'2026-11-28T10:10:00.000Z');
 assert.deepEqual(a.frozenNow.sort(),['2026-11-28-SAME_DAY','2026-11-29-DAY_AHEAD']);
 assert.equal(a.readiness.paperForecasting.status,'READY');assert.equal(a.readiness.ownerReview.status,'NOT_READY');assert.equal(a.readiness.exchange,'DISABLED');
 const before=readFileSync(join(base,'forecasts','2026-11-28-SAME_DAY.json'),'utf8');
 const again=run(x,'2026-11-28T10:20:00.000Z');assert.deepEqual(again.frozenNow,[]);assert.equal(again.skipped['2026-11-28-SAME_DAY'],'ALREADY_FROZEN');
 assert.equal(readFileSync(join(base,'forecasts','2026-11-28-SAME_DAY.json'),'utf8'),before,'never rewritten');
 // Stale inputs (retrieved more than 3 h earlier) never produce a fresh forecast.
 const stale=fixture('2026-11-28T04:00:00Z','2026-11-29');
 assert.match(run(stale,'2026-11-28T10:10:00.000Z').skipped['2026-11-28-SAME_DAY'],/INPUTS_NOT_FRESH/);
 // After the anchor: refused, and counted as missed later.
 assert.equal(run(fixture('2026-11-28T11:30:00Z','2026-11-29'),'2026-11-28T11:30:00.000Z').skipped['2026-11-28-SAME_DAY'],'ANCHOR_PASSED');
 // Next day: the archived CLI report for Nov 28 (published Nov 29 06:37Z, after the freeze) grades it.
 const y=fixture('2026-11-29T10:00:00Z','2026-11-30');
 const b=run({...y,data:x.data},'2026-11-29T10:05:00.000Z');
 assert.ok(b.gradedNow.includes('2026-11-28-SAME_DAY'),JSON.stringify(b.gradedNow));
 assert.ok(existsSync(join(base,'grades','2026-11-28-SAME_DAY.json')));
 assert.equal(b.engineResult.result.evidence,'forward');assert.equal(readdirSync(join(base,'scorecards')).length>=3,true);
});

test('learning engine reads the newest forward scorecard and records forward evidence without skipping review gates',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wx-engine-fwd-')),sc=join(dir,'multisource-v1','scorecards');mkdirSync(sc,{recursive:true});
 const summary=['DAY_AHEAD','SAME_DAY'].map(anchor=>({anchor,frozen:20,awaitingHistory:0,graded:20,ungraded:0,missedSince:[],firstDate:null,lastDate:null,
  meanCrps:{},coverage80:null,vsBest:{against:null,n:0,mean:null,lower95:null,upper95:null},disposition:'NO_CLEAR_EFFECT',reason:'20/50 graded forward days.'}));
 writeFileSync(join(sc,'2026-12-20T1010Z.json'),JSON.stringify({schema:'kalshi-weather-multisource-paper-scorecard-v1',summary,engineResult:forwardEngineResult(summary)}));
 execFileSync(process.execPath,['--experimental-strip-types','--no-warnings','scripts/research-engine.ts','--registry','research/engine/registry.json',
  '--out',join(dir,'out'),'--now','2026-12-20T12:00:00Z','--weather-forward',join(dir,'multisource-v1')],{cwd:ROOT,stdio:['ignore','pipe','pipe']});
 const rep=JSON.parse(readFileSync(join(dir,'out','report.json'),'utf8')),reg=JSON.parse(readFileSync(join(dir,'out','registry.json'),'utf8'));
 assert.equal(rep.status,'OK',rep.failure);assert.equal(rep.domains.weather.scorecard,'2026-12-20T1010Z.json');
 const e=reg.experiments.find(x=>x.id===MULTISOURCE_EXPERIMENT_ID);
 assert.deepEqual(e.history.map(h=>h.to),['PROPOSED','RUNNING','INSUFFICIENT_DATA'],'forward evidence below the minimum is INSUFFICIENT_DATA');
 writeFileSync(join(sc,'2026-12-21T1010Z.json'),JSON.stringify({schema:'other',engineResult:{result:{evidence:'forward'}}}));
 let failed=false;try{execFileSync(process.execPath,['--experimental-strip-types','--no-warnings','scripts/research-engine.ts','--registry','research/engine/registry.json',
  '--out',join(dir,'out2'),'--now','2026-12-21T12:00:00Z','--weather-forward',join(dir,'multisource-v1')],{cwd:ROOT,stdio:['ignore','pipe','pipe']});}catch{failed=true;}
 assert.equal(failed,true,'an invalid scorecard fails the run closed');
});
