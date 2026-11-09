/**
 * Daily NBA player-prop PAPER cycle (worker side). Two run kinds:
 *  collect: events -> choose (budget) -> event odds (prizepicks, pick6 + sportsbook references) -> validate
 *           -> predict (frozen model) -> record pick/skip -> market views -> virtual entries, all before lock.
 *           Sportsbook quotes and market views are best-effort: a failure there never loses a line or pick.
 *  settle:  ESPN scoreboard/summary -> box scores (append revisions) -> link events
 *           -> grade lines -> settle entries (PrizePicks captured table; Pick6 unknown).
 * Every provider request is reserved first and never retried. A successful exit is
 * NOT proof of recorded picks: the summary reports counts read back from the store.
 */
import {PropsStoreError,type PropsStore} from './props-store.ts';
import type {PropsOddsClient} from './props-odds-client.ts';
import {ProviderError} from './props-odds-client.ts';
import {trimSummary,type EspnClient} from './props-espn-client.ts';
import {parseEventList,normalizePropEvent,normalizeBookQuotes,sha256,canonicalJson,type ListedEvent,type BookQuote} from '../props/normalize.ts';
import {marketView,type MarketView} from '../props/market.ts';
import {chooseEvents,ACTIVE_BUDGET_POLICY,EVENTS_LIST_COST,eventOddsWorstCost,canSpend,type BudgetState} from '../props/budget.ts';
import {predictLine,type GameLog,type ModelParams,type PriorSummary} from '../props/model.ts';
import {matchPlayer,playerKey,teamAbbr,type RosterCandidate} from '../props/identity.ts';
import {parseScoreboard,parseSummary,type ScoreboardGame} from '../props/boxscore.ts';
import {gradeLine,decidePick,decidePickV2,buildEntries,settleEntry,legResult,PRIZEPICKS_TERMS_V1,type LineOutcome} from '../props/rules.ts';
import {matchupFeatures} from '../props/features.ts';
import {predictLearn} from '../props/learn.ts';
import {loadActiveModel,type ActiveModel} from './props-active-model.ts';
import {loadTeamRows} from './props-learn-data.ts';
import {checkSafetyBrake} from './props-learn-worker.ts';
import {MODEL_VERSION,SELECTION_VERSION,SELECTION_VERSION_V2,NORMALIZER_VERSION,OBSERVATION_RULES,PLATFORMS,SPORTSBOOKS,type Platform,type Stat} from '../props/contract.ts';

export type ModelArtifact={modelVersion:string;params:ModelParams;
 players:Record<string,{name:string;lastTeam:string;games:number;minutes:number;points:number;rebounds:number;assists:number}>};
export type CycleDeps={store:PropsStore;odds:PropsOddsClient|null;espn:EspnClient;model:ModelArtifact;
 now:()=>string;worker:string;seasonStart:string};
export type CycleResult={kind:'collect'|'settle'|'backfill';outcome:string;runId:number|null;summary:Record<string,unknown>};

const LEASE=900;
const COLLECT_HORIZON_MS=10*3600_000;
/** Extra margin beyond the 10-minute lock buffer for processing time inside one run. */
const COLLECT_LOCK_MARGIN_MS=OBSERVATION_RULES.lockBufferMs+10*60_000;
const q=encodeURIComponent;
const ago=(now:string,ms:number)=>new Date(Date.parse(now)-ms).toISOString();
const etDate=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
const inList=(xs:(string|number)[])=>'in.('+xs.map(x=>typeof x==='number'?String(x):'"'+String(x).replace(/["\\]/g,'')+'"').join(',')+')';
const chunk=<T,>(xs:T[],n:number)=>Array.from({length:Math.ceil(xs.length/n)},(_,i)=>xs.slice(i*n,i*n+n));

async function begin(d:CycleDeps,kind:'collect'|'settle'|'backfill',slot:string,scheduledFor:string|null){
 return d.store.rpc<{outcome:string;runId?:number;abandoned?:number;startDelaySeconds?:number|null}>('props_begin_run',
  {p_kind:kind,p_slot:slot,p_worker:d.worker,p_scheduled_for:scheduledFor,p_lease_seconds:LEASE});
}
async function finish(d:CycleDeps,runId:number,ok:boolean,outcome:string,summary:Record<string,unknown>){
 try{await d.store.rpc('props_finish_run',{p_run:runId,p_status:ok?'completed':'failed',p_outcome:outcome,p_summary:summary});}
 catch{/* lease lost: the next run records this one as abandoned */}
}
const heartbeat=(d:CycleDeps,runId:number)=>d.store.rpc<{control:string}>('props_heartbeat',{p_run:runId,p_lease_seconds:LEASE});

async function budgetState(d:CycleDeps):Promise<BudgetState>{
 const now=d.now();
 const rows=await d.store.select<{credits:number;reserved_at:string}>('props_credit_reservations',
  'select=credits,reserved_at&reserved_at=gt.'+q(ago(now,30*86400_000))+'&limit=10000');
 const dayAgo=Date.parse(now)-86400_000;
 const usage=await d.store.select<{requests_remaining:number}>('props_provider_usage',
  'select=requests_remaining&requests_remaining=not.is.null&order=recorded_at.desc,id.desc&limit=1');
 return {used24h:rows.filter(r=>Date.parse(r.reserved_at)>dayAgo).reduce((a,r)=>a+Number(r.credits),0),
  used30d:rows.reduce((a,r)=>a+Number(r.credits),0),providerRemaining:usage.length?Number(usage[0].requests_remaining):null};
}
/** Reserve, call once, record usage + raw evidence. Budget refusals and provider failures are explicit outcomes. */
async function paidCall(d:CycleDeps,runId:number,endpoint:'events'|'event_odds',eventId:string|null,credits:number,
 call:()=>ReturnType<PropsOddsClient['events']>){
 let reservation:number;
 try{reservation=await d.store.rpc<number>('props_reserve_credits',{p_run:runId,p_endpoint:endpoint,p_event:eventId,p_credits:credits});}
 catch(e){if(e instanceof PropsStoreError&&e.refused)return {kind:'refused' as const,code:e.code};throw e;}
 let reply;
 try{reply=await call();}
 catch(e){return {kind:'provider_error' as const,code:e instanceof ProviderError?e.code:'UNKNOWN'};}
 await d.store.rpc('props_record_usage',{p_reservation:reservation,p_http:reply.httpStatus,p_remaining:reply.usage.remaining,
  p_used:reply.usage.used,p_last:reply.usage.last});
 const rawId=await storeRaw(d,runId,'the_odds_api',endpoint,eventId??'nba',reply.httpStatus,reply.receivedAt,reply.body);
 return {kind:'reply' as const,reply,rawId};
}
async function storeRaw(d:CycleDeps,runId:number,source:string,endpoint:string,externalId:string,http:number,receivedAt:string,body:unknown){
 const hash=sha256(canonicalJson(body));
 const ins=await d.store.insert<{id:number}>('props_raw_responses',[{run_id:runId,source,endpoint,external_id:externalId,
  http_status:http,received_at:receivedAt,content_sha256:hash,body:body??{}}],
  {onConflict:'source,endpoint,external_id,content_sha256',ignoreDuplicates:true,select:'id'});
 if(ins.length)return Number(ins[0].id);
 const prior=await d.store.select<{id:number}>('props_raw_responses','select=id&source=eq.'+q(source)+'&endpoint=eq.'+q(endpoint)+
  '&external_id=eq.'+q(externalId)+'&content_sha256=eq.'+hash+'&limit=1');
 if(prior.length!==1)throw new PropsStoreError('RAW_EVIDENCE_UNRESOLVED',false);
 return Number(prior[0].id);
}

type PG={id:number;espn_event_id:string;athlete_id:string;athlete_name:string;team_abbr:string;game_start:string;game_status:string;
 did_not_play:boolean;minutes:number|null;points:number|null;rebounds:number|null;assists:number|null;revision:number;content_sha256:string};
const PG_COLS='id,espn_event_id,athlete_id,athlete_name,team_abbr,game_start,game_status,did_not_play,minutes,points,rebounds,assists,revision,content_sha256';
/** Latest revision per (event, athlete). */
function latest(rows:PG[]){const m=new Map<string,PG>();for(const r of rows){const k=r.espn_event_id+'|'+r.athlete_id;
 const p=m.get(k);if(!p||r.revision>p.revision)m.set(k,r);}return [...m.values()];}
const toLog=(r:PG):GameLog=>({gameStart:r.game_start,didNotPlay:r.did_not_play,minutes:r.minutes===null?null:Number(r.minutes),
 points:r.points,rebounds:r.rebounds,assists:r.assists});

// ============================================================== collect
export async function runCollect(d:CycleDeps,slot:string,scheduledFor:string|null):Promise<CycleResult>{
 const start=await begin(d,'collect',slot,scheduledFor);
 if(start.outcome!=='STARTED'||!start.runId)return {kind:'collect',outcome:start.outcome,runId:start.runId??null,summary:{...start}};
 const runId=start.runId;
 const s:Record<string,unknown>={startDelaySeconds:start.startDelaySeconds??null,abandonedRecovered:start.abandoned??0,
  modelVersion:MODEL_VERSION,selectionVersion:SELECTION_VERSION};
 try{
  if(!d.odds){await finish(d,runId,false,'ODDS_NOT_CONFIGURED',s);return {kind:'collect',outcome:'ODDS_NOT_CONFIGURED',runId,summary:s};}
  const odds=d.odds;
  const state=await budgetState(d);s.budgetBefore=state;
  if(!canSpend(ACTIVE_BUDGET_POLICY,state,EVENTS_LIST_COST+eventOddsWorstCost()).allowed){
   s.reason='budget_exhausted_before_start';await finish(d,runId,true,'BUDGET_EXHAUSTED',s);
   return {kind:'collect',outcome:'BUDGET_EXHAUSTED',runId,summary:s};
  }
  const ev=await paidCall(d,runId,'events',null,EVENTS_LIST_COST,()=>odds.events());
  if(ev.kind!=='reply'||!ev.reply.ok){
   s.events=ev.kind==='reply'?{httpStatus:ev.reply.httpStatus}:ev;
   const outcome=ev.kind==='refused'?'BUDGET_REFUSED':'PROVIDER_EVENTS_FAILED';
   await finish(d,runId,ev.kind==='refused',outcome,s);return {kind:'collect',outcome,runId,summary:s};
  }
  const listed=parseEventList(ev.reply.body,d.now());
  s.events={listed:listed.events.length,invalid:listed.invalid,startedOrPast:listed.startedOrPast};
  const done=await d.store.select<{external_id:string}>('props_raw_responses','select=external_id&source=eq.the_odds_api&endpoint=eq.event_odds'+
   '&received_at=gt.'+q(ago(d.now(),20*3600_000))+'&limit=2000');
  const after=await budgetState(d);
  const plan=chooseEvents({events:listed.events,alreadyCollected:new Set(done.map(r=>r.external_id)),nowIso:d.now(),
   lockBufferMs:COLLECT_LOCK_MARGIN_MS,horizonMs:COLLECT_HORIZON_MS,policy:ACTIVE_BUDGET_POLICY,state:after});
  s.plan={chosen:plan.chosen.map(e=>e.id),skipped:plan.skipped};
  const observed:{obs:ObsRow;event:ListedEvent}[]=[];
  const perEvent:Record<string,unknown>[]=[];
  const quotes:BookQuote[]=[];
  const bookQuotes:{inserted:number;byBook:Record<string,number>;error?:string}={inserted:0,byBook:Object.fromEntries(SPORTSBOOKS.map(b=>[b,0]))};
  for(const e of plan.chosen){
   await heartbeat(d,runId);
   const r=await paidCall(d,runId,'event_odds',e.id,eventOddsWorstCost(),()=>odds.eventOdds(e.id));
   if(r.kind!=='reply'){perEvent.push({event:e.id,outcome:r.kind,code:r.code});if(r.kind==='refused')break;continue;}
   if(!r.reply.ok){perEvent.push({event:e.id,outcome:'provider_http_'+r.reply.httpStatus});continue;}
   const norm=normalizePropEvent(r.reply.body,e,r.reply.receivedAt);
   const rows=norm.observations.map(o=>({run_id:runId,raw_response_id:r.rawId,provider:o.provider,platform:o.platform,
    bookmaker_key:o.bookmakerKey,provider_event_id:o.providerEventId,home_team:o.homeTeam,away_team:o.awayTeam,
    commence_time:o.commenceTime,lock_at:o.lockAt,player_name:o.playerName,stat:o.stat,market_key:o.marketKey,period:o.period,
    line:o.line,over_price:o.overPrice,under_price:o.underPrice,over_multiplier:o.overMultiplier,under_multiplier:o.underMultiplier,
    provider_last_update:o.providerLastUpdate,ingested_at:o.ingestedAt,normalizer_version:NORMALIZER_VERSION,
    response_sha256:o.responseSha256,source_fields:o.sourceFields}));
   const inserted=await d.store.insert<ObsRow>('props_observations',rows,
    {onConflict:'platform,provider_event_id,market_key,player_name,line,provider_last_update',ignoreDuplicates:true,select:OBS_COLS});
   inserted.forEach(o=>observed.push({obs:o,event:e}));
   if(!bookQuotes.error)try{
    const bq=normalizeBookQuotes(r.reply.body,e,r.reply.receivedAt);
    const qrows=bq.quotes.map(x=>({run_id:runId,raw_response_id:r.rawId,bookmaker_key:x.bookmakerKey,provider_event_id:x.providerEventId,
     player_name:x.playerName,stat:x.stat,market_key:x.marketKey,line:x.line,over_price:x.overPrice,under_price:x.underPrice,
     provider_last_update:x.providerLastUpdate,ingested_at:x.ingestedAt,lock_at:x.lockAt,response_sha256:x.responseSha256}));
    for(const part of chunk(qrows,200))await d.store.insert('props_book_quotes',part,
     {onConflict:'bookmaker_key,provider_event_id,market_key,player_name,line,provider_last_update',ignoreDuplicates:true});
    quotes.push(...bq.quotes);bookQuotes.inserted+=qrows.length;
    for(const x of bq.quotes)bookQuotes.byBook[x.bookmakerKey]++;
   }catch(err){bookQuotes.error=err instanceof PropsStoreError?err.code:'UNEXPECTED';}
   // Keyed platform:reason so one-sided or special lines can be traced to the platform that published them.
   const reasons:Record<string,number>={};for(const x of norm.rejected){const k=(x.platform??'unknown')+':'+x.reason;reasons[k]=(reasons[k]??0)+1;}
   perEvent.push({event:e.id,outcome:'stored',accepted:norm.observations.length,inserted:inserted.length,rejected:reasons,
    usage:r.reply.usage,byPlatform:Object.fromEntries(PLATFORMS.map(p=>[p,norm.observations.filter(o=>o.platform===p).length]))});
  }
  s.collection=perEvent;
  s.bookQuotes=bookQuotes;
  await heartbeat(d,runId);
  const active=await loadActiveModel(d.store);
  s.activeModel={version:active.version,fallback:active.fallback,controlAvailable:active.controlAvailable,shadows:active.shadows.map(x=>x.version)};
  const picked=await predictAndPick(d,runId,observed,quotes,active);
  s.predictions=picked.out;
  s.marketViews=await recordMarketViews(d,picked.views);
  if(picked.fallback)s.activeModel={...s.activeModel as object,fallback:true};
  s.entries=await recordEntries(d,runId,picked.out.selectionVersion);
  // Read back what was durably recorded in this run (the receipt, not the exit code).
  const [o,p,k]=await Promise.all(['props_observations','props_predictions','props_picks'].map(t=>
   d.store.select<{id:number}>(t,'select=id&run_id=eq.'+runId+'&limit=5000')));
  s.receipt={observations:o.length,predictions:p.length,picks:k.length};
  await finish(d,runId,true,'COMPLETED',s);
  return {kind:'collect',outcome:'COMPLETED',runId,summary:s};
 }catch(e){
  const code=e instanceof PropsStoreError?e.code:e instanceof ProviderError?e.code:'UNEXPECTED';
  s.error=code;await finish(d,runId,false,'FAILED_'+code.replace(/[^A-Z0-9_]/g,'_').slice(0,50),s);
  return {kind:'collect',outcome:'FAILED',runId,summary:s};
 }
}

type ObsRow={id:number;platform:Platform;provider_event_id:string;home_team:string;away_team:string;lock_at:string;
 player_name:string;stat:Stat;line:number;ingested_at:string};
const OBS_COLS='id,platform,provider_event_id,home_team,away_team,lock_at,player_name,stat,line,ingested_at';

type ViewRow={observation_id:number;run_id:number;books_at_same_line:number;p_more_books:number|null;nearest_book_line:number|null;
 line_gap:number|null;flags:string[]};
/** One market view per new observation, computed against the active model's side. Best-effort. */
async function recordMarketViews(d:CycleDeps,rows:ViewRow[]):Promise<{withBooks:number;without:number;flags:Record<string,number>;error?:string}>{
 const out:{withBooks:number;without:number;flags:Record<string,number>;error?:string}={withBooks:0,without:0,flags:{}};
 for(const v of rows){
  if(v.books_at_same_line)out.withBooks++;else out.without++;
  for(const f of v.flags)out.flags[f]=(out.flags[f]??0)+1;
 }
 try{for(const part of chunk(rows,200))await d.store.insert('props_market_views',part,{onConflict:'observation_id',ignoreDuplicates:true});}
 catch(err){out.error=err instanceof PropsStoreError?err.code:'UNEXPECTED';}
 return out;
}

async function predictAndPick(d:CycleDeps,runId:number,observed:{obs:ObsRow;event:ListedEvent}[],quotes:BookQuote[],active:ActiveModel){
 const out={scored:0,unscorable:{} as Record<string,number>,recorded:0,skipped:{} as Record<string,number>,
  learn:{} as Record<string,number>,selectionVersion:active.artifact?SELECTION_VERSION_V2:SELECTION_VERSION as string,learnError:undefined as string|undefined};
 const views:ViewRow[]=[];
 if(!observed.length)return {out,views,fallback:false};
 const teams=[...new Set(observed.flatMap(x=>[teamAbbr(x.event.homeTeam),teamAbbr(x.event.awayTeam)]).filter((t):t is string=>!!t))];
 const roster=teams.length?latest(await d.store.select<PG>('props_player_games','select='+PG_COLS+'&team_abbr='+inList(teams)+
  '&game_start=gte.'+q(d.seasonStart)+'&order=game_start.asc&limit=10000')):[];
 const predRows:Record<string,unknown>[]=[];
 const meta=new Map<number,{athlete:string|null;team:string|null}>();
 const logsCache=new Map<string,GameLog[]>();
 for(const {obs,event} of observed){
  const cutoff=obs.ingested_at;
  const cands=new Map<string,RosterCandidate>();
  for(const r of roster){if(Date.parse(r.game_start)>=Date.parse(cutoff))continue;
   const c=cands.get(r.athlete_id);if(!c||r.game_start>c.lastGame)cands.set(r.athlete_id,{athleteId:r.athlete_id,name:r.athlete_name,teamAbbr:r.team_abbr,lastGame:r.game_start});}
  const m=matchPlayer(obs.player_name,[event.homeTeam,event.awayTeam],[...cands.values()]);
  let row:Record<string,unknown>;
  if(m.status!=='matched'){
   row={status:'unscorable',reason:'identity_'+m.reason,athlete_id:null,p_more:null,p_less:null,p_tie:null,mean:null,inputs:{player:obs.player_name}};
   meta.set(obs.id,{athlete:null,team:null});
  }else{
   let logs=logsCache.get(m.athleteId);
   if(!logs){
    logs=latest(await d.store.select<PG>('props_player_games','select='+PG_COLS+'&athlete_id=eq.'+m.athleteId+
     '&game_start=gte.'+q(d.seasonStart)+'&order=game_start.asc&limit=200')).filter(r=>r.game_status==='final').map(toLog);
    logsCache.set(m.athleteId,logs);
   }
   const pr=d.model.players[m.athleteId];
   const prior:PriorSummary|null=pr?{games:pr.games,minutes:pr.minutes,points:pr.points,rebounds:pr.rebounds,assists:pr.assists}:null;
   const p=predictLine({logs,prior,stat:obs.stat,line:Number(obs.line),cutoff,params:d.model.params});
   // The team is kept with the prediction so the learning loop never has to guess it later.
   row=p.status==='scored'?{status:'scored',reason:'ok',athlete_id:m.athleteId,p_more:p.pMore,p_less:p.pLess,p_tie:p.pTie,mean:p.mean,inputs:{...p.inputs,team:m.teamAbbr}}
    :{status:'unscorable',reason:p.reason,athlete_id:m.athleteId,p_more:null,p_less:null,p_tie:null,mean:null,inputs:{...p.inputs,team:m.teamAbbr}};
   meta.set(obs.id,{athlete:m.athleteId,team:m.teamAbbr});
  }
  if(row.status==='scored')out.scored++;else out.unscorable[row.reason as string]=(out.unscorable[row.reason as string]??0)+1;
  predRows.push({observation_id:obs.id,run_id:runId,model_version:MODEL_VERSION,data_cutoff:cutoff,...row});
 }
 type PredRow={id:number;observation_id:number;model_version:string;status:'scored'|'unscorable';p_more:number|null;p_less:number|null;p_tie:number|null};
 const insertPreds=async(rows:Record<string,unknown>[])=>{const got:PredRow[]=[];
  for(const part of chunk(rows,200))got.push(...await d.store.insert<PredRow>('props_predictions',part,
   {onConflict:'observation_id,model_version',ignoreDuplicates:true,select:'id,observation_id,model_version,status,p_more,p_less,p_tie'}));
  return got;};
 const preds=await insertPreds(predRows);
 const probs=(p:PredRow)=>({pMore:Number(p.p_more),pLess:Number(p.p_less),pTie:Number(p.p_tie)});
 const byObs=new Map(observed.map(x=>[x.obs.id,x]));
 const obsInfo=(o:ObsRow)=>({providerEventId:o.provider_event_id,playerName:o.player_name,stat:o.stat,line:Number(o.line)});

 // Learning layer: the active learn model and every shadowing challenger score each scored line before lock.
 const learners=[...(active.artifact?[{version:active.version,artifact:active.artifact}]:[]),...active.shadows];
 const learnPreds=new Map<number,PredRow>();
 let useLearn=!!active.artifact,fallback=false;
 // Best-effort: a learning-layer failure never costs the run its picks. Shadows are skipped;
 // an active learning model falls back to the stats model (and its accounts) for this run.
 if(learners.length)try{
  const teamRows=await loadTeamRows(d.store,ago(d.now(),95*86400_000));
  const learnRows:Record<string,unknown>[]=[];
  for(const p of preds){
   const x=byObs.get(p.observation_id);const m=meta.get(p.observation_id);
   if(p.status!=='scored'||!x||!m?.team)continue;
   const home=teamAbbr(x.event.homeTeam),away=teamAbbr(x.event.awayTeam);
   const opponent=m.team===home?away:home;
   if(!home||!away||!opponent)continue;
   const cutoff=x.obs.ingested_at;
   const matchup=matchupFeatures({teamAbbr:m.team,opponentAbbr:opponent,home:m.team===home,lockAt:cutoff,stat:x.obs.stat,rows:teamRows});
   const market=marketView(obsInfo(x.obs),quotes,null);
   const base=probs(p);
   const v1=predRows.find(r=>r.observation_id===p.observation_id)!;
   for(const l of learners){
    const lp=predictLearn(l.artifact,x.obs.stat,{base,market,matchup});
    learnRows.push({observation_id:p.observation_id,run_id:runId,model_version:l.version,data_cutoff:cutoff,status:'scored',reason:'ok',
     athlete_id:m.athlete,p_more:lp.pMore,p_less:lp.pLess,p_tie:lp.pTie,mean:v1.mean,
     inputs:{matchup,booksAtSameLine:market.booksAtSameLine,pMoreBooks:market.pMoreBooks,lineGap:market.lineGap}});
    out.learn[l.version]=(out.learn[l.version]??0)+1;
   }
  }
  for(const r of await insertPreds(learnRows))if(r.model_version===active.version)learnPreds.set(r.observation_id,r);
 }catch(err){
  out.learnError=err instanceof PropsStoreError?err.code:'UNEXPECTED';
  if(useLearn){useLearn=false;fallback=true;learnPreds.clear();out.selectionVersion=SELECTION_VERSION;}
 }

 // Picks come from the active model only: layer 1 under props-select-v1, a learn model under props-select-v2.
 const pickRows:Record<string,unknown>[]=[];
 for(const p of preds){
  const x=byObs.get(p.observation_id)!;
  const chosen=useLearn?learnPreds.get(p.observation_id)??null:p;
  const scored=chosen&&chosen.status==='scored';
  const side=scored?(Number(chosen.p_more)>=Number(chosen.p_less)?'more':'less'):null;
  const view:MarketView=marketView(obsInfo(x.obs),quotes,side);
  views.push({observation_id:p.observation_id,run_id:runId,books_at_same_line:view.booksAtSameLine,p_more_books:view.pMoreBooks,
   nearest_book_line:view.nearestBookLine,line_gap:view.lineGap,flags:view.flags});
  if(useLearn&&!chosen){out.skipped.unscorable=(out.skipped.unscorable??0)+1;continue;}
  const target=chosen??p;
  const input={status:target.status,pMore:target.p_more===null?null:Number(target.p_more),
   pLess:target.p_less===null?null:Number(target.p_less),pTie:target.p_tie===null?null:Number(target.p_tie)};
  const dec=useLearn?decidePickV2(input,view):decidePick(input);
  if(dec.status==='recorded')out.recorded++;else out.skipped[dec.reason]=(out.skipped[dec.reason]??0)+1;
  pickRows.push({prediction_id:target.id,run_id:runId,selection_version:out.selectionVersion,status:dec.status,side:dec.side,reason:dec.reason});
 }
 for(const part of chunk(pickRows,200))await d.store.insert('props_picks',part,{onConflict:'prediction_id,selection_version',ignoreDuplicates:true});
 return {out,views,fallback};
}

async function recordEntries(d:CycleDeps,runId:number,selectionVersion:string){
 const now=d.now();
 const accounts=await d.store.select<{id:number;platform:Platform;max_entries_per_day:number;picks_per_entry:number}>('props_accounts',
  'select=id,platform,max_entries_per_day,picks_per_entry&selection_version=eq.'+selectionVersion+'&limit=10');
 const picks=await d.store.select<{id:number;prediction_id:number}>('props_picks','select=id,prediction_id&status=eq.recorded'+
  '&selection_version=eq.'+selectionVersion+'&decided_at=gt.'+q(ago(now,36*3600_000))+'&limit=2000');
 const result:Record<string,unknown>={};
 if(!picks.length){for(const a of accounts)result[a.platform]={recorded:0,reason:'no_recorded_picks'};return result;}
 const legs=await d.store.select<{pick_id:number}>('props_entry_legs','select=pick_id&pick_id='+inList(picks.map(p=>p.id))+'&limit=2000');
 const used=new Set(legs.map(l=>Number(l.pick_id)));
 const open=picks.filter(p=>!used.has(Number(p.id)));
 const preds=open.length?await d.store.select<{id:number;observation_id:number;athlete_id:string;p_more:number;p_less:number}>('props_predictions',
  'select=id,observation_id,athlete_id,p_more,p_less&id='+inList(open.map(p=>p.prediction_id))+'&limit=2000'):[];
 const obs=preds.length?await d.store.select<ObsRow>('props_observations','select='+OBS_COLS+'&id='+inList(preds.map(p=>p.observation_id))+'&limit=2000'):[];
 const sides=await d.store.select<{id:number;side:'more'|'less'}>('props_picks','select=id,side&id='+inList(open.map(p=>p.id))+'&limit=2000');
 const cands=open.flatMap(p=>{const pr=preds.find(x=>x.id===p.prediction_id);const o=pr&&obs.find(x=>x.id===pr.observation_id);
  const side=sides.find(x=>x.id===p.id)?.side;if(!pr||!o||!side)return [];
  return [{pickId:Number(p.id),platform:o.platform,eventId:o.provider_event_id,playerKey:pr.athlete_id??playerKey(o.player_name),
   teamAbbr:'',probability:Number(side==='more'?pr.p_more:pr.p_less),lockAt:o.lock_at}];});
 const todayStart=etMidnightUtc(now);
 for(const a of accounts){
  const today=await d.store.select<{id:number}>('props_entries','select=id&account_id=eq.'+a.id+'&created_at=gte.'+q(todayStart)+'&limit=50');
  const room=Math.max(0,a.max_entries_per_day-today.length);
  const planned=buildEntries(cands,{platform:a.platform,picksPerEntry:a.picks_per_entry,maxEntries:room,nowIso:now,
   lockBufferMs:OBSERVATION_RULES.lockBufferMs});
  const done:unknown[]=[];
  for(const legsPlanned of planned){
   try{done.push(await d.store.rpc('props_record_entry',{p_account:a.id,p_run:runId,p_picks:legsPlanned.map(l=>l.pickId),
    p_entry_type:a.platform==='prizepicks'?'power':'pick6_standard',
    p_payout_terms:a.platform==='prizepicks'?PRIZEPICKS_TERMS_V1.version:null}));}
   catch(e){if(e instanceof PropsStoreError&&e.refused){done.push({outcome:'REFUSED',code:e.code});continue;}throw e;}
  }
  result[a.platform]={room,eligiblePicks:cands.filter(c=>c.platform===a.platform).length,entries:done};
 }
 return result;
}
/** UTC instant of the most recent midnight in New York. */
function etMidnightUtc(now:string){
 const day=etDate(now);
 for(const off of [4,5]){const t=new Date(`${day}T00:00:00Z`);t.setUTCHours(off);if(etDate(t.toISOString())===day&&
  etDate(new Date(t.getTime()-1).toISOString())!==day)return t.toISOString();}
 return new Date(`${day}T05:00:00Z`).toISOString();
}

// ============================================================== settle / backfill
export async function runSettle(d:CycleDeps,slot:string,scheduledFor:string|null,opts:{kind?:'settle'|'backfill';dates?:string[]}={}):Promise<CycleResult>{
 const kind=opts.kind??'settle';
 const start=await begin(d,kind,slot,scheduledFor);
 if(start.outcome!=='STARTED'||!start.runId)return {kind,outcome:start.outcome,runId:start.runId??null,summary:{...start}};
 const runId=start.runId;const now=d.now();
 const s:Record<string,unknown>={startDelaySeconds:start.startDelaySeconds??null,abandonedRecovered:start.abandoned??0};
 try{
  // Observations awaiting a result (locked within the last 7 days).
  const pending=await d.store.select<ObsRow>('props_observations','select='+OBS_COLS+'&lock_at=lt.'+q(now)+
   '&lock_at=gt.'+q(ago(now,7*86400_000))+'&order=lock_at.asc&limit=5000');
  const results=pending.length?await d.store.select<{observation_id:number;player_game_id:number|null;revision:number;outcome:LineOutcome}>(
   'props_line_results','select=observation_id,player_game_id,revision,outcome&observation_id='+inList(pending.map(o=>o.id))+'&limit=10000'):[];
  const dates=opts.dates??[...new Set([etDate(ago(now,86400_000)),etDate(now),...pending.map(o=>etDate(o.lock_at))])].sort().slice(-8);
  const games:ScoreboardGame[]=[];
  let fetchedSummaries=0,newRows=0,corrections=0,incomplete=0;const scoreboardFailures:string[]=[];
  for(const day of dates){
   await heartbeat(d,runId);
   const sb=await d.espn.scoreboard(day.replace(/-/g,''));
   if(!sb.ok){scoreboardFailures.push(day);continue;}
   await storeRaw(d,runId,'espn_scoreboard','scoreboard',day.replace(/-/g,''),sb.httpStatus,sb.receivedAt,sb.body);
   games.push(...parseScoreboard(sb.body));
  }
  const complete=new Set<string>();
  for(const g of games.filter(g=>g.status==='final'&&Date.parse(g.start)<Date.parse(now))){
   const stored=latest(await d.store.select<PG>('props_player_games','select='+PG_COLS+'&espn_event_id=eq.'+g.espnEventId+'&limit=100'));
   // Fetch new finals, and re-check once-stored games within 30h for stat corrections.
   if(stored.length&&Date.parse(now)-Date.parse(g.start)>30*3600_000){complete.add(g.espnEventId);continue;}
   const r=await d.espn.summary(g.espnEventId);fetchedSummaries++;
   if(!r.ok)continue;
   const parsed=parseSummary(r.body,g.espnEventId);
   if(parsed.status!=='final'||parsed.rejectedRows>0||!parsed.players.length){incomplete++;continue;}
   const trimmed=trimSummary(r.body);
   await storeRaw(d,runId,'espn_summary','summary',g.espnEventId,r.httpStatus,r.receivedAt,trimmed);
   const rows:Record<string,unknown>[]=[];
   for(const p of parsed.players){
    const hash=sha256(canonicalJson(p));
    const prev=stored.find(x=>x.athlete_id===p.athleteId);
    if(prev&&prev.content_sha256===hash)continue;
    if(prev)corrections++;
    rows.push({source:'espn_summary',espn_event_id:p.espnEventId,athlete_id:p.athleteId,athlete_name:p.athleteName,team_abbr:p.teamAbbr,
     opponent_abbr:p.opponentAbbr,game_start:p.gameStart,game_status:'final',did_not_play:p.didNotPlay,dnp_reason:p.dnpReason,
     minutes:p.minutes===null?null:Math.round(p.minutes*100)/100,points:p.points,rebounds:p.rebounds,assists:p.assists,
     retrieved_at:r.receivedAt,content_sha256:hash,revision:prev?prev.revision+1:1});
   }
   for(const part of chunk(rows,200))newRows+=(await d.store.insert<{id:number}>('props_player_games',part,
    {onConflict:'source,espn_event_id,athlete_id,revision',ignoreDuplicates:true,select:'id'})).length;
   complete.add(g.espnEventId);
  }
  s.boxScores={dates,games:games.length,fetchedSummaries,newRows,corrections,incomplete,scoreboardFailures};

  // Link provider events to ESPN games (teams + start within 2h), then grade.
  const links=pending.length?await d.store.select<{provider_event_id:string;espn_event_id:string}>('props_game_links',
   'select=provider_event_id,espn_event_id&provider_event_id='+inList([...new Set(pending.map(o=>o.provider_event_id))])+'&limit=1000'):[];
  const linkMap=new Map(links.map(l=>[l.provider_event_id,l.espn_event_id]));
  const newLinks:Record<string,unknown>[]=[];
  for(const o of pending){
   if(linkMap.has(o.provider_event_id))continue;
   const h=teamAbbr(o.home_team),a=teamAbbr(o.away_team);
   const m=games.filter(g=>g.homeAbbr===h&&g.awayAbbr===a&&Math.abs(Date.parse(g.start)-Date.parse(o.lock_at))<=2*3600_000);
   if(m.length!==1)continue;
   linkMap.set(o.provider_event_id,m[0].espnEventId);
   newLinks.push({provider_event_id:o.provider_event_id,espn_event_id:m[0].espnEventId,home_abbr:h,away_abbr:a,provider_start:o.lock_at,espn_start:m[0].start});
  }
  if(newLinks.length)await d.store.insert('props_game_links',newLinks,{onConflict:'provider_event_id',ignoreDuplicates:true});
  const preds=pending.length?await d.store.select<{observation_id:number;athlete_id:string|null}>('props_predictions',
   'select=observation_id,athlete_id&model_version=eq.'+MODEL_VERSION+'&observation_id='+inList(pending.map(o=>o.id))+'&limit=10000'):[];
  const graded:Record<string,number>={},waiting:Record<string,number>={};const newResults:Record<string,unknown>[]=[];
  for(const o of pending){
   const espnId=linkMap.get(o.provider_event_id);
   const game=espnId?games.find(g=>g.espnEventId===espnId)??null:null;
   const box=espnId?latest(await d.store.select<PG>('props_player_games','select='+PG_COLS+'&espn_event_id=eq.'+espnId+'&limit=100')):[];
   let athlete=preds.find(p=>p.observation_id===o.id)?.athlete_id??null;
   if(!athlete&&box.length){
    const m=matchPlayer(o.player_name,[o.home_team,o.away_team],box.map(b=>({athleteId:b.athlete_id,name:b.athlete_name,teamAbbr:b.team_abbr,lastGame:b.game_start})));
    athlete=m.status==='matched'?m.athleteId:null;
    if(m.status!=='matched'&&m.reason!=='player_not_found'){waiting.identity_unresolved=(waiting.identity_unresolved??0)+1;continue;}
   }
   const row=athlete?box.find(b=>b.athlete_id===athlete)??null:null;
   const g=gradeLine({line:Number(o.line),stat:o.stat,lockAt:o.lock_at,nowIso:now,game:game?{status:game.status}:null,
    player:row?{didNotPlay:row.did_not_play,points:row.points,rebounds:row.rebounds,assists:row.assists}:null,
    boxComplete:!!espnId&&complete.has(espnId)&&box.length>0});
   if(g.state==='pending'){waiting[g.reason]=(waiting[g.reason]??0)+1;continue;}
   const prior=results.filter(r=>r.observation_id===o.id).sort((x,y)=>y.revision-x.revision)[0];
   const pgId=row?Number(row.id):null;
   if(prior&&prior.outcome===g.outcome&&(prior.player_game_id===null?null:Number(prior.player_game_id))===pgId)continue;
   graded[g.outcome]=(graded[g.outcome]??0)+1;
   newResults.push({observation_id:o.id,player_game_id:g.outcome==='void_postponed'?null:pgId,revision:prior?prior.revision+1:1,actual:g.actual,outcome:g.outcome});
  }
  for(const part of chunk(newResults,200))await d.store.insert('props_line_results',part,{onConflict:'observation_id,revision',ignoreDuplicates:true});
  s.grading={pendingLines:pending.length,newResults:newResults.length,graded,waiting,newLinks:newLinks.length};
  s.settlement=await settleEntries(d);
  // Safety brake: best-effort; a failure here never fails grading or settlement.
  try{s.safetyBrake=await checkSafetyBrake(d.store,d.now());}
  catch(err){s.safetyBrake={error:err instanceof PropsStoreError?err.code:'UNEXPECTED'};}
  await finish(d,runId,true,'COMPLETED',s);
  return {kind,outcome:'COMPLETED',runId,summary:s};
 }catch(e){
  const code=e instanceof PropsStoreError?e.code:'UNEXPECTED';
  s.error=code;await finish(d,runId,false,'FAILED_'+code.replace(/[^A-Z0-9_]/g,'_').slice(0,50),s);
  return {kind,outcome:'FAILED',runId,summary:s};
 }
}

async function settleEntries(d:CycleDeps){
 const entries=await d.store.select<{id:number;account_id:number;stake_cents:number}>('props_entries','select=id,account_id,stake_cents&order=id.asc&limit=2000');
 const settled=entries.length?await d.store.select<{entry_id:number}>('props_entry_settlements','select=entry_id&limit=5000'):[];
 const open=entries.filter(e=>!settled.some(x=>Number(x.entry_id)===Number(e.id)));
 if(!open.length)return {open:0,settled:0};
 const accounts=await d.store.select<{id:number;platform:Platform}>('props_accounts','select=id,platform&limit=10');
 const legs=await d.store.select<{entry_id:number;pick_id:number}>('props_entry_legs','select=entry_id,pick_id&entry_id='+inList(open.map(e=>e.id))+'&limit=5000');
 const picks=legs.length?await d.store.select<{id:number;prediction_id:number;side:'more'|'less'}>('props_picks','select=id,prediction_id,side&id='+inList(legs.map(l=>l.pick_id))+'&limit=5000'):[];
 const preds=picks.length?await d.store.select<{id:number;observation_id:number}>('props_predictions','select=id,observation_id&id='+inList(picks.map(p=>p.prediction_id))+'&limit=5000'):[];
 const res=preds.length?await d.store.select<{observation_id:number;revision:number;outcome:LineOutcome}>('props_line_results',
  'select=observation_id,revision,outcome&observation_id='+inList(preds.map(p=>p.observation_id))+'&limit=10000'):[];
 let n=0;const waiting:number[]=[];
 for(const e of open){
  const results=legs.filter(l=>Number(l.entry_id)===Number(e.id)).map(l=>{
   const pk=picks.find(p=>Number(p.id)===Number(l.pick_id));const pr=pk&&preds.find(p=>Number(p.id)===Number(pk.prediction_id));
   const r=pr&&res.filter(x=>Number(x.observation_id)===Number(pr.observation_id)).sort((a,b)=>b.revision-a.revision)[0];
   return pk&&r?legResult(pk.side,r.outcome):null;});
  if(results.some(r=>r===null)||!results.length){waiting.push(Number(e.id));continue;}
  const platform=accounts.find(a=>Number(a.id)===Number(e.account_id))!.platform;
  const st=settleEntry(platform,Number(e.stake_cents),results as ('win'|'loss'|'void')[]);
  await d.store.rpc('props_record_settlement',{p_entry:e.id,p_outcome:st.outcome,p_multiplier_milli:st.multiplierMilli,
   p_return_cents:st.returnCents,p_terms:st.termsVersion});
  n++;
 }
 return {open:open.length,settled:n,waitingOnResults:waiting.length};
}
