/** Read-only daily NOAA archive checks. No collector, provider, database, account or dispatch capability. */
import {isDeepStrictEqual} from 'node:util';
import {nextNewYorkDate,verifyIndependentWeatherMemory} from '../src/lib/prediction-markets/kalshi/weather-memory.ts';
import {verifyCentralParkCli,gradeIndependentWeather} from '../src/lib/prediction-markets/kalshi/nws-cli.ts';
import {verifyIndependentWeatherScorecard} from '../src/lib/prediction-markets/kalshi/weather-scorecard.ts';

const BASE='https://raw.githubusercontent.com/ang87505-crypto/SportsEdge/research-data/kalshi-independent/nyc-weather';
const DAY=86_400_000,MAX_BYTES=120_000;
// Existing 11:17 UTC outcome backup + its existing 180-minute operations grace.
// A reporting deadline only: no scientific horizon, collector cron or release gate changes.
export const OUTCOME_DEADLINE_UTC_MINUTES=14*60+17;
const shift=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
const stationDate=at=>shift(nextNewYorkDate(new Date(at).toISOString()),-1);
function expected(at){
 const today=stationDate(at),deadline=Date.parse(today+'T00:00:00Z')+OUTCOME_DEADLINE_UTC_MINUTES*60_000;
 return {today,next:shift(today,1),outcome:shift(today,at>=deadline?-1:-2)};
}

async function read(url,fetcher){
 try{
  const r=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
   headers:{Accept:'application/json'},signal:AbortSignal.timeout(7000)});
  if(r.status===404)return {kind:'missing'};
  if(!r.ok||!r.body||Number(r.headers.get('content-length'))>MAX_BYTES)return {kind:'error'};
  const stream=r.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await stream.read();if(done)break;
   size+=value.byteLength;if(size>MAX_BYTES){await stream.cancel();return {kind:'error'};}chunks.push(value);
  }}finally{stream.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {kind:'ok',value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
 }catch{return {kind:'error'};}
}

/** Six bounded GETs of existing public files; no retries, archive writes or NOAA/exchange requests. */
export async function readNoaaMemory({fetcher=fetch,now=Date.now}={}){
 const start=now();if(!Number.isFinite(start))throw Error('NOAA_MONITOR_INVALID_CLOCK');
 const dates=expected(start);
 const paths=[['forecasts',dates.today],['forecasts',dates.next],['forecasts',dates.outcome],
  ['cli-daily-preliminary',dates.outcome],['independent-grades',dates.outcome],['scorecards',dates.outcome]];
 const rows=await Promise.all(paths.map(([section,date])=>read(BASE+'/'+section+'/'+date+'.json',fetcher)));
 const finished=now(),issues=[];
 if(!Number.isFinite(finished))throw Error('NOAA_MONITOR_INVALID_CLOCK');
 const result={schemaVersion:'noaa-daily-memory-health-v1',checkedAt:new Date(finished).toISOString(),
  state:'OK',issues,requiredForecastDate:dates.today,requiredOutcomeDate:dates.outcome,
  forecast:null,nextForecast:null,outcome:null,scorecard:null};
 if(finished<start||!isDeepStrictEqual(expected(finished),dates)){
  result.state='UNAVAILABLE';issues.push('MONITOR_CLOCK_BOUNDARY');return result;
 }
 const readValue=(i,code,optional=false)=>{
  if(rows[i].kind==='missing'&&optional)return null;
  if(rows[i].kind!=='ok'){issues.push(code+(rows[i].kind==='missing'?'_MISSING':'_UNAVAILABLE'));return null;}
  if(rows[i].value===null){issues.push(code+'_INVALID');return null;}
  return rows[i].value;
 };
 function forecast(i,date,code,optional=false){
  const raw=readValue(i,code,optional);if(raw===null)return null;
  try{
   const f=verifyIndependentWeatherMemory(raw);
   if(f.targetLocalDate!==date||Date.parse(f.capturedAt)>finished||Date.parse(f.capturedAt)>=Date.parse(date+'T05:00:00Z'))throw Error('binding');
   return f;
  }catch{issues.push(code+'_INVALID');return null;}
 }
 const current=forecast(0,dates.today,'CURRENT_FORECAST');
 const next=forecast(1,dates.next,'NEXT_FORECAST',true);
 const frozen=forecast(2,dates.outcome,'OUTCOME_FORECAST');
 const brief=f=>f?{date:f.targetLocalDate,capturedAt:f.capturedAt,id:f.id,
  hoursBeforeDay:Number(((Date.parse(f.targetLocalDate+'T05:00:00Z')-Date.parse(f.capturedAt))/3600_000).toFixed(3))}:null;
 result.forecast=brief(current);result.nextForecast=brief(next);
 const rawCli=readValue(3,'OUTCOME'),rawGrade=readValue(4,'GRADE'),rawScore=readValue(5,'SCORECARD');
 let cli=null;
 if(rawCli!==null)try{
  cli=verifyCentralParkCli(rawCli);
  if(cli.reportDate!==dates.outcome||Date.parse(cli.fetchedAt)>finished)throw Error('binding');
 }catch{issues.push('OUTCOME_INVALID');cli=null;}
 if(frozen&&cli&&rawGrade!==null)try{
  const grade=gradeIndependentWeather(frozen,cli);
  if(!isDeepStrictEqual(grade,rawGrade))throw Error('binding');
  result.outcome={date:cli.reportDate,fetchedAt:cli.fetchedAt,issuedAt:cli.issuedAt,id:cli.id,gradeId:grade.id};
 }catch{issues.push('GRADE_INVALID');}
 if(rawScore!==null)try{
  const s=verifyIndependentWeatherScorecard(rawScore);
  if(s.lastDate!==dates.outcome||s.dates.at(-1)!==dates.outcome||s.firstDate!==s.dates[0]||
   s.dates.some((d,i)=>d>dates.outcome||(i&&d<=s.dates[i-1])))throw Error('binding');
  result.scorecard={throughDate:s.lastDate,days:s.evaluatedDays,id:s.id};
 }catch{issues.push('SCORECARD_INVALID');}
 result.state=issues.some(x=>x.endsWith('UNAVAILABLE'))?'UNAVAILABLE':issues.length?'ATTENTION':'OK';
 return result;
}

/** Keep the execution history and missed slots. Verified daily work does not make a missed backup an absent day. */
export function applyNoaaMemory(job,evidence){
 const result={...job,workflowStatus:job.status,dailyEvidence:evidence};
 if(['FAILING','DISABLED','STALE','EXPIRED','RETIRED','UNKNOWN'].includes(job.status))return result;
 if(evidence?.state!=='OK')return {...result,status:'FAILING',
  detail:'Daily NOAA archive check failed: '+(evidence?.issues?.join(', ')||'EVIDENCE_UNAVAILABLE')+'. Workflow success is insufficient.'};
 const detail=`Verified forecast ${evidence.requiredForecastDate} and graded outcome ${evidence.requiredOutcomeDate}.`;
 if(job.status==='MISSED_SLOT')return {...result,status:'RAN_LATE',
  detail:detail+' Daily evidence is complete; planned firings remain late/missed. See original slot counts and capture timestamps.'};
 return {...result,detail:(detail+' '+job.detail).slice(0,400)};
}
