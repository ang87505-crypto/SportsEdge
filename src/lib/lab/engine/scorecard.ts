/** Descriptive probability diagnostics on admitted, non-tie production lines. Never trains or selects a model. */
import {brier,logLoss,clusteredDifference,round,wilson} from '../stats.ts';
import type {SportsRow} from './diagnostics.ts';

export const SCORECARD_SCHEMA='sports-probability-scorecard-v1';
type Interval={lower95:number;upper95:number};
export type ProbabilitySummary={lines:number;games:number;dates:number;brier:number|null;logLoss:number|null;
 fairBrier:number|null;brierDifference:number|null;brierDifference95:Interval|null;
 picks:number;hits:number;hitRate:number|null;hitRate95:Interval|null;meanConfidence:number|null;confidenceGap:number|null;
 confidenceGap95:Interval|null;smallSample:boolean};
export type ProbabilityGroup={id:string;label:string;summary:ProbabilitySummary};
export type SportsScorecard={schema:typeof SCORECARD_SCHEMA;scope:'NON_TIE_BASELINE_LINES';duplicatesExcluded:number;
 all:ProbabilitySummary;groups:{id:string;label:string;rows:ProbabilityGroup[]}[];note:string};

const ci=(x:ReturnType<typeof clusteredDifference>):Interval|null=>x?{lower95:round(x.lower95,6)!,upper95:round(x.upper95,6)!}:null;
function summary(rows:readonly SportsRow[]):ProbabilitySummary{
 const picks=rows.filter(r=>r.picked),hits=picks.filter(r=>r.picked===r.outcome).length;
 const confidence=picks.map(r=>r.picked==='more'?r.pMore:1-r.pMore);
 const games=new Set(rows.map(r=>r.game)).size;
 const briers=rows.map(r=>({cluster:r.game,candidate:brier(r.pMore,r.outcome==='more'?1:0),reference:0.25}));
 const average=confidence.length?confidence.reduce((a,b)=>a+b,0)/confidence.length:null;
 const hitRate=picks.length?hits/picks.length:null;
 const w=picks.length?wilson(hits,picks.length):null;
 const gap=clusteredDifference(picks.map((r,i)=>({cluster:r.game,candidate:confidence[i],reference:Number(r.picked===r.outcome)})),1000,20261119);
 const meanBrier=rows.length?briers.reduce((a,r)=>a+r.candidate,0)/rows.length:null;
 return {lines:rows.length,games,dates:new Set(rows.map(r=>r.date)).size,
  brier:round(meanBrier,6),logLoss:round(rows.length?rows.reduce((a,r)=>a+logLoss(r.pMore,r.outcome==='more'?1:0),0)/rows.length:null,6),
  fairBrier:rows.length?0.25:null,brierDifference:round(meanBrier===null?null:meanBrier-0.25,6),brierDifference95:ci(clusteredDifference(briers,1000,20261119)),
  picks:picks.length,hits,hitRate:round(hitRate,6),hitRate95:w?{lower95:round(w.lower,6)!,upper95:round(w.upper,6)!}:null,
  meanConfidence:round(average,6),confidenceGap:round(average===null||hitRate===null?null:average-hitRate,6),confidenceGap95:ci(gap),
  smallSample:rows.length<40||games<10};
}
const known=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
type GroupDef={id:string;label:string;bins:{id:string;label:string;includes:(r:SportsRow)=>boolean}[]};
const defs:GroupDef[]=[
 {id:'stat',label:'Player statistic',bins:['points','rebounds','assists'].map(stat=>({id:stat,label:stat,includes:r=>r.stat===stat}))},
 {id:'side',label:'Recorded pick direction',bins:['more','less'].map(side=>({id:side,label:side,includes:r=>r.picked===side}))},
 {id:'confidence',label:'Recorded pick confidence',bins:[
  ...[[0.5,0.6],[0.6,0.65],[0.65,0.7],[0.7,0.8],[0.8,1]].map(([low,high])=>({id:`${low}-${high}`,label:`${low*100}%–${high*100}%`,
   includes:(r:SportsRow)=>{const p=r.picked==='more'?r.pMore:1-r.pMore;return !!r.picked&&p>=low&&p<high;}}))]},
 {id:'history',label:'Games of player history',bins:[
  {id:'0-5',label:'Up to 5 games',includes:r=>known(r.games)&&r.games<=5},
  {id:'6-10',label:'6–10 games',includes:r=>known(r.games)&&r.games>5&&r.games<=10},
  {id:'11-plus',label:'More than 10 games',includes:r=>known(r.games)&&r.games>10},
  {id:'unknown',label:'Unknown',includes:r=>!known(r.games)}]},
 {id:'minutes',label:'Minutes variability (SD / expected minutes)',bins:[
  {id:'under-015',label:'Below 0.15',includes:r=>known(r.minutesCv)&&r.minutesCv<0.15},
  {id:'015-030',label:'0.15–0.30',includes:r=>known(r.minutesCv)&&r.minutesCv>=0.15&&r.minutesCv<0.3},
  {id:'030-plus',label:'0.30 or higher',includes:r=>known(r.minutesCv)&&r.minutesCv>=0.3},
  {id:'unknown',label:'Unknown',includes:r=>!known(r.minutesCv)}]},
 {id:'gap',label:'Model mean distance from platform line',bins:[
  {id:'under-020',label:'Below 20%',includes:r=>known(r.lineGapRel)&&r.lineGapRel<0.2},
  {id:'020-040',label:'20%–40%',includes:r=>known(r.lineGapRel)&&r.lineGapRel>=0.2&&r.lineGapRel<0.4},
  {id:'040-plus',label:'40% or higher',includes:r=>known(r.lineGapRel)&&r.lineGapRel>=0.4},
  {id:'unknown',label:'Unknown',includes:r=>!known(r.lineGapRel)}]}
];

/** Caller supplies rows admitted by sportsQuality. Repeated exact lines never increase sample sizes. */
export function sportsScorecard(rows:readonly SportsRow[]):SportsScorecard{
 const unique=new Map<string,SportsRow>();
 for(const r of [...rows].sort((a,b)=>a.key.localeCompare(b.key)||a.predictedAt.localeCompare(b.predictedAt))){
  if(!r.key||!r.game||!(r.pMore>0&&r.pMore<1)||!['more','less'].includes(r.outcome)||
   (r.picked!==null&&!['more','less'].includes(r.picked)))throw Error('SCORECARD_INVALID_ROW');
  if(!unique.has(r.key))unique.set(r.key,r);
 }
 const clean=[...unique.values()];
 return {schema:SCORECARD_SCHEMA,scope:'NON_TIE_BASELINE_LINES',duplicatesExcluded:rows.length-clean.length,all:summary(clean),
  groups:defs.map(d=>({id:d.id,label:d.label,rows:d.bins.map(b=>({id:b.id,label:b.label,summary:summary(clean.filter(b.includes))}))})),
  note:'Descriptive research on unique graded non-tie lines and conditional More/Less probabilities. The fixed 50/50 reference has binary Brier 0.25; it is not a sportsbook price or trading strategy. Brier-difference and confidence-gap intervals resample whole games; hit-rate Wilson intervals are descriptive and do not account for game correlation. Groups below 40 lines or 10 games are marked small. These overlapping subgroup views do not select a challenger, change promotion gates, establish profitability, or justify a model change.'};
}

/** Old published reports have no scorecard. Malformed optional diagnostics cannot break the accepted registry. */
export function readSportsScorecard(raw:unknown):SportsScorecard|null{
 if(!raw||typeof raw!=='object')return null;
 const r=raw as SportsScorecard;
 const validSummary=(s:ProbabilitySummary)=>{
  if(!s||![s.lines,s.games,s.dates,s.picks,s.hits].every(n=>Number.isSafeInteger(n)&&n>=0)||s.games>s.lines||s.dates>s.lines||s.picks>s.lines||s.hits>s.picks||s.smallSample!==(s.lines<40||s.games<10))return false;
  for(const k of ['brier','logLoss','fairBrier','brierDifference','hitRate','meanConfidence','confidenceGap'] as const)if(s[k]!==null&&(typeof s[k]!=='number'||!Number.isFinite(s[k])))return false;
  for(const k of ['brierDifference95','hitRate95','confidenceGap95'] as const){const x=s[k];if(x!==null&&(!x||!Number.isFinite(x.lower95)||!Number.isFinite(x.upper95)||x.lower95>x.upper95))return false;}
  if(s.lines===0){if(s.brier!==null||s.logLoss!==null||s.fairBrier!==null||s.brierDifference!==null||s.brierDifference95!==null)return false;}
  else if(!s.games||!s.dates||s.brier===null||s.brier<0||s.brier>1||s.logLoss===null||s.logLoss<0||s.fairBrier!==0.25||s.brierDifference===null||Math.abs(s.brierDifference-(s.brier-0.25))>0.000002)return false;
  if(s.games<2&&s.brierDifference95!==null)return false;
  if(s.picks===0){if(s.hitRate!==null||s.meanConfidence!==null||s.confidenceGap!==null||s.hitRate95!==null||s.confidenceGap95!==null)return false;}
  else if(s.hitRate===null||Math.abs(s.hitRate-s.hits/s.picks)>0.000001||s.meanConfidence===null||s.confidenceGap===null||Math.abs(s.confidenceGap-(s.meanConfidence-s.hitRate))>0.000002)return false;
  return (s.hitRate===null||s.hitRate>=0&&s.hitRate<=1)&&(s.meanConfidence===null||s.meanConfidence>=0&&s.meanConfidence<=1);
 };
 if(r.schema!==SCORECARD_SCHEMA||r.scope!=='NON_TIE_BASELINE_LINES'||!Number.isSafeInteger(r.duplicatesExcluded)||r.duplicatesExcluded<0||
  !validSummary(r.all)||typeof r.note!=='string'||r.note.length>3000||!Array.isArray(r.groups)||r.groups.length!==defs.length)return null;
 for(let i=0;i<defs.length;i++){
  const g=r.groups[i],d=defs[i];
  if(!g||g.id!==d.id||g.label!==d.label||!Array.isArray(g.rows)||g.rows.length!==d.bins.length||
   g.rows.some((b,j)=>!b||b.id!==d.bins[j].id||b.label!==d.bins[j].label||!validSummary(b.summary)||b.summary.lines>r.all.lines))return null;
 }
 return r;
}
