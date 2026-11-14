/**
 * Independent sports results snapshots. No sportsbook, Kalshi, DFS, key, token,
 * staking, order, research_forecasts mutation, or existing model imports.
 *
 * Sources: nflverse/nfldata schedule CSV (attribution), SportsDataverse NHL
 * schedules release (CC BY 4.0). Archive only whitelisted game fields.
 * One immutable source snapshot per league/day, never a retroactive prediction.
 */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';

const sha=s=>createHash('sha256').update(s).digest('hex');
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const TEAM=/^[A-Z]{2,4}$/;
const MAX_ROWS=15000;
const MAX_CSV_BYTES=6_000_000;
const MAX_GAMES={nfl:300,nhl:1600};
export const SPORTS_SOURCES=Object.freeze({
 nfl:Object.freeze({
  league:'nfl',license:'NFLVERSE_CC_BY_4_0',
  attribution:'nflverse + Lee Sharpe/nfldata; CC BY 4.0. https://github.com/nflverse/nflverse-data/releases/tag/schedules',
  url:'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv',
  description:'NFL game schedule/scores only; excludes source betting lines, player data and any model prediction',
 }),
 nhl:Object.freeze({
  league:'nhl',license:'SPORTSDATAVERSE_CC_BY_4_0',
  attribution:'SportsDataverse fastRhockey NHL schedule, CC BY 4.0 https://github.com/sportsdataverse/sportsdataverse-data',
  url:'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/nhl_schedules/nhl_schedule_{endSeason}.csv',
  description:'NHL games/schedules; extracts only event identity, start, final status and results',
 }),
});
export const leagues=Object.freeze(Object.keys(SPORTS_SOURCES));
function validDay(s){
 if(typeof s!=='string'||!DAY.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)
  throw Error('SPORTS_INVALID_DATE');
 return s;
}
function captureTime(s){
 const t=Date.parse(s);
 if(typeof s!=='string'||!Number.isFinite(t)||!s.endsWith('Z'))throw Error('SPORTS_INVALID_CLOCK');
 return new Date(t).toISOString();
}
export function sourceFor(league,now){
 if(!Object.hasOwn(SPORTS_SOURCES,league))throw Error('SPORTS_LEAGUE_NOT_ALLOWED');
 const at=captureTime(now),day=at.slice(0,10);
 // The 2026-27 NHL season is called 2027 in SportsDataverse; NFL uses its starting calendar year.
 const [year,month]=day.split('-').map(Number);
 const season=league==='nhl'?(month>=7?year+1:year):(month>=7?year:year-1);
 return {...SPORTS_SOURCES[league],season,url:SPORTS_SOURCES[league].url.replace('{endSeason}',String(season))};
}
/** RFC4180 for bounded text. Strings are data and never converted to commands. */
export function parseCsv(text){
 if(typeof text!=='string'||text.length<5||Buffer.byteLength(text,'utf8')>MAX_CSV_BYTES||text.includes('\0'))
  throw Error('SPORTS_CSV_INVALID_SIZE');
 const rows=[];let cells=[],part='',quoted=false,wasQuoted=false;
 const pushCell=()=>{cells.push(part);part='';wasQuoted=false;};
 const pushRow=()=>{pushCell();if(cells.some(x=>x.length))rows.push(cells);cells=[];if(rows.length>MAX_ROWS)throw Error('SPORTS_CSV_TOO_MANY_ROWS');};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){
   if(c==='"'&&text[i+1]==='"'){part+='"';i++;continue;}
   if(c==='"'){quoted=false;wasQuoted=true;continue;}
   part+=c;
  }else if(c==='"'){
   if(part!==''||wasQuoted)throw Error('SPORTS_CSV_BAD_QUOTES');
   quoted=true;
  }else if(c===','){pushCell();}
  else if(c==='\n'||c==='\r'){pushRow();if(c==='\r'&&text[i+1]==='\n')i++;}
  else{
   if(wasQuoted)throw Error('SPORTS_CSV_BAD_QUOTES');
   part+=c;
  }
  if(part.length>3000)throw Error('SPORTS_CSV_CELL_TOO_LONG');
 }
 if(quoted)throw Error('SPORTS_CSV_UNCLOSED_QUOTE');
 if(part||cells.length)pushRow();
 if(rows.length<2)throw Error('SPORTS_CSV_NO_ROWS');
 const header=rows.shift().map(x=>x.replace(/^\uFEFF/,'').trim());
 if(header.some(h=>!h||!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(h))||new Set(header).size!==header.length)
  throw Error('SPORTS_CSV_BAD_HEADER');
 if(rows.some(row=>row.length!==header.length))throw Error('SPORTS_CSV_RAGGED_ROWS');
 return rows.map(row=>Object.fromEntries(header.map((h,i)=>[h,row[i]])));
}
const score=s=>{
 if(s===''||s==='NA'||s===undefined)return null;
 if(!/^\d{1,3}$/.test(s)||Number(s)>150)throw Error('SPORTS_BAD_SCORE');
 return Number(s);
};
const number=(s,min,max)=>{
 if(s===''||s===undefined||s==='NA')return null;
 const n=Number(s);
 if(!Number.isFinite(n)||n<min||n>max)throw Error('SPORTS_BAD_NUMBER');
 return n;
};
function gameDay(s){return validDay(s);}
function normalizedNFL(row,at,season){
 if(!/^\d{4}_(?:\d{2}|WC|DIV|CON|SB)_[A-Z]{2,4}_[A-Z]{2,4}$/.test(row.game_id)||
  !TEAM.test(row.home_team)||!TEAM.test(row.away_team)||row.home_team===row.away_team||
  !/^(REG|WC|DIV|CON|SB|PRE)$/.test(row.game_type)||
  !/^\d{1,2}$/.test(row.week))throw Error('SPORTS_NFL_BAD_GAME');
 const day=gameDay(row.gameday),home=score(row.home_score),away=score(row.away_score);
 if((home===null)!==(away===null))throw Error('SPORTS_NFL_PARTIAL_SCORE');
 const finished=day<at.slice(0,10)&&home!==null;
 return {
  id:row.game_id,season,round:Number(row.week),phase:row.game_type,date:day,
  timeAsPublished:row.gametime||null,home:row.home_team,away:row.away_team,
  state:finished?'SOURCE_REPORTED_RESULT':'UNVERIFIED_OR_FUTURE',
  homeScore:finished?home:null,awayScore:finished?away:null,
  homeRestDays:number(row.home_rest,0,40),awayRestDays:number(row.away_rest,0,40),
 };
}
function normalizedNHL(row,at,season){
 if(!/^\d{7,12}$/.test(row.game_id)||!TEAM.test(row.home_team_abbr)||
  !TEAM.test(row.away_team_abbr)||row.home_team_abbr===row.away_team_abbr||
  !/^(PR|R|P|A)$/.test(row.game_type))throw Error('SPORTS_NHL_BAD_GAME');
 const date=gameDay(row.game_date),home=score(row.home_score),away=score(row.away_score);
 if((home===null)!==(away===null))throw Error('SPORTS_NHL_PARTIAL_SCORE');
 const gameTime=row.game_time&&row.game_time!=='NA'?row.game_time:null;
 if(gameTime&&!(Number.isFinite(Date.parse(gameTime))))throw Error('SPORTS_NHL_BAD_START');
 const finished=date<at.slice(0,10)&&home!==null&&
  /^(OFF|FINAL|F|7)$/i.test(row.game_state??'');
 return {
  id:row.game_id,season,phase:row.game_type,date,
  timeAsPublished:gameTime,home:row.home_team_abbr,away:row.away_team_abbr,
  state:finished?'SOURCE_REPORTED_RESULT':'UNVERIFIED_OR_FUTURE',
  homeScore:finished?home:null,awayScore:finished?away:null
 };
}
export function freezeSportsSnapshot(league,csv,now){
 const at=captureTime(now),source=sourceFor(league,at),all=parseCsv(csv);
 const required=league==='nfl'?
  ['game_id','season','game_type','week','gameday','gametime','home_team','away_team','home_score','away_score']:
  ['game_id','season_full','game_type','game_date','game_time','home_team_abbr','away_team_abbr','home_score','away_score','game_state'];
 for(const key of required)if(!Object.hasOwn(all[0],key))throw Error('SPORTS_SOURCE_SCHEMA_CHANGED_'+key);
 const matches=all.filter(x=>league==='nfl'?x.season===String(source.season):
  x.season_full===String(source.season-1)+String(source.season));
 if(matches.length<1||matches.length>MAX_GAMES[league])throw Error('SPORTS_SEASON_MISSING_OR_OVERSIZED');
 const seen=new Set();
 const games=matches.map(x=>{
  const game=league==='nfl'?normalizedNFL(x,at,source.season):normalizedNHL(x,at,source.season);
  if(seen.has(game.id))throw Error('SPORTS_DUPLICATE_EVENT');
  seen.add(game.id);
  return game;
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const base={
  schema:'independent-sports-daily-v1',league,source:source.license,
  sourceUrl:source.url,attribution:source.attribution,
  snapshotAt:at,season:source.season,
  sourceCsvSha256:sha(csv),rows:games.length,sourceReportedResults:games.filter(g=>g.state==='SOURCE_REPORTED_RESULT').length,
  games,
  note:'Independent source-reported schedules/results only, captured now; NOT an as-of historical sportsbook feed, official verified settlement, pick, prediction, probability, or wager. Market odds and post-event data were excluded.'
 };
 return {id:sha(JSON.stringify(base)),...base};
}
function parseArchive(s,league,day){
 const r=JSON.parse(s),{id,...base}=r;
 if(!id||id!==sha(JSON.stringify(base))||r.schema!=='independent-sports-daily-v1'||r.league!==league||
  r.snapshotAt.slice(0,10)!==day||!Array.isArray(r.games)||r.rows!==r.games.length||
  r.games.some(g=>g.date>=day&&g.state==='SOURCE_REPORTED_RESULT'))
  throw Error('SPORTS_ARCHIVE_INTEGRITY');
 return r;
}
function dailyPath(root,league,day){return join(root,'independent-sports',league,'snapshots',day+'.json');}
async function download(url,fetcher){
 // This module accepts only URLs fixed by the internal source catalog.
 const res=await fetcher(url,{method:'GET',credentials:'omit',redirect:'follow',cache:'no-store',
  signal:AbortSignal.timeout(12_000),headers:{Accept:'text/csv'}});
 if(!res.ok)throw Error('SPORTS_SOURCE_HTTP_'+res.status);
 const len=res.headers.get('content-length');
 if(len&&Number(len)>MAX_CSV_BYTES)throw Error('SPORTS_SOURCE_TOO_LARGE');
 if(!res.body)throw Error('SPORTS_SOURCE_EMPTY');
 const reader=res.body.getReader();let total=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;
  total+=value.byteLength;if(total>MAX_CSV_BYTES)throw Error('SPORTS_SOURCE_TOO_LARGE');
  chunks.push(value);
 }}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;
 for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function collectIndependentSports({league,root,now=()=>new Date().toISOString(),fetcher=fetch}){
 if(typeof root!=='string'||!root.trim()||!Object.hasOwn(SPORTS_SOURCES,league))throw Error('SPORTS_BAD_CONFIG');
 const at=captureTime(now()),day=at.slice(0,10),path=dailyPath(root,league,day);
 if(existsSync(path)){
  const prior=parseArchive(readFileSync(path,'utf8'),league,day);
  return {status:'ALREADY_ARCHIVED',league,day,rows:prior.rows,sourceCalls:0,path};
 }
 const source=sourceFor(league,at);
 const csv=await download(source.url,fetcher);
 const record=freezeSportsSnapshot(league,csv,at);
 mkdirSync(dirname(path),{recursive:true});
 // Never overwrite a frozen forward snapshot. GitHub branch commit guard
 // provides the second append-only constraint.
 writeFileSync(path,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
 return {status:'ARCHIVED',league,day,rows:record.rows,sourceCalls:1,path};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const league=process.argv[2],root=process.argv[3];
 if(!root||!leagues.includes(league)){console.error('Usage: node scripts/independent-sports-collect.mjs nfl|nhl research-data');process.exitCode=2;}
 else collectIndependentSports({league,root}).then(x=>console.log(JSON.stringify(x))).catch(err=>{
  console.error(err instanceof Error?err.message:'SPORTS_COLLECTION_FAILED');process.exitCode=1;
 });
}
