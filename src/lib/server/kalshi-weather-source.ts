/** Read only the owner's pinned NOAA archive; retain original JSON record order/digests. */
import {verifyIndependentWeatherMemory,type IndependentWeatherMemory,nextNewYorkDate} from '../prediction-markets/kalshi/weather-memory.ts';
import {verifyCentralParkCli,independentTrainingDay,type CentralParkCliDaily} from '../prediction-markets/kalshi/nws-cli.ts';
import type {KalshiPlatformStore} from './kalshi-platform-store.ts';
const REPO='ang87505-crypto/SportsEdge';
const PREFIX='kalshi-independent/nyc-weather/';
type Evidence={kind:'forecast'|'outcome';climate_date:string;document:string;archive_ref:string;blob_sha:string};
async function get(url:string,fetcher:typeof fetch){
 const r=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
  headers:{Accept:'application/json'},signal:AbortSignal.timeout(7000)});
 if(!r.ok||!r.body)throw Error('KALSHI_ARCHIVE_HTTP_'+r.status);
 const reader=r.body.getReader(),decoder=new TextDecoder();let bytes=0,s='';
 for(;;){const q=await reader.read();if(q.done)break;bytes+=q.value.byteLength;
  if(bytes>2_000_000){await reader.cancel();throw Error('KALSHI_ARCHIVE_TOO_LARGE');}s+=decoder.decode(q.value,{stream:true});}
 return JSON.parse(s+decoder.decode()) as unknown;
}
export async function loadKalshiWeatherSources(store:KalshiPlatformStore,asOf:string,fetcher:typeof fetch=fetch){
 const deadline=Date.now()+25000;
 const cached=await store.select<Evidence>('kalshi_weather_evidence','select=*&order=climate_date.asc&limit=2001');
 if(cached.length>2000)throw Error('KALSHI_ARCHIVE_TOO_LARGE');
 const data=await get('https://api.github.com/repos/'+REPO+'/git/ref/heads/research-data',fetcher) as {object?:{sha?:string}};
 const ref=data.object?.sha;if(!ref||!/^[a-f0-9]{40}$/.test(ref))throw Error('KALSHI_ARCHIVE_BAD_REF');
 const known=new Map(cached.map(x=>[x.kind+':'+x.climate_date,x]));
 const rows=[...cached],missing:{kind:Evidence['kind'];date:string;sha:string;folder:string}[]=[];
 for(const [kind,folder] of [['forecast','forecasts'],['outcome','cli-daily-preliminary']] as const){
  const listing=await get('https://api.github.com/repos/'+REPO+'/contents/'+PREFIX+folder+'?ref='+ref,fetcher);
  if(!Array.isArray(listing)||listing.length>1000)throw Error('KALSHI_ARCHIVE_BAD_INDEX');
  for(const item of listing){
   if(!item||typeof item.name!=='string'||!/^\d{4}-\d{2}-\d{2}\.json$/.test(item.name)||item.type!=='file')continue;
   const date=item.name.slice(0,10);if(date>nextNewYorkDate(asOf))continue;
   if(typeof item.sha!=='string'||!/^[a-f0-9]{40}$/.test(item.sha))throw Error('KALSHI_ARCHIVE_BAD_INDEX');
   const prior=known.get(kind+':'+date);
   if(prior&&prior.blob_sha!==item.sha)throw Error('KALSHI_ARCHIVE_CHANGED');
   if(!prior)missing.push({kind,date,sha:item.sha,folder});
  }
 }
 // Bound catch-up work. A partial catch-up is explicit and cannot produce a model forecast.
 let imported=0;
 for(const item of missing.slice(0,20)){
  if(Date.now()>deadline)break;
  const v=await get('https://raw.githubusercontent.com/'+REPO+'/'+ref+'/'+PREFIX+item.folder+'/'+item.date+'.json',fetcher);
  const value=item.kind==='forecast'?verifyIndependentWeatherMemory(v):verifyCentralParkCli(v);
  const date='targetLocalDate' in value?value.targetLocalDate:value.reportDate;
  const available='capturedAt' in value?value.capturedAt:value.fetchedAt;
  if(date!==item.date||Date.parse(available)>Date.parse(asOf))throw Error('KALSHI_ARCHIVE_DATE_OR_TIME');
  const row:Evidence={kind:item.kind,climate_date:date,archive_ref:ref,blob_sha:item.sha,document:JSON.stringify(value)};
  await store.insert('kalshi_weather_evidence',[row]);rows.push(row);imported++;
 }
 const forecasts:IndependentWeatherMemory[]=[],outcomes:CentralParkCliDaily[]=[];
 for(const row of rows){
  const v=JSON.parse(row.document);
  if(row.kind==='forecast'){const m=verifyIndependentWeatherMemory(v);
   if(m.targetLocalDate!==row.climate_date||Date.parse(m.capturedAt)>Date.parse(asOf))throw Error('KALSHI_ARCHIVE_DATE_OR_TIME');forecasts.push(m);
  }else{const c=verifyCentralParkCli(v);
   if(c.reportDate!==row.climate_date||Date.parse(c.fetchedAt)>Date.parse(asOf))throw Error('KALSHI_ARCHIVE_DATE_OR_TIME');outcomes.push(c);}
 }
 const byDate=new Map(outcomes.map(x=>[x.reportDate,x]));
 const training=forecasts.filter(f=>byDate.has(f.targetLocalDate)).map(f=>independentTrainingDay(f,byDate.get(f.targetLocalDate)!));
 return {archiveRef:ref,forecasts,outcomes,training,imported,complete:missing.length===imported};
}
