/**
 * Independent weather research model. Requires real historical forecasts AND observed Central
 * Park station highs with documented availability timestamps. Uses ZERO Kalshi input.
 * Does not parse market wording, set stakes, or place orders.
 */
export type WeatherTrainingDay={
 localDate:string;forecastHighF:number;observedHighF:number;
 forecastAvailableAt:string;observedAvailableAt:string;
 forecastSource:'NWS';observationSource:'OFFICIAL_CENTRAL_PARK';
};
export type WeatherRangeStudy={
 modelId:'nws-empirical-error-v0-research';trainingDays:number;probabilityPpm:number;
 asOf:string;targetLocalDate:string;referenceForecastHighF:number;
 rangeMinF:number;rangeMaxF:number;
 caveat:string;
};
const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'));
const time=(s:string)=>Number.isFinite(Date.parse(s));
const finite=(n:number)=>typeof n==='number'&&Number.isFinite(n)&&n>= -150&&n<=180;
/** Strictly retrospective, smoothed empirical error distribution; never counts future data. */
export function estimateStationTemperatureRange(x:{
 forecastHighF:number;rangeMinF:number;rangeMaxF:number;
 targetLocalDate:string;asOf:string;training:readonly WeatherTrainingDay[]
}):WeatherRangeStudy{
 if(!finite(x.forecastHighF)||!finite(x.rangeMinF)||!finite(x.rangeMaxF)||
  x.rangeMinF>x.rangeMaxF||!date(x.targetLocalDate)||!time(x.asOf))
  throw Error('WEATHER_INVALID_TARGET');
 if(x.targetLocalDate<=x.asOf.slice(0,10))throw Error('WEATHER_TARGET_NOT_FUTURE');
 const seen=new Set<string>();const residuals:number[]=[];
 for(const r of x.training){
  if(r.forecastSource!=='NWS'||r.observationSource!=='OFFICIAL_CENTRAL_PARK'||
   !date(r.localDate)||!time(r.forecastAvailableAt)||!time(r.observedAvailableAt)||
   !finite(r.forecastHighF)||!finite(r.observedHighF)||
   r.localDate>=x.targetLocalDate||Date.parse(r.observedAvailableAt)>=Date.parse(x.asOf)||
   Date.parse(r.forecastAvailableAt)>=Date.parse(r.observedAvailableAt)||
   r.forecastAvailableAt.slice(0,10)>r.localDate)
   throw Error('WEATHER_ASOF_OR_SOURCE_VIOLATION');
  if(seen.has(r.localDate))throw Error('WEATHER_DUPLICATE_DAY');seen.add(r.localDate);
  residuals.push(r.observedHighF-r.forecastHighF);
 }
 if(residuals.length<30)throw Error('WEATHER_INSUFFICIENT_DAYS');
 // One-sided Laplace smoothing prevents false certainty from a small error distribution.
 const wins=residuals.filter(e=>x.forecastHighF+e>=x.rangeMinF&&x.forecastHighF+e<=x.rangeMaxF).length;
 const probabilityPpm=Math.round(1_000_000*(wins+1)/(residuals.length+2));
 return {modelId:'nws-empirical-error-v0-research',trainingDays:residuals.length,
  probabilityPpm,asOf:x.asOf,targetLocalDate:x.targetLocalDate,
  referenceForecastHighF:x.forecastHighF,rangeMinF:x.rangeMinF,rangeMaxF:x.rangeMaxF,
  caveat:'Exploratory independently sourced climatology. Different forecast grid and station, small samples, seasonality, contract rounding/rules, calibration and actual as-of training must be verified. Not proven against market prices.'};
}
