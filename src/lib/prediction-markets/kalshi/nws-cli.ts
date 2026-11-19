/**
 * NWS Central Park (CLINYC) next-morning DAILY climate report reader.
 * Direct fixed official NOAA source; independent of Kalshi, free and read-only.
 * A NWS daily report is preliminary until NCEI quality control. It is NOT
 * proof of a Kalshi contract settlement or NCEI-certified high.
 * https://www.weather.gov/okx/CentralParkHistorical
 */
import {createHash} from 'node:crypto';
import type {WeatherTrainingDay} from './weather-model.ts';
import type {IndependentWeatherMemory} from './weather-memory.ts';
export const NYC_CLI_SOURCE='https://tgftp.nws.noaa.gov/data/raw/cd/cdus41.kokx.cli.nyc.txt';
const MAX_BYTES=20_000;
const MONTHS=['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST',
 'SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'] as const;
const SHA=/^[a-f0-9]{64}$/;
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const day=(year:number,month:string,num:number)=>{
 const mon=MONTHS.indexOf(month.toUpperCase() as typeof MONTHS[number]);
 if(mon<0||year<1950||year>2100||num<1||num>31)throw Error('NWS_CLI_INVALID_DATE');
 const x=new Date(Date.UTC(year,mon,num)).toISOString().slice(0,10);
 if(x!==String(year)+'-'+String(mon+1).padStart(2,'0')+'-'+String(num).padStart(2,'0'))
  throw Error('NWS_CLI_INVALID_DATE');
 return x;
};
export type CentralParkCliDaily={
 schemaVersion:'nws-central-park-cli-preliminary-v1';
 id:string;source:'NWS_CLINYC_NEXT_MORNING_PRELIMINARY';
 station:'KNYC_CENTRAL_PARK';reportDate:string;issuedAt:string;fetchedAt:string;
 observedHighF:number;sourceDigest:string;sourceUrl:typeof NYC_CLI_SOURCE;
 dayDefinition:'LOCAL_STANDARD_TIME_UTC_MINUS_5';
 status:'PRELIMINARY_NWS_DAILY_NOT_NCEI_CERTIFIED_NOT_KALSHI_SETTLEMENT';
 /** Original raw product from NOAA, retained to audit revisions/ambiguities. */
 rawProductText:string;
};
export function parseCentralParkCli(text:string,fetchedAt:string):CentralParkCliDaily{
 if(typeof text!=='string'||text.length<150||text.length>MAX_BYTES||
  /[^\x09\x0A\x0D\x20-\x7E]/.test(text))throw Error('NWS_CLI_INVALID_TEXT');
 const raw=text.replace(/\r\n/g,'\n');
 if(!/\bCDUS41 KOKX \d{6}\b/.test(raw)||!/^CLINYC\s*$/m.test(raw)||
  !/CLIMATE REPORT\s*\n\s*NATIONAL WEATHER SERVICE NEW YORK, NY/i.test(raw))
  throw Error('NWS_CLI_WRONG_PRODUCT');
 const dateMatches=[...raw.matchAll(/THE CENTRAL PARK NY CLIMATE SUMMARY FOR (JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{1,2})\s+(\d{4})/g)];
 if(dateMatches.length!==1)throw Error('NWS_CLI_WRONG_STATION_OR_DATE');
 const [d]=dateMatches,reportDate=day(Number(d[3]),d[1],Number(d[2]));
 // Evening/intermediate reports must never be mistaken for a complete daily label.
 if(/VALID\s+(?:TODAY\s+)?AS\s+OF/i.test(raw))throw Error('NWS_CLI_INTERIM_NOT_COMPLETE');
 const issuer=raw.match(/^\s*(\d{3,4})\s+(AM|PM)\s+(EST|EDT)\s+\w{3}\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{1,2})\s+(\d{4})\s*$/m);
 if(!issuer)throw Error('NWS_CLI_MISSING_ISSUANCE');
 const clock=issuer[1].padStart(4,'0'),hh=Number(clock.slice(0,2)),mm=Number(clock.slice(2));
 if(hh<1||hh>12||mm>59)throw Error('NWS_CLI_INVALID_ISSUANCE');
 const issDate=day(Number(issuer[6]),MONTHS[(['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']).indexOf(issuer[4])],Number(issuer[5]));
 if(issDate!==new Date(Date.parse(reportDate+'T00:00:00Z')+86_400_000).toISOString().slice(0,10))
  throw Error('NWS_CLI_NOT_NEXT_MORNING_REPORT');
 const mon=Number(issDate.slice(5,7))-1,dy=Number(issDate.slice(8,10)),yr=Number(issDate.slice(0,4));
 const utcH=(hh%12)+(issuer[2]==='PM'?12:0)+(issuer[3]==='EST'?5:4);
 const issuedAt=new Date(Date.UTC(yr,mon,dy,utcH,mm)).toISOString();
 const fetched=Date.parse(fetchedAt);
 if(!Number.isFinite(fetched)||fetched<Date.parse(issuedAt)||fetched-Date.parse(issuedAt)>36*3600_000)
  throw Error('NWS_CLI_BAD_AVAILABILITY');
 const temp=/TEMPERATURE\s*\(F\)\s*\n\s*TODAY\s*\n\s*MAXIMUM\s+(-?\d{1,3}|MM)(?:\s|$)/i.exec(raw);
 if(!temp||temp[1]==='MM')throw Error('NWS_CLI_MISSING_HIGH');
 const observedHighF=Number(temp[1]);
 if(!Number.isSafeInteger(observedHighF)||observedHighF< -100||observedHighF>150)
  throw Error('NWS_CLI_INVALID_HIGH');
 const base:Omit<CentralParkCliDaily,'id'>={
  schemaVersion:'nws-central-park-cli-preliminary-v1',source:'NWS_CLINYC_NEXT_MORNING_PRELIMINARY',
  station:'KNYC_CENTRAL_PARK',reportDate,issuedAt,fetchedAt,observedHighF,
  sourceDigest:createHash('sha256').update(raw).digest('hex'),sourceUrl:NYC_CLI_SOURCE,
  dayDefinition:'LOCAL_STANDARD_TIME_UTC_MINUS_5',
  status:'PRELIMINARY_NWS_DAILY_NOT_NCEI_CERTIFIED_NOT_KALSHI_SETTLEMENT',rawProductText:raw};
 return {id:digest(base),...base};
}
export async function readCentralParkCli(opts:{
 userAgent:string;fetcher?:typeof fetch;now?:()=>string
}):Promise<CentralParkCliDaily>{
 const fetcher=opts.fetcher??fetch;
 if(typeof opts.userAgent!=='string'||opts.userAgent.length<12||opts.userAgent.length>180||
  /[\r\n]/.test(opts.userAgent))throw Error('NWS_CLI_USER_AGENT_REQUIRED');
 const r=await fetcher(NYC_CLI_SOURCE,{method:'GET',redirect:'error',credentials:'omit',
  cache:'no-store',headers:{'User-Agent':opts.userAgent,Accept:'text/plain'},
  signal:AbortSignal.timeout(8_000)});
 if(r.status===429)throw Error('NWS_CLI_RATE_LIMITED');
 if(!r.ok)throw Error('NWS_CLI_HTTP_'+r.status);
 if(Number(r.headers.get('content-length'))>MAX_BYTES)throw Error('NWS_CLI_TOO_LARGE');
 if(!r.body)throw Error('NWS_CLI_EMPTY');
 const reader=r.body.getReader();const chunks:Uint8Array[]=[];let n=0;
 try{while(true){
  const {done,value}=await reader.read();if(done)break;
  n+=value.length;if(n>MAX_BYTES)throw Error('NWS_CLI_TOO_LARGE');
  chunks.push(value);
 }}finally{reader.releaseLock();}
 const bytes=new Uint8Array(n);let offset=0;
 for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
 return parseCentralParkCli(new TextDecoder().decode(bytes),(opts.now??(()=>new Date().toISOString()))());
}
export function verifyCentralParkCli(raw:unknown):CentralParkCliDaily{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('NWS_CLI_INVALID_MEMORY');
 const {id,...base}=raw as Record<string,unknown>;
 if(typeof id!=='string'||!SHA.test(id)||digest(base)!==id||
  base.schemaVersion!=='nws-central-park-cli-preliminary-v1'||
  base.source!=='NWS_CLINYC_NEXT_MORNING_PRELIMINARY'||base.station!=='KNYC_CENTRAL_PARK'||
  base.status!=='PRELIMINARY_NWS_DAILY_NOT_NCEI_CERTIFIED_NOT_KALSHI_SETTLEMENT'||
  base.sourceUrl!==NYC_CLI_SOURCE||
  base.dayDefinition!=='LOCAL_STANDARD_TIME_UTC_MINUS_5'||
  typeof base.rawProductText!=='string'||
  createHash('sha256').update(base.rawProductText).digest('hex')!==base.sourceDigest)
  throw Error('NWS_CLI_INVALID_MEMORY');
 return raw as CentralParkCliDaily;
}
/** Independent model training only. This does NOT certify market settlement. */
export function independentTrainingDay(f:IndependentWeatherMemory,o:CentralParkCliDaily):WeatherTrainingDay{
 if(f.targetLocalDate!==o.reportDate||f.dayDefinition!=='CENTRAL_PARK_LOCAL_STANDARD_TIME_UTC_MINUS_5'||
  o.dayDefinition!=='LOCAL_STANDARD_TIME_UTC_MINUS_5'||
  Date.parse(f.capturedAt)>=Date.parse(o.issuedAt)||Date.parse(o.fetchedAt)<Date.parse(o.issuedAt))
  throw Error('NWS_CLI_FORECAST_OUTCOME_MISMATCH');
 return {localDate:o.reportDate,forecastHighF:f.forecastHighF,observedHighF:o.observedHighF,
  forecastAvailableAt:f.capturedAt,observedAvailableAt:o.fetchedAt,
  forecastSource:'NWS',observationSource:'NWS_CLI_PRELIMINARY_CENTRAL_PARK'};
}
export type IndependentWeatherGrade={
 id:string;forecastId:string;cliId:string;date:string;
 observedHighF:number;forecastHighF:number;absoluteErrorF:number;hitIndependentBand:boolean;
 forecastBandProbabilityPpm:number|null;brier:number|null;
 source:'NWS_CLI_PRELIMINARY_NOT_KALSHI_SETTLEMENT';
};
export function gradeIndependentWeather(f:IndependentWeatherMemory,o:CentralParkCliDaily):IndependentWeatherGrade{
 independentTrainingDay(f,o);
 const yes=o.observedHighF>=f.bandLowF&&o.observedHighF<=f.bandHighF;
 const probability=f.estimatedBandProbabilityPpm;
 const brier=probability===null?null:Math.pow(probability/1e6-(yes?1:0),2);
 const base:Omit<IndependentWeatherGrade,'id'>={
  forecastId:f.id,cliId:o.id,date:o.reportDate,
  observedHighF:o.observedHighF,forecastHighF:f.forecastHighF,
  absoluteErrorF:Math.abs(o.observedHighF-f.forecastHighF),
  hitIndependentBand:yes,forecastBandProbabilityPpm:probability,brier,
  source:'NWS_CLI_PRELIMINARY_NOT_KALSHI_SETTLEMENT'};
 return {id:digest(base),...base};
}
