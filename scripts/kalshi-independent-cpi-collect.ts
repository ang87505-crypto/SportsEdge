/**
 * Independent BLS CPI-U All Items observations, archived exactly once per UTC
 * collection day. Unlike exchange prices, these are free public BLS readings.
 *
 * IMPORTANT: BLS v1 GET returns the currently published/revised series.
 * An archived response is "what we saw NOW", NEVER a historical pre-release
 * forecast, an official past announcement-time vintage, or Kalshi settlement.
 *
 * node --experimental-strip-types scripts/kalshi-independent-cpi-collect.ts research-data
 */
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
 fetchCpiSnapshot,CPI_SERIES_ID,BLS_CPI_URL,
 type CpiSnapshot
} from '../src/lib/prediction-markets/kalshi/bls-cpi.ts';

const SHA=/^[0-9a-f]{64}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const MAX_ARCHIVE=180_000;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clock=(s:string)=>{
 if(typeof s!=='string'||!s.endsWith('Z')||!Number.isFinite(Date.parse(s)))throw Error('CPI_ARCHIVE_BAD_CLOCK');
 return new Date(Date.parse(s)).toISOString();
};
export type CpiPublicMemory={
 id:string;schemaVersion:'sportsedge-public-bls-cpi-memory-v1';
 source:'BLS_PUBLIC_V1_NO_KEY';
 seriesId:typeof CPI_SERIES_ID;sourceUrl:typeof BLS_CPI_URL;
 observationDate:string;fetchedAt:string;sourceResponseDigest:string;
 status:'POST_PUBLICATION_SERIES_AS_SEEN_NOT_EVENT_TIME_VINTAGE';
 firstMonth:string;lastMonth:string;readingCount:number;
 readings:CpiSnapshot['readings'];
 warning:string;
};
export const cpiArchivePath=(root:string,date:string)=>{
 if(typeof root!=='string'||!root.trim()||root.length>300||
  typeof date!=='string'||!DAY.test(date))throw Error('CPI_ARCHIVE_BAD_PATH');
 return join(root,'kalshi-independent','bls-cpi','observations',date+'.json');
};
function createMemory(snapshot:CpiSnapshot):CpiPublicMemory{
 const at=clock(snapshot.fetchedAt),day=at.slice(0,10);
 if(snapshot.seriesId!==CPI_SERIES_ID||snapshot.source!=='BLS_PUBLIC_DATA_V1'||
  snapshot.vintage!=='LATEST_AVAILABLE_NOT_HISTORICAL_PIT'||
  !SHA.test(snapshot.responseDigest)||snapshot.readings.length<1||
  snapshot.readings.some((r,i,a)=>r.month!==a[0].month&&i>0&&r.month<=a[i-1].month))
  throw Error('CPI_ARCHIVE_BAD_SOURCE');
 const base:Omit<CpiPublicMemory,'id'>={
  schemaVersion:'sportsedge-public-bls-cpi-memory-v1',source:'BLS_PUBLIC_V1_NO_KEY',
  seriesId:CPI_SERIES_ID,sourceUrl:BLS_CPI_URL,observationDate:day,
  fetchedAt:at,sourceResponseDigest:snapshot.responseDigest,
  status:'POST_PUBLICATION_SERIES_AS_SEEN_NOT_EVENT_TIME_VINTAGE',
  firstMonth:snapshot.readings[0].month,
  lastMonth:snapshot.readings.at(-1)!.month,
  readingCount:snapshot.readings.length,readings:snapshot.readings,
  warning:'BLS monthly CPI-U index values published by this collection time (may include revisions). NOT a pre-announcement forecast, an announcement-time historical vintage, a Kalshi contract result, or a trade. Missing days cannot be backfilled as past observations.'
 };
 return {id:hash(base),...base};
}
export function verifyCpiPublicMemory(raw:unknown):CpiPublicMemory{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('CPI_ARCHIVE_INVALID_MEMORY');
 const r=raw as Record<string,unknown>,{id,...base}=r;
 if(typeof id!=='string'||!SHA.test(id)||hash(base)!==id||
  r.schemaVersion!=='sportsedge-public-bls-cpi-memory-v1'||
  r.source!=='BLS_PUBLIC_V1_NO_KEY'||r.seriesId!==CPI_SERIES_ID||
  r.sourceUrl!==BLS_CPI_URL||r.status!=='POST_PUBLICATION_SERIES_AS_SEEN_NOT_EVENT_TIME_VINTAGE'||
  typeof r.fetchedAt!=='string'||typeof r.observationDate!=='string'||
  clock(r.fetchedAt).slice(0,10)!==r.observationDate||
  typeof r.sourceResponseDigest!=='string'||!SHA.test(r.sourceResponseDigest)||
  !Array.isArray(r.readings)||r.readingCount!==r.readings.length||
  r.readingCount<1||r.readingCount>45||
  r.firstMonth!==(r.readings[0] as Record<string,unknown>)?.month||
  r.lastMonth!==(r.readings.at(-1) as Record<string,unknown>)?.month||
  r.readings.some((v,i,a)=>{
   if(!v||typeof v!=='object'||Array.isArray(v))return true;
   const x=v as Record<string,unknown>;
   return typeof x.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(x.month)||
    typeof x.indexValue!=='number'||!Number.isFinite(x.indexValue)||x.indexValue<=0||
    typeof x.flaggedForReview!=='boolean'||(i>0&&x.month<=a[i-1].month);
  }))
  throw Error('CPI_ARCHIVE_INVALID_MEMORY');
 return raw as CpiPublicMemory;
}
export type CpiCollectReceipt={status:'ARCHIVED'|'ALREADY_ARCHIVED';date:string;
 path:string;providerCalls:0|1;monthsStored:number;latestPublishedMonth:string};
export async function collectIndependentCpi(opts:{
 root:string;fetcher?:typeof fetch;now?:()=>string
}):Promise<CpiCollectReceipt>{
 const at=clock((opts.now??(()=>new Date().toISOString()))());
 const date=at.slice(0,10),path=cpiArchivePath(opts.root,date);
 if(existsSync(path)){
  const oldText=readFileSync(path,'utf8');
  if(Buffer.byteLength(oldText)>MAX_ARCHIVE)throw Error('CPI_ARCHIVE_TOO_LARGE');
  const prior=verifyCpiPublicMemory(JSON.parse(oldText));
  return {status:'ALREADY_ARCHIVED',date,path,providerCalls:0,
   monthsStored:prior.readingCount,latestPublishedMonth:prior.lastMonth};
 }
 // A single public BLS v1 GET. No Kalshi, sportsbook or paid provider request.
 const snapshot=await fetchCpiSnapshot(opts.fetcher??fetch,()=>at);
 const row=createMemory(snapshot);
 mkdirSync(dirname(path),{recursive:true});
 writeFileSync(path,JSON.stringify(row,null,2)+'\n',{encoding:'utf8',flag:'wx'});
 return {status:'ARCHIVED',date,path,providerCalls:1,
  monthsStored:row.readingCount,latestPublishedMonth:row.lastMonth};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const root=process.argv[2];
 if(!root){console.error('Usage: node --experimental-strip-types scripts/kalshi-independent-cpi-collect.ts research-data');process.exitCode=2;}
 else collectIndependentCpi({root}).then(r=>console.log(JSON.stringify(r))).catch(e=>{
  console.error(e instanceof Error?e.message:'CPI_ARCHIVE_FAILED');process.exitCode=1;
 });
}
