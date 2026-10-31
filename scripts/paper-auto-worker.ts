/**
 * Recurring Alpaca PAPER worker entry point (GitHub Actions or a manual shell).
 *   node --experimental-strip-types scripts/paper-auto-worker.ts <kind> --experiment <id>
 *     kinds: execute | reconcile | monitor [--session YYYY-MM-DD] | decision --decision-file <path>
 *            | context --output <path>  (registration and held securities for the signal bridge)
 *     owner: register  (reviewed config/paper-auto/<id>.json; the account must be flat and dedicated)
 *            | confirm-absent --intent <pai-...>  (after the close; lookup and complete history first)
 *            | resume  (a fresh reconcile, then the database's own resume against that exact run)
 *     Owner kinds need SPORTSEDGE_PAPER_AUTO_OWNER_REF and never run from a schedule.
 * Scheduler-triggered runs are refused before any network call while the release
 * manifest is OFF. Broker writes stay OFF in source, so an execute run with the
 * checked-in manifest records a shadow plan and never reserves or sends an order.
 * Output is one JSON line without credentials. Exit 1 when the owner must act.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {PAPER_AUTO_RELEASE} from '../src/lib/stocks/paper-auto-release.ts';
import {alpacaPaperAutoBroker} from '../src/lib/server/paper-auto-broker.ts';
import {stagingPaperAutoStore} from '../src/lib/server/paper-auto-store.ts';
import {runExecuteSlot,runReconcileSlot,runMonitorSlot,recordDecisionSlot,registerExperiment,confirmIntentAbsent,
 parseRegistrationConfig,type ControllerDeps,type DecisionInput,type SlotResult} from '../src/lib/server/paper-auto-controller.ts';
import {PaperAutoStoreError} from '../src/lib/server/paper-auto-store.ts';
import {nyDate,quarterHourSlot} from '../src/lib/server/paper-auto-time.ts';

function emit(v:Record<string,unknown>,code:number):never{
 process.stdout.write(JSON.stringify(v)+'\n');
 process.exit(code);
}
function arg(name:string):string|undefined{
 const k=process.argv.indexOf('--'+name);
 return k>0?process.argv[k+1]:undefined;
}
const kind=process.argv[2];
const experimentId=arg('experiment')??'';
const OWNER_KINDS=['register','confirm-absent','resume'];
if(!['execute','reconcile','monitor','decision','context',...OWNER_KINDS].includes(kind??'')||
 !/^[a-z0-9][a-z0-9-]{2,62}$/.test(experimentId))
 emit({status:'USAGE',usage:'paper-auto-worker.ts <execute|reconcile|monitor|decision|context|register|'+
  'confirm-absent|resume> --experiment <id>'},2);
const ownerRef=process.env.SPORTSEDGE_PAPER_AUTO_OWNER_REF??'';
if(OWNER_KINDS.includes(kind)){
 if(process.env.GITHUB_EVENT_NAME==='schedule')emit({status:'OWNER_ACTION_NOT_SCHEDULABLE',kind,experimentId},1);
 if(!/^owner-[a-f0-9]{32}$/.test(ownerRef))emit({status:'OWNER_REF_REQUIRED',kind,experimentId},1);
}
if(process.env.GITHUB_EVENT_NAME==='schedule'&&(PAPER_AUTO_RELEASE.scheduledRunsEnabled as boolean)!==true)
 emit({status:'SCHEDULED_RUNS_RELEASED_OFF',kind,experimentId,brokerCalls:0},0);
if(!PAPER_AUTO_RELEASE.paperOnly||PAPER_AUTO_RELEASE.realMoneyEnabled)emit({status:'RELEASE_INVALID'},1);
const keyId=process.env.ALPACA_PAPER_AUTO_KEY_ID??'',secretKey=process.env.ALPACA_PAPER_AUTO_SECRET_KEY??'';
/** Decision recording never needs the broker; any accidental use fails closed. */
const noBroker=new Proxy({},{get:(_,k)=>k==='writesEnabled'?false:()=>{throw Error('BROKER_NOT_AVAILABLE');}});
let deps:ControllerDeps;
try{
 deps={store:stagingPaperAutoStore(),
  broker:kind==='decision'||kind==='context'?noBroker as ReturnType<typeof alpacaPaperAutoBroker>
   :alpacaPaperAutoBroker({keyId,secretKey}),
  now:()=>Date.now(),sleep:(ms:number)=>new Promise<void>(r=>setTimeout(r,ms)),
  worker:('gha:'+(process.env.GITHUB_RUN_ID??'local')+':'+(process.env.GITHUB_RUN_ATTEMPT??'1')).slice(0,100)};
}catch{emit({status:'NOT_CONFIGURED',kind,experimentId},1);}
let result:SlotResult;
try{
 const now=Date.now();
 if(kind==='execute')result=await runExecuteSlot(deps,experimentId,quarterHourSlot(now));
 else if(kind==='reconcile')result=await runReconcileSlot(deps,experimentId,quarterHourSlot(now));
 else if(kind==='monitor')result=await runMonitorSlot(deps,experimentId,arg('session')??nyDate(now));
 else if(kind==='register'){
  let config=null;
  try{
   config=parseRegistrationConfig(JSON.parse(readFileSync(new URL(`../config/paper-auto/${experimentId}.json`,
    import.meta.url),'utf8')),experimentId);
  }catch{/* missing or unreadable: refused below */}
  if(!config)emit({status:'REGISTRATION_CONFIG_INVALID',experimentId},1);
  const r=await registerExperiment(deps,{...config,ownerRef});
  if(!r.registered)emit({status:'NOT_REGISTERED',experimentId,blockers:r.blockers},1);
  emit({status:'REGISTERED',experimentId,state:r.status.state,configDigest:r.status.configDigest},0);
 }
 else if(kind==='resume'){
  // Owner one-click arm: reconcile and resume in one job, so the database's 15-minute freshness
  // window cannot lapse between them. The database still refuses unless the reconcile is clean,
  // newer than the last gate change, for this account, and nothing is unresolved or alerting.
  const rec=await runReconcileSlot(deps,experimentId,quarterHourSlot(Date.now()));
  const runId=rec.reason==='CLEAN'?rec.runId:null;
  // A reconcile already run in this quarter-hour is SKIPPED here: retry in the next quarter-hour.
  if(!runId)emit({status:'RECONCILE_NOT_CLEAN',experimentId,outcome:rec.outcome,reason:rec.reason},1);
  const before=await deps.store.call('status',{experiment_id:experimentId});
  const after=await deps.store.call('resume',{experiment_id:experimentId,owner_ref:ownerRef,
   expected_gate_version:before.gateVersion,reconcile_run_id:runId});
  emit({status:'RESUMED',experimentId,state:after.state,gateMode:after.gateMode,reconcileRunId:runId},0);
 }
 else if(kind==='confirm-absent'){
  const intentId=arg('intent')??'';
  if(!/^pai-[a-f0-9]{32}$/.test(intentId))emit({status:'USAGE',usage:'confirm-absent requires --intent pai-<32 hex>'},2);
  const r=await confirmIntentAbsent(deps,experimentId,intentId,ownerRef);
  emit({status:r.reason,experimentId,intentId,confirmed:r.confirmed},r.confirmed?0:1);
 }
 else if(kind==='context'){
  // Read-only: the registration time, model and reconciled holdings the bridge binds into a decision.
  const out=arg('output');
  if(!out)emit({status:'USAGE',usage:'context requires --output'},2);
  const state=await deps.store.call('worker_state',{experiment_id:experimentId});
  if(state.state==='NOT_REGISTERED')emit({status:'NOT_REGISTERED',experimentId},1);
  const x=state.experiment as Record<string,unknown>;
  const held=(state.filledBySecurity as {securityId:string;netShares:string}[])
   .filter(f=>Number(f.netShares)>0).map(f=>f.securityId).sort();
  writeFileSync(out,JSON.stringify({experimentId,registeredAt:x.registeredAt,modelVersion:x.modelVersion,
   heldSecurityIds:held}),{flag:'wx'});
  emit({status:'CONTEXT_WRITTEN',experimentId,heldSecurities:held.length},0);
 }
 else{
  const file=arg('decision-file');
  if(!file)emit({status:'USAGE',usage:'decision requires --decision-file'},2);
  const input=JSON.parse(readFileSync(file,'utf8')) as DecisionInput;
  if(!input||input.experimentId!==experimentId)emit({status:'DECISION_FILE_MISMATCH'},1);
  result=await recordDecisionSlot(deps,input);
 }
}catch(e){
 emit({status:'WORKER_ERROR',kind,experimentId,
  error:e instanceof PaperAutoStoreError?e.code:e instanceof Error?e.name:'unknown'},1);
}
if(result.outcome==='BLOCKED')process.stdout.write(`::warning::paper-auto ${kind} blocked: ${result.reason}\n`);
// Execute runs also print their planned legs (symbol, side, shares, limit): no account or credential data.
const rounds=kind==='execute'&&Array.isArray(result.detail?.rounds)?{rounds:result.detail.rounds}:{};
emit({status:'DONE',kind,experimentId,outcome:result.outcome,reason:result.reason,runId:result.runId,
 slot:result.slot,posts:result.posts,cancels:result.cancels,...rounds},['STOPPED','FAILED'].includes(result.outcome)?1:0);
