/**
 * Chronological evaluation of knyc-multisource-emos-v1-research, exactly as pre-registered:
 * - walk-forward: each scored day uses only its own trailing window;
 * - BACKTEST = the first half of scored days, HOLDOUT = the rest;
 * - the best corrected member is chosen on BACKTEST only, and the decision is made on HOLDOUT only;
 * - a 7-day moving-block bootstrap of paired daily CRPS differences.
 * Output is forecast-accuracy evidence only. It reads no market data and says nothing about profitability.
 */
import {independentLadder} from './weather-contract-eval.ts';
import {MEMBERS,MULTISOURCE_MODEL_ID,MULTISOURCE_POLICY,baselinePmfs,integerCrps,intervalCovers,logLoss,
 multisourceForecast,pit,pmfEventProbabilitiesPpm,trainingWindow,type Anchor,type AnchorDay,type BaselineId,type Pmf} from './weather-multisource.ts';

export const EVAL_POLICY=Object.freeze({minHoldoutDaysForReview:50,blockDays:7,replicates:2000,seed:20261126,
 coverage:Object.freeze([0.70,0.90] as const)});
type ModelId='COMBINED'|BaselineId;
export type DayScore={crps:number;absErr:number;logLoss:number;eventBrier:number|null;covered:boolean;pit:number};
export type EvalRow={date:string;observedHighF:number;trainingDays:number;members:string[];scores:Partial<Record<ModelId,DayScore>>};
type Summary={n:number;meanCrps:number|null;mae:number|null;meanLogLoss:number|null;meanEventBrier:number|null;coverage80:number|null;
 pitHistogram:number[]};

const U=1_000_000;
const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const r6=(x:number|null)=>x===null?null:Number(x.toFixed(6));
const pmfMean=(p:Pmf)=>p.pmfPpm.reduce((s,x,i)=>s+x*(p.supportMinF+i),0)/U;

/** Scores one whole-degree distribution against one outcome (also used to grade frozen paper forecasts). */
export function scoreDay(p:Pmf,y:number,ladderCenter:number):DayScore{
 let eventBrier:number|null=null;
 try{
  const ladder=independentLadder(ladderCenter),probs=pmfEventProbabilitiesPpm(p,ladder).map(x=>x/U);
  // The ladder's six ranges: <= c-5, [c-4,c-3], [c-2,c-1], [c,c+1], [c+2,c+3], >= c+4.
  const bins=[[-Infinity,ladderCenter-5],[ladderCenter-4,ladderCenter-3],[ladderCenter-2,ladderCenter-1],[ladderCenter,ladderCenter+1],
   [ladderCenter+2,ladderCenter+3],[ladderCenter+4,Infinity]];
  const yb=bins.findIndex(([a,b])=>y>=a&&y<=b);
  eventBrier=probs.reduce((s,q,i)=>s+(q-(i===yb?1:0))**2,0);
 }catch{eventBrier=null;}
 return {crps:integerCrps(p,y),absErr:Math.abs(Math.round(pmfMean(p))-y),logLoss:logLoss(p,y),eventBrier,covered:intervalCovers(p,y,0.8),pit:pit(p,y)};
}
function summarise(rows:readonly EvalRow[],m:ModelId):Summary{
 const s=rows.map(r=>r.scores[m]).filter((x):x is DayScore=>!!x);
 const hist=Array(10).fill(0);for(const x of s)hist[Math.min(9,Math.floor(x.pit*10))]++;
 const eb=s.map(x=>x.eventBrier).filter((x):x is number=>x!==null);
 return {n:s.length,meanCrps:r6(avg(s.map(x=>x.crps))),mae:r6(avg(s.map(x=>x.absErr))),meanLogLoss:r6(avg(s.map(x=>x.logLoss))),
  meanEventBrier:r6(avg(eb)),coverage80:r6(avg(s.map(x=>x.covered?1:0))),pitHistogram:hist};
}
function rng(seed:number){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);
 t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
/** Moving-block bootstrap percentile interval of the mean of d. */
export function blockBootstrap(d:readonly number[],P=EVAL_POLICY){
 const n=d.length;if(n<2)return {mean:avg([...d]),lower95:null,upper95:null};
 const L=Math.min(P.blockDays,n),r=rng(P.seed),means:number[]=[];
 for(let k=0;k<P.replicates;k++){const xs:number[]=[];
  while(xs.length<n){const s=Math.floor(r()*(n-L+1));for(let j=0;j<L&&xs.length<n;j++)xs.push(d[s+j]);}
  means.push(xs.reduce((a,b)=>a+b,0)/n);}
 means.sort((a,b)=>a-b);
 return {mean:r6(avg([...d])),lower95:r6(means[Math.floor(0.025*(P.replicates-1))]),upper95:r6(means[Math.ceil(0.975*(P.replicates-1))])};
}
export type AnchorReport={anchor:Anchor;station:string;inputDays:number;skippedInsufficientHistory:number;skippedNoMember:number;
 skippedNoOutcome:number;scoredDays:number;backtestDays:number;holdoutDays:number;backtestRange:[string,string]|null;
 holdoutRange:[string,string]|null;bestMemberChosenOnBacktest:BaselineId|null;
 backtest:Partial<Record<ModelId,Summary>>;holdout:Partial<Record<ModelId,Summary>>;
 holdoutCombinedMinusBestMember:{n:number;mean:number|null;lower95:number|null;upper95:number|null};
 /** Descriptive only (the decision rule above is unchanged): paired HOLDOUT CRPS differences, combined minus each. */
 holdoutPairs:Partial<Record<BaselineId,{n:number;mean:number|null;lower95:number|null;upper95:number|null}>>;
 checks:{enoughHoldout:boolean;beatsBestMember:boolean;beatsNbmNative:boolean|null;beatsClimatology:boolean;
  bootstrapUpperBelowZero:boolean;coverageWithinRange:boolean};
 disposition:'PROMISING'|'NO_CLEAR_EFFECT'|'REJECTED';reason:string;rows:EvalRow[]};

export function evaluateAnchor(days:readonly AnchorDay[],P=MULTISOURCE_POLICY,E=EVAL_POLICY):AnchorReport{
 const ordered=[...days].sort((a,b)=>a.localDate.localeCompare(b.localDate));
 if(!ordered.length)throw Error('WX_MS_EVAL_EMPTY');
 const {anchor,station}=ordered[0];
 if(ordered.some(d=>d.anchor!==anchor||d.station!==station))throw Error('WX_MS_EVAL_MIXED_INPUT');
 const rows:EvalRow[]=[];let skippedInsufficientHistory=0,skippedNoMember=0,skippedNoOutcome=0;
 for(const t of ordered){
  if(t.observedHighF===null){skippedNoOutcome++;continue;}
  const f=multisourceForecast(ordered,t,P);
  if(f.blocker==='WX_MS_INSUFFICIENT_DAYS'){skippedInsufficientHistory++;continue;}
  if(!f.distribution){skippedNoMember++;continue;}
  const y=t.observedHighF,center=Math.round(f.mu!),scores:EvalRow['scores']={COMBINED:scoreDay(f.distribution,y,center)};
  for(const [k,p] of Object.entries(baselinePmfs(trainingWindow(ordered,t,P),t,P)) as [BaselineId,Pmf][])scores[k]=scoreDay(p,y,center);
  rows.push({date:t.localDate,observedHighF:y,trainingDays:f.trainingDays,members:Object.keys(t.members),scores});
 }
 const half=Math.floor(rows.length/2),back=rows.slice(0,half),hold=rows.slice(half);
 const models=[...new Set(rows.flatMap(r=>Object.keys(r.scores)))] as ModelId[];
 const table=(rs:EvalRow[])=>Object.fromEntries(models.map(m=>[m,summarise(rs,m)])) as Partial<Record<ModelId,Summary>>;
 const backtest=table(back),holdout=table(hold);
 const corrected=MEMBERS.map(m=>`${m}_CORRECTED` as BaselineId).filter(m=>(backtest[m]?.n??0)>0);
 const best=corrected.sort((a,b)=>backtest[a]!.meanCrps!-backtest[b]!.meanCrps!||a.localeCompare(b))[0]??null;
 const paired=best?hold.filter(r=>r.scores[best]).map(r=>r.scores.COMBINED!.crps-r.scores[best]!.crps):[];
 const boot=blockBootstrap(paired,E);
 const holdoutPairs:AnchorReport['holdoutPairs']={};
 for(const m of ['NBM_RAW','NBM_CORRECTED','NBM_NATIVE','GFS_MOS_RAW','GFS_MOS_CORRECTED'] as BaselineId[]){
  const d=hold.filter(r=>r.scores[m]).map(r=>r.scores.COMBINED!.crps-r.scores[m]!.crps);
  if(d.length)holdoutPairs[m]={n:d.length,...blockBootstrap(d,E)};
 }
 const on=(m:ModelId)=>{const both=hold.filter(r=>r.scores[m]);return both.length?
  {c:avg(both.map(r=>r.scores.COMBINED!.crps))!,o:avg(both.map(r=>r.scores[m]!.crps))!}:null;};
 const nbm=on('NBM_NATIVE'),clim=on('CLIMATOLOGY'),cov=holdout.COMBINED?.coverage80??null;
 const checks={enoughHoldout:hold.length>=E.minHoldoutDaysForReview,
  beatsBestMember:paired.length>0&&(boot.mean??Infinity)<0,beatsNbmNative:nbm?nbm.c<nbm.o:null,
  beatsClimatology:!!clim&&clim.c<clim.o,bootstrapUpperBelowZero:boot.upper95!==null&&boot.upper95<0,
  coverageWithinRange:cov!==null&&cov>=E.coverage[0]&&cov<=E.coverage[1]};
 let disposition:AnchorReport['disposition']='NO_CLEAR_EFFECT',reason:string;
 if(!checks.enoughHoldout)reason=`Only ${hold.length} holdout days; the registered review minimum is ${E.minHoldoutDaysForReview}.`;
 else if(boot.lower95!==null&&boot.lower95>0){disposition='REJECTED';reason='The combination is confidently worse than the best single corrected member on HOLDOUT.';}
 else if(checks.beatsBestMember&&checks.beatsNbmNative!==false&&checks.beatsClimatology&&checks.bootstrapUpperBelowZero&&checks.coverageWithinRange)
  {disposition='PROMISING';reason='All pre-registered HOLDOUT conditions hold (retrospective evidence only).';}
 else reason='At least one pre-registered HOLDOUT condition fails: '+Object.entries(checks).filter(([,v])=>v===false).map(([k])=>k).join(', ')+'.';
 const range=(rs:EvalRow[]):[string,string]|null=>rs.length?[rs[0].date,rs.at(-1)!.date]:null;
 return {anchor,station,inputDays:ordered.length,skippedInsufficientHistory,skippedNoMember,skippedNoOutcome,scoredDays:rows.length,
  backtestDays:back.length,holdoutDays:hold.length,backtestRange:range(back),holdoutRange:range(hold),bestMemberChosenOnBacktest:best,
  backtest,holdout,holdoutCombinedMinusBestMember:{n:paired.length,...boot},holdoutPairs,checks,disposition,reason,rows};
}
export type MultisourceEvalReport={schema:'kalshi-weather-multisource-eval-v1';modelId:typeof MULTISOURCE_MODEL_ID;evidence:'retrospective';
 anchors:AnchorReport[];disposition:'PROMISING'|'NO_CLEAR_EFFECT'|'REJECTED';promotionEligible:false;marketDataUsed:false;caveat:string};
/** Overall: REJECTED if any anchor is rejected, PROMISING only if every anchor is, otherwise NO_CLEAR_EFFECT. */
export function evaluateMultisource(byAnchor:readonly AnchorDay[][]):MultisourceEvalReport{
 const anchors=byAnchor.filter(d=>d.length).map(d=>evaluateAnchor(d));
 const disposition=anchors.some(a=>a.disposition==='REJECTED')?'REJECTED':anchors.length&&anchors.every(a=>a.disposition==='PROMISING')?'PROMISING':'NO_CLEAR_EFFECT';
 return {schema:'kalshi-weather-multisource-eval-v1',modelId:MULTISOURCE_MODEL_ID,evidence:'retrospective',anchors,disposition,
  promotionEligible:false,marketDataUsed:false,
  caveat:'Historical forecast accuracy against archived NWS CLI reports. Not Kalshi settlement (first non-preliminary report, TWC first), not market prices, fees or fills, and not evidence of trading profitability.'};
}
