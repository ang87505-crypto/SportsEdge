// Owner-only props Pause/Resume/Stop API: session, origin, strict body, single RPC.
// Fake store and synthetic secrets only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {issueOwnerSession} from './alpaca-owner-session.ts';
import {PropsStoreError} from './props-store.ts';
import {handlePropsOwnerGet,handlePropsOwnerPost,parsePropsOwnerAction,PROPS_OWNER_ACTOR} from './props-owner.ts';

const SECRET='0123456789abcdef'.repeat(4);
process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY=SECRET;
const URL_='https://sportsedge.example/api/internal/props/control';
const CONTROL={state:'RUNNING',reason:'released',changed_at:'2026-11-08T16:00:00Z'};
function fakeStore(rpc=async(fn,p)=>({state:p.p_state,version:2})){
 const calls=[];
 return {calls,make:()=>({
  async select(t,q){calls.push({t,q});return [CONTROL];},
  async rpc(fn,p){calls.push({fn,p});return rpc(fn,p);},
  async insert(){throw Error('never');}})};
}
function req(o={}){
 const {url=URL_,contentType='application/json',body=JSON.stringify({action:'pause',reason:'checking lines'})}=o;
 return {url,ownerCookie:'cookie' in o?o.cookie:issueOwnerSession(SECRET),
  origin:'origin' in o?o.origin:'https://sportsedge.example',contentType,text:async()=>body};
}

test('parse accepts exactly a known action and a short reason',()=>{
 assert.deepEqual(parsePropsOwnerAction('{"action":"stop","reason":"  done   for now "}'),{action:'stop',reason:'done for now'});
 for(const bad of ['','x','[]','{"action":"pause"}','{"action":"collect","reason":"abc"}','{"action":"pause","reason":"ab"}',
  JSON.stringify({action:'pause',reason:'x'.repeat(201)}),'{"action":"pause","reason":"abc","extra":1}','{"action":"__proto__","reason":"abc"}'])
  assert.equal(parsePropsOwnerAction(bad),null,bad);
});

test('GET and POST refuse without a valid owner session and make no database call',async()=>{
 const s=fakeStore();
 for(const cookie of [undefined,'v1.forged',issueOwnerSession('f'.repeat(64))]){
  assert.equal((await handlePropsOwnerGet(req({cookie}),{},s.make)).status,401);
  assert.equal((await handlePropsOwnerPost(req({cookie}),{},s.make)).status,401);
 }
 assert.equal(s.calls.length,0);
});

test('GET returns the current control',async()=>{
 const s=fakeStore();
 const r=await handlePropsOwnerGet(req(),{},s.make);
 assert.equal(r.status,200);
 assert.deepEqual((await r.json()).control,CONTROL);
 assert.equal((await handlePropsOwnerGet(req({url:URL_+'?x=1'}),{},s.make)).status,400);
 assert.equal((await handlePropsOwnerGet(req(),{},()=>{throw new PropsStoreError('NOT_CONFIGURED',true);})).status,503);
 assert.equal((await handlePropsOwnerGet(req(),{SPORTSEDGE_PREVIEW_FIXTURES:'1'},s.make)).status,503);
});

test('POST checks origin, content type and body before any database call',async()=>{
 const s=fakeStore();
 assert.equal((await handlePropsOwnerPost(req({origin:null}),{},s.make)).status,403);
 assert.equal((await handlePropsOwnerPost(req({origin:'https://evil.example'}),{},s.make)).status,403);
 assert.equal((await handlePropsOwnerPost(req({contentType:'text/plain'}),{},s.make)).status,400);
 assert.equal((await handlePropsOwnerPost(req({body:'{"action":"collect","reason":"abc"}'}),{},s.make)).status,400);
 assert.equal(s.calls.length,0);
});

test('each action maps to one props_set_control call attributed to the dashboard owner',async()=>{
 for(const [action,state] of [['pause','PAUSED'],['resume','RUNNING'],['stop','STOPPED']]){
  const s=fakeStore();
  const r=await handlePropsOwnerPost(req({body:JSON.stringify({action,reason:'owner test'})}),{},s.make);
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{status:'recorded',action,state});
  assert.deepEqual(s.calls,[{fn:'props_set_control',p:{p_state:state,p_reason:'owner test',p_actor:PROPS_OWNER_ACTOR}}]);
 }
});

test('a database refusal is 409; an unknown outcome is 503 and marked safe to retry',async()=>{
 const refused=fakeStore(async()=>{throw new PropsStoreError('PROPS_INVALID_STATE',true);});
 assert.equal((await handlePropsOwnerPost(req(),{},refused.make)).status,409);
 const unknown=fakeStore(async()=>{throw new PropsStoreError('STORE_OUTCOME_UNKNOWN',false);});
 const r=await handlePropsOwnerPost(req(),{},unknown.make);
 assert.equal(r.status,503);
 assert.equal((await r.json()).retrySafe,true);
});

// ---- learning controls (fake store; synthetic TEST-ONLY model rows)
const MODEL={active_model_version:'props-learn-v1',previous_model_version:'props-nb-minutes-rate-v1',learning_enabled:true,auto_switch_enabled:false};
const EVENTS=[{id:3,version:'props-learn-v2',event:'eligible',reason:'gate passed',detail:{lines:512},at:'2026-12-06T10:00:00Z'},
 {id:2,version:'props-learn-v2',event:'shadow_start',reason:'ok',detail:{},at:'2026-11-29T10:00:00Z'},
 {id:1,version:'props-learn-v1',event:'promoted',reason:'ok',detail:{},at:'2026-11-20T10:00:00Z'}];
function learnStore(rpc=async(fn,p)=>({ok:true,fn,p})){
 const calls=[];
 return {calls,make:()=>({
  async select(t){calls.push({t});if(t==='props_control')return [CONTROL];if(t==='props_model_control')return [MODEL];if(t==='props_model_events')return EVENTS;return [];},
  async rpc(fn,p){calls.push({fn,p});return rpc(fn,p);},
  async insert(){throw Error('never');}})};
}
const body=o=>JSON.stringify(o);

test('GET also reports the model, learning switches and challengers',async()=>{
 const s=learnStore();
 const j=await (await handlePropsOwnerGet(req(),{},s.make)).json();
 assert.deepEqual(j.model,{active:'props-learn-v1',previous:'props-nb-minutes-rate-v1',learningEnabled:true,autoSwitchEnabled:false,
  challengers:[{version:'props-learn-v2',state:'eligible',reason:'gate passed',detail:{lines:512},at:'2026-12-06T10:00:00Z'},
   {version:'props-learn-v1',state:'promoted',reason:'ok',detail:{},at:'2026-11-20T10:00:00Z'}]});
});

test('GET still works when the learning tables are not migrated (model is null)',async()=>{
 const make=()=>({async select(t){if(t==='props_control')return [CONTROL];throw new PropsStoreError('STORE_HTTP_404',false);},async rpc(){},async insert(){}});
 const j=await (await handlePropsOwnerGet(req(),{},make)).json();
 assert.equal(j.status,'ok');assert.equal(j.model,null);
});

test('learning switches map to one props_set_learning call keeping the other switch',async()=>{
 for(const [action,learning,auto] of [['learning_off',false,false],['learning_on',true,false],['auto_on',true,true],['auto_off',true,false]]){
  const s=learnStore();
  const r=await handlePropsOwnerPost(req({body:body({action,reason:'owner test'})}),{},s.make);
  assert.equal(r.status,200,action);
  assert.deepEqual(s.calls.filter(c=>c.fn),[{fn:'props_set_learning',p:{p_learning:learning,p_auto:auto,p_actor:PROPS_OWNER_ACTOR,p_reason:'owner test'}}]);
 }
});

test('approve and roll back are one RPC each; approve validates the version first',async()=>{
 const s=learnStore();
 assert.equal((await handlePropsOwnerPost(req({body:body({action:'approve',version:'props-learn-v2',reason:'looks good'})}),{},s.make)).status,200);
 assert.equal((await handlePropsOwnerPost(req({body:body({action:'rollback',reason:'undo it'})}),{},s.make)).status,200);
 assert.deepEqual(s.calls.filter(c=>c.fn).map(c=>c.fn),['props_promote_model','props_rollback_model']);
 const bad=learnStore();
 for(const b of [{action:'approve',reason:'x y z'},{action:'approve',version:'props-learn-v2; drop',reason:'x y z'},{action:'rollback',reason:'abc',version:'props-learn-v1'}])
  assert.equal((await handlePropsOwnerPost(req({body:body(b)}),{},bad.make)).status,400,JSON.stringify(b));
 assert.equal(bad.calls.length,0);
});

test('database refusals reach the owner as 409 with their code',async()=>{
 for(const [action,code,extra] of [['approve','PROPS_MODEL_NOT_ELIGIBLE',{version:'props-learn-v2'}],['rollback','PROPS_NO_PREVIOUS_MODEL',{}]]){
  const s=learnStore(async()=>{throw new PropsStoreError(code,true);});
  const r=await handlePropsOwnerPost(req({body:body({action,reason:'owner test',...extra})}),{},s.make);
  assert.equal(r.status,409);assert.equal((await r.json()).code,code);
 }
});

test('retrain dispatches the learning workflow, or says it is not configured',async()=>{
 const s=learnStore();
 const off=await handlePropsOwnerPost(req({body:body({action:'retrain',reason:'try now'})}),{},s.make,async()=>({result:'not_configured'}));
 assert.equal(off.status,503);assert.equal((await off.json()).status,'learn_dispatch_not_configured');
 const on=await handlePropsOwnerPost(req({body:body({action:'retrain',reason:'try now'})}),{},s.make,async()=>({result:'dispatched'}));
 assert.equal(on.status,202);assert.equal((await on.json()).status,'started');
 assert.equal(s.calls.filter(c=>c.fn).length,0,'retrain never writes to the database itself');
});
