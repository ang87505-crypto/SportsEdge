/**
 * Independent government economics input: US CPI-U All Items (CUUR0000SA0).
 * BLS API v1 single-series public GET (no API key). Zero Kalshi data used.
 * These are current *revised* time-series readings, NOT historical real-time
 * announcement vintages; do not use them to "backtest" event-time CPI forecasts.
 * https://www.bls.gov/developers/api_signature.htm
 */
import {createHash} from 'node:crypto';
export const CPI_SERIES_ID='CUUR0000SA0' as const;
export const BLS_CPI_URL='https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0';
export type CpiReading={
 month:string;indexValue:number;flaggedForReview:boolean;
};
export type CpiSnapshot={
 source:'BLS_PUBLIC_DATA_V1';seriesId:typeof CPI_SERIES_ID;
 fetchedAt:string;responseDigest:string;vintage:'LATEST_AVAILABLE_NOT_HISTORICAL_PIT';
 readings:CpiReading[];
};
const record=(x:unknown):Record<string,unknown>=>{
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('BLS_INVALID_RESPONSE');
 return x as Record<string,unknown>;
};
export function normalizeCpi(x:unknown,fetchedAt:string):CpiSnapshot{
 const d=record(x),results=record(d.Results);
 if(d.status!=='REQUEST_SUCCEEDED'||!Array.isArray(results.series)||results.series.length!==1)
  throw Error('BLS_UNSUCCESSFUL_OR_AMBIGUOUS');
 const series=record(results.series[0]);
 if(series.seriesID!==CPI_SERIES_ID||!Array.isArray(series.data)||series.data.length>45)
  throw Error('BLS_WRONG_SERIES');
 if(!Number.isFinite(Date.parse(fetchedAt)))throw Error('BLS_INVALID_FETCH_TIME');
 const seen=new Set<string>(),readings:CpiReading[]=[];
 for(const raw of series.data){
  const v=record(raw);
  if(typeof v.year!=='string'||!/^(19|20)\d{2}$/.test(v.year)||
   typeof v.period!=='string')throw Error('BLS_INVALID_PERIOD');
  if(v.period==='M13')continue; // BLS optional annual-average row.
  if(!/^M(0[1-9]|1[0-2])$/.test(v.period))throw Error('BLS_INVALID_PERIOD');
  const month=v.year+'-'+v.period.slice(1);
  if(seen.has(month))throw Error('BLS_DUPLICATE_MONTH');
  seen.add(month);
  if(typeof v.value!=='string'||!/^\d{1,4}(?:\.\d{1,4})?$/.test(v.value))
   throw Error('BLS_INVALID_VALUE');
  const indexValue=Number(v.value);
  if(!Number.isFinite(indexValue)||indexValue<=0)throw Error('BLS_INVALID_VALUE');
  const footnotes=v.footnotes===undefined?[]:v.footnotes;
  if(!Array.isArray(footnotes)||footnotes.length>8)throw Error('BLS_INVALID_FOOTNOTES');
  const flaggedForReview=footnotes.some(f=>{
   if(f===null)return false;
   const item=record(f);
   return Boolean(item.code);
  });
  readings.push({month,indexValue,flaggedForReview});
 }
 if(!readings.length)throw Error('BLS_NO_MONTHLY_DATA');
 readings.sort((a,b)=>a.month.localeCompare(b.month));
 return {
  source:'BLS_PUBLIC_DATA_V1',seriesId:CPI_SERIES_ID,fetchedAt,
  responseDigest:createHash('sha256').update(JSON.stringify(d)).digest('hex'),
  vintage:'LATEST_AVAILABLE_NOT_HISTORICAL_PIT',readings
 };
}
export async function fetchCpiSnapshot(fetcher:typeof fetch=fetch,now:()=>string=()=>new Date().toISOString()):Promise<CpiSnapshot>{
 const r=await fetcher(BLS_CPI_URL,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
  headers:{Accept:'application/json'},signal:AbortSignal.timeout(8_000)});
 if(r.status===429)throw Error('BLS_RATE_LIMITED');
 if(!r.ok)throw Error('BLS_HTTP_'+r.status);
 if(!(r.headers.get('content-type')??'').includes('json'))throw Error('BLS_NOT_JSON');
 if(Number(r.headers.get('content-length'))>120_000)throw Error('BLS_RESPONSE_TOO_LARGE');
 if(!r.body)throw Error('BLS_EMPTY_RESPONSE');
 const reader=r.body.getReader();const chunks:Uint8Array[]=[];let length=0;
 try{while(true){
  const {done,value}=await reader.read();if(done)break;
  length+=value.byteLength;
  if(length>120_000)throw Error('BLS_RESPONSE_TOO_LARGE');
  chunks.push(value);
 }}finally{reader.releaseLock();}
 const all=new Uint8Array(length);let offset=0;
 for(const v of chunks){all.set(v,offset);offset+=v.byteLength;}
 let decoded:unknown;
 try{decoded=JSON.parse(new TextDecoder().decode(all));}catch{throw Error('BLS_INVALID_JSON');}
 return normalizeCpi(decoded,now());
}
