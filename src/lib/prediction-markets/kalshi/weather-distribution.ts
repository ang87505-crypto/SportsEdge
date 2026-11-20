/**
 * Registered challenger: nws-empirical-error-pmf-v1-research.
 * Turns one frozen NWS forecast high into a whole-degree probability distribution for the
 * Central Park climate-day high, so ANY contract ladder (2°F bins, strict tails) can be priced
 * coherently. Uses ZERO Kalshi data. Keeps the registered 30-day minimum and as-of gate of v0,
 * and additionally requires those 30 days to come from the same forecast horizon.
 * Pre-registration: docs/KALSHI_WEATHER_CONTRACT_MATH_2026_11_20.md
 */
import {createHash} from 'node:crypto';
import {centralParkStandardDate,validateTrainingAsOf,MIN_TRAINING_DAYS,type WeatherTrainingDay} from './weather-model.ts';
import {strikeIntegerRange,validateStrikePartition,type IntegerRange,type TemperatureStrike} from './contract-math.ts';

export const PMF_MODEL_ID='nws-empirical-error-pmf-v1-research' as const;
/** Whole degrees either side of the forecast; the two edge cells hold the open tails. */
export const PMF_SUPPORT_RADIUS_F=25;
/** Pseudo-count of the smoothing prior (same strength as v0's add-one/add-two Laplace rule). */
export const PMF_SMOOTHING_ALPHA=2;
/** Minimum discrete-Laplace prior scale in °F; widened to the training mean absolute error. */
export const PMF_MIN_PRIOR_SCALE_F=1.5;
/** Training rows count only if their lead time is within this many hours of the target's. */
export const PMF_HORIZON_TOLERANCE_HOURS=6;
const U=1_000_000;
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const DATE=/^\d{4}-\d{2}-\d{2}$/;

/** Hours from forecast availability to 00:00 EST (05:00 UTC) starting the climate day. */
export function forecastLeadHours(forecastAvailableAt:string,localDate:string):number{
 const t=Date.parse(forecastAvailableAt),start=Date.parse(localDate+'T05:00:00Z');
 if(!Number.isFinite(t)||!DATE.test(localDate)||!Number.isFinite(start))throw Error('WEATHER_INVALID_TIME');
 return (start-t)/3600_000;
}

export type WeatherHighPmf={
 modelId:typeof PMF_MODEL_ID;targetLocalDate:string;asOf:string;forecastAvailableAt:string;
 forecastHighF:number;leadHours:number;trainingDays:number;horizonMatchedDays:number;trainingDigest:string;
 supportMinF:number;supportMaxF:number;
 /** pmfPpm[i] is P(high = supportMinF+i); index 0 is P(high <= supportMinF), last is P(high >= supportMaxF). */
 pmfPpm:number[];
 smoothing:{alpha:number;priorScaleF:number};
};
/**
 * Largest-remainder rounding so integer ppm cells sum to exactly 1,000,000. Every cell keeps
 * at least 1 ppm so no whole degree is ever declared impossible (finite log loss).
 */
function toPpm(weights:number[]):number[]{
 const total=weights.reduce((a,b)=>a+b,0),free=U-weights.length;
 const raw=weights.map(w=>w/total*free),floor=raw.map(r=>Math.floor(r)+1);
 let left=U-floor.reduce((a,b)=>a+b,0);
 const order=raw.map((r,i)=>({i,frac:r-floor[i]})).sort((a,b)=>b.frac-a.frac||a.i-b.i);
 for(const {i} of order){if(left<=0)break;floor[i]++;left--;}
 return floor;
}
export function forecastHighPmf(x:{
 forecastHighF:number;targetLocalDate:string;asOf:string;forecastAvailableAt:string;
 training:readonly WeatherTrainingDay[];
}):WeatherHighPmf{
 if(!Number.isSafeInteger(x.forecastHighF)||x.forecastHighF< -100||x.forecastHighF>150||
  typeof x.targetLocalDate!=='string'||!DATE.test(x.targetLocalDate)||!Number.isFinite(Date.parse(x.asOf)))
  throw Error('WEATHER_INVALID_TARGET');
 if(x.targetLocalDate<=centralParkStandardDate(x.asOf))throw Error('WEATHER_TARGET_NOT_FUTURE');
 if(!Number.isFinite(Date.parse(x.forecastAvailableAt))||Date.parse(x.forecastAvailableAt)>Date.parse(x.asOf))
  throw Error('WEATHER_FORECAST_AFTER_ASOF');
 const admitted=validateTrainingAsOf(x.training,x.targetLocalDate,x.asOf);
 if(admitted.length<MIN_TRAINING_DAYS)throw Error('WEATHER_INSUFFICIENT_DAYS');
 const leadHours=forecastLeadHours(x.forecastAvailableAt,x.targetLocalDate);
 const matched=admitted.filter(r=>Math.abs(forecastLeadHours(r.forecastAvailableAt,r.localDate)-leadHours)<=PMF_HORIZON_TOLERANCE_HOURS)
  .sort((a,b)=>a.localDate.localeCompare(b.localDate));
 if(matched.length<MIN_TRAINING_DAYS)throw Error('WEATHER_INSUFFICIENT_HORIZON_MATCHED_DAYS');
 for(const r of matched)if(!Number.isSafeInteger(r.forecastHighF)||!Number.isSafeInteger(r.observedHighF))
  throw Error('WEATHER_NON_INTEGER_TRAINING');
 const R=PMF_SUPPORT_RADIUS_F;
 const residuals=matched.map(r=>Math.max(-R,Math.min(R,r.observedHighF-r.forecastHighF)));
 const priorScaleF=Math.max(PMF_MIN_PRIOR_SCALE_F,residuals.reduce((a,e)=>a+Math.abs(e),0)/residuals.length);
 const ks=Array.from({length:2*R+1},(_,i)=>i-R);
 const prior=ks.map(k=>Math.exp(-Math.abs(k)/priorScaleF)),priorTotal=prior.reduce((a,b)=>a+b,0);
 const counts=ks.map(k=>residuals.filter(e=>e===k).length);
 const weights=ks.map((_,i)=>counts[i]+PMF_SMOOTHING_ALPHA*prior[i]/priorTotal);
 return {modelId:PMF_MODEL_ID,targetLocalDate:x.targetLocalDate,asOf:x.asOf,
  forecastAvailableAt:x.forecastAvailableAt,forecastHighF:x.forecastHighF,leadHours,
  trainingDays:admitted.length,horizonMatchedDays:matched.length,trainingDigest:sha(matched),
  supportMinF:x.forecastHighF-R,supportMaxF:x.forecastHighF+R,pmfPpm:toPpm(weights),
  smoothing:{alpha:PMF_SMOOTHING_ALPHA,priorScaleF:Number(priorScaleF.toFixed(6))}};
}
/** P(YES) in ppm. A strike that would split a lumped tail cell is refused, never interpolated. */
export function contractProbabilityPpm(pmf:WeatherHighPmf,strike:TemperatureStrike):number{
 return rangeProbabilityPpm(pmf,strikeIntegerRange(strike));
}
function rangeProbabilityPpm(pmf:WeatherHighPmf,r:IntegerRange):number{
 const lo=pmf.supportMinF,hi=pmf.supportMaxF;
 // Edge cells are open tails: a strike must contain all of a tail cell or none of it.
 const lowPartial=(r.minF!==null&&r.minF<=lo)||(r.minF===null&&r.maxF!==null&&r.maxF<lo);
 const highPartial=(r.maxF!==null&&r.maxF>=hi)||(r.maxF===null&&r.minF!==null&&r.minF>hi);
 if(lowPartial||highPartial)throw Error('WEATHER_STRIKE_OUTSIDE_MODEL_SUPPORT');
 let total=0;
 pmf.pmfPpm.forEach((p,i)=>{
  const t=lo+i;
  if((r.minF===null||t>=r.minF)&&(r.maxF===null||t<=r.maxF))total+=p;
 });
 return total;
}
/** Probabilities for a full event ladder, in the caller's order; they sum to exactly 1,000,000. */
export function eventProbabilitiesPpm(pmf:WeatherHighPmf,strikes:readonly TemperatureStrike[]):number[]{
 validateStrikePartition(strikes);
 const out=strikes.map(s=>contractProbabilityPpm(pmf,s));
 if(out.reduce((a,b)=>a+b,0)!==U)throw Error('WEATHER_EVENT_NOT_COHERENT');
 return out;
}

/* ---------- Proposed shared forecast I/O contract (v1). Not yet persisted anywhere. ---------- */

/** What a collector supplies per target day. Derivable from the existing frozen weather memory. */
export type WeatherForecastInputV1={
 schemaVersion:'kalshi-weather-forecast-input-v1';
 station:'KNYC_CENTRAL_PARK';
 /** Central Park climate day, local standard time (UTC-5) year round. */
 targetLocalDate:string;
 /** Whole °F: max of the 24 hourly grid temperatures in the climate day. */
 forecastHighF:number;
 forecastIssuedAt:string;
 /** When SportsEdge actually held the forecast (capture time); the as-of anchor. */
 forecastAvailableAt:string;
 forecastSource:'NWS_HOURLY_GRID';
 sourceDigest:string;
};
export type WeatherContractForecastStatus='AWAITING_VERIFIED_HISTORY'|'UNCALIBRATED_EXPERIMENTAL_MODEL';
/** What the model returns. Probabilities are null (never guessed) until history is sufficient. */
export type WeatherContractForecastV1={
 schemaVersion:'kalshi-weather-contract-forecast-v1';id:string;
 modelId:typeof PMF_MODEL_ID;status:WeatherContractForecastStatus;
 blocker:null|'WEATHER_INSUFFICIENT_DAYS'|'WEATHER_INSUFFICIENT_HORIZON_MATCHED_DAYS';
 input:WeatherForecastInputV1;asOf:string;leadHours:number;
 trainingDays:number;horizonMatchedDays:number;trainingDigest:string|null;
 distribution:null|{supportMinF:number;supportMaxF:number;pmfPpm:number[];smoothing:{alpha:number;priorScaleF:number}};
 contracts:{strike:TemperatureStrike;range:IntegerRange;probabilityYesPpm:number|null}[];
 marketDataUsed:false;caveat:string;
};
function checkInput(i:WeatherForecastInputV1){
 const x=i as Record<string,unknown>;
 if(!x||x.schemaVersion!=='kalshi-weather-forecast-input-v1'||x.station!=='KNYC_CENTRAL_PARK'||
  typeof x.targetLocalDate!=='string'||!DATE.test(x.targetLocalDate)||!Number.isSafeInteger(x.forecastHighF)||
  typeof x.forecastIssuedAt!=='string'||!Number.isFinite(Date.parse(x.forecastIssuedAt))||
  typeof x.forecastAvailableAt!=='string'||!Number.isFinite(Date.parse(x.forecastAvailableAt))||
  Date.parse(x.forecastIssuedAt)>Date.parse(x.forecastAvailableAt)||
  x.forecastSource!=='NWS_HOURLY_GRID'||typeof x.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(x.sourceDigest))
  throw Error('WEATHER_INPUT_CONTRACT_VIOLATION');
}
export function forecastInputFromMemory(m:{
 targetLocalDate:string;forecastHighF:number;forecastIssuedAt:string;capturedAt:string;
 sourceDigest:string;dayDefinition:string;source:string;
}):WeatherForecastInputV1{
 if(m.dayDefinition!=='CENTRAL_PARK_LOCAL_STANDARD_TIME_UTC_MINUS_5'||m.source!=='NWS_GRID_FORECAST_NOT_STATION_OBSERVATION')
  throw Error('WEATHER_INPUT_CONTRACT_VIOLATION');
 const input:WeatherForecastInputV1={schemaVersion:'kalshi-weather-forecast-input-v1',station:'KNYC_CENTRAL_PARK',
  targetLocalDate:m.targetLocalDate,forecastHighF:m.forecastHighF,forecastIssuedAt:m.forecastIssuedAt,
  forecastAvailableAt:m.capturedAt,forecastSource:'NWS_HOURLY_GRID',sourceDigest:m.sourceDigest};
 checkInput(input);
 return input;
}
const AWAITING=new Set(['WEATHER_INSUFFICIENT_DAYS','WEATHER_INSUFFICIENT_HORIZON_MATCHED_DAYS']);
export function buildWeatherContractForecast(x:{
 input:WeatherForecastInputV1;training:readonly WeatherTrainingDay[];strikes:readonly TemperatureStrike[];asOf:string;
}):WeatherContractForecastV1{
 checkInput(x.input);
 validateStrikePartition(x.strikes);
 const leadHours=forecastLeadHours(x.input.forecastAvailableAt,x.input.targetLocalDate);
 let pmf:WeatherHighPmf|null=null,blocker:WeatherContractForecastV1['blocker']=null;
 try{
  pmf=forecastHighPmf({forecastHighF:x.input.forecastHighF,targetLocalDate:x.input.targetLocalDate,
   asOf:x.asOf,forecastAvailableAt:x.input.forecastAvailableAt,training:x.training});
 }catch(e){
  const code=e instanceof Error?e.message:'';
  if(!AWAITING.has(code))throw e;
  blocker=code as NonNullable<typeof blocker>;
 }
 const admitted=pmf?pmf.trainingDays:validateTrainingAsOf(x.training,x.input.targetLocalDate,x.asOf).length;
 const matched=pmf?pmf.horizonMatchedDays:x.training.filter(r=>Math.abs(forecastLeadHours(r.forecastAvailableAt,r.localDate)-leadHours)<=PMF_HORIZON_TOLERANCE_HOURS).length;
 const probs=pmf?eventProbabilitiesPpm(pmf,x.strikes):null;
 const base:Omit<WeatherContractForecastV1,'id'>={
  schemaVersion:'kalshi-weather-contract-forecast-v1',modelId:PMF_MODEL_ID,
  status:pmf?'UNCALIBRATED_EXPERIMENTAL_MODEL':'AWAITING_VERIFIED_HISTORY',blocker,
  input:x.input,asOf:x.asOf,leadHours,trainingDays:admitted,horizonMatchedDays:matched,
  trainingDigest:pmf?.trainingDigest??null,
  distribution:pmf?{supportMinF:pmf.supportMinF,supportMaxF:pmf.supportMaxF,pmfPpm:pmf.pmfPpm,smoothing:pmf.smoothing}:null,
  contracts:x.strikes.map((strike,i)=>({strike,range:strikeIntegerRange(strike),probabilityYesPpm:probs?probs[i]:null})),
  marketDataUsed:false,
  caveat:'Independent NWS-forecast research distribution for the KNYC climate-day high. Not calibrated against market prices, not a Kalshi settlement, quote or order. Training outcomes are preliminary NWS CLI reports; Kalshi settles on the first non-preliminary report from The Weather Company, then NWS.'};
 return {id:sha(base),...base};
}
