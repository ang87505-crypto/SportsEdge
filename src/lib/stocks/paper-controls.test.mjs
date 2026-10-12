import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaperHandlers,trustedMutation} from '../paper-control.ts';
const origin='https://sports.example';
const COMMAND_ID='00000000-0000-4000-8000-000000000001';
const request=(body={track:'sports',action:'run',commandId:COMMAND_ID},headers={})=>new Request(origin+'/api/paper-control',{method:'POST',headers:{origin,'content-type':'application/json','x-sportsedge-control':'1',...headers},body:JSON.stringify(body)});
function setup(overrides={}){const calls=[];const handlers=createPaperHandlers({origin:()=>origin,identity:async()=>({configured:true,owner:true}),enabled:()=>true,runCommand:async(id)=>{calls.push('run:'+id);return {state:'completed',result:{positionIds:[1],alreadyRecorded:[],failedGames:[],skippedGames:[]}};},refresh:async()=>{calls.push('refresh');return {settledPositions:1,unavailableGames:[]};},...overrides});return {handlers,calls};}
test('owner run reaches runner once; refresh reaches settlement only',async()=>{const {handlers,calls}=setup();assert.equal((await handlers.POST(request())).status,200);assert.equal((await handlers.POST(request({track:'sports',action:'refresh'}))).status,200);assert.deepEqual(calls,['run:'+COMMAND_ID,'refresh']);});
test('unauthenticated and disabled requests never mutate',async()=>{for(const override of [{identity:async()=>({configured:true,owner:false})},{enabled:()=>false},{identity:async()=>({configured:false,owner:false})}]){const {handlers,calls}=setup(override);assert.notEqual((await handlers.POST(request())).status,200);assert.deepEqual(calls,[]);}});
test('origin, custom-header and JSON guards reject CSRF',async()=>{for(const h of [{origin:'https://attacker.example'},{origin:''},{'x-sportsedge-control':''},{'content-type':'text/plain'}]){const {handlers,calls}=setup();assert.equal((await handlers.POST(request(undefined,h))).status,403);assert.deepEqual(calls,[]);}assert.equal(trustedMutation(request(),undefined),false);});
test('GET never places or settles',async()=>{const {handlers,calls}=setup();const r=await handlers.GET(new Request(origin+'/api/paper-control'));assert.equal(r.headers.get('cache-control'),'private, no-store');assert.deepEqual(calls,[]);assert.equal((await r.json()).stocksReady,false);});
test('stocks fail closed even if client asks to run',async()=>{const {handlers,calls}=setup();const r=await handlers.POST(request({track:'stocks',action:'run'}));assert.equal(r.status,409);assert.deepEqual(calls,[]);assert.match((await r.json()).error,/No trade was placed/);});
test('invalid actions and oversized body do not execute',async()=>{const {handlers,calls}=setup();for(const body of [null,{track:'epl',action:'run'},{track:'sports',action:'real-money'}])assert.equal((await handlers.POST(request(body))).status,400);assert.equal((await handlers.POST(request({padding:'x'.repeat(2000)}))).status,413);assert.deepEqual(calls,[]);});
test('uncertain failure is explicit and never retried',async()=>{let attempts=0;const {handlers}=setup({runCommand:async()=>{attempts++;return {state:'uncertain'};}});const r=await handlers.POST(request());assert.equal(r.status,503);const body=await r.text();assert.match(body,/uncertain/);assert.doesNotMatch(body,/private provider secret/);assert.equal(attempts,1);});

test('NBA run requires a client-generated UUID receipt key before runner is touched',async()=>{
 const {handlers,calls}=setup();
 for(const id of [undefined,null,42,'invalid']){
  const reply=await handlers.POST(request({track:'sports',action:'run',commandId:id}));
  assert.equal(reply.status,400);
 }
 assert.deepEqual(calls,[]);
});
test('duplicate completed receipt returns cached result and reports replay',async()=>{
 const {handlers,calls}=setup({runCommand:async()=>({state:'replayed',result:{positionIds:[55],failedGames:[],skippedGames:[],alreadyRecordedPositionIds:[]}})});
 const res=await handlers.POST(request());
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.replayed,true);
 assert.equal(body.commandId,COMMAND_ID);
 assert.deepEqual(body.result.positionIds,[55]);
 assert.deepEqual(calls,[]);
});
test('unresolved receipt and missing database both refuse a new batch',async()=>{
 for(const [state,expected] of [['blocked',409],['unavailable',503],['uncertain',503]]){
  let attempts=0;
  const {handlers}=setup({runCommand:async()=>{attempts++;return {state};}});
  const response=await handlers.POST(request());
  assert.equal(response.status,expected);
  assert.match(await response.text(),/No new|No new batch|locked for review/);
  assert.equal(attempts,1);
 }
});

test('read-only status checks require owner and do not execute a batch',async()=>{
 const calls=[];
 const handlers=createPaperHandlers({
  origin:()=>origin,
  identity:async()=>({configured:true,owner:true}),
  enabled:()=>false,
  runCommand:async()=>{calls.push('run');return {state:'completed',result:{}};},
  refresh:async()=>{calls.push('refresh');},
  commandStatus:async id=>{calls.push('read:'+id);return {state:'completed',result:{positionIds:[17]}};}
 });
 const response=await handlers.GET(new Request(origin+'/api/paper-control?commandId='+COMMAND_ID));
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{commandId:COMMAND_ID,state:'completed',result:{positionIds:[17]}});
 assert.deepEqual(calls,['read:'+COMMAND_ID]);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('anonymous and malformed command receipt reads do not access private storage',async()=>{
 let reads=0;
 const handlers=createPaperHandlers({
  origin:()=>origin,identity:async()=>({configured:true,owner:false}),enabled:()=>false,
  runCommand:async()=>{throw Error('must not run');},refresh:async()=>{throw Error('must not refresh');},
  commandStatus:async()=>{reads++;return {state:'not_found'};}
 });
 assert.equal((await handlers.GET(new Request(origin+'/api/paper-control?commandId='+COMMAND_ID))).status,401);
 assert.equal((await handlers.GET(new Request(origin+'/api/paper-control?commandId=incorrect'))).status,400);
 assert.equal(reads,0);
});
test('private receipt lookup outage fails closed without a new run',async()=>{
 const handlers=createPaperHandlers({
  origin:()=>origin,identity:async()=>({configured:true,owner:true}),enabled:()=>false,
  runCommand:async()=>{throw Error('must not run');},refresh:async()=>{throw Error('must not refresh');},
  commandStatus:async()=>{throw Error('database internals are private');}
 });
 const result=await handlers.GET(new Request(origin+'/api/paper-control?commandId='+COMMAND_ID));
 assert.equal(result.status,503);
 assert.doesNotMatch(await result.text(),/database internals are private/);
});
