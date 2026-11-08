/**
 * Owner-only Pause / Resume / Stop for the NBA player-prop PAPER worker, from the website.
 * SERVER ONLY. It performs exactly one database call, props_set_control, the same RPC the
 * GitHub workflow's pause/resume/stop kinds use. It never collects lines, settles, contacts a
 * DFS platform or moves money. Every action is idempotent, so retrying an unknown outcome is safe.
 */
import {ownerSecret,validOwnerSession} from './alpaca-owner-session.ts';
import {propsStore,PropsStoreError,type PropsStore} from './props-store.ts';

export const PROPS_OWNER_ACTIONS={pause:'PAUSED',resume:'RUNNING',stop:'STOPPED'} as const;
export type PropsOwnerAction=keyof typeof PROPS_OWNER_ACTIONS;
export const PROPS_OWNER_ACTOR='owner:dashboard';

/** Exactly {action, reason} with a known action and a 3-200 character reason; otherwise null. */
export function parsePropsOwnerAction(body:string):{action:PropsOwnerAction;reason:string}|null{
 if(body.length>600)return null;
 let raw:unknown;
 try{raw=JSON.parse(body);}catch{return null;}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const x=raw as Record<string,unknown>;
 if(Object.keys(x).length!==2||typeof x.action!=='string'||typeof x.reason!=='string')return null;
 if(!Object.hasOwn(PROPS_OWNER_ACTIONS,x.action))return null;
 const reason=x.reason.trim().replace(/\s+/g,' ');
 if(reason.length<3||reason.length>200)return null;
 return {action:x.action as PropsOwnerAction,reason};
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
  return json({status:'ok',control:rows[0]});
 }catch(e){return json({status:'props_unavailable',code:e instanceof PropsStoreError?e.code:'UNKNOWN'},503);}
}

/** POST: one owner action as one props_set_control call. */
export async function handlePropsOwnerPost(req:PropsOwnerRequest,env:Env,make:StoreFactory=propsStore):Promise<Response>{
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
  const out=await db.rpc<{state?:unknown;version?:unknown}>('props_set_control',
   {p_state:PROPS_OWNER_ACTIONS[action.action],p_reason:action.reason,p_actor:PROPS_OWNER_ACTOR});
  return json({status:'recorded',action:action.action,state:typeof out?.state==='string'?out.state:PROPS_OWNER_ACTIONS[action.action]});
 }catch(e){
  if(e instanceof PropsStoreError&&e.refused)return json({status:'refused',action:action.action,code:e.code},409);
  return json({status:'outcome_unknown',action:action.action,code:e instanceof PropsStoreError?e.code:'UNKNOWN',retrySafe:true},503);
 }
}
