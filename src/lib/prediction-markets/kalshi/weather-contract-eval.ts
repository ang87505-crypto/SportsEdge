/**
 * Walk-forward evaluation of whole-degree contract probabilities on an INDEPENDENT ladder that
 * mirrors Kalshi's daily structure (two strict tails + four inclusive 2°F bins around the forecast).
 * It never reads Kalshi listings, quotes or settlements. Output is research evidence only and
 * can never promote a model: promotion gates live outside this module and are unchanged.
 */
import {centralParkStandardDate,estimateStationTemperatureRange,MIN_TRAINING_DAYS,type WeatherTrainingDay} from './weather-model.ts';
import {forecastHighPmf,eventProbabilitiesPpm,type WeatherHighPmf} from './weather-distribution.ts';
import {strikeIntegerRange,inRange,type TemperatureStrike} from './contract-math.ts';

const U=1_000_000;
const BINS=6;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const DAY_MS=86_400_000;
const addDays=(d:string,n:number)=>new Date(Date.parse(d+'T00:00:00Z')+n*DAY_MS).toISOString().slice(0,10);
const fixed=(n:number|null)=>n===null?null:Number(n.toFixed(7));
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;

/** Lower tail <= f-5, bins [f-4,f-3] [f-2,f-1] [f,f+1] [f+2,f+3], upper tail >= f+4. */
export function independentLadder(forecastHighF:number):TemperatureStrike[]{
 if(!Number.isSafeInteger(forecastHighF))throw Error('WEATHER_EVAL_INVALID_FORECAST');
 const f=forecastHighF;
 return [{kind:'below',thresholdF:f-4},{kind:'between',lowerF:f-4,upperF:f-3},{kind:'between',lowerF:f-2,upperF:f-1},
  {kind:'between',lowerF:f,upperF:f+1},{kind:'between',lowerF:f+2,upperF:f+3},{kind:'above',thresholdF:f+3}];
}
function ppmFromCounts(counts:number[]):number[]{
 const total=counts.reduce((a,b)=>a+b,0),raw=counts.map(c=>c/total*U),out=raw.map(Math.floor);
 let left=U-out.reduce((a,b)=>a+b,0);
 for(const {i} of raw.map((r,i)=>({i,f:r-out[i]})).sort((a,b)=>b.f-a.f||a.i-b.i)){if(left<=0)break;out[i]++;left--;}
 return out;
}
export type ContractEvalRow={
 date:string;asOf:string;trainDays:number;horizonMatchedDays:number;forecastHighF:number;observedHighF:number;
 outcomeBin:number;challenger:number[];climatology:number[];v0PerBin:number[];
};
type ModelName='challenger'|'climatology'|'v0PerBin';
export type ModelScore={meanContractBrier:number|null;meanEventBrier:number|null;meanLogLoss:number|null;
 meanRankedProbabilityScore:number|null;meanAbsCoherenceGapPpm:number|null};
export type ContractEvalReport={
 schemaVersion:'kalshi-weather-contract-eval-v1';
 challengerModelId:'nws-empirical-error-pmf-v1-research';
 status:'BLOCKED_INSUFFICIENT_HISTORY'|'INSUFFICIENT_EVIDENCE'|'RESEARCH_ONLY_NOT_PROVEN';
 inputDays:number;skippedSameDay:number;skippedInsufficientHistory:number;holdoutDays:number;
 minTrainingDays:number;minHoldoutDaysForReview:number;
 models:{[k in ModelName]:ModelScore};
 paired:{challengerVsClimatology:PairedDelta;challengerVsV0PerBin:PairedDelta};
 reliability:{lo:number;hi:number;n:number;meanPredicted:number|null;observedFrequency:number|null}[];
 intervalCoverage80:number|null;
 promotionEligible:false;
 rows:ContractEvalRow[];
 caveat:string;
};
type PairedDelta={n:number;meanEventBrierDelta:number|null;daysChallengerBetter:number};
export const MIN_HOLDOUT_DAYS_FOR_REVIEW=50;

function scoreRow(p:number[],y:number){
 const probs=p.map(x=>x/U);
 const contract=probs.map((q,b)=>(q-(b===y?1:0))**2);
 let cumP=0,cumO=0,rps=0;
 for(let b=0;b<BINS-1;b++){cumP+=probs[b];cumO+=b===y?1:0;rps+=(cumP-cumO)**2;}
 return {contractBrier:contract.reduce((a,b)=>a+b,0)/BINS,eventBrier:contract.reduce((a,b)=>a+b,0),
  logLoss:-Math.log(Math.max(1e-6,probs[y])),rps:rps/(BINS-1),gap:Math.abs(p.reduce((a,b)=>a+b,0)-U)};
}
function quantile(pmf:WeatherHighPmf,q:number){
 let cum=0;
 for(let i=0;i<pmf.pmfPpm.length;i++){cum+=pmf.pmfPpm[i];if(cum>=q*U)return pmf.supportMinF+i;}
 return pmf.supportMaxF;
}
export function walkForwardContractEvaluation(days:readonly WeatherTrainingDay[]):ContractEvalReport{
 if(days.length>10_000)throw Error('WEATHER_EVAL_TOO_MANY_ROWS');
 const ordered=[...days].sort((a,b)=>a.localDate.localeCompare(b.localDate));
 const seen=new Set<string>();
 for(const d of ordered){
  if(typeof d.localDate!=='string'||!DATE.test(d.localDate)||seen.has(d.localDate))throw Error('WEATHER_EVAL_DUPLICATE_OR_INVALID_DAY');
  if(!Number.isSafeInteger(d.forecastHighF)||!Number.isSafeInteger(d.observedHighF))throw Error('WEATHER_EVAL_NON_INTEGER_DAY');
  seen.add(d.localDate);
 }
 const rows:ContractEvalRow[]=[],pmfs:WeatherHighPmf[]=[];
 let skippedSameDay=0,skippedInsufficientHistory=0;
 for(const target of ordered){
  if(centralParkStandardDate(target.forecastAvailableAt)>=target.localDate){skippedSameDay++;continue;}
  const asOf=target.forecastAvailableAt,cut=Date.parse(asOf);
  const known=ordered.filter(r=>r.localDate<target.localDate&&Date.parse(r.observedAvailableAt)<cut);
  let pmf:WeatherHighPmf;
  try{pmf=forecastHighPmf({forecastHighF:target.forecastHighF,targetLocalDate:target.localDate,asOf,forecastAvailableAt:asOf,training:known});}
  catch(e){
   const code=e instanceof Error?e.message:'';
   if(code==='WEATHER_INSUFFICIENT_DAYS'||code==='WEATHER_INSUFFICIENT_HORIZON_MATCHED_DAYS'){skippedInsufficientHistory++;continue;}
   throw e;
  }
  const ladder=independentLadder(target.forecastHighF),ranges=ladder.map(strikeIntegerRange);
  const outcomeBin=ranges.findIndex(r=>inRange(r,target.observedHighF));
  const climatology=ppmFromCounts(ranges.map(r=>1+known.filter(k=>inRange(r,k.observedHighF)).length));
  const v0PerBin=ranges.map(r=>estimateStationTemperatureRange({forecastHighF:target.forecastHighF,
   rangeMinF:r.minF??-150,rangeMaxF:r.maxF??180,targetLocalDate:target.localDate,asOf,training:known}).probabilityPpm);
  rows.push({date:target.localDate,asOf,trainDays:known.length,horizonMatchedDays:pmf.horizonMatchedDays,
   forecastHighF:target.forecastHighF,observedHighF:target.observedHighF,outcomeBin,
   challenger:eventProbabilitiesPpm(pmf,ladder),climatology,v0PerBin});
  pmfs.push(pmf);
 }
 const scores=(m:ModelName)=>rows.map(r=>scoreRow(r[m],r.outcomeBin));
 const summarize=(m:ModelName):ModelScore=>{
  const s=scores(m);
  return {meanContractBrier:fixed(mean(s.map(x=>x.contractBrier))),meanEventBrier:fixed(mean(s.map(x=>x.eventBrier))),
   meanLogLoss:fixed(mean(s.map(x=>x.logLoss))),meanRankedProbabilityScore:fixed(mean(s.map(x=>x.rps))),
   meanAbsCoherenceGapPpm:fixed(mean(s.map(x=>x.gap)))};
 };
 const paired=(baseline:ModelName):PairedDelta=>{
  const c=scores('challenger'),b=scores(baseline);
  return {n:c.length,meanEventBrierDelta:fixed(mean(c.map((x,i)=>x.eventBrier-b[i].eventBrier))),
   daysChallengerBetter:c.filter((x,i)=>x.eventBrier<b[i].eventBrier).length};
 };
 const reliability=[0,1,2,3,4].map(k=>{
  const lo=k/5,hi=(k+1)/5;
  const pts=rows.flatMap(r=>r.challenger.map((p,b)=>({p:p/U,y:b===r.outcomeBin?1:0})))
   .filter(x=>x.p>=lo&&(k===4?x.p<=hi:x.p<hi));
  return {lo,hi,n:pts.length,meanPredicted:fixed(mean(pts.map(x=>x.p))),observedFrequency:fixed(mean(pts.map(x=>x.y)))};
 });
 const covered=rows.map((r,i)=>r.observedHighF>=quantile(pmfs[i],0.1)&&r.observedHighF<=quantile(pmfs[i],0.9)?1:0);
 return {
  schemaVersion:'kalshi-weather-contract-eval-v1',challengerModelId:'nws-empirical-error-pmf-v1-research',
  status:rows.length===0?'BLOCKED_INSUFFICIENT_HISTORY':rows.length<MIN_HOLDOUT_DAYS_FOR_REVIEW?'INSUFFICIENT_EVIDENCE':'RESEARCH_ONLY_NOT_PROVEN',
  inputDays:ordered.length,skippedSameDay,skippedInsufficientHistory,holdoutDays:rows.length,
  minTrainingDays:MIN_TRAINING_DAYS,minHoldoutDaysForReview:MIN_HOLDOUT_DAYS_FOR_REVIEW,
  models:{challenger:summarize('challenger'),climatology:summarize('climatology'),v0PerBin:summarize('v0PerBin')},
  paired:{challengerVsClimatology:paired('climatology'),challengerVsV0PerBin:paired('v0PerBin')},
  reliability,intervalCoverage80:fixed(mean(covered)),promotionEligible:false,rows,
  caveat:'Independent ladder, not Kalshi listings. Outcomes are preliminary NWS CLI reports, not Kalshi settlements. No prices, fees or fills are involved, so no edge or profit is measured. A better score than baselines on this ladder is a prerequisite for review, not a promotion.'};
}

/** Approximate UTC time the CLINYC "latest" text is replaced by the next day's 4:30 PM interim report. */
const LATEST_ENDPOINT_REPLACED_UTC='T21:30:00Z';
export type WeatherEvidenceBlockers={
 asOf:string;minTrainingDays:number;pairedDays:string[];
 missingOutcomesPastLatestEndpoint:string[];outcomesPending:string[];missingForecasts:string[];
 outcomesWithoutForecast:string[];trainingShortfall:number;
 earliestThirtiethPairTargetDate:string|null;earliestFirstModelForecastCaptureDate:string|null;
 codes:string[];
};
/**
 * Explicit missing-data report for the archived NOAA evidence. Projections assume every future
 * day is captured and graded; any missed day pushes them back one day.
 */
export function weatherEvidenceBlockers(x:{
 asOf:string;forecastDates:readonly string[];outcomeDates:readonly string[];
 /** Observed workflow runs fetch outcomes AFTER the same morning's forecast capture (default). */
 outcomeFetchedBeforeSameDayCapture?:boolean;
}):WeatherEvidenceBlockers{
 const ok=(d:unknown)=>typeof d==='string'&&DATE.test(d)&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 if(!Number.isFinite(Date.parse(x.asOf))||!Array.isArray(x.forecastDates)||!Array.isArray(x.outcomeDates)||
  ![...x.forecastDates,...x.outcomeDates].every(ok))throw Error('WEATHER_BLOCKERS_INVALID_INPUT');
 const forecasts=[...new Set(x.forecastDates)].sort(),outcomes=new Set(x.outcomeDates),fset=new Set(forecasts);
 const pairedDays=forecasts.filter(d=>outcomes.has(d));
 const unpaired=forecasts.filter(d=>!outcomes.has(d));
 const asOf=Date.parse(x.asOf);
 const missed=unpaired.filter(d=>Date.parse(addDays(d,1)+LATEST_ENDPOINT_REPLACED_UTC)<asOf);
 const pending=unpaired.filter(d=>!missed.includes(d));
 const missingForecasts:string[]=[];
 if(forecasts.length)for(let d=forecasts[0];d<forecasts.at(-1)!;d=addDays(d,1))if(!fset.has(d))missingForecasts.push(d);
 const outcomesWithoutForecast=[...outcomes].filter(d=>!fset.has(d)).sort();
 const shortfall=Math.max(0,MIN_TRAINING_DAYS-pairedDays.length);
 let thirtieth:string|null=null;
 if(shortfall>0){
  const nextCapturable=new Date(asOf-5*3600_000+DAY_MS).toISOString().slice(0,10);
  const candidates=[...pending];
  let d=forecasts.length&&addDays(forecasts.at(-1)!,1)>nextCapturable?addDays(forecasts.at(-1)!,1):nextCapturable;
  while(candidates.length<shortfall){candidates.push(d);d=addDays(d,1);}
  thirtieth=candidates.sort()[shortfall-1];
 }
 const codes=[
  shortfall>0&&'INSUFFICIENT_TRAINING_PAIRS',missed.length&&'OUTCOMES_MISSED_BY_COLLECTOR',
  pending.length&&'OUTCOMES_PENDING',missingForecasts.length&&'FORECASTS_MISSING',
  outcomesWithoutForecast.length&&'OUTCOMES_WITHOUT_FORECAST'].filter((c):c is string=>typeof c==='string');
 return {asOf:x.asOf,minTrainingDays:MIN_TRAINING_DAYS,pairedDays,missingOutcomesPastLatestEndpoint:missed,
  outcomesPending:pending,missingForecasts,outcomesWithoutForecast,trainingShortfall:shortfall,
  earliestThirtiethPairTargetDate:thirtieth,
  earliestFirstModelForecastCaptureDate:thirtieth===null?null:addDays(thirtieth,x.outcomeFetchedBeforeSameDayCapture?1:2),
  codes};
}
