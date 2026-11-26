/**
 * Automatic PAPER forecasts and grading for knyc-multisource-emos-v1-research (no market data, no exchange access).
 *
 * - freezeMultisourcePaper(): one immutable forecast per (station, climate day, anchor), frozen at or before the anchor.
 *   It uses only member bulletins and outcomes available at the freeze time, the frozen protocol, and a 30-day window
 *   built from verified archive history. Baseline distributions are frozen beside it, so forward comparisons need
 *   no refit.
 * - gradeMultisourcePaper(): grades a frozen forecast against the NWS CLI high, which must be published after the
 *   freeze. It never rewrites the forecast.
 * - forwardSummary(): forward evidence per anchor. All forward days are out-of-sample.
 *   - The combination must beat every corrected member and NBM native, which is stricter than the backtest rule.
 *   - It needs the registered 50 forward days for review.
 *   - It also reports frozen-but-ungraded days and missed anchors, never filling either in.
 */
import {createHash} from 'node:crypto';
import {independentLadder} from './weather-contract-eval.ts';
import {ANCHORS,MULTISOURCE_MODEL_ID,anchorAt,baselinePmfs,multisourceForecast,pmfEventProbabilitiesPpm,trainingWindow,
 type Anchor,type AnchorDay,type BaselineId,type DailyOutcome,type Pmf} from './weather-multisource.ts';
import {EVAL_POLICY,blockBootstrap,scoreDay,type DayScore} from './weather-multisource-eval.ts';

export const PAPER_SCHEMA='kalshi-weather-multisource-paper-v1' as const;
export const GRADE_SCHEMA='kalshi-weather-multisource-paper-grade-v1' as const;
const sha=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ms=(s:string)=>Date.parse(s);

export type PaperForecastRecord={schema:typeof PAPER_SCHEMA;id:string;modelId:typeof MULTISOURCE_MODEL_ID;station:string;localDate:string;
 anchor:Anchor;anchorAt:string;frozenAt:string;inputsDigest:string;status:'FROZEN'|'AWAITING_VERIFIED_HISTORY';blocker:string|null;
 trainingDays:number;trainingDigest:string|null;members:AnchorDay['members'];weights:Record<string,number>;bias:Record<string,number>;
 mu:number|null;sigma:number|null;distribution:Pmf|null;
 ladder:{strikes:ReturnType<typeof independentLadder>;probabilityYesPpm:number[]}|null;
 baselines:Partial<Record<BaselineId,Pmf>>;marketDataUsed:false;exchangeAccess:'DISABLED'};

/**
 * Freeze the paper forecast for one target. `days` must be built from member bulletins and outcomes as captured.
 * Anything that became available after `frozenAt` is excluded here.
 */
export function freezeMultisourcePaper(days:readonly AnchorDay[],localDate:string,anchor:Anchor,frozenAt:string,inputsDigest:string):PaperForecastRecord{
 const official=anchorAt(localDate,anchor);
 if(!Number.isFinite(ms(frozenAt)))throw Error('WX_MS_PAPER_INVALID_TIME');
 if(ms(frozenAt)>ms(official))throw Error('WX_MS_PAPER_AFTER_ANCHOR');
 if(!/^[a-f0-9]{64}$/.test(inputsDigest))throw Error('WX_MS_PAPER_INVALID_DIGEST');
 const target=days.find(d=>d.localDate===localDate&&d.anchor===anchor);
 if(!target)throw Error('WX_MS_PAPER_NO_TARGET');
 // The freeze time is the as-of: training outcomes must have been public before it.
 const asOf={...target,anchorAt:new Date(ms(frozenAt)).toISOString()};
 const f=multisourceForecast(days,asOf);
 const window=trainingWindow(days,asOf);
 const ladder=f.distribution?(()=>{const strikes=independentLadder(Math.round(f.mu!));
  return {strikes,probabilityYesPpm:pmfEventProbabilitiesPpm(f.distribution,strikes)};})():null;
 const base:Omit<PaperForecastRecord,'id'>={schema:PAPER_SCHEMA,modelId:MULTISOURCE_MODEL_ID,station:target.station,localDate,anchor,
  anchorAt:official,frozenAt:asOf.anchorAt,inputsDigest,status:f.distribution?'FROZEN':'AWAITING_VERIFIED_HISTORY',blocker:f.blocker,
  trainingDays:f.trainingDays,trainingDigest:f.trainingDigest,members:target.members,
  weights:f.weights as Record<string,number>,bias:f.bias as Record<string,number>,mu:f.mu,sigma:f.sigma,distribution:f.distribution,ladder,
  baselines:f.distribution?baselinePmfs(window,asOf):{},marketDataUsed:false,exchangeAccess:'DISABLED'};
 return {id:sha(base),...base};
}
export function verifyPaperForecast(raw:unknown):PaperForecastRecord{
 const r=raw as PaperForecastRecord;
 if(!r||typeof r!=='object'||r.schema!==PAPER_SCHEMA||r.modelId!==MULTISOURCE_MODEL_ID||!ANCHORS.includes(r.anchor)||
  r.marketDataUsed!==false||r.exchangeAccess!=='DISABLED')throw Error('WX_MS_PAPER_INVALID_RECORD');
 const {id,...base}=r;
 if(sha(base)!==id)throw Error('WX_MS_PAPER_DIGEST_MISMATCH');
 if(ms(r.frozenAt)>ms(r.anchorAt)||anchorAt(r.localDate,r.anchor)!==r.anchorAt)throw Error('WX_MS_PAPER_AFTER_ANCHOR');
 return r;
}

export type PaperGrade={schema:typeof GRADE_SCHEMA;id:string;forecastId:string;localDate:string;anchor:Anchor;observedHighF:number;
 outcomeProvenance:DailyOutcome['provenance'];outcomeAvailableAt:string;combined:DayScore;baselines:Partial<Record<BaselineId,DayScore>>;
 note:string};
export function gradeMultisourcePaper(f:PaperForecastRecord,o:DailyOutcome):PaperGrade{
 verifyPaperForecast(f);
 if(f.status!=='FROZEN'||!f.distribution||f.mu===null)throw Error('WX_MS_PAPER_NOTHING_TO_GRADE');
 if(o.localDate!==f.localDate||o.station!==f.station||!Number.isSafeInteger(o.observedHighF))throw Error('WX_MS_PAPER_OUTCOME_MISMATCH');
 if(!(ms(o.observedAvailableAt)>ms(f.frozenAt)))throw Error('WX_MS_PAPER_OUTCOME_BEFORE_FORECAST');
 const c=Math.round(f.mu),baselines:PaperGrade['baselines']={};
 for(const [k,p] of Object.entries(f.baselines) as [BaselineId,Pmf][])baselines[k]=scoreDay(p,o.observedHighF,c);
 const base:Omit<PaperGrade,'id'>={schema:GRADE_SCHEMA,forecastId:f.id,localDate:f.localDate,anchor:f.anchor,observedHighF:o.observedHighF,
  outcomeProvenance:o.provenance,outcomeAvailableAt:o.observedAvailableAt,combined:scoreDay(f.distribution,o.observedHighF,c),baselines,
  note:'Forecast accuracy against the NWS CLI report. Not a Kalshi settlement (first non-preliminary report, TWC first), price, fill or profit.'};
 return {id:sha(base),...base};
}

const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const r6=(x:number|null)=>x===null?null:Number(x.toFixed(6));
export type ForwardAnchorSummary={anchor:Anchor;frozen:number;awaitingHistory:number;graded:number;ungraded:number;missedSince:string[];
 firstDate:string|null;lastDate:string|null;meanCrps:Record<string,number|null>;coverage80:number|null;
 vsBest:{against:string|null;n:number;mean:number|null;lower95:number|null;upper95:number|null};
 disposition:'PROMISING'|'NO_CLEAR_EFFECT'|'REJECTED';reason:string};
/** Forward evidence: every comparison is paired on days where both were frozen and graded. */
export function forwardSummary(records:readonly PaperForecastRecord[],grades:readonly PaperGrade[],nowIso:string):ForwardAnchorSummary[]{
 return ANCHORS.map(anchor=>{
  const rs=records.filter(r=>r.anchor===anchor).sort((a,b)=>a.localDate.localeCompare(b.localDate));
  const frozen=rs.filter(r=>r.status==='FROZEN');
  const gs=grades.filter(g=>g.anchor===anchor&&frozen.some(r=>r.id===g.forecastId));
  // A day between the first and last frozen record without any record is a missed anchor (never backfilled).
  const missed:string[]=[];
  if(rs.length){let d=rs[0].localDate;const last=rs.at(-1)!.localDate;
   while(d<last){if(!rs.some(r=>r.localDate===d)&&ms(anchorAt(d,anchor))<ms(nowIso))missed.push(d);
    d=new Date(ms(d+'T00:00:00Z')+86400e3).toISOString().slice(0,10);}}
  const models=[...new Set(gs.flatMap(g=>Object.keys(g.baselines)))];
  const meanCrps:Record<string,number|null>={COMBINED:r6(avg(gs.map(g=>g.combined.crps)))};
  for(const m of models)meanCrps[m]=r6(avg(gs.filter(g=>g.baselines[m as BaselineId]).map(g=>g.baselines[m as BaselineId]!.crps)));
  // Stricter than the backtest rule: the combination is compared with the BEST competitor in hindsight.
  const rivals=models.filter(m=>m.endsWith('_CORRECTED')||m==='NBM_NATIVE');
  const best=rivals.sort((a,b)=>(meanCrps[a]??Infinity)-(meanCrps[b]??Infinity))[0]??null;
  const d=best?gs.filter(g=>g.baselines[best as BaselineId]).map(g=>g.combined.crps-g.baselines[best as BaselineId]!.crps):[];
  const boot=blockBootstrap(d);
  const cov=r6(avg(gs.map(g=>g.combined.covered?1:0)));
  let disposition:ForwardAnchorSummary['disposition']='NO_CLEAR_EFFECT',reason:string;
  if(gs.length<EVAL_POLICY.minHoldoutDaysForReview)reason=`${gs.length}/${EVAL_POLICY.minHoldoutDaysForReview} graded forward days.`;
  else if(boot.lower95!==null&&boot.lower95>0){disposition='REJECTED';reason=`Forward CRPS confidently worse than ${best}.`;}
  else if(boot.upper95!==null&&boot.upper95<0&&cov!==null&&cov>=EVAL_POLICY.coverage[0]&&cov<=EVAL_POLICY.coverage[1]&&
   (meanCrps.CLIMATOLOGY===undefined||(meanCrps.COMBINED??Infinity)<(meanCrps.CLIMATOLOGY??Infinity)))
   {disposition='PROMISING';reason=`Forward CRPS below the best competitor (${best}) with 95% confidence and calibrated 80% intervals.`;}
  else reason=`No forward advantage over ${best} established.`;
  return {anchor,frozen:frozen.length,awaitingHistory:rs.length-frozen.length,graded:gs.length,ungraded:frozen.length-gs.length,
   missedSince:missed,firstDate:rs[0]?.localDate??null,lastDate:rs.at(-1)?.localDate??null,meanCrps,coverage80:cov,
   vsBest:{against:best,n:d.length,mean:boot.mean,lower95:boot.lower95,upper95:boot.upper95},disposition,reason};
 });
}
