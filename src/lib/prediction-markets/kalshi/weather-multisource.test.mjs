// knyc-multisource-emos-v1-research: model, evaluation, archive adapters and readiness. SYNTHETIC data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MULTISOURCE_POLICY,anchorAt,anchorLeadHours,selectMembers,buildAnchorDays,trainingWindow,gaussianPmf,integerCrps,
 multisourceForecast,pmfEventProbabilitiesPpm,intervalCovers,gaussianIntegerCrps} from './weather-multisource.ts';
import {evaluateAnchor,evaluateMultisource,blockBootstrap} from './weather-multisource-eval.ts';
import {parseIemMosCsv,parseCliArchive,utcIso} from './weather-archive-adapter.ts';
import {engineResult,paperReadiness,MULTISOURCE_EXPERIMENT_ID} from './weather-multisource-readiness.ts';
import {independentLadder} from './weather-contract-eval.ts';

const S='KNYC_CENTRAL_PARK',DAY=86400e3;
const addDays=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
function rng(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);
 t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const gauss=r=>Math.sqrt(-2*Math.log(r()+1e-12))*Math.cos(2*Math.PI*r());
/** Truth plus members with fixed biases and independent noise; outcomes published next morning. */
function world({days=160,start='2025-01-01',members={NBM:[1.5,2],GFS_MOS:[-2,3.5]},seed=7,xnd=2}={}){
 const r=rng(seed),forecasts=[],outcomes=[];
 for(let i=0;i<days;i++){const d=addDays(start,i),truth=50+15*Math.sin(i/58)+gauss(r)*4;
  for(const [m,[bias,sd]] of Object.entries(members)){
   const cycle=addDays(d,-1)+'T06:00:00.000Z',lat=MULTISOURCE_POLICY.latencyHours[m]??2;
   forecasts.push({member:m,station:S,targetLocalDate:d,cycle,availableAt:new Date(Date.parse(cycle)+lat*3600e3).toISOString(),
    valueF:Math.round(truth-bias+gauss(r)*sd),sdF:m==='NBM'?xnd:null});}
  outcomes.push({station:S,localDate:d,observedHighF:Math.round(truth),observedAvailableAt:addDays(d,1)+'T06:37:00.000Z',provenance:'IEM_AFOS_CLI_ARCHIVE'});
 }
 return {forecasts,outcomes};
}

test('anchors, lead time and member selection respect availability and age',()=>{
 assert.equal(anchorAt('2025-03-10','DAY_AHEAD'),'2025-03-09T14:00:00.000Z');
 assert.equal(anchorAt('2025-03-10','SAME_DAY'),'2025-03-10T11:00:00.000Z');
 assert.equal(anchorLeadHours('2025-03-10','DAY_AHEAD'),15);assert.equal(anchorLeadHours('2025-03-10','SAME_DAY'),-6);
 const f=(cycle,avail,v)=>({member:'NBM',station:S,targetLocalDate:'2025-03-10',cycle,availableAt:avail,valueF:v,sdF:2});
 const fs=[f('2025-03-09T00:00:00Z','2025-03-09T02:00:00Z',60),f('2025-03-09T12:00:00Z','2025-03-09T14:30:00Z',61),
  f('2025-03-08T00:00:00Z','2025-03-08T02:00:00Z',59)];
 assert.equal(selectMembers(fs,S,'2025-03-10','DAY_AHEAD').NBM.valueF,60,'the 12Z cycle was not yet available at 14:00Z');
 assert.equal(selectMembers(fs,S,'2025-03-10','SAME_DAY').NBM.valueF,61);
 assert.equal(selectMembers([fs[2]],S,'2025-03-10','DAY_AHEAD').NBM,undefined,'a 38-hour-old cycle is too stale');
 assert.throws(()=>selectMembers([{...fs[0],valueF:NaN}],S,'2025-03-10','DAY_AHEAD'),/WX_MS_INVALID_FORECAST/);
});

test('the training window only uses outcomes published before the anchor, and needs 30 days',()=>{
 const {forecasts,outcomes}=world({days:40});
 const late=outcomes.map((o,i)=>i===35?{...o,observedAvailableAt:addDays(o.localDate,10)+'T00:00:00.000Z'}:o);
 const days=buildAnchorDays(forecasts,late,S,'DAY_AHEAD'),t=days[37];
 const w=trainingWindow(days,t);
 assert.ok(w.every(d=>Date.parse(d.observedAvailableAt)<Date.parse(t.anchorAt)));
 assert.ok(!w.some(d=>d.localDate===days[35].localDate),'an outcome published after the anchor is excluded');
 assert.ok(!w.some(d=>d.localDate>=addDays(t.localDate,-1)),'yesterday is not yet reported at the day-ahead anchor');
 const early=multisourceForecast(days,days[20]);
 assert.equal(early.status,'AWAITING_VERIFIED_HISTORY');assert.equal(early.blocker,'WX_MS_INSUFFICIENT_DAYS');assert.equal(early.distribution,null);
 assert.throws(()=>buildAnchorDays(forecasts,[...outcomes,outcomes[0]],S,'DAY_AHEAD'),/WX_MS_DUPLICATE_OUTCOME/);
 assert.throws(()=>buildAnchorDays(forecasts,[{...outcomes[0],observedAvailableAt:outcomes[0].localDate+'T20:00:00Z'}],S,'DAY_AHEAD'),/WX_MS_INVALID_OUTCOME/,
  'an outcome published before the climate day ends is refused');
});

test('bias correction recovers member biases; the distribution is a coherent whole-degree pmf priced by contract math',()=>{
 const {forecasts,outcomes}=world({days:80});
 const days=buildAnchorDays(forecasts,outcomes,S,'DAY_AHEAD'),f=multisourceForecast(days,days[75]);
 assert.equal(f.status,'UNCALIBRATED_EXPERIMENTAL_MODEL');assert.equal(f.trainingDays,30);assert.equal(f.marketDataUsed,false);
 assert.ok(Math.abs(f.bias.NBM-1.5)<1.2&&Math.abs(f.bias.GFS_MOS+2)<1.6,JSON.stringify(f.bias));
 assert.ok(f.weights.NBM>f.weights.GFS_MOS,'the more accurate member gets more weight');
 assert.ok(f.weights.GFS_MOS>=0.25,'shrinkage keeps every member at least half of equal weight');
 assert.equal(f.distribution.pmfPpm.reduce((a,b)=>a+b,0),1_000_000);assert.ok(f.distribution.pmfPpm.every(x=>x>=1));
 const ladder=independentLadder(Math.round(f.mu)),p=pmfEventProbabilitiesPpm(f.distribution,ladder);
 assert.equal(p.reduce((a,b)=>a+b,0),1_000_000);
 assert.throws(()=>pmfEventProbabilitiesPpm(f.distribution,[{kind:'below',thresholdF:f.distribution.supportMinF},{kind:'at_least',thresholdF:f.distribution.supportMinF}]),
  /WEATHER_STRIKE_OUTSIDE_MODEL_SUPPORT/);
});

test('scores: integer CRPS, coverage and a sharper correct forecast scoring better',()=>{
 const sharp=gaussianPmf(60,1.5),wide=gaussianPmf(60,6);
 assert.ok(integerCrps(sharp,60)<integerCrps(wide,60));assert.ok(integerCrps(sharp,70)>integerCrps(wide,70));
 assert.ok(intervalCovers(wide,64)&&!intervalCovers(sharp,64));
 for(const [mu,sd,y] of [[60,1,60],[60.4,2.3,63],[41.7,5,30],[70,1,99]])
  assert.ok(Math.abs(integerCrps(gaussianPmf(mu,sd),y)-gaussianIntegerCrps(mu,sd,y))<1e-3,'fitting CRPS matches the published pmf within the 1-ppm floor');
});

test('walk-forward evaluation: the combination beats each member when members carry independent information',()=>{
 const {forecasts,outcomes}=world({days:260,members:{NBM:[1.5,2.5],GFS_MOS:[-2,2.5]}});
 const rep=evaluateAnchor(buildAnchorDays(forecasts,outcomes,S,'DAY_AHEAD'));
 assert.equal(rep.skippedInsufficientHistory>=30,true);
 assert.equal(rep.backtestDays+rep.holdoutDays,rep.scoredDays);assert.ok(rep.backtestRange[1]<rep.holdoutRange[0],'strictly chronological split');
 assert.ok(rep.holdoutDays>=50);
 assert.ok(rep.holdout.COMBINED.meanCrps<rep.holdout.NBM_CORRECTED.meanCrps,JSON.stringify(rep.holdout.COMBINED));
 assert.ok(rep.holdout.COMBINED.meanCrps<rep.holdout.GFS_MOS_CORRECTED.meanCrps);
 assert.ok(rep.holdout.NBM_CORRECTED.meanCrps<rep.holdout.NBM_RAW.meanCrps,'bias correction helps a biased member');
 assert.ok(rep.holdout.COMBINED.meanCrps<rep.holdout.CLIMATOLOGY.meanCrps);
 assert.equal(rep.disposition,'PROMISING',rep.reason);
});

test('the decision rule: too few holdout days is never PROMISING; a dominated combination is REJECTED',()=>{
 const small=world({days:90});
 const r1=evaluateAnchor(buildAnchorDays(small.forecasts,small.outcomes,S,'SAME_DAY'));
 assert.ok(r1.holdoutDays<50);assert.equal(r1.disposition,'NO_CLEAR_EFFECT');assert.match(r1.reason,/registered review minimum is 50/);
 // One nearly perfect member and one very noisy member: shrinking toward equal weights must lose to the best member.
 const dom=world({days:300,members:{NBM:[0,0.3],GFS_MOS:[0,9]},xnd:0});
 const r2=evaluateAnchor(buildAnchorDays(dom.forecasts,dom.outcomes,S,'DAY_AHEAD'));
 assert.equal(r2.bestMemberChosenOnBacktest,'NBM_CORRECTED');assert.equal(r2.disposition,'REJECTED',r2.reason);
 const all=evaluateMultisource([buildAnchorDays(dom.forecasts,dom.outcomes,S,'DAY_AHEAD'),buildAnchorDays(dom.forecasts,dom.outcomes,S,'SAME_DAY')]);
 assert.equal(all.disposition,'REJECTED');assert.equal(all.promotionEligible,false);assert.equal(all.marketDataUsed,false);
 assert.match(all.caveat,/not evidence of trading profitability/);
});

test('block bootstrap is deterministic and brackets a clearly negative mean',()=>{
 const d=Array.from({length:80},(_,i)=>-0.3+0.1*Math.sin(i));
 assert.deepEqual(blockBootstrap(d),blockBootstrap(d));const b=blockBootstrap(d);assert.ok(b.upper95<0&&b.lower95<b.mean);
});

test('IEM MOS adapter: the 00Z max is day D-1, NBS keeps XND, latency is applied, bad rows are counted not guessed',()=>{
 const gfs=['station,model,runtime,ftime,n_x,tmp','KNYC,GFS,2025-09-01 00:00,2025-09-01 12:00,61,62',
  'KNYC,GFS,2025-09-01 00:00,2025-09-02 00:00,78,70','KNYC,GFS,2025-09-01 00:00,2025-09-03 00:00,,71',
  'KJFK,GFS,2025-09-01 00:00,2025-09-02 00:00,70,70'].join('\n');
 const g=parseIemMosCsv(gfs,'GFS','KNYC');
 assert.deepEqual(g.forecasts.map(f=>[f.member,f.targetLocalDate,f.valueF,f.availableAt]),[['GFS_MOS','2025-09-01',78,'2025-09-01T05:00:00.000Z']]);
 assert.equal(g.issues.MISSING_MAX,1);assert.equal(g.issues.OTHER_STATION,1);
 const nbs='"station","model","runtime","ftime","txn","xnd"\nKNYC,NBS,2025-09-01 13:00:00+00,2025-09-02 00:00:00+00,77,2\n';
 assert.deepEqual(parseIemMosCsv(nbs,'NBS','KNYC').forecasts.map(f=>[f.member,f.valueF,f.sdF,f.availableAt]),[['NBM',77,2,'2025-09-01T15:00:00.000Z']]);
 assert.throws(()=>parseIemMosCsv('a,b\n1,2','GFS','KNYC'),/WX_ADAPTER_MISSING_COLUMNS/);
 assert.equal(utcIso('2025-09-01T00:00Z'),'2025-09-01T00:00:00.000Z');assert.equal(utcIso('nope'),null);
});

test('duplicate archive rows: identical copies collapse to one; conflicting copies are all excluded and listed, never chosen',()=>{
 const h='station,model,runtime,ftime,txn,xnd,tmp';
 const csv=[h,'KNYC,NBS,2025-10-14 07:00,2025-10-17 00:00,58,1,50','KNYC,NBS,2025-10-14 07:00,2025-10-17 00:00,59,1,50',
  'KNYC,NBS,2025-10-14 13:00,2025-10-17 00:00,60,2,50','KNYC,NBS,2025-10-14 13:00,2025-10-17 00:00,60,2,51',
  'KNYC,NBS,2025-10-14 19:00,2025-10-17 00:00,61,2,50','KNYC,NBS,2025-10-14 19:00,2025-10-17 00:00,61,3,50',
  'KNYC,NBS,2025-10-15 01:00,2025-10-17 00:00,62,2,50'].join('\n');
 const r=parseIemMosCsv(csv,'NBS','KNYC');
 assert.deepEqual(r.forecasts.map(f=>[f.cycle.slice(0,16),f.valueF,f.sdF]),[['2025-10-14T13:00',60,2],['2025-10-15T01:00',62,2]],
  'the conflicting TXN 58/59 group and the XND 2/3 group are excluded; a group differing only in an unused column is kept once');
 assert.equal(r.issues.CONFLICTING_DUPLICATE_EXCLUDED,2);assert.equal(r.issues.DUPLICATE_IDENTICAL,1);
 assert.deepEqual(r.conflicts.map(c=>[c.cycle.slice(0,16),c.values.map(v=>v.valueF+'/'+v.sdF)]),
  [['2025-10-14T07:00',['58/1','59/1']],['2025-10-14T19:00',['61/2','61/3']]]);
});

const cli=(issued,wmo,dateLine,max)=>['CDUS41 KOKX '+wmo,'CLINYC','','CLIMATE REPORT','NATIONAL WEATHER SERVICE NEW YORK, NY',issued,'',
 '...................................','','...THE CENTRAL PARK NY CLIMATE SUMMARY FOR '+dateLine+'...','','CLIMATE NORMAL PERIOD 1991 TO 2020','',
 'WEATHER ITEM OBSERVED TIME RECORD YEAR NORMAL','TEMPERATURE (F)',' YESTERDAY','   MAXIMUM         '+max+'   1211 AM  73  1931',
 '   MINIMUM         38    923 AM  23  2019','   AVERAGE         45','PRECIPITATION (IN)',' TODAY            0.26','$$',''].join('\n');
test('CLI archive adapter: first next-morning report per day, WMO cross-check, interim and mismatched products refused',()=>{
 const first=cli('137 AM EST SAT NOV 14 2026','140637','NOVEMBER 13 2026',52),later=cli('500 AM EST SAT NOV 14 2026','141000','NOVEMBER 13 2026',53);
 const badWmo=cli('137 AM EST SUN NOV 15 2026','151500','NOVEMBER 14 2026',50);
 const interim=first.replace('...THE CENTRAL PARK','VALID AS OF 0500 PM\n...THE CENTRAL PARK');
 const r=parseCliArchive([{name:'b',text:later},{name:'a',text:first},{name:'c',text:badWmo},{name:'d',text:interim}]);
 assert.deepEqual(r.outcomes,[{station:S,localDate:'2026-11-13',observedHighF:52,observedAvailableAt:'2026-11-14T06:37:00.000Z',provenance:'IEM_AFOS_CLI_ARCHIVE'}]);
 assert.equal(r.issues.REPORT_REVISED_VALUE,1);assert.equal(r.issues.WMO_ISSUANCE_MISMATCH,1);assert.equal(r.issues.NWS_CLI_INTERIM_NOT_COMPLETE,1);
});

test('engine result is retrospective; paper forecasting needs only 30 verified training days, owner review needs 50 forward days',()=>{
 const {forecasts,outcomes}=world({days:120});
 const rep=evaluateMultisource([buildAnchorDays(forecasts,outcomes,S,'DAY_AHEAD')]),r=engineResult(rep);
 assert.equal(r.experimentId,MULTISOURCE_EXPERIMENT_ID);assert.equal(r.result.evidence,'retrospective');assert.match(r.result.reason,/no profitability claim/);
 const fwd=(graded,disposition)=>['DAY_AHEAD','SAME_DAY'].map(anchor=>({anchor,graded,disposition}));
 const start=paperReadiness({trainingDaysByAnchor:{DAY_AHEAD:30,SAME_DAY:30},verifiedInputs:true,forward:fwd(0,'NO_CLEAR_EFFECT')});
 assert.equal(start.paperForecasting.status,'READY','history satisfies the 30-day training minimum; no forward wait');
 assert.equal(start.ownerReview.status,'NOT_READY');assert.equal(start.exchange,'DISABLED');assert.equal(start.ordersEnabled,false);
 assert.equal(paperReadiness({trainingDaysByAnchor:{DAY_AHEAD:29,SAME_DAY:30},verifiedInputs:true,forward:[]}).paperForecasting.status,'NOT_READY');
 assert.equal(paperReadiness({trainingDaysByAnchor:{DAY_AHEAD:30,SAME_DAY:30},verifiedInputs:false,forward:[]}).paperForecasting.status,'NOT_READY');
 assert.equal(paperReadiness({trainingDaysByAnchor:{DAY_AHEAD:30,SAME_DAY:30},verifiedInputs:true,forward:fwd(49,'PROMISING')}).ownerReview.status,'NOT_READY');
 assert.equal(paperReadiness({trainingDaysByAnchor:{DAY_AHEAD:30,SAME_DAY:30},verifiedInputs:true,forward:fwd(50,'NO_CLEAR_EFFECT')}).ownerReview.status,'NOT_READY');
 const ok=paperReadiness({trainingDaysByAnchor:{DAY_AHEAD:30,SAME_DAY:30},verifiedInputs:true,forward:fwd(50,'PROMISING')});
 assert.equal(ok.ownerReview.status,'READY');assert.equal(ok.exchange,'DISABLED');
});

test('the frozen protocol file is the one pre-registered (hash pinned)',()=>{
 const b=readFileSync(new URL('../../../../research/kalshi_weather_multisource_v1_20261126/protocol.json',import.meta.url));
 assert.equal(createHash('sha256').update(b).digest('hex'),'23762ccab292e7dccabfbb66d3f695cee7792f8c67c90cb7ef0683df1192df77');
 const p=JSON.parse(b);
 assert.equal(p.training.minTrainingDays,MULTISOURCE_POLICY.minTrainingDays);assert.equal(p.training.trailingWindowDays,MULTISOURCE_POLICY.windowDays);
 assert.equal(p.evaluation.minHoldoutDaysForReview,50);
});

test('learning engine: the seeded weather experiment takes a retrospective result through --result and never jumps to review',async()=>{
 const {execFileSync}=await import('node:child_process');const {mkdtempSync,writeFileSync:wf,readFileSync:rf}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {engineView}=await import('../../lab/engine/view.ts');
 const ROOT=new URL('../../../../',import.meta.url),dir=mkdtempSync(join(tmpdir(),'wx-engine-'));
 const {forecasts,outcomes}=world({days:120});
 wf(join(dir,'result.json'),JSON.stringify([engineResult(evaluateMultisource([buildAnchorDays(forecasts,outcomes,S,'DAY_AHEAD')]))]));
 execFileSync(process.execPath,['--experimental-strip-types','--no-warnings','scripts/research-engine.ts','--registry','research/engine/registry.json',
  '--out',join(dir,'out'),'--now','2026-11-27T00:00:00Z','--result',join(dir,'result.json')],{cwd:ROOT,stdio:['ignore','pipe','pipe']});
 const report=JSON.parse(rf(join(dir,'out','report.json'),'utf8')),reg=JSON.parse(rf(join(dir,'out','registry.json'),'utf8'));
 assert.equal(report.status,'OK',report.failure);
 const e=reg.experiments.find(x=>x.id===MULTISOURCE_EXPERIMENT_ID);
 assert.equal(e.domain,'weather');assert.deepEqual(e.history.map(h=>h.to),['PROPOSED','RUNNING']);
 assert.notEqual(e.status,'READY_FOR_REVIEW');
 const v=engineView(reg);assert.equal(v.counts.weather.RUNNING,1);
});
