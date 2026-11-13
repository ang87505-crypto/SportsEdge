/**
 * Strictly chronological independent weather forecast research.
 * Input records must have separately evidenced NWS forecast and official Central Park
 * station observation timestamps. This module DOES NOT use Kalshi prices or outcomes.
 * Synthetic unit fixtures are not evidence of forecasting skill or market profitability.
 */
import {estimateStationTemperatureRange,type WeatherTrainingDay} from './weather-model.ts';

export type WeatherReplayRow={
 date:string;asOf:string;trainDays:number;forecastHighF:number;
 bandLowF:number;bandHighF:number;modelProbability:number;climatologyProbability:number;
 outcome:0|1;modelBrier:number;climatologyBrier:number;
};
export type WeatherReplayReport={
 modelId:'nws-empirical-error-v0-research';
 status:'INSUFFICIENT_EVIDENCE'|'RESEARCH_ONLY_NOT_PROVEN';
 inputDays:number;skippedSameDay:number;resolvedHoldoutDays:number;
 meanModelBrier:number|null;meanClimatologyBrier:number|null;
 modelLogLoss:number|null;climatologyLogLoss:number|null;
 pairedBrierImprovement:number|null;
 rows:WeatherReplayRow[];
 caveat:string;
};
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const validDate=(s:string)=>DATE.test(s)&&new Date(s+'T00:00:00.000Z').toISOString().slice(0,10)===s;
const checkedTime=(s:string)=>{const t=Date.parse(s);if(!Number.isFinite(t))throw Error('WEATHER_REPLAY_BAD_TIME');return t;};
const score=(p:number,y:0|1)=>(p-y)**2;
const loss=(p:number,y:0|1)=>-(y*Math.log(p)+(1-y)*Math.log(1-p));
const avg=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const fixed=(n:number)=>Number(n.toFixed(7));
const sameBin=(observed:number,lo:number,hi:number)=>observed>=lo&&observed<=hi;
/**
 * Pre-registered, independently defined range: five whole Fahrenheit degrees
 * anchored to the NWS forecast (e.g. forecast 56 -> [55,59]).
 * These are NOT inferred from any exchange's selected contract bins.
 */
function bandFor(forecastHighF:number):{lo:number;hi:number}{
 const lo=Math.floor(forecastHighF/5)*5;
 return {lo,hi:lo+4};
}
function validateDay(d:WeatherTrainingDay):void{
 if(!validDate(d.localDate)||d.forecastSource!=='NWS'||d.observationSource!=='OFFICIAL_CENTRAL_PARK'||
  !Number.isFinite(d.forecastHighF)||!Number.isFinite(d.observedHighF)||
  d.forecastHighF< -150||d.forecastHighF>180||
  d.observedHighF< -150||d.observedHighF>180)
  throw Error('WEATHER_REPLAY_INVALID_SOURCE');
 const issued=checkedTime(d.forecastAvailableAt),observed=checkedTime(d.observedAvailableAt);
 if(issued>=observed||d.localDate<d.forecastAvailableAt.slice(0,10)||
  d.localDate>d.observedAvailableAt.slice(0,10))
  throw Error('WEATHER_REPLAY_BAD_PROVENANCE');
}
export function walkForwardNwsTemperature(days:readonly WeatherTrainingDay[]):WeatherReplayReport{
 if(days.length>10000)throw Error('WEATHER_REPLAY_TOO_MANY_ROWS');
 const seen=new Set<string>();
 const ordered=[...days].sort((a,b)=>a.localDate.localeCompare(b.localDate));
 for(const d of ordered){
  validateDay(d);
  if(seen.has(d.localDate))throw Error('WEATHER_REPLAY_DUPLICATE_DAY');
  seen.add(d.localDate);
 }
 const rows:WeatherReplayRow[]=[];
 let skippedSameDay=0;
 for(const target of ordered){
  // Today's forecasts require an intra-day time-window design; do not silently
  // bypass the existing model's prospective-date validation.
  if(target.forecastAvailableAt.slice(0,10)>=target.localDate){skippedSameDay++;continue;}
  const known=ordered.filter(r=>r.localDate<target.localDate&&
   checkedTime(r.observedAvailableAt)<checkedTime(target.forecastAvailableAt));
  if(known.length<30)continue;
  const band=bandFor(target.forecastHighF);
  const pred=estimateStationTemperatureRange({
   forecastHighF:target.forecastHighF,rangeMinF:band.lo,rangeMaxF:band.hi,
   targetLocalDate:target.localDate,asOf:target.forecastAvailableAt,training:known
  });
  // The comparator asks if a historical *observed* Central Park high fell
  // in today's independent band, without referencing a forecast or market price.
  const historicalWins=known.filter(d=>sameBin(d.observedHighF,band.lo,band.hi)).length;
  const baseline=(historicalWins+1)/(known.length+2);
  const p=pred.probabilityPpm/1_000_000;
  const y:0|1=sameBin(target.observedHighF,band.lo,band.hi)?1:0;
  rows.push({date:target.localDate,asOf:target.forecastAvailableAt,trainDays:known.length,
   forecastHighF:target.forecastHighF,bandLowF:band.lo,bandHighF:band.hi,
   modelProbability:p,climatologyProbability:baseline,outcome:y,
   modelBrier:score(p,y),climatologyBrier:score(baseline,y)});
 }
 const modelBrier=avg(rows.map(r=>r.modelBrier));
 const baseBrier=avg(rows.map(r=>r.climatologyBrier));
 return {
  modelId:'nws-empirical-error-v0-research',
  status:rows.length>=50?'RESEARCH_ONLY_NOT_PROVEN':'INSUFFICIENT_EVIDENCE',
  inputDays:ordered.length,skippedSameDay,resolvedHoldoutDays:rows.length,
  meanModelBrier:modelBrier===null?null:fixed(modelBrier),
  meanClimatologyBrier:baseBrier===null?null:fixed(baseBrier),
  modelLogLoss:rows.length?fixed(avg(rows.map(r=>loss(r.modelProbability,r.outcome)))!):null,
  climatologyLogLoss:rows.length?fixed(avg(rows.map(r=>loss(r.climatologyProbability,r.outcome)))!):null,
  pairedBrierImprovement:modelBrier===null||baseBrier===null?null:fixed(baseBrier-modelBrier),
  rows,
  caveat:'Research only, independently sourced weather forecast and station data. All training outcomes must have been available at each as-of timestamp. Synthetic fixtures cannot establish any real market advantage, and this is not a Kalshi settlement simulator.'
 };
}
