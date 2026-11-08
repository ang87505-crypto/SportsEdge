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
