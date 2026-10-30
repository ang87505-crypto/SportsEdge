/**
 * Recurring Alpaca PAPER worker entry point (GitHub Actions or a manual shell).
 *   node --experimental-strip-types scripts/paper-auto-worker.ts <kind> --experiment <id>
 *     kinds: execute | reconcile | monitor [--session YYYY-MM-DD] | decision --decision-file <path>
 *            | context --output <path>  (registration and held securities for the signal bridge)
 * Scheduler-triggered runs are refused before any network call while the release
 * manifest is OFF. Broker writes stay OFF in source, so an execute run with the
 * checked-in manifest records a shadow plan and never reserves or sends an order.
 * Output is one JSON line without credentials. Exit 1 when the owner must act.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {PAPER_AUTO_RELEASE} from '../src/lib/stocks/paper-auto-release.ts';
import {alpacaPaperAutoBroker} from '../src/lib/server/paper-auto-broker.ts';
import {stagingPaperAutoStore} from '../src/lib/server/paper-auto-store.ts';
import {runExecuteSlot,runReconcileSlot,runMonitorSlot,recordDecisionSlot,type DecisionInput,type SlotResult}
 from '../src/lib/server/paper-auto-controller.ts';
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
if(!['execute','reconcile','monitor','decision','context'].includes(kind??'')||
 !/^[a-z0-9][a-z0-9-]{2,62}$/.test(experimentId))
 emit({status:'USAGE',usage:'paper-auto-worker.ts <execute|reconcile|monitor|decision|context> --experiment <id>'},2);
if(process.env.GITHUB_EVENT_NAME==='schedule'&&(PAPER_AUTO_RELEASE.scheduledRunsEnabled as boolean)!==true)
 emit({status:'SCHEDULED_RUNS_RELEASED_OFF',kind,experimentId,brokerCalls:0},0);
if(!PAPER_AUTO_RELEASE.paperOnly||PAPER_AUTO_RELEASE.realMoneyEnabled)emit({status:'RELEASE_INVALID'},1);
const keyId=process.env.ALPACA_PAPER_AUTO_KEY_ID??'',secretKey=process.env.ALPACA_PAPER_AUTO_SECRET_KEY??'';
/** Decision recording never needs the broker; any accidental use fails closed. */
const noBroker=new Proxy({},{get:(_,k)=>k==='writesEnabled'?false:()=>{throw Error('BROKER_NOT_AVAILABLE');}});
let deps;
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
 emit({status:'WORKER_ERROR',kind,experimentId,error:e instanceof Error?e.name:'unknown'},1);
}
if(result.outcome==='BLOCKED')process.stdout.write(`::warning::paper-auto ${kind} blocked: ${result.reason}\n`);
emit({status:'DONE',kind,experimentId,outcome:result.outcome,reason:result.reason,runId:result.runId,
 slot:result.slot,posts:result.posts,cancels:result.cancels},['STOPPED','FAILED'].includes(result.outcome)?1:0);
