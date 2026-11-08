/**
 * Owner-only controls for the NBA player-prop PAPER worker and its learning loop, from the website.
 * SERVER ONLY. Each action is exactly one database RPC (the same ones the GitHub workflows use) or,
 * for "Retrain now", one fixed GitHub workflow dispatch. Nothing here collects lines, settles,
 * contacts a DFS platform or moves money. Retrying an unknown outcome is safe: every RPC is
 * idempotent or checked by the database.
 */
import {ownerSecret,validOwnerSession} from './alpaca-owner-session.ts';
import {propsStore,PropsStoreError,type PropsStore} from './props-store.ts';
import {runOwnerAction} from './props-learn-worker.ts';
import {dispatchPropsLearn,type LearnDispatcher} from './props-learn-dispatch.ts';

export const PROPS_OWNER_ACTIONS={pause:'PAUSED',resume:'RUNNING',stop:'STOPPED'} as const;
type ControlAction=keyof typeof PROPS_OWNER_ACTIONS;
const LEARN_ACTIONS=['learning_on','learning_off','auto_on','auto_off','rollback','retrain'] as const;
export type PropsOwnerAction=ControlAction|typeof LEARN_ACTIONS[number]|'approve';
export const PROPS_OWNER_ACTOR='owner:dashboard';
const VERSION=/^props-learn-v[0-9]+$/;

/** Exactly {action, reason} (plus `version` for approve only); otherwise null. */
export function parsePropsOwnerAction(body:string):{action:PropsOwnerAction;reason:string;version?:string}|null{
 if(body.length>600)return null;
 let raw:unknown;
 try{raw=JSON.parse(body);}catch{return null;}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const x=raw as Record<string,unknown>;
 if(typeof x.action!=='string'||typeof x.reason!=='string')return null;
 const known=Object.hasOwn(PROPS_OWNER_ACTIONS,x.action)||(LEARN_ACTIONS as readonly string[]).includes(x.action)||x.action==='approve';
 if(!known)return null;
 const approve=x.action==='approve';
 if(Object.keys(x).length!==(approve?3:2))return null;
 if(approve&&(typeof x.version!=='string'||!VERSION.test(x.version)))return null;
 const reason=x.reason.trim().replace(/\s+/g,' ');
 if(reason.length<3||reason.length>200)return null;
 return approve?{action:'approve',reason,version:x.version as string}:{action:x.action as PropsOwnerAction,reason};
}

export type PropsOwnerRequest={url:string;ownerCookie:string|undefined;origin:string|null;contentType:string|null;
 text:()=>Promise<string>};
type Env=Readonly<Record<string,string|undefined>>;
type StoreFactory=(env:Env)=>PropsStore;
const NO_STORE={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const json=(body:Record<string,unknown>,status=200)=>Response.json(body,{status,headers:NO_STORE});
const signedIn=(req:PropsOwnerRequest)=>{const s=ownerSecret();return !!s&&validOwnerSession(req.ownerCookie,s);};
const storeFor=(env:Env,make:StoreFactory)=>{
 // Synthetic Preview deployments never touch a real ledger.
 if(env.SPORTSEDGE_PREVIEW_FIXTURES==='1')return null;
 try{return make(env);}catch{return null;}
};
type Control={state:string;reason:string;changed_at:string};
type Model={active:string;previous:string|null;learningEnabled:boolean;autoSwitchEnabled:boolean;
 challengers:{version:string;state:string;reason:string;detail:Record<string,unknown>;at:string}[]};
/** Active model, switches and each version's latest lifecycle state; null when the learning tables are absent. */
async function readModel(db:PropsStore):Promise<Model|null>{
 try{
  const [[c],events]=await Promise.all([
   db.select<{active_model_version:string;previous_model_version:string|null;learning_enabled:boolean;auto_switch_enabled:boolean}>(
    'props_model_control','select=active_model_version,previous_model_version,learning_enabled,auto_switch_enabled'),
   db.select<{id:number;version:string;event:string;reason:string;detail:Record<string,unknown>;at:string}>('props_model_events',
    'select=id,version,event,reason,detail,at&order=id.desc&limit=200')]);
  if(!c)return null;
  const seen=new Set<string>();const challengers:Model['challengers']=[];
  for(const e of [...events].sort((a,b)=>b.id-a.id)){
   if(seen.has(e.version))continue;seen.add(e.version);
   challengers.push({version:e.version,state:e.event,reason:e.reason,detail:e.detail??{},at:e.at});
   if(challengers.length>=10)break;
  }
  return {active:c.active_model_version,previous:c.previous_model_version,learningEnabled:c.learning_enabled,autoSwitchEnabled:c.auto_switch_enabled,challengers};
 }catch{return null;}
}
const validControl=(c:unknown):c is Control=>!!c&&typeof c==='object'&&
 ['RUNNING','PAUSED','STOPPED'].includes((c as Control).state)&&typeof (c as Control).reason==='string';

/** GET: is the owner signed in, and what is the current control? Read-only. */
export async function handlePropsOwnerGet(req:PropsOwnerRequest,env:Env,make:StoreFactory=propsStore):Promise<Response>{
 if(!signedIn(req))return json({status:'owner_access_required'},401);
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 const db=storeFor(env,make);
 if(!db)return json({status:'props_not_configured'},503);
 try{
  const rows=await db.select<Control>('props_control','select=state,reason,changed_at&id=eq.1');
  if(!validControl(rows[0]))return json({status:'control_unverifiable'},502);
  return json({status:'ok',control:rows[0],model:await readModel(db)});
 }catch(e){return json({status:'props_unavailable',code:e instanceof PropsStoreError?e.code:'UNKNOWN'},503);}
}

/** POST: one owner action as one props_set_control call. */
export async function handlePropsOwnerPost(req:PropsOwnerRequest,env:Env,make:StoreFactory=propsStore,
 dispatch:LearnDispatcher=env=>dispatchPropsLearn(env)):Promise<Response>{
 if(!signedIn(req))return json({status:'owner_access_required'},401);
 if(req.origin!==new URL(req.url).origin)return json({status:'origin_rejected'},403);
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 if(req.contentType?.split(';')[0]?.trim()!=='application/json')return json({status:'invalid_request'},400);
 let action;
 try{action=parsePropsOwnerAction(await req.text());}catch{return json({status:'invalid_request'},400);}
 if(!action)return json({status:'invalid_request'},400);
 const db=storeFor(env,make);
 if(!db)return json({status:'props_not_configured'},503);
 try{
  if(action.action==='retrain'){
   const r=await dispatch(env);
   if(r.result==='dispatched')return json({status:'started',action:'retrain'},202);
   if(r.result==='not_configured')return json({status:'learn_dispatch_not_configured',action:'retrain'},503);
   return json({status:r.result==='refused'?'refused':'outcome_unknown',action:'retrain',code:r.code},r.result==='refused'?409:503);
  }
  if(Object.hasOwn(PROPS_OWNER_ACTIONS,action.action)){
   const state=PROPS_OWNER_ACTIONS[action.action as ControlAction];
   const out=await db.rpc<{state?:unknown}>('props_set_control',{p_state:state,p_reason:action.reason,p_actor:PROPS_OWNER_ACTOR});
   return json({status:'recorded',action:action.action,state:typeof out?.state==='string'?out.state:state});
  }
  const result=await runOwnerAction(db,action.action as Exclude<PropsOwnerAction,ControlAction|'retrain'>,
   {version:action.version,reason:action.reason,actor:PROPS_OWNER_ACTOR});
  return json({status:'recorded',action:action.action,result:result as Record<string,unknown>});
 }catch(e){
  if(e instanceof PropsStoreError&&e.refused)return json({status:'refused',action:action.action,code:e.code},409);
  return json({status:'outcome_unknown',action:action.action,code:e instanceof PropsStoreError?e.code:'UNKNOWN',retrySafe:true},503);
 }
}
