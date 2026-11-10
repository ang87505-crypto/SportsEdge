/**
 * NBA player-prop PAPER worker (GitHub Actions or a manual shell).
 *   node --experimental-strip-types scripts/props-worker.ts <kind> [options]
 *     collect                      price upcoming games, predict, record picks/entries before lock
 *     settle                       box scores -> grade lines -> settle entries
 *     backfill --from D --to D     current-season box scores (player logs), at most 25 dates
 *     status                       read-only: control, recent runs, budget
 *     pause|resume|stop --reason   owner control (never from a schedule)
 * Scheduled firings exit before any network call while PROPS_RELEASE is OFF.
 * Output: one JSON line without credentials. Exit 1 when the owner must look.
 */
import {readFileSync} from 'node:fs';
import {propsStore,PropsStoreError} from '../src/lib/server/props-store.ts';
import {theOddsApiClient} from '../src/lib/server/props-odds-client.ts';
import {espnClient} from '../src/lib/server/props-espn-client.ts';
import {runCollect,runSettle,type ModelArtifact,type CycleDeps} from '../src/lib/server/props-cycle.ts';
import {PROPS_RELEASE,scheduledInstant,slotKey,slotCronMatches} from '../src/lib/props/schedule.ts';
import {MODEL_VERSION,PROPS_SEASON_START} from '../src/lib/props/contract.ts';

function emit(v:Record<string,unknown>,code:number):never{process.stdout.write(JSON.stringify(v)+'\n');process.exit(code);}
const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:undefined;};
const kind=process.argv[2]??'';
const KINDS=['collect','settle','backfill','status','pause','resume','stop'];
if(!KINDS.includes(kind))emit({status:'USAGE',usage:'props-worker.ts <'+KINDS.join('|')+'>'},2);
// A backup trigger (the Vercel scheduler) may dispatch a run for a named scheduled slot. It gets the same
// slot key as the GitHub schedule, so whichever starts second is recorded as DUPLICATE and does nothing.
const slotDispatch=process.env.GITHUB_EVENT_NAME==='workflow_dispatch'&&!!process.env.SCHEDULE_CRON;
const scheduled=process.env.GITHUB_EVENT_NAME==='schedule'||slotDispatch;
if(scheduled&&!['collect','settle'].includes(kind))emit({status:'OWNER_ACTION_NOT_SCHEDULABLE',kind},1);
if(slotDispatch&&!slotCronMatches(kind,process.env.SCHEDULE_CRON??''))emit({status:'UNKNOWN_SCHEDULE',kind,cron:process.env.SCHEDULE_CRON},1);
if(scheduled&&(PROPS_RELEASE.scheduledRunsEnabled as boolean)!==true)emit({status:'SCHEDULED_RUNS_RELEASED_OFF',kind,providerCalls:0},0);
if(!PROPS_RELEASE.paperOnly||PROPS_RELEASE.realMoneyEnabled)emit({status:'RELEASE_INVALID'},1);

const now=()=>new Date().toISOString();
const worker=('gha:'+(process.env.GITHUB_RUN_ID??'local')+':'+(process.env.GITHUB_RUN_ATTEMPT??'1')).slice(0,100);
let store;
try{store=propsStore();}catch(e){emit({status:'NOT_CONFIGURED',kind,detail:e instanceof PropsStoreError?e.code:'UNKNOWN'},1);}
try{
 if(kind==='status'){
  const [control,runs,credits]=await Promise.all([
   store.select('props_control','select=state,reason,changed_at&id=eq.1'),
   store.select('props_runs','select=id,kind,slot_key,status,outcome,started_at,finished_at,start_delay_seconds&order=id.desc&limit=8'),
   store.select<{credits:number;reserved_at:string}>('props_credit_reservations','select=credits,reserved_at&reserved_at=gt.'+
    encodeURIComponent(new Date(Date.now()-30*86400_000).toISOString())+'&limit=10000')]);
  const dayAgo=Date.now()-86400_000;
  emit({status:'OK',control:control[0]??null,runs,credits24h:credits.filter(c=>Date.parse(c.reserved_at)>dayAgo).reduce((a,c)=>a+Number(c.credits),0),
   credits30d:credits.reduce((a,c)=>a+Number(c.credits),0)},0);
 }
 if(['pause','resume','stop'].includes(kind)){
  const reason=(arg('reason')??'').trim();
  if(reason.length<3||reason.length>300)emit({status:'USAGE',usage:kind+' requires --reason "<3-300 chars>"'},2);
  const actor=('owner:'+(process.env.GITHUB_ACTOR??'local')).toLowerCase().replace(/[^a-z0-9:._-]/g,'-').slice(0,100);
  const state={pause:'PAUSED',resume:'RUNNING',stop:'STOPPED'}[kind as 'pause'|'resume'|'stop'];
  emit({status:'CONTROL_SET',...await store.rpc<Record<string,unknown>>('props_set_control',{p_state:state,p_reason:reason,p_actor:actor})},0);
 }
 const model=JSON.parse(readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url),'utf8')) as ModelArtifact;
 if(model.modelVersion!==MODEL_VERSION)emit({status:'MODEL_ARTIFACT_MISMATCH'},1);
 const key=process.env.ODDS_API_KEY??'';
 const deps:CycleDeps={store,odds:kind==='collect'&&key?theOddsApiClient(key):null,espn:espnClient(),model,now,worker,seasonStart:PROPS_SEASON_START};
 const cron=process.env.SCHEDULE_CRON??'';
 const scheduledFor=scheduled?scheduledInstant(cron,now()):null;
 if(scheduled&&!scheduledFor)emit({status:'UNKNOWN_SCHEDULE',cron},1);
 const slot=(arg('slot')??(scheduledFor?slotKey(kind,scheduledFor):`${kind}-manual-${process.env.GITHUB_RUN_ID??Date.now()}`)).slice(0,80);
 let result;
 if(kind==='collect')result=await runCollect(deps,slot,scheduledFor);
 else if(kind==='settle')result=await runSettle(deps,slot,scheduledFor);
 else{
  const from=arg('from')??'',to=arg('to')??'';
  if(!/^\d{4}-\d\d-\d\d$/.test(from)||!/^\d{4}-\d\d-\d\d$/.test(to)||from>to)emit({status:'USAGE',usage:'backfill --from YYYY-MM-DD --to YYYY-MM-DD'},2);
  const dates:string[]=[];
  for(let t=Date.parse(from+'T12:00:00Z');t<=Date.parse(to+'T12:00:00Z');t+=86400_000)dates.push(new Date(t).toISOString().slice(0,10));
  if(dates.length>25)emit({status:'USAGE',usage:'at most 25 dates per backfill'},2);
  result=await runSettle(deps,slot,null,{kind:'backfill',dates});
 }
 const attention=['FAILED','ODDS_NOT_CONFIGURED'].includes(result.outcome)||result.outcome.startsWith('FAILED');
 if(attention)process.stdout.write(`::warning::props ${kind} ${result.outcome}\n`);
 emit({status:result.outcome,kind,runId:result.runId,slot,summary:result.summary},attention?1:0);
}catch(e){
 emit({status:'WORKER_ERROR',kind,error:e instanceof PropsStoreError?e.code:e instanceof Error?e.name:'unknown'},1);
}
