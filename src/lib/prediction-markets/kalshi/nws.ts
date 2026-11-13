/**
 * Independent, public-domain NWS forecast input for NYC weather research.
 * NOT a Kalshi price feed, NOT an official final Central Park station observation,
 * NOT a probability model, and NOT a source of automatic trading decisions.
 * No scheduled use; must be called explicitly with a meaningful NWS User-Agent.
 */
import {createHash} from 'node:crypto';
export const NWS_CENTRAL_PARK_POINT='https://api.weather.gov/points/40.7829,-73.9654';
const NWS_HOST='api.weather.gov';
const HOURLY_PATH=/^\/gridpoints\/[A-Z]{2,4}\/\d{1,4},\d{1,4}\/forecast\/hourly$/;
const MAX_BODY=300_000;
const asObj=(v:unknown):Record<string,unknown>=>{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('NWS_INVALID_OBJECT');
 return v as Record<string,unknown>;
};
const asTime=(v:unknown):string=>{
 if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw Error('NWS_INVALID_TIME');
 return v;
};
function validateNwsUrl(url:string):string{
 let u:URL;try{u=new URL(url);}catch{throw Error('NWS_URL_INVALID');}
 if(u.protocol!=='https:'||u.hostname!==NWS_HOST||u.port||u.username||u.password||u.search||u.hash||
  !HOURLY_PATH.test(u.pathname))throw Error('NWS_URL_NOT_ALLOWED');
 return u.href;
}
async function get(url:string,userAgent:string,fetcher:typeof fetch){
 if(typeof userAgent!=='string'||userAgent.length<12||userAgent.length>180||/[\r\n]/.test(userAgent))
  throw Error('NWS_USER_AGENT_REQUIRED');
 const r=await fetcher(url,{method:'GET',headers:{'User-Agent':userAgent,Accept:'application/geo+json'},
  redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8_000)});
 if(r.status===429)throw Error('NWS_RATE_LIMITED');
 if(!r.ok)throw Error('NWS_HTTP_'+r.status);
 const len=Number(r.headers.get('content-length'));
 if(Number.isFinite(len)&&len>MAX_BODY)throw Error('NWS_RESPONSE_TOO_LARGE');
 if(!r.body)throw Error('NWS_EMPTY');
 const rd=r.body.getReader();let n=0;const parts:Uint8Array[]=[];
 try{while(true){const {done,value}=await rd.read();if(done)break;n+=value.length;
  if(n>MAX_BODY)throw Error('NWS_RESPONSE_TOO_LARGE');parts.push(value);}}finally{rd.releaseLock();}
 const bytes=new Uint8Array(n);let i=0;for(const c of parts){bytes.set(c,i);i+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('NWS_BAD_JSON');}
}
export type NWSHourlyResearch={
 source:'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION';
 forecastIssuedAt:string;fetchedAt:string;sourceDigest:string;
 gridForecastUrl:string;hourly:{startTime:string;endTime:string;temperatureF:number}[];
 /** NWS point-grid max is NOT a Kalshi contract probability or official resolution. */
};
export function normalizeNwsHourly(raw:unknown,url:string,fetchedAt:string):NWSHourlyResearch{
 const p=asObj(asObj(raw).properties);
 const issued=asTime(p.updateTime??p.updated??p.generatedAt);
 if(Date.parse(issued)>Date.parse(fetchedAt))throw Error('NWS_FUTURE_ISSUE');
 if(!Array.isArray(p.periods)||p.periods.length>200)throw Error('NWS_INVALID_PERIODS');
 const hourly=p.periods.slice(0,48).map((x)=>{
  const r=asObj(x),startTime=asTime(r.startTime),endTime=asTime(r.endTime),temp=r.temperature;
  if(Date.parse(startTime)>=Date.parse(endTime)||r.temperatureUnit!=='F'||
   typeof temp!=='number'||!Number.isFinite(temp)||temp< -100||temp>160)throw Error('NWS_INVALID_FORECAST');
  return {startTime,endTime,temperatureF:temp};
 });
 if(!hourly.length)throw Error('NWS_NO_FORECAST');
 return {source:'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION',forecastIssuedAt:issued,
  fetchedAt:asTime(fetchedAt),sourceDigest:createHash('sha256').update(JSON.stringify(hourly)).digest('hex'),
  gridForecastUrl:validateNwsUrl(url),hourly};
}
export async function readCentralParkHourlyNws(opts:{
 userAgent:string;fetcher?:typeof fetch;now?:()=>string
}):Promise<NWSHourlyResearch>{
 const fetcher=opts.fetcher??fetch,now=opts.now??(()=>new Date().toISOString());
 const point=asObj(asObj(await get(NWS_CENTRAL_PARK_POINT,opts.userAgent,fetcher)).properties);
 if(typeof point.forecastHourly!=='string')throw Error('NWS_MISSING_HOURLY_URL');
 const url=validateNwsUrl(point.forecastHourly);
 const forecast=await get(url,opts.userAgent,fetcher);
 return normalizeNwsHourly(forecast,url,now());
}
