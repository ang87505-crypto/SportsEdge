/**
 * Independent weather memory: immutable pre-day NYC NWS grid forecasts.
 * Never uses Kalshi prices, market contracts, settlement rules, credentials or orders.
 * A projected NWS grid high is not an official Central Park station daily high.
 */
import {createHash} from 'node:crypto';
import {estimateStationTemperatureRange,type WeatherTrainingDay} from './weather-model.ts';
import type {NWSHourlyResearch} from './nws.ts';
const TIME_ZONE='America/New_York';
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const DAY_MS=86_400_000;
const hourParts=new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,year:'numeric',
 month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ms=(s:string)=>{const t=Date.parse(s);if(!Number.isFinite(t))throw Error('WEATHER_MEMORY_INVALID_TIME');return t;};
function nyParts(s:string){
 const parts=hourParts.formatToParts(new Date(ms(s)));
 const get=(p:string)=>parts.find(x=>x.type===p)?.value??'';
 const date=get('year')+'-'+get('month')+'-'+get('day');
 if(!DATE.test(date))throw Error('WEATHER_MEMORY_INVALID_LOCAL_DATE');
 return {date,hour:Number(get('hour'))};
}
export function nextNewYorkDate(asOf:string){
 const d=nyParts(asOf).date;
 return new Date(Date.parse(d+'T00:00:00Z')+DAY_MS).toISOString().slice(0,10);
}
export type IndependentWeatherMemory={
 schemaVersion:'independent-nyc-weather-memory-v1';
 id:string;
 status:'AWAITING_VERIFIED_HISTORY'|'UNCALIBRATED_EXPERIMENTAL_MODEL';
 source:'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION';
 locale:'America/New_York';targetLocalDate:string;capturedAt:string;forecastIssuedAt:string;
 forecastHighF:number;bandLowF:number;bandHighF:number;
 historicalTrainingDays:number;historicalTrainingDigest:string|null;
 estimatedBandProbabilityPpm:number|null;modelId:string|null;
 sourceDigest:string;sourceSnapshot:NWSHourlyResearch;
 warning:string;
};
/** A single full NYC civil day, with 23/24/25 hourly intervals across DST. */
export function buildIndependentWeatherMemory(s:NWSHourlyResearch,
 training:readonly WeatherTrainingDay[]=[]):IndependentWeatherMemory{
 if(s.source!=='NWS_GRID_FORECAST_NOT_STATION_OBSERVATION'||!Array.isArray(s.hourly)||
  s.hourly.length>48||s.hourly.length<23||!s.sourceDigest||!/^[0-9a-f]{64}$/.test(s.sourceDigest))
  throw Error('WEATHER_MEMORY_INVALID_SOURCE');
 const asOf=ms(s.fetchedAt),issued=ms(s.forecastIssuedAt);
 if(issued>asOf||asOf-issued>12*3600_000)throw Error('WEATHER_MEMORY_STALE_OR_FUTURE_ISSUE');
 const target=nextNewYorkDate(s.fetchedAt);
 const hours=s.hourly.filter(h=>nyParts(h.startTime).date===target)
  .sort((a,b)=>ms(a.startTime)-ms(b.startTime));
 if(hours.length<23||hours.length>25||nyParts(hours[0].startTime).hour!==0||
  nyParts(hours[hours.length-1].startTime).hour!==23)
  throw Error('WEATHER_MEMORY_DAY_NOT_FULLY_COVERED');
 for(let i=0;i<hours.length;i++){
  const h=hours[i],start=ms(h.startTime),end=ms(h.endTime);
  if(!Number.isFinite(h.temperatureF)||h.temperatureF< -100||h.temperatureF>160||
   end-start!==3600_000||(i&&start!==ms(hours[i-1].endTime))||
   start<=asOf||end<=asOf)
   throw Error('WEATHER_MEMORY_GAP_OR_FORECAST_AFTER_LOCK');
 }
 const high=Math.max(...hours.map(h=>h.temperatureF));
 const low=Math.floor(high/5)*5,upper=low+4;
 // Never synthesize a training label or pretend a grid observation is official station history.
 const known=training.filter(r=>ms(r.observedAvailableAt)<asOf);
 let estimatedBandProbabilityPpm:null|number=null,modelId:null|string=null,trainingDigest:null|string=null;
 if(known.length>=30){
  const res=estimateStationTemperatureRange({forecastHighF:high,rangeMinF:low,rangeMaxF:upper,
   targetLocalDate:target,asOf:s.fetchedAt,training:known});
  estimatedBandProbabilityPpm=res.probabilityPpm;modelId=res.modelId;
  trainingDigest=sha(known);
 }
 const base:Omit<IndependentWeatherMemory,'id'>={
  schemaVersion:'independent-nyc-weather-memory-v1',
  status:estimatedBandProbabilityPpm===null?'AWAITING_VERIFIED_HISTORY':'UNCALIBRATED_EXPERIMENTAL_MODEL',
  source:'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION',locale:'America/New_York',
  targetLocalDate:target,capturedAt:s.fetchedAt,forecastIssuedAt:s.forecastIssuedAt,
  forecastHighF:high,bandLowF:low,bandHighF:upper,
  historicalTrainingDays:known.length,historicalTrainingDigest:trainingDigest,
  estimatedBandProbabilityPpm,modelId,sourceDigest:s.sourceDigest,sourceSnapshot:s,
  warning:'Pre-event independent grid-point forecast for a NYC civil day, NOT an official Central Park station high, Kalshi market bin, market settlement, executable price or profitable opportunity. Model probabilities require >=30 independently verified pre-as-of station observations and forward validation.'
 };
 return {id:sha(base),...base};
}
/** Tamper-evident record that can be safely read from the data branch. */
export function verifyIndependentWeatherMemory(raw:unknown):IndependentWeatherMemory{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('WEATHER_MEMORY_INVALID_RECORD');
 const r=raw as Record<string,unknown>,{id,...base}=r;
 if(typeof id!=='string'||!/^([a-f0-9]{64})$/.test(id)||sha(base)!==id||
  r.schemaVersion!=='independent-nyc-weather-memory-v1'||r.locale!=='America/New_York'||
  typeof r.targetLocalDate!=='string'||!DATE.test(r.targetLocalDate)||
  typeof r.capturedAt!=='string'||nextNewYorkDate(r.capturedAt)!==r.targetLocalDate||
  r.source!=='NWS_GRID_FORECAST_NOT_STATION_OBSERVATION'||r.sourceSnapshot===null||
  typeof r.sourceSnapshot!=='object'||Array.isArray(r.sourceSnapshot)||
  (r.sourceSnapshot as Record<string,unknown>).sourceDigest!==r.sourceDigest||
  (r.sourceSnapshot as Record<string,unknown>).fetchedAt!==r.capturedAt||
  typeof r.forecastHighF!=='number'||!Number.isFinite(r.forecastHighF)||
  typeof r.bandLowF!=='number'||r.bandLowF!==Math.floor(r.forecastHighF/5)*5||
  r.bandHighF!==(r.bandLowF as number)+4||
  (r.status!=='AWAITING_VERIFIED_HISTORY'&&r.status!=='UNCALIBRATED_EXPERIMENTAL_MODEL')||
  (r.estimatedBandProbabilityPpm!==null&&
   (!Number.isSafeInteger(r.estimatedBandProbabilityPpm)||
    (r.estimatedBandProbabilityPpm as number)<1||(r.estimatedBandProbabilityPpm as number)>=1_000_000)))
  throw Error('WEATHER_MEMORY_INVALID_RECORD');
 return raw as IndependentWeatherMemory;
}
