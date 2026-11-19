/**
 * Append-only independent NWS forecast + preliminary Central Park CLI capture.
 * Operates ONLY inside the existing data-only research-data branch checkout.
 * One immutable JSON per station climate date; no Kalshi requests, paid feeds,
 * API tokens, account or broker calls. No automatic strategy promotion.
 *
 * node --experimental-strip-types scripts/kalshi-independent-weather-collect.ts forecast research-data
 * node --experimental-strip-types scripts/kalshi-independent-weather-collect.ts outcome research-data
 */
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readCentralParkHourlyNws} from '../src/lib/prediction-markets/kalshi/nws.ts';
import {nextNewYorkDate,buildIndependentWeatherMemory,verifyIndependentWeatherMemory} from '../src/lib/prediction-markets/kalshi/weather-memory.ts';
import {readCentralParkCli,verifyCentralParkCli,independentTrainingDay,
 gradeIndependentWeather} from '../src/lib/prediction-markets/kalshi/nws-cli.ts';
import type {WeatherTrainingDay} from '../src/lib/prediction-markets/kalshi/weather-model.ts';
import {scoreIndependentWeatherForward} from '../src/lib/prediction-markets/kalshi/weather-scorecard.ts';
import type {IndependentWeatherMemory} from '../src/lib/prediction-markets/kalshi/weather-memory.ts';
import type {IndependentWeatherGrade,CentralParkCliDaily} from '../src/lib/prediction-markets/kalshi/nws-cli.ts';
export type Phase='forecast'|'outcome';
export type CollectResult={status:'CREATED'|'ALREADY_ARCHIVED';phase:Phase;date:string;
 file:string;independentGraded:boolean;historicalTrainingDays:number};
const archive=(root:string)=>join(root,'kalshi-independent','nyc-weather');
const forecastFile=(root:string,date:string)=>join(archive(root),'forecasts',date+'.json');
const cliFile=(root:string,date:string)=>join(archive(root),'cli-daily-preliminary',date+'.json');
const gradeFile=(root:string,date:string)=>join(archive(root),'independent-grades',date+'.json');
const scoreFile=(root:string,date:string)=>join(archive(root),'scorecards',date+'.json');
function stationYesterday(now:string){
 const tomorrow=nextNewYorkDate(now);
 return new Date(Date.parse(tomorrow+'T00:00:00Z')-2*86_400_000).toISOString().slice(0,10);
}
function readArchive<T>(path:string,verify:(v:unknown)=>T):T{
 const bytes=readFileSync(path,'utf8');
 if(bytes.length>120_000)throw Error('WEATHER_ARCHIVE_TOO_LARGE');
 return verify(JSON.parse(bytes));
}
function appendArchive(path:string,value:unknown){
 mkdirSync(dirname(path),{recursive:true});
 // Any re-run must keep the original frozen file. The research-data commit
 // guard additionally rejects updates or deletes on the data branch.
 writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',encoding:'utf8'});
}
function knownHistory(root:string):WeatherTrainingDay[]{
 const dir=join(archive(root),'forecasts');
 if(!existsSync(dir))return [];
 const files=readdirSync(dir).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f));
 if(files.length>1000)throw Error('WEATHER_HISTORY_EXCEEDS_LIMIT');
 const out:WeatherTrainingDay[]=[];
 for(const file of files){
  const date=file.slice(0,10),obs=cliFile(root,date);
  if(!existsSync(obs))continue;
  const forecast=readArchive(join(dir,file),verifyIndependentWeatherMemory);
  const cli=readArchive(obs,verifyCentralParkCli);
  if(forecast.targetLocalDate!==date||cli.reportDate!==date)throw Error('WEATHER_ARCHIVE_DATE_INTEGRITY');
  out.push(independentTrainingDay(forecast,cli));
 }
 return out.sort((a,b)=>a.localDate.localeCompare(b.localDate));
}
/** Repair missing derived files from *already stored* government evidence, without another API call. */
function updateDerivedWeather(root:string,date:string,cli:CentralParkCliDaily):boolean{
 let graded=false;
 const forecastPath=forecastFile(root,date);
 if(existsSync(forecastPath)){
  const frozen=readArchive(forecastPath,verifyIndependentWeatherMemory);
  const expected=gradeIndependentWeather(frozen,cli),dest=gradeFile(root,date);
  if(existsSync(dest)){
   const stored=readArchive(dest,(v):IndependentWeatherGrade=>v as IndependentWeatherGrade);
   if(JSON.stringify(stored)!==JSON.stringify(expected))throw Error('WEATHER_GRADE_ARCHIVE_CONFLICT');
  }else{appendArchive(dest,expected);graded=true;}
 }
 const scoreDest=scoreFile(root,date);
 if(!existsSync(scoreDest)){
  const dir=join(archive(root),'independent-grades');
  const rows:{forecast:IndependentWeatherMemory;cli:CentralParkCliDaily;grade:IndependentWeatherGrade}[]=[];
  if(existsSync(dir)){
   const files=readdirSync(dir).filter(x=>/^\d{4}-\d{2}-\d{2}\.json$/.test(x)&&x.slice(0,10)<=date);
   if(files.length>1000)throw Error('WEATHER_HISTORY_EXCEEDS_LIMIT');
   for(const file of files){
    const id=file.slice(0,10),fc=forecastFile(root,id),obs=cliFile(root,id);
    if(!existsSync(fc)||!existsSync(obs))throw Error('WEATHER_ARCHIVE_MISSING_GRADE_SOURCE');
    rows.push({
     forecast:readArchive(fc,verifyIndependentWeatherMemory),
     cli:readArchive(obs,verifyCentralParkCli),
     grade:readArchive(join(dir,file),(v):IndependentWeatherGrade=>v as IndependentWeatherGrade)
    });
   }
  }
  appendArchive(scoreDest,scoreIndependentWeatherForward(rows));
 }
 return graded;
}
export async function collectIndependentWeather(opts:{
 phase:Phase;root:string;userAgent:string;fetcher?:typeof fetch;now?:()=>string
}):Promise<CollectResult>{
 const now=opts.now??(()=>new Date().toISOString());
 if(typeof opts.root!=='string'||!opts.root.trim()||
  typeof opts.userAgent!=='string'||opts.userAgent.length<12||
  opts.userAgent.length>180||/[\r\n]/.test(opts.userAgent))
  throw Error('WEATHER_COLLECT_INVALID_CONFIG');
 const capturedAt=now();
 if(!Number.isFinite(Date.parse(capturedAt)))throw Error('WEATHER_COLLECT_INVALID_TIME');
 if(opts.phase!=='forecast'&&opts.phase!=='outcome')throw Error('WEATHER_COLLECT_INVALID_PHASE');
 const root=opts.root;
 if(opts.phase==='forecast'){
  const date=nextNewYorkDate(capturedAt),file=forecastFile(root,date);
  if(existsSync(file)){
   const old=readArchive(file,verifyIndependentWeatherMemory);
   if(old.targetLocalDate!==date)throw Error('WEATHER_ARCHIVE_DATE_INTEGRITY');
   return {status:'ALREADY_ARCHIVED',phase:'forecast',date,file,independentGraded:false,
    historicalTrainingDays:old.historicalTrainingDays};
  }
  const source=await readCentralParkHourlyNws({
   userAgent:opts.userAgent,now:()=>capturedAt,fetcher:opts.fetcher});
  const frozen=buildIndependentWeatherMemory(source,knownHistory(root));
  if(frozen.targetLocalDate!==date)throw Error('WEATHER_COLLECT_RACE_WITH_DAY_ROLLOVER');
  appendArchive(file,frozen);
  return {status:'CREATED',phase:'forecast',date,file,independentGraded:false,
   historicalTrainingDays:frozen.historicalTrainingDays};
 }
 const date=stationYesterday(capturedAt),file=cliFile(root,date);
 if(existsSync(file)){
  const old=readArchive(file,verifyCentralParkCli);
  if(old.reportDate!==date)throw Error('WEATHER_ARCHIVE_DATE_INTEGRITY');
  updateDerivedWeather(root,date,old);
  return {status:'ALREADY_ARCHIVED',phase:'outcome',date,file,
   independentGraded:existsSync(gradeFile(root,date)),historicalTrainingDays:0};
 }
 const cli=await readCentralParkCli({userAgent:opts.userAgent,now:()=>capturedAt,fetcher:opts.fetcher});
 if(cli.reportDate!==date)throw Error('WEATHER_CLI_NOT_EXPECTED_DATE');
 appendArchive(file,cli);
 const graded=updateDerivedWeather(root,date,cli);
 return {status:'CREATED',phase:'outcome',date,file,independentGraded:graded,historicalTrainingDays:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const phase=process.argv[2],root=process.argv[3];
 if((phase!=='forecast'&&phase!=='outcome')||!root){
  console.error('Usage: node --experimental-strip-types scripts/kalshi-independent-weather-collect.ts forecast|outcome research-data');
  process.exitCode=2;
 }else{
  // No private email or API token is embedded. The repository URL identifies the client.
  const userAgent=process.env.NWS_RESEARCH_USER_AGENT||
   'SportsEdge independent NOAA weather research (https://github.com/ang87505-crypto/SportsEdge)';
  collectIndependentWeather({phase,root,userAgent}).then(result=>{
   process.stdout.write(JSON.stringify(result)+'\n');
  }).catch(error=>{
   console.error(error instanceof Error?error.message:'WEATHER_COLLECT_FAILED');
   process.exitCode=1;
  });
 }
}
