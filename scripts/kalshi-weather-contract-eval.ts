/**
 * Reproducible, offline evaluation of the archived NOAA weather evidence for Kalshi-style
 * whole-degree contracts. Reads ONLY an existing research-data checkout; makes ZERO network
 * requests (no NWS, no Kalshi) and writes nothing unless --out is given.
 *
 * node --experimental-strip-types scripts/kalshi-weather-contract-eval.ts <research-data-dir> \
 *   --as-of 2026-11-20T19:00:00Z --archive-ref <research-data commit> [--out report.json]
 */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyIndependentWeatherMemory,type IndependentWeatherMemory} from '../src/lib/prediction-markets/kalshi/weather-memory.ts';
import {verifyCentralParkCli,independentTrainingDay} from '../src/lib/prediction-markets/kalshi/nws-cli.ts';
import type {WeatherTrainingDay} from '../src/lib/prediction-markets/kalshi/weather-model.ts';
import {walkForwardContractEvaluation,weatherEvidenceBlockers,independentLadder} from '../src/lib/prediction-markets/kalshi/weather-contract-eval.ts';
import {buildWeatherContractForecast,forecastInputFromMemory,forecastLeadHours} from '../src/lib/prediction-markets/kalshi/weather-distribution.ts';
import {KXHIGHNY_CONTRACT_SPEC} from '../src/lib/prediction-markets/kalshi/contract-math.ts';

const FILE=/^\d{4}-\d{2}-\d{2}\.json$/;
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
function listDir(root:string,sub:string){
 const dir=join(root,'kalshi-independent','nyc-weather',sub);
 if(!existsSync(dir))return [];
 const files=readdirSync(dir).filter(f=>FILE.test(f)).sort();
 if(files.length>2000)throw Error('WEATHER_EVAL_ARCHIVE_TOO_LARGE');
 return files.map(f=>({date:f.slice(0,10),rel:['kalshi-independent','nyc-weather',sub,f].join('/'),path:join(dir,f)}));
}
export function evaluateWeatherArchive(x:{root:string;asOf:string;archiveRef:string}){
 if(typeof x.root!=='string'||!x.root||!Number.isFinite(Date.parse(x.asOf))||
  typeof x.archiveRef!=='string'||!/^[A-Za-z0-9._/-]{1,80}$/.test(x.archiveRef))throw Error('WEATHER_EVAL_INVALID_ARGS');
 const asOf=Date.parse(x.asOf);
 const inputs:{path:string;sha256:string}[]=[];
 const read=(f:{rel:string;path:string})=>{
  if(statSync(f.path).size>120_000)throw Error('WEATHER_EVAL_RECORD_TOO_LARGE');
  const bytes=readFileSync(f.path);
  if(bytes.length>120_000)throw Error('WEATHER_EVAL_RECORD_TOO_LARGE');
  return {raw:JSON.parse(bytes.toString('utf8')),receipt:{path:f.rel,sha256:sha(bytes)}};
 };
 // Only evidence that existed at asOf is admitted, so a later run reproduces an earlier report.
 const forecasts=new Map<string,IndependentWeatherMemory>();
 for(const f of listDir(x.root,'forecasts')){
  const {raw,receipt}=read(f),m=verifyIndependentWeatherMemory(raw);
  if(m.targetLocalDate!==f.date)throw Error('WEATHER_EVAL_ARCHIVE_DATE_INTEGRITY');
  if(Date.parse(m.capturedAt)<=asOf){forecasts.set(f.date,m);inputs.push(receipt);}
 }
 const outcomes=new Map<string,ReturnType<typeof verifyCentralParkCli>>();
 for(const f of listDir(x.root,'cli-daily-preliminary')){
  const {raw,receipt}=read(f),c=verifyCentralParkCli(raw);
  if(c.reportDate!==f.date)throw Error('WEATHER_EVAL_ARCHIVE_DATE_INTEGRITY');
  const available=Date.parse(c.fetchedAt);
  if(!Number.isFinite(available))throw Error('WEATHER_EVAL_INVALID_RECEIPT_TIME');
  if(available<=asOf){outcomes.set(f.date,c);inputs.push(receipt);}
 }
 const training:WeatherTrainingDay[]=[...forecasts.keys()].filter(d=>outcomes.has(d)).sort()
  .map(d=>independentTrainingDay(forecasts.get(d)!,outcomes.get(d)!));
 const latest=[...forecasts.values()].sort((a,b)=>a.targetLocalDate.localeCompare(b.targetLocalDate)).at(-1)??null;
 const latestContractForecast=latest?buildWeatherContractForecast({input:forecastInputFromMemory(latest),
  training:training.filter(t=>Date.parse(t.observedAvailableAt)<Date.parse(latest.capturedAt)),
  strikes:independentLadder(latest.forecastHighF),asOf:latest.capturedAt}):null;
 return {
  schemaVersion:'kalshi-weather-contract-archive-eval-v1',
  asOf:x.asOf,archiveRef:x.archiveRef,
  archive:{files:inputs.sort((a,b)=>a.path.localeCompare(b.path)),aggregateSha256:sha(JSON.stringify(inputs.map(i=>i.path+':'+i.sha256).sort()))},
  networkRequests:0,kalshiDataUsed:false,
  contractSpec:KXHIGHNY_CONTRACT_SPEC,
  forecasts:[...forecasts.values()].sort((a,b)=>a.targetLocalDate.localeCompare(b.targetLocalDate)).map(m=>({
   targetLocalDate:m.targetLocalDate,capturedAt:m.capturedAt,forecastIssuedAt:m.forecastIssuedAt,
   leadHours:Number(forecastLeadHours(m.capturedAt,m.targetLocalDate).toFixed(3)),forecastHighF:m.forecastHighF,
   observedHighF:outcomes.get(m.targetLocalDate)?.observedHighF??null,
   outcomeFetchedAt:outcomes.get(m.targetLocalDate)?.fetchedAt??null})),
  blockers:weatherEvidenceBlockers({asOf:x.asOf,forecastDates:[...forecasts.keys()],outcomeDates:[...outcomes.keys()]}),
  evaluation:walkForwardContractEvaluation(training),
  latestContractForecast,
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [root,...rest]=process.argv.slice(2),arg=(k:string)=>{const i=rest.indexOf(k);return i>=0?rest[i+1]:undefined;};
 const asOf=arg('--as-of'),archiveRef=arg('--archive-ref'),out=arg('--out');
 if(!root||!asOf||!archiveRef){
  console.error('Usage: node --experimental-strip-types scripts/kalshi-weather-contract-eval.ts <research-data-dir> --as-of <ISO> --archive-ref <ref> [--out file]');
  process.exitCode=2;
 }else{
  try{
   const json=JSON.stringify(evaluateWeatherArchive({root,asOf,archiveRef}),null,2)+'\n';
   if(out)writeFileSync(out,json,'utf8');else process.stdout.write(json);
  }catch(e){console.error(e instanceof Error?e.message:'WEATHER_EVAL_FAILED');process.exitCode=1;}
 }
}
