/**
 * WATCH ONLY: replay existing pre-lock observations and original model forecasts.
 * Every captured line is visible, including unscorable lines; there is NO
 * dollar stake, entry, bet, Odds API request, account sign-in, or database write.
 *
 * Deduplication is only for analytics. Source/platform rows remain visible.
 */
import {MODEL_VERSION,OBSERVATION_RULES} from './contract.ts';
import {playerKey} from './identity.ts';
import {validProbabilities,type ResearchRaw} from './research.ts';

export const WATCH_ONLY_VERSION='nba-props-watch-only-v1';
export type WatchOutcome='win'|'loss'|'push'|'pending'|'unscored';
export type WatchRow={
 key:string;predictionId:number|null;observationId:number;
 eventId:string;platform:string;game:string;player:string;stat:string;line:number;
 recordedAt:string;providerUpdatedAt:string;predictedAt:string|null;lockAt:string;date:string;
 modelVersion:string|null;side:'more'|'less'|null;probability:number|null;
 tieProbability:number|null;outcome:WatchOutcome;actual:number|null;gradedAt:string|null;
 isUnique:boolean;status:'scored'|'unscorable';source:'the_odds_api';
};
export type WatchTotals={
 lines:number;uniqueLines:number;games:number;graded:number;wins:number;losses:number;
 pushes:number;pending:number;unscored:number;winRate:number|null;
};
const dayFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const time=(s:string)=>typeof s==='string'?Date.parse(s):NaN;
const valid=(n:number)=>Number.isFinite(n);
const keyFor=(o:ResearchRaw['observations'][number])=>
 [o.provider_event_id,playerKey(o.player_name),o.stat,Number(o.line)].join('|');
const tally=(rs:WatchRow[]):WatchTotals=>{
 const unique=rs.filter(r=>r.isUnique);
 const wins=unique.filter(r=>r.outcome==='win').length,losses=unique.filter(r=>r.outcome==='loss').length;
 return {lines:rs.length,uniqueLines:unique.length,games:new Set(unique.map(r=>r.eventId)).size,
  graded:unique.filter(r=>['win','loss','push'].includes(r.outcome)).length,
  wins,losses,pushes:unique.filter(r=>r.outcome==='push').length,
  pending:unique.filter(r=>r.outcome==='pending').length,
  unscored:unique.filter(r=>r.outcome==='unscored').length,
  winRate:wins+losses?wins/(wins+losses):null};
};
export function watchOnlyLedger(r:ResearchRaw,asOf=r.nowIso){
 const now=time(asOf);
 if(!valid(now))throw Error('WATCH_INVALID_AS_OF');
 const obs=new Map(r.observations.map(o=>[o.id,o]));
 // Always use the first generated version of a forecast for an observation.
 const predictions=new Map<number,ResearchRaw['predictions'][number]>();
 for(const p of [...r.predictions].sort((a,b)=>a.id-b.id)){
  if(p.model_version===MODEL_VERSION&&!predictions.has(p.observation_id))predictions.set(p.observation_id,p);
 }
 const results=new Map<number,ResearchRaw['results'][number]>();
 for(const grade of r.results){
  const t=time(grade.graded_at);
  if(!valid(t)||t>now)continue;
  const old=results.get(grade.observation_id);
  if(!old||grade.revision>old.revision)results.set(grade.observation_id,grade);
 }
 const seenPlatform=new Set<string>(),seenGlobal=new Set<string>();
 let invalidRows=0,duplicates=0;
 const rows:WatchRow[]=[];
 // Freeze first-seen price-line snapshots; retain each platform as a source
 // receipt, while unique sample sizes count each exact player/line once.
 for(const o of [...obs.values()].sort((a,b)=>time(a.recorded_at)-time(b.recorded_at)||a.id-b.id)){
  const ingested=time(o.ingested_at),recorded=time(o.recorded_at),quote=time(o.provider_last_update),
   lock=time(o.lock_at),line=Number(o.line);
  if(![ingested,recorded,quote,lock].every(valid)||ingested>recorded||recorded>now||
   recorded>=lock-OBSERVATION_RULES.lockBufferMs||quote>ingested+OBSERVATION_RULES.maxClockSkewMs||
   quote<ingested-OBSERVATION_RULES.maxQuoteAgeMs||!valid(line)||
   line<OBSERVATION_RULES.minLine||line>OBSERVATION_RULES.maxLine||
   !o.provider_event_id||!o.player_name){invalidRows++;continue;}
  const key=keyFor(o),platformKey=o.platform+'|'+key;
  if(seenPlatform.has(platformKey)){duplicates++;continue;}
  seenPlatform.add(platformKey);
  const isUnique=!seenGlobal.has(key);
  seenGlobal.add(key);
  const p=predictions.get(o.id);
  const validForecast=Boolean(p&&p.status==='scored'&&p.athlete_id&&
   p.p_more!==null&&p.p_less!==null&&p.p_tie!==null&&
   validProbabilities({pMore:Number(p.p_more),pLess:Number(p.p_less),pTie:Number(p.p_tie)})&&
   valid(time(p.predicted_at))&&valid(time(p.data_cutoff))&&
   time(p.predicted_at)<=now&&time(p.predicted_at)>=ingested&&
   time(p.predicted_at)<lock-OBSERVATION_RULES.lockBufferMs&&
   time(p.data_cutoff)<=time(p.predicted_at));
  const more=validForecast?Number(p!.p_more):null,less=validForecast?Number(p!.p_less):null;
  const side:WatchRow['side']=validForecast?(more!>=less!?'more':'less'):null;
  const probability=validForecast?Math.max(more!,less!):null;
  const grade=results.get(o.id),gradedAt=grade?time(grade.graded_at):NaN;
  const actual=grade?.actual===null||grade?.actual===undefined?null:Number(grade.actual);
  const correctGrade=Boolean(grade&&valid(gradedAt)&&gradedAt>lock&&
   (['more','less','tie'].includes(grade.outcome)&&actual!==null&&valid(actual)&&
    (actual>line?'more':actual<line?'less':'tie')===grade.outcome||
    ['void_dnp','void_postponed'].includes(grade.outcome)&&actual===null));
  let outcome:WatchOutcome=!validForecast?'unscored':'pending';
  if(validForecast&&correctGrade){
   if(grade!.outcome==='tie'||grade!.outcome.startsWith('void_'))outcome='push';
   else outcome=grade!.outcome===side?'win':'loss';
  }
  rows.push({key,predictionId:p?.id??null,observationId:o.id,eventId:o.provider_event_id,
   platform:o.platform,game:o.away_team+' @ '+o.home_team,player:o.player_name,stat:o.stat,line,
   recordedAt:o.recorded_at,providerUpdatedAt:o.provider_last_update,
   predictedAt:validForecast?p!.predicted_at:null,lockAt:o.lock_at,date:dayFmt.format(new Date(lock)),
   modelVersion:validForecast?p!.model_version:null,side,probability,
   tieProbability:validForecast?Number(p!.p_tie):null,outcome,
   actual:correctGrade?actual:null,gradedAt:correctGrade?grade!.graded_at:null,
   isUnique,status:validForecast?'scored':'unscorable',source:'the_odds_api'});
 }
 rows.sort((a,b)=>b.lockAt.localeCompare(a.lockAt)||a.player.localeCompare(b.player)||a.line-b.line||a.platform.localeCompare(b.platform));
 const filter=(threshold:number,dates?:string,platform?:string)=>{
  if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw Error('WATCH_BAD_THRESHOLD');
  return rows.filter(row=>(threshold===0||row.probability!==null&&row.probability>=threshold)&&
   (!dates||row.date===dates)&&(!platform||row.platform===platform));
 };
 const report=(threshold:number,date?:string,platform?:string)=>{
  const selected=filter(threshold,date,platform);
  // Platform-filtered analytics count once per filtered group too.
  const unique=new Set<string>();
  return tally(selected.map(row=>({...row,isUnique:!unique.has(row.key)&&!!unique.add(row.key)})));
 };
 const impact=(threshold:number,date:string,platform?:string)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('WATCH_BAD_DATE');
  const selected=filter(threshold,undefined,platform);
  const before=tally(selected.filter(row=>row.date<date));
  const daily=tally(selected.filter(row=>row.date===date));
  const through=tally(selected.filter(row=>row.date<=date));
  return {before,daily,through,
   deltaPercentagePoints:before.winRate===null||through.winRate===null?null:
    Math.round((through.winRate-before.winRate)*10000)/100};
 };
 return {version:WATCH_ONLY_VERSION,asOf,rows,invalidRows,duplicates,filter,report,impact};
}
