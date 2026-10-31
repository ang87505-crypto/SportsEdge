/**
 * Owner actions on the recurring PAPER experiments for the dashboard API. SERVER ONLY.
 * Every action is a staging paper_auto RPC; nothing here contacts a broker.
 * - STOP is always allowed and idempotent, so retrying after an unknown outcome is safe.
 * - RESUME is the database's compare-and-swap on the gate version and needs a fresh,
 *   clean reconcile run. A stale browser view can only make it fail.
 * - START is the one-click form of resume: it triggers the owner-only GitHub workflow that
 *   reconciles and then resumes in one job (paper-auto-start.ts). It is refused while armed.
 */
import {createHmac} from 'node:crypto';
import {ownerSecret,validOwnerSession} from './alpaca-owner-session.ts';
import {PaperAutoStoreError,stagingPaperAutoStore,storeCode,type PaperAutoRpc,type PaperAutoStore}
 from './paper-auto-store.ts';
import {parseLedger,parseStatus} from '../stocks/paper-auto-ledger.ts';
import {PAPER_AUTO_RELEASE} from '../stocks/paper-auto-release.ts';
import {dispatchOwnerResume,startConfigured,type Dispatcher} from './paper-auto-start.ts';

const EXPERIMENT=/^[a-z0-9][a-z0-9-]{2,62}$/;
export type OwnerAction=
 {action:'stop';experimentId:string}|
 {action:'start';experimentId:string}|
 {action:'pause';experimentId:string}|
 {action:'resume';experimentId:string;expectedGateVersion:number;reconcileRunId:string}|
 {action:'ack_alert';experimentId:string;alertId:number};
const FIELDS:Record<OwnerAction['action'],readonly string[]>={stop:[],start:[],pause:[],
 resume:['expectedGateVersion','reconcileRunId'],ack_alert:['alertId']};

/** Opaque, stable attribution for the database (owner-<32 hex>); never the secret itself. */
export function ownerRefFor(secret:string):string{
 return 'owner-'+createHmac('sha256',secret).update('sportsedge-paper-auto-owner-ref-v1').digest('hex').slice(0,32);
}
/** Experiments the dashboard may show and act on, from SPORTSEDGE_PAPER_AUTO_EXPERIMENT_IDS. */
export function configuredExperiments(env:Readonly<Record<string,string|undefined>>):string[]|null{
 const raw=env.SPORTSEDGE_PAPER_AUTO_EXPERIMENT_IDS??'';
 const ids=raw.split(',').map(s=>s.trim());
 if(!raw||ids.length>4||ids.some(id=>!EXPERIMENT.test(id))||new Set(ids).size!==ids.length)return null;
 return ids;
}
/** Exactly one known action with exactly its fields, for a configured experiment; otherwise null. */
export function parseOwnerAction(body:string,experiments:readonly string[]):OwnerAction|null{
 if(body.length>400)return null;
 let raw:unknown;
 try{raw=JSON.parse(body);}catch{return null;}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const x=raw as Record<string,unknown>;
 const action=x.action;
 if(typeof action!=='string'||!Object.hasOwn(FIELDS,action))return null;
 const fields=FIELDS[action as OwnerAction['action']];
 if(Object.keys(x).length!==2+fields.length||!fields.every(f=>Object.hasOwn(x,f)))return null;
 if(typeof x.experimentId!=='string'||!experiments.includes(x.experimentId))return null;
 const experimentId=x.experimentId;
 if(action==='resume'){
  if(!Number.isSafeInteger(x.expectedGateVersion)||(x.expectedGateVersion as number)<1||
   typeof x.reconcileRunId!=='string'||!/^run-[a-f0-9]{32}$/.test(x.reconcileRunId))return null;
  return {action,experimentId,expectedGateVersion:x.expectedGateVersion as number,reconcileRunId:x.reconcileRunId};
 }
 if(action==='ack_alert'){
  if(!Number.isSafeInteger(x.alertId)||(x.alertId as number)<1)return null;
  return {action,experimentId,alertId:x.alertId as number};
 }
 return {action:action as 'stop'|'pause',experimentId};
}
/** The single RPC an owner action maps to. */
export function ownerActionCall(a:Exclude<OwnerAction,{action:'start'}>,ownerRef:string)
 :{fn:PaperAutoRpc;p:Record<string,unknown>}{
 if(!/^owner-[a-f0-9]{32}$/.test(ownerRef))throw Error('INVALID_OWNER_REF');
 const experiment_id=a.experimentId;
 switch(a.action){
  case 'stop':return {fn:'stop',p:{experiment_id,reason:'OWNER_STOP',actor:ownerRef,
   evidence:{source:'owner-dashboard'}}};
  case 'pause':return {fn:'pause',p:{experiment_id,owner_ref:ownerRef}};
  case 'resume':return {fn:'resume',p:{experiment_id,owner_ref:ownerRef,
   expected_gate_version:a.expectedGateVersion,reconcile_run_id:a.reconcileRunId}};
  case 'ack_alert':return {fn:'ack_alert',p:{experiment_id,owner_ref:ownerRef,alert_id:a.alertId}};
 }
}

export type OwnerRequest={url:string;ownerCookie:string|undefined;origin:string|null;contentType:string|null;
 text:()=>Promise<string>};
type Env=Readonly<Record<string,string|undefined>>;
type StoreFactory=(env:Env)=>PaperAutoStore;
const NO_STORE={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const json=(body:Record<string,unknown>,status=200)=>Response.json(body,{status,headers:NO_STORE});
function session(req:OwnerRequest):string|null{
 const secret=ownerSecret();
 return secret&&validOwnerSession(req.ownerCookie,secret)?secret:null;
}
function storeFor(env:Env,make:StoreFactory):PaperAutoStore|null{
 try{return make(env);}catch{return null;}
}
/** GET: every configured experiment's ledger, strictly re-read; never a broker call. */
export async function handlePaperAutoGet(req:OwnerRequest,env:Env,make:StoreFactory=stagingPaperAutoStore)
 :Promise<Response>{
 if(!session(req))return json({status:'owner_access_required'},401);
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 const ids=configuredExperiments(env),db=storeFor(env,make);
 if(!ids||!db)return json({status:'paper_auto_not_configured'},503);
 try{
  const experiments=[];
  for(const experimentId of ids){
   const ledger=parseLedger(await db.call('ledger',{experiment_id:experimentId}));
   if(!ledger||ledger.experimentId!==experimentId)return json({status:'ledger_unverifiable'},502);
   experiments.push(ledger);
  }
  return json({status:'ok',release:PAPER_AUTO_RELEASE,start:{oneClick:startConfigured(env)},experiments});
 }catch(e){return json({status:'paper_auto_unavailable',reason:storeCode(e)},503);}
}
/** POST: one owner action as one database RPC; never a broker call. */
export async function handlePaperAutoPost(req:OwnerRequest,env:Env,make:StoreFactory=stagingPaperAutoStore,
 dispatch:Dispatcher=dispatchOwnerResume):Promise<Response>{
 const secret=session(req);
 if(!secret)return json({status:'owner_access_required'},401);
 if(req.origin!==new URL(req.url).origin)return json({status:'origin_rejected'},403);
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 if(req.contentType?.split(';')[0]?.trim()!=='application/json')return json({status:'invalid_request'},400);
 const ids=configuredExperiments(env),db=storeFor(env,make);
 if(!ids||!db)return json({status:'paper_auto_not_configured'},503);
 let action:OwnerAction|null;
 try{action=parseOwnerAction(await req.text(),ids);}catch{return json({status:'invalid_request'},400);}
 if(!action)return json({status:'invalid_request'},400);
 if(action.action==='start'){
  // Start only arms a stopped or paused experiment; the workflow's database resume does the arming.
  let gateMode:string|undefined;
  try{gateMode=parseStatus(await db.call('status',{experiment_id:action.experimentId}))?.gateMode;}
  catch(e){return json({status:'outcome_unknown',action:'start',code:storeCode(e),retrySafe:true},503);}
  if(gateMode==='ARMED')return json({status:'refused',action:'start',code:'ALREADY_RUNNING'},409);
  const r=await dispatch(action.experimentId,env);
  if(r.result==='dispatched')return json({status:'started',action:'start'},202);
  if(r.result==='not_configured')return json({status:'start_not_configured',action:'start'},503);
  return json({status:r.result==='refused'?'refused':'outcome_unknown',action:'start',code:r.code},
   r.result==='refused'?409:503);
 }
 const {fn,p}=ownerActionCall(action,ownerRefFor(secret));
 try{
  return json({status:'recorded',action:action.action,state:parseStatus(await db.call(fn,p))});
 }catch(e){
  // A database refusal rolled back. Anything else is an unknown outcome: every owner
  // action is idempotent or version-checked, so re-reading status and retrying is
  // safe, and STOP can always be sent again.
  if(e instanceof PaperAutoStoreError&&e.refused)return json({status:'refused',action:action.action,code:e.code},409);
  return json({status:'outcome_unknown',action:action.action,code:storeCode(e),retrySafe:true},503);
 }
}
