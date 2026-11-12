/**
 * Evaluation of challenger props-nb-role-minutes-v1 against layer 1 (props-nb-minutes-rate-v1) and simple baselines.
 * Protocol: research/props_cal_v1_20261110/protocol.json + amendment-1.json (committed before this ran).
 *   node --experimental-strip-types scripts/props-role-eval.ts --prior player_box_2025.csv --season player_box_2026.csv \
 *     --holdout player_box_2027.csv --out research/props_cal_v1_20261110
 * PROXY lines (floor of last-10 median + 0.5) from earlier games only. Probability quality, not profit.
 * Exploratory: 2025-26 (already inspected), layer 1 with 2024-25 priors. Holdout: 2026-27 so far, never used to choose
 * anything, scored with the production artifact exactly as the live worker does.
 */
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {STATS,type Stat} from '../src/lib/props/contract.ts';
import {poissonMeanBaseline,type GameLog,type ModelParams,type PriorSummary} from '../src/lib/props/model.ts';
import {loadBoxCsv,proxyLine,statOf,priors,fitDispersion,byAthlete,MODEL_FIXED,type BoxRow} from './lib/box-csv.ts';
import {itemsFromSeason} from './lib/learn-history.ts';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:undefined;};
const ROLE={recentGames:3,minShift:6};
const SEED=20261110;
const BANDS=[0,0.2,0.35,0.45,0.55,0.65,0.8,1.0000001];
const calProtocol=JSON.parse(readFileSync(new URL('../research/props_calibration_20261108/protocol.json',import.meta.url),'utf8'));
const production=JSON.parse(readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url),'utf8'));

type Row={key:string;eventId:string;date:string;stat:Stat;y:0|1;p:Record<string,number>;shift:boolean};
const pMoreNoTie=(p:{pMore:number;pLess:number})=>p.pMore+p.pLess>0?p.pMore/(p.pMore+p.pLess):0.5;
const clamp=(x:number)=>Math.min(1-1e-6,Math.max(1e-6,x));

/** B1/B2/B3 for the same (game, athlete, stat, line) keys, from earlier played games only. */
function baselines(rows:BoxRow[]){
 const out=new Map<string,Record<string,number>>();
 for(const games of byAthlete(rows).values()){
  games.sort((a,b)=>a.start.localeCompare(b.start));
  games.forEach((r,i)=>{
   if(r.log.didNotPlay||r.log.minutes===null)return;
   const history:GameLog[]=games.slice(0,i).map(x=>x.log);
   for(const s of STATS){
    const line=proxyLine(history,s);if(line===null)continue;
    const b1=poissonMeanBaseline(history,s,line,r.start,10),b2=poissonMeanBaseline(history,s,line,r.start,null);
    const last=history.filter(g=>!g.didNotPlay&&g.minutes!==null&&statOf(g,s)!==null).slice(-10);
    const share=last.filter(g=>statOf(g,s)>line).length/last.length;
    out.set([r.game,r.athlete,s,line].join('|'),{b1:b1?pMoreNoTie(b1):NaN,b2:b2?pMoreNoTie(b2):NaN,b3:0.5*share+0.25});
   }
  });
 }
 return out;
}

function evaluate(rows:BoxRow[],params:ModelParams,priorOf:(a:string)=>PriorSummary|null){
 const v1=itemsFromSeason(rows,params,priorOf);
 const role=itemsFromSeason(rows,{...params,version:'props-nb-role-minutes-v1',roleChange:ROLE},priorOf);
 const roleByKey=new Map(role.items.map(x=>[x.key,x]));
 const base=baselines(rows);
 const out:Row[]=[];
 for(const x of v1.items){
  const r=roleByKey.get(x.key),b=base.get(x.key);
  if(!r||!b)throw new Error('KEY_MISMATCH '+x.key);
  const pv=pMoreNoTie(x.base),pr=pMoreNoTie(r.base);
  out.push({key:x.key,eventId:x.eventId,date:x.date,stat:x.stat,y:x.y,shift:pv!==pr,p:{layer1:pv,role:pr,b1:b.b1,b2:b.b2,b3:b.b3}});
 }
 if(role.items.length!==v1.items.length)throw new Error('COVERAGE_MISMATCH');
 return {rows:out,leakage:{checked:v1.checked+role.checked,violations:v1.violations+role.violations}};
}

const brier=(rs:Row[],m:string)=>rs.reduce((a,r)=>a+(r.p[m]-r.y)**2,0)/rs.length;
const logLoss=(rs:Row[],m:string)=>rs.reduce((a,r)=>a-(r.y?Math.log(clamp(r.p[m])):Math.log(1-clamp(r.p[m]))),0)/rs.length;
function interval(rs:Row[],m:string,base='layer1'){
 // Paired game-level bootstrap of Brier(m) - Brier(base); lines from one game move together.
 const games=new Map<string,{d:number;n:number}>();
 for(const r of rs){const g=games.get(r.eventId)??{d:0,n:0};g.d+=(r.p[m]-r.y)**2-(r.p[base]-r.y)**2;g.n++;games.set(r.eventId,g);}
 const list=[...games.values()];if(list.length<20)return null;
 let state=SEED>>>0;const rnd=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 const reps:number[]=[];
 for(let k=0;k<1000;k++){let d=0,n=0;for(let i=0;i<list.length;i++){const g=list[Math.floor(rnd()*list.length)];d+=g.d;n+=g.n;}reps.push(d/n);}
 reps.sort((a,b)=>a-b);
 const point=list.reduce((a,g)=>a+g.d,0)/list.reduce((a,g)=>a+g.n,0);
 return {difference:+point.toFixed(6),lower95:+reps[24].toFixed(6),upper95:+reps[974].toFixed(6),games:list.length};
}
function calibration(rs:Row[],m:string){
 return BANDS.slice(0,-1).map((lo,i)=>{const hi=BANDS[i+1];const b=rs.filter(r=>r.p[m]>=lo&&r.p[m]<hi);
  return {band:`${lo}-${Math.min(1,hi).toFixed(2)}`,n:b.length,meanPredicted:b.length?+(b.reduce((a,r)=>a+r.p[m],0)/b.length).toFixed(4):null,
   observedMore:b.length?+(b.reduce((a,r)=>a+r.y,0)/b.length).toFixed(4):null};});
}
function report(rs:Row[]){
 const models=['layer1','role','b1','b2','b3'];
 return Object.fromEntries(STATS.map(s=>{
  const all=rs.filter(r=>r.stat===s),shifted=all.filter(r=>r.shift);
  const usable=(m:string)=>all.filter(r=>Number.isFinite(r.p[m]));
  return [s,{lines:all.length,games:new Set(all.map(r=>r.eventId)).size,roleShiftLines:shifted.length,
   byModel:Object.fromEntries(models.map(m=>{const u=usable(m);return [m,{n:u.length,brier:+brier(u,m).toFixed(5),logLoss:+logLoss(u,m).toFixed(5)}];})),
   roleVsLayer1:interval(all,'role'),roleVsLayer1OnShiftedLines:shifted.length?{n:shifted.length,layer1:+brier(shifted,'layer1').toFixed(5),
    role:+brier(shifted,'role').toFixed(5),interval:interval(shifted,'role')}:null,
   baselinesVsLayer1:Object.fromEntries(['b1','b2','b3'].map(m=>[m,interval(usable(m),m)])),
   calibration:{layer1:calibration(all,'layer1'),role:calibration(all,'role')}}];
 }));
}

const prior=loadBoxCsv(arg('prior')!),season=loadBoxCsv(arg('season')!),holdout=loadBoxCsv(arg('holdout')!);
for(const f of [prior,season])if(calProtocol.sourceHashes[f.file!]!==f.sha256)throw new Error('SOURCE_HASH_MISMATCH '+f.file);
// Exploratory (already inspected): layer 1 as in the replay pipeline, 2024-25 priors, dispersion through 2025-12-31.
const pr=priors(prior.rows);
const params:ModelParams={...MODEL_FIXED,leagueRate:pr.leagueRate,dispersion:fitDispersion(season.rows,pr,Date.parse('2025-12-31T23:59:59Z'))};
const exp=evaluate(season.rows,params,a=>pr.players.get(a)??null);
// Holdout: the production artifact exactly.
const players=production.players as Record<string,PriorSummary>;
const hold=evaluate(holdout.rows,production.params as ModelParams,a=>players[a]??null);
for(const e of [exp,hold])if(e.leakage.violations!==0)throw new Error('LEAKAGE');

const holdReport=report(hold.rows);
const passes=STATS.filter(s=>(holdReport[s].roleVsLayer1?.upper95??1)<0).length;
const worse=STATS.filter(s=>(holdReport[s].roleVsLayer1?.lower95??0)>0);
const verdict=passes>=2&&!worse.length?'IMPROVES ON HOLDOUT (review only; not promoted)':'NO IMPROVEMENT ON HOLDOUT';
const out=arg('out')!;mkdirSync(out,{recursive:true});
const dates=(rs:Row[])=>[rs.reduce((m,r)=>r.date<m?r.date:m,'9999'),rs.reduce((m,r)=>r.date>m?r.date:m,'')];
const result={generatedBy:'scripts/props-role-eval.ts',candidate:'props-nb-role-minutes-v1',baseline:'props-nb-minutes-rate-v1',role:ROLE,
 protocol:['research/props_cal_v1_20261110/protocol.json','research/props_cal_v1_20261110/amendment-1.json'],
 sources:[prior,season,holdout].map(f=>({file:f.file,sha256:f.sha256,regularSeasonRows:f.rows.length})),
 attemptedVariants:[{id:'props-cal-v1',status:'withdrawn before any run (duplicates props-temperature-v2)'},
  {id:'props-nb-role-minutes-v1',status:'evaluated once, parameters fixed in amendment-1'}],
 exploratory:{label:'2025-26, previously inspected; not confirmation',window:dates(exp.rows),lines:exp.rows.length,leakage:exp.leakage,byStat:report(exp.rows)},
 holdout:{label:'2026-27 so far; unseen by any earlier fit or choice',window:dates(hold.rows),lines:hold.rows.length,leakage:hold.leakage,
  productionArtifact:'src/data/props/model_v1.json',byStat:holdReport},
 verdict,limitations:['Proxy lines, not PrizePicks lines; probability quality only, no returns.',
  'Only players who played are scored (PrizePicks voids DNPs); players need 3 earlier played games this season.',
  'Early-season holdout: few games per player, wide intervals.','Lines of the same game are correlated; intervals resample whole games.']};
writeFileSync(out+'/report.json',JSON.stringify(result,null,1)+'\n');
console.log(JSON.stringify({verdict,holdout:{window:result.holdout.window,lines:result.holdout.lines,leakage:hold.leakage},
 byStat:Object.fromEntries(STATS.map(s=>[s,{lines:holdReport[s].lines,shifted:holdReport[s].roleShiftLines,layer1:holdReport[s].byModel.layer1.brier,
  role:holdReport[s].byModel.role.brier,ci:holdReport[s].roleVsLayer1,shifted_ci:holdReport[s].roleVsLayer1OnShiftedLines,
  b1:holdReport[s].byModel.b1.brier,b2:holdReport[s].byModel.b2.brier,b3:holdReport[s].byModel.b3.brier}]))},null,1));
