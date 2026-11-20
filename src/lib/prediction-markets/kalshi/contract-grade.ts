/** Independent NWS research grades. Never an exchange settlement or monetary return. */
import {createHash} from 'node:crypto';
import {PMF_MODEL_ID,type WeatherContractForecastV1} from './weather-distribution.ts';
import {validateStrikePartition,settlesYes} from './contract-math.ts';
import {centralParkStandardDate} from './weather-model.ts';
import {verifyCentralParkCli,type CentralParkCliDaily} from './nws-cli.ts';
export function verifyContractForecast(v:unknown):WeatherContractForecastV1{
 const f=v as WeatherContractForecastV1;
 if(!f||typeof f!=='object'||Array.isArray(f))throw Error('KALSHI_FORECAST_INVALID');
 const {id,...base}=f;
 if(f.schemaVersion!=='kalshi-weather-contract-forecast-v1'||f.modelId!==PMF_MODEL_ID||f.marketDataUsed!==false||
  !/^[a-f0-9]{64}$/.test(id)||createHash('sha256').update(JSON.stringify(base)).digest('hex')!==id||
  !Number.isFinite(Date.parse(f.asOf))||!f.input||f.input.schemaVersion!=='kalshi-weather-forecast-input-v1'||f.input.station!=='KNYC_CENTRAL_PARK'||
  !/^\d{4}-\d{2}-\d{2}$/.test(f.input.targetLocalDate)||!Number.isSafeInteger(f.input.forecastHighF)||
  f.input.forecastSource!=='NWS_HOURLY_GRID'||!/^[a-f0-9]{64}$/.test(f.input.sourceDigest)||
  f.input.targetLocalDate<=centralParkStandardDate(f.asOf)||
  !Number.isFinite(Date.parse(f.input.forecastAvailableAt))||!Number.isFinite(Date.parse(f.input.forecastIssuedAt))||
  Date.parse(f.input.forecastAvailableAt)>Date.parse(f.asOf)||Date.parse(f.input.forecastIssuedAt)>Date.parse(f.input.forecastAvailableAt)||
  !Number.isSafeInteger(f.trainingDays)||f.trainingDays<0||!Number.isSafeInteger(f.horizonMatchedDays)||f.horizonMatchedDays<0||f.horizonMatchedDays>f.trainingDays||
  !Array.isArray(f.contracts)||f.contracts.length<2)throw Error('KALSHI_FORECAST_INVALID');
 validateStrikePartition(f.contracts.map(c=>c.strike));
 if(f.status==='AWAITING_VERIFIED_HISTORY'){
  if(f.distribution!==null||f.contracts.some(c=>c.probabilityYesPpm!==null)||
   !['WEATHER_INSUFFICIENT_DAYS','WEATHER_INSUFFICIENT_HORIZON_MATCHED_DAYS'].includes(String(f.blocker)))throw Error('KALSHI_FORECAST_INVALID');
 }else if(f.status==='UNCALIBRATED_EXPERIMENTAL_MODEL'){
  if(f.blocker!==null||f.trainingDays<30||f.horizonMatchedDays<30||!f.distribution||
   f.contracts.some(c=>!Number.isSafeInteger(c.probabilityYesPpm)||c.probabilityYesPpm!<0||c.probabilityYesPpm!>1_000_000)||
   f.contracts.reduce((a,c)=>a+c.probabilityYesPpm!,0)!==1_000_000)throw Error('KALSHI_FORECAST_INVALID');
 }else throw Error('KALSHI_FORECAST_INVALID');
 return f;
}
export type ContractResearchGrade={schemaVersion:'kalshi-contract-research-grade-v1';forecastId:string;sourceId:string;
 targetLocalDate:string;source:'NWS_PRELIMINARY_RESEARCH';observedHighF:number;absoluteErrorF:number;
 gradedAt:string;sourceAvailableAt:string;brier:number|null;logLoss:number|null;contractResults:boolean[];
 exchangeSettlement:false;profitMicros:null};
export function gradeContractResearch(forecast:WeatherContractForecastV1,cli:CentralParkCliDaily,asOf:string):ContractResearchGrade{
 const f=verifyContractForecast(forecast),c=verifyCentralParkCli(cli);
 if(c.reportDate!==f.input.targetLocalDate||!Number.isFinite(Date.parse(asOf))||
  Date.parse(c.fetchedAt)>Date.parse(asOf)||Date.parse(c.fetchedAt)<=Date.parse(f.asOf))throw Error('KALSHI_RESEARCH_GRADE_TIME');
 const results=f.contracts.map(x=>settlesYes(x.strike,c.observedHighF));
 if(results.filter(Boolean).length!==1)throw Error('KALSHI_RESEARCH_GRADE_PARTITION');
 const trained=f.status==='UNCALIBRATED_EXPERIMENTAL_MODEL';
 const brier=trained?f.contracts.reduce((a,x,i)=>a+(x.probabilityYesPpm!/1_000_000-Number(results[i]))**2,0)/results.length:null;
 const logLoss=trained?f.contracts.reduce((a,x,i)=>{
  const p=Math.max(1e-9,Math.min(1-1e-9,x.probabilityYesPpm!/1_000_000));return a-(results[i]?Math.log(p):Math.log(1-p));},0)/results.length:null;
 return {schemaVersion:'kalshi-contract-research-grade-v1',forecastId:f.id,sourceId:c.id,
  targetLocalDate:c.reportDate,source:'NWS_PRELIMINARY_RESEARCH',observedHighF:c.observedHighF,
  absoluteErrorF:Math.abs(c.observedHighF-f.input.forecastHighF),gradedAt:asOf,sourceAvailableAt:c.fetchedAt,
  brier,logLoss,contractResults:results,exchangeSettlement:false,profitMicros:null};
}
