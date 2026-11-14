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
