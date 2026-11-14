/**
 * Independent NWS forecast-vs-preliminary-Central-Park station scorecard.
 * Never compares Kalshi data or prices, so no bets, P&L or win rates are asserted.
 */
import {createHash} from 'node:crypto';
import {gradeIndependentWeather,type IndependentWeatherGrade,type CentralParkCliDaily} from './nws-cli.ts';
import type {IndependentWeatherMemory} from './weather-memory.ts';
const sha=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const round=(x:number|null)=>x===null?null:Number(x.toFixed(6));
export type WeatherScorecard={
 id:string;schemaVersion:'independent-weather-forward-scorecard-v1';
 source:'INDEPENDENT_NWS_GRID_VS_PRELIMINARY_KNYC_CLIMATE';
 status:'INSUFFICIENT_HISTORY'|'EXPLORATORY_FORWARD_ONLY';
 evaluatedDays:number;modelScoredDays:number;
 meanAbsoluteErrorF:number|null;independentBandHitRate:number|null;
 modelBrier:number|null;firstDate:string|null;lastDate:string|null;
 dates:string[];warning:string;
};
export function scoreIndependentWeatherForward(rows:readonly {
 forecast:IndependentWeatherMemory;cli:CentralParkCliDaily;grade:IndependentWeatherGrade;
}[]):WeatherScorecard{
 if(rows.length>2000)throw Error('WEATHER_SCORE_TOO_MANY_DAYS');
 const seen=new Set<string>(),abs:number[]=[],hits:number[]=[],briers:number[]=[],dates:string[]=[];
 for(const row of [...rows].sort((a,b)=>a.forecast.targetLocalDate.localeCompare(b.forecast.targetLocalDate))){
  const date=row.forecast.targetLocalDate;
  if(seen.has(date))throw Error('WEATHER_SCORE_DUPLICATE_DAY');
  seen.add(date);
  // Recalculate from frozen evidence: never accept arbitrary user-supplied "winners".
  const actual=gradeIndependentWeather(row.forecast,row.cli);
  if(JSON.stringify(actual)!==JSON.stringify(row.grade))throw Error('WEATHER_SCORE_GRADE_CONFLICT');
  abs.push(actual.absoluteErrorF);hits.push(actual.hitIndependentBand?1:0);
  if(actual.brier!==null)briers.push(actual.brier);
  dates.push(date);
 }
 const base:Omit<WeatherScorecard,'id'>={
  schemaVersion:'independent-weather-forward-scorecard-v1',
  source:'INDEPENDENT_NWS_GRID_VS_PRELIMINARY_KNYC_CLIMATE',
  status:rows.length>=30?'EXPLORATORY_FORWARD_ONLY':'INSUFFICIENT_HISTORY',
  evaluatedDays:rows.length,modelScoredDays:briers.length,
  meanAbsoluteErrorF:round(mean(abs)),independentBandHitRate:round(mean(hits)),
  modelBrier:round(mean(briers)),firstDate:dates[0]??null,lastDate:dates.at(-1)??null,
  dates,
  warning:'Independent forward weather research only. NWS grid forecasts are not station highs; NWS daily CLI observations are preliminary and not NCEI-certified or verified Kalshi settlements. A 5F band hit is NOT a bet win or profit; market prices, fees, and forward evidence of a market edge are entirely absent.'
 };
 return {id:sha(base),...base};
}

/** Public data-branch report parser: never silently trusts a rewritten daily summary. */
export function verifyIndependentWeatherScorecard(raw:unknown):WeatherScorecard{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('WEATHER_SCORE_INVALID_ARCHIVE');
 const r=raw as Record<string,unknown>,{id,...base}=r;
 if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)||sha(base)!==id||
  r.schemaVersion!=='independent-weather-forward-scorecard-v1'||
  r.source!=='INDEPENDENT_NWS_GRID_VS_PRELIMINARY_KNYC_CLIMATE'||
  !Number.isSafeInteger(r.evaluatedDays)||(r.evaluatedDays as number)<0||
  !Number.isSafeInteger(r.modelScoredDays)||(r.modelScoredDays as number)<0||
  (r.modelScoredDays as number)>(r.evaluatedDays as number)||
  !Array.isArray(r.dates)||r.dates.length!==r.evaluatedDays||
  r.dates.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d))||
  new Set(r.dates).size!==r.dates.length||
  (r.evaluatedDays===0&&
   (r.meanAbsoluteErrorF!==null||r.independentBandHitRate!==null))||
  (r.modelScoredDays===0&&r.modelBrier!==null)||
  (r.status!=='INSUFFICIENT_HISTORY'&&r.status!=='EXPLORATORY_FORWARD_ONLY')||
  (r.independentBandHitRate!==null&&
   (typeof r.independentBandHitRate!=='number'||r.independentBandHitRate<0||r.independentBandHitRate>1)))
  throw Error('WEATHER_SCORE_INVALID_ARCHIVE');
 return raw as WeatherScorecard;
}
