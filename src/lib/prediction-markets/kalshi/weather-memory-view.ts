/**
 * Public NOAA-only research archive reader: read the data-only research-data
 * branch, never the Kalshi API, Supabase private ledger, broker or paid provider.
 * The path is generated from an internally computed valid station day.
 */
import {createHash} from 'node:crypto';
import {nextNewYorkDate,verifyIndependentWeatherMemory,type IndependentWeatherMemory} from './weather-memory.ts';
import type {IndependentWeatherGrade} from './nws-cli.ts';
const BASE='https://raw.githubusercontent.com/ang87505-crypto/SportsEdge/research-data/kalshi-independent/nyc-weather';
const SHA=/^[a-f0-9]{64}$/;
type ReadValue={kind:'missing'|'error'|'ok';value?:unknown};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function read(sect:'forecasts'|'independent-grades',day:string,fetcher:typeof fetch):Promise<ReadValue>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('NWS_MEMORY_INVALID_DATE');
 try{
  const r=await fetcher(BASE+'/'+sect+'/'+day+'.json',{method:'GET',redirect:'error',
   credentials:'omit',headers:{Accept:'application/json'},next:{revalidate:600},
   signal:AbortSignal.timeout(5_000)});
  if(r.status===404)return {kind:'missing'};
  if(!r.ok)return {kind:'error'};
  if(Number(r.headers.get('content-length'))>120000)return {kind:'error'};
  const body=await r.text();
  if(body.length>120000)return {kind:'error'};
  return {kind:'ok',value:JSON.parse(body) as unknown};
 }catch{return {kind:'error'};}
}
function verifiedGrade(v:unknown,f:IndependentWeatherMemory):IndependentWeatherGrade{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('NWS_GRADE_INVALID');
 const g=v as Record<string,unknown>,{id,...base}=g;
 if(typeof id!=='string'||!SHA.test(id)||digest(base)!==id||
  g.source!=='NWS_CLI_PRELIMINARY_NOT_KALSHI_SETTLEMENT'||
  g.forecastId!==f.id||g.date!==f.targetLocalDate||
  typeof g.observedHighF!=='number'||!Number.isInteger(g.observedHighF)||
  typeof g.absoluteErrorF!=='number'||g.absoluteErrorF!==Math.abs(g.observedHighF-f.forecastHighF)||
  typeof g.hitIndependentBand!=='boolean'||
  g.hitIndependentBand!==(g.observedHighF>=f.bandLowF&&g.observedHighF<=f.bandHighF)||
  (g.brier!==null&&typeof g.brier!=='number'))
  throw Error('NWS_GRADE_INVALID');
 return v as IndependentWeatherGrade;
}
export type LatestWeatherResearch=
 {state:'RECORDED';memory:IndependentWeatherMemory;grade:IndependentWeatherGrade|null}|
 {state:'AWAITING_FIRST_ARCHIVE'|'ARCHIVE_UNAVAILABLE';memory:null;grade:null};
export async function loadLatestIndependentWeather(nowIso:string=new Date().toISOString(),
 fetcher:typeof fetch=fetch):Promise<LatestWeatherResearch>{
 const next=nextNewYorkDate(nowIso);
 const today=new Date(Date.parse(next+'T00:00:00Z')-86_400_000).toISOString().slice(0,10);
 let unavailable=false;
 for(const date of [next,today]){
  const result=await read('forecasts',date,fetcher);
  if(result.kind==='error'){unavailable=true;continue;}
  if(result.kind!=='ok')continue;
  try{
   const memory=verifyIndependentWeatherMemory(result.value);
   if(memory.targetLocalDate!==date)throw Error('NWS_ARCHIVE_DATE_MISMATCH');
   const g=await read('independent-grades',date,fetcher);
   let grade:null|IndependentWeatherGrade=null;
   if(g.kind==='ok')grade=verifiedGrade(g.value,memory);
   if(g.kind==='error')unavailable=true;
   // A corrupt grade must NEVER be rendered as a confirmed weather outcome.
   return {state:'RECORDED',memory,grade};
  }catch{unavailable=true;}
 }
 return {state:unavailable?'ARCHIVE_UNAVAILABLE':'AWAITING_FIRST_ARCHIVE',memory:null,grade:null};
}
