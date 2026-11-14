/**
 * Research-only 60%+ NBA prop shadow ledger from already-persisted, pre-lock
 * Supabase observations + forecasts + later box-score grades. No new API
 * requests, paid odds, database writes, wagers, or account modifications.
 *
 * EVERY admissible first-seen forecast above the study threshold is retained,
 * even if the live selection rule skips it or daily entry caps are reached.
 * The fixed 2.00x payout is a deliberately hypothetical EVEN-MONEY benchmark
 * for a standalone pick: NOT an offered sportsbook price, PrizePicks payout,
 * Kalshi price, executable trade, or actual profit.
 */
import type {ResearchRaw} from './research.ts';
import {validProbabilities} from './research.ts';
import {MODEL_VERSION} from './contract.ts';

export const SHADOW_STUDY={
 version:'nba-props-shadow-even-money-v1',
 minSideProbability:0.60,
 stakeCents:500,
 benchmarkDecimalOdds:2.00,
 maxRows:20000
} as const;
export type ShadowState='win'|'loss'|'push'|'pending';
export type ShadowRow={
 key:string;predictionId:number;observationId:number;platform:string;eventId:string;
 game:string;player:string;stat:string;line:number;modelVersion:string;lockAt:string;
 capturedAt:string;predictedAt:string;slateDate:string;side:'more'|'less';
 probability:number;tieProbability:number;liveStatus:'recorded'|'skipped'|'no_decision';
 outsideLiveBand:boolean;tieRisk:boolean;
 state:ShadowState;actual:number|null;gradedAt:string|null;
 stakeCents:500;hypotheticalExpectedNetCents:number;
 /** Null is pending/unknown, not a zero-valued loss. */
 hypotheticalNetCents:number|null;
};
export type ShadowSummary={
 rows:number;days:number;games:number;graded:number;wins:number;losses:number;pushes:number;
 pending:number;winRate:number|null;hypotheticalNetCents:number;
 hypotheticalExpectedNetCents:number;liveRecorded:number;excludedByLiveRules:number;
 uniquePlatforms:number;invalidSkipped:number;duplicatesSkipped:number;
};
const et=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const validTime=(s:string)=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const evidenceTime=(s:string)=>validTime(s)?Date.parse(s):NaN;
const sideOf=(p:{p_more:number;p_less:number}):'more'|'less'=>p.p_more>=p.p_less?'more':'less';
const round=(n:number)=>Math.round(n);
const cent=(n:number)=>Math.round(n*SHADOW_STUDY.stakeCents);
const admission=(o:ResearchRaw['observations'][number],p:ResearchRaw['predictions'][number],now:number):boolean=>{
 const ms=[o.ingested_at,o.recorded_at,o.provider_last_update,o.lock_at,p.data_cutoff,p.predicted_at].map(evidenceTime);
 if(ms.some(x=>!Number.isFinite(x)))return false;
 const [ingested,recorded,provider,lock,cutoff,predicted]=ms;
 return Boolean(
  p.model_version===MODEL_VERSION&&p.status==='scored'&&p.athlete_id&&
  ingested<=recorded&&recorded<lock&&ingested<lock&&predicted>=ingested&&predicted<lock&&
  cutoff<=predicted&&predicted<=now&&provider<=ingested+60000&&provider>=ingested-7200000&&provider<lock&&
  Number.isFinite(Number(o.line))&&Number(o.line)>0&&
  typeof o.provider_event_id==='string'&&o.provider_event_id.length>0
 );
};
export function shadowLedger(r:ResearchRaw,nowIso:string=r.nowIso){
 if(!validTime(nowIso))throw Error('SHADOW_INVALID_TIME');
 if(r.observations.length>SHADOW_STUDY.maxRows||r.predictions.length>SHADOW_STUDY.maxRows*4)
  throw Error('SHADOW_TOO_MANY_ROWS');
 const now=Date.parse(nowIso),observations=new Map(r.observations.map(o=>[o.id,o]));
 const picks=new Map(r.picks.map(k=>[k.prediction_id,k]));
 const latest=new Map<number,ResearchRaw['results'][number]>();
 for(const result of r.results){
  if(!validTime(result.graded_at)||Date.parse(result.graded_at)>now)continue;
  const old=latest.get(result.observation_id);
  if(!old||result.revision>old.revision)latest.set(result.observation_id,result);
 }
 let invalidSkipped=0,duplicatesSkipped=0;
 const found=new Map<string,ShadowRow>();
 // Oldest first; a later quote or platform cannot silently replace the
 // original frozen forecast after seeing a result or favorable price.
 const predictions=[...r.predictions].sort((a,b)=>{
  const oa=observations.get(a.observation_id),ob=observations.get(b.observation_id);
  return (oa?.recorded_at??'').localeCompare(ob?.recorded_at??'')||a.predicted_at.localeCompare(b.predicted_at)||a.id-b.id;
 });
 for(const p of predictions){
  const o=observations.get(p.observation_id);
  if(!o||!admission(o,p,now)){invalidSkipped++;continue;}
  if(p.p_more===null||p.p_less===null||p.p_tie===null){invalidSkipped++;continue;}
  const probs={pMore:Number(p.p_more),pLess:Number(p.p_less),pTie:Number(p.p_tie)};
  if(!validProbabilities(probs)){invalidSkipped++;continue;}
  const side=sideOf({p_more:probs.pMore,p_less:probs.pLess});
  const probability=side==='more'?probs.pMore:probs.pLess;
  // No upper cap for RESEARCH: observations above 80% are *kept* but flagged
  // as excluded by the frozen live pick rule (typically unmodeled news).
  if(probability<SHADOW_STUDY.minSideProbability)continue;
  const key=[o.provider_event_id,p.athlete_id,o.stat,Number(o.line),p.model_version].join('|');
  if(found.has(key)){duplicatesSkipped++;continue;}
  const result=latest.get(o.id);
  const resultAt=result&&validTime(result.graded_at)?Date.parse(result.graded_at):NaN;
  const actual=result?.actual===null||result?.actual===undefined?null:Number(result.actual);
  let state:ShadowState='pending';
  let gradedAt:string|null=null;
  if(result&&Number.isFinite(resultAt)&&resultAt>Date.parse(o.lock_at)){
   if(['more','less','tie'].includes(result.outcome)&&actual!==null&&Number.isFinite(actual)&&
      (actual>Number(o.line)?'more':actual<Number(o.line)?'less':'tie')===result.outcome){
    state=result.outcome==='tie'?'push':result.outcome===side?'win':'loss';gradedAt=result.graded_at;
   }else if(['void_dnp','void_postponed'].includes(result.outcome)&&actual===null){
    state='push';gradedAt=result.graded_at;
   }
  }
  const pick=picks.get(p.id),liveStatus=pick?(pick.status==='recorded'?'recorded':'skipped'):'no_decision';
  const outsideLiveBand=probability>0.80;
  const tieRisk=probs.pTie>0.05;
  const net=state==='win'?SHADOW_STUDY.stakeCents:state==='loss'?-SHADOW_STUDY.stakeCents:state==='push'?0:null;
  found.set(key,{key,predictionId:p.id,observationId:o.id,platform:o.platform,eventId:o.provider_event_id,
   game:o.away_team+' @ '+o.home_team,player:o.player_name,stat:o.stat,line:Number(o.line),
   modelVersion:p.model_version,lockAt:o.lock_at,capturedAt:o.recorded_at,predictedAt:p.predicted_at,
   slateDate:et.format(new Date(o.lock_at)),side,probability,tieProbability:probs.pTie,
   liveStatus,outsideLiveBand,tieRisk,state,actual,gradedAt,
   stakeCents:SHADOW_STUDY.stakeCents,
   hypotheticalExpectedNetCents:cent(probability-(side==='more'?probs.pLess:probs.pMore)),
   hypotheticalNetCents:net});
 }
 const rows=[...found.values()].sort((a,b)=>b.lockAt.localeCompare(a.lockAt)||b.probability-a.probability||a.predictionId-b.predictionId);
 const sum=(list:ShadowRow[]):ShadowSummary=>{
  const graded=list.filter(x=>x.state!=='pending'),wins=graded.filter(x=>x.state==='win').length,
   losses=graded.filter(x=>x.state==='loss').length,pushes=graded.filter(x=>x.state==='push').length;
  return {rows:list.length,days:new Set(list.map(x=>x.slateDate)).size,games:new Set(list.map(x=>x.eventId)).size,
   graded:graded.length,wins,losses,pushes,pending:list.length-graded.length,
   winRate:wins+losses?wins/(wins+losses):null,
   hypotheticalNetCents:graded.reduce((n,x)=>n+x.hypotheticalNetCents!,0),
   hypotheticalExpectedNetCents:list.reduce((n,x)=>n+x.hypotheticalExpectedNetCents,0),
   liveRecorded:list.filter(x=>x.liveStatus==='recorded').length,
   excludedByLiveRules:list.filter(x=>x.liveStatus!=='recorded').length,
   uniquePlatforms:new Set(list.map(x=>x.platform)).size,
   invalidSkipped,duplicatesSkipped};
 };
 const impact=(date:string)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('SHADOW_INVALID_DATE');
  const prior=sum(rows.filter(x=>x.slateDate<date));
  const daily=sum(rows.filter(x=>x.slateDate===date));
  const through=sum(rows.filter(x=>x.slateDate<=date));
  return {date,prior,daily,through,
   // Percentage points, not relative percent; only settled win/loss grades
   // affect the cumulative rate. A push or pending leg does not.
   deltaPoints:prior.winRate===null||through.winRate===null?null:
    Math.round((through.winRate-prior.winRate)*10000)/100};
 };
 return {version:SHADOW_STUDY.version,asOf:nowIso,rows,summary:sum(rows),summarize:sum,impact};
}
