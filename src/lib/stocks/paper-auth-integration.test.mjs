import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createPaperHandlers} from '../paper-control.ts';

// Test the production owner-session implementation with a fake Supabase Auth HTTP
// service. No internet access, database write, real API key or simulated bet.
const original=await readFile(new URL('../server/paper-owner.ts',import.meta.url),'utf8');
const source=original.replace("import 'server-only';",'').replace(
  "'../paper-control'",
  JSON.stringify(new URL('../paper-control.ts',import.meta.url).href)
);
const transformed=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {ownerIdentity,ownerSession}=await import('data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'));
const ORIGIN='https://sportsedge-ci.example';
const OWNER='22222222-2222-4222-8222-222222222222';
const OTHER='33333333-3333-4333-8333-333333333333';
const TOKEN='fixture.signed.access.token.is.long.enough';
const ID='44444444-4444-4444-8444-444444444444';
const vars={
 SUPABASE_URL:'https://fixture.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'fixture-publishable',
 SPORTSEDGE_OWNER_USER_ID:OWNER,
 SPORTSEDGE_SITE_ORIGIN:ORIGIN
};
const req=(url,body,otherHeaders={})=>new Request(ORIGIN+url,{
 method:'POST',
 headers:{origin:ORIGIN,'x-sportsedge-control':'1','content-type':'application/json',...otherHeaders},
 body:JSON.stringify(body)
});
const cookieValue=response=>{
 const header=response.headers.get('set-cookie');
 assert.match(header,/^__Host-sportsedge-paper=/);
 assert.match(header,/HttpOnly/);
 assert.match(header,/Secure/);
 assert.match(header,/SameSite=Strict/);
 return header.split(';')[0];
};
async function isolated(work){
 const existing=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));
 const priorFetch=globalThis.fetch;
 for(const [k,v] of Object.entries(vars))process.env[k]=v;
 try{await work();}finally{
  globalThis.fetch=priorFetch;
  for(const [k,v] of Object.entries(existing))v===undefined?delete process.env[k]:process.env[k]=v;
 }
}
function authProvider({id=OWNER,confirmed=true,anonymous=false,expired=false}={}){
 let tokenCalls=0,userCalls=0,logoutCalls=0;
 return {
  counts:()=>({tokenCalls,userCalls,logoutCalls}),
  handler:async(url,options)=>{
   if(url.endsWith('/auth/v1/token?grant_type=password')){
    tokenCalls++;
    assert.equal(options.method,'POST');
    assert.equal(options.headers.apikey,'fixture-publishable');
    return Response.json({access_token:TOKEN,expires_in:1200});
   }
   if(url.endsWith('/auth/v1/user')){
    userCalls++;
    assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
    return expired?Response.json({message:'expired'},{status:401}):
     Response.json({id,is_anonymous:anonymous,email_confirmed_at:confirmed?'2026-10-01T12:00:00Z':null});
   }
   if(url.includes('/auth/v1/logout')){
    logoutCalls++;
    return Response.json({});
   }
   throw Error('Unexpected external HTTP call: '+url);
  }
 };
}
function endpoints({enabled=true}={}){
 const events=[];
 const handlers=createPaperHandlers({
  origin:()=>ORIGIN,
  identity:ownerIdentity,
  enabled:()=>enabled,
  runCommand:async id=>{events.push('run:'+id);return {state:'completed',result:{positionIds:[13],alreadyRecordedPositionIds:[],skippedGames:[],failedGames:[]}};},
  refresh:async()=>{events.push('refresh');return {settledPositions:0,unavailableGames:[]};}
 });
 return {handlers,events};
}
test('verified owner signs in, uses strict cookie, and reaches one idempotent paper command',()=>isolated(async()=>{
 const provider=authProvider();globalThis.fetch=provider.handler;
 const signIn=await ownerSession(req('/api/paper-control/session',{action:'login',email:'owner@example.test',password:'fixture'}));
 assert.equal(signIn.status,200);
 const cookie=cookieValue(signIn);
 const {handlers,events}=endpoints();
 const result=await handlers.POST(req('/api/paper-control',{track:'sports',action:'run',commandId:ID},{cookie}));
 assert.equal(result.status,200);
 assert.equal((await result.json()).commandId,ID);
 assert.deepEqual(events,['run:'+ID]);
 assert.deepEqual(provider.counts(),{tokenCalls:1,userCalls:2,logoutCalls:0});
}));
test('session without cookie, with unverified identity, or with expired token cannot run',()=>isolated(async()=>{
 const {handlers,events}=endpoints();
 const missing=await handlers.POST(req('/api/paper-control',{track:'sports',action:'run',commandId:ID}));
 assert.equal(missing.status,401);
 for(const fixture of [{confirmed:false},{anonymous:true},{id:OTHER},{expired:true}]){
  const provider=authProvider(fixture);globalThis.fetch=provider.handler;
  const response=await handlers.POST(req('/api/paper-control',{track:'sports',action:'run',commandId:ID},{cookie:'__Host-sportsedge-paper='+TOKEN}));
  assert.equal(response.status,401);
 }
 assert.deepEqual(events,[]);
}));
test('disabled execution rejects authenticated owner before claim or score provider',()=>isolated(async()=>{
 const provider=authProvider();globalThis.fetch=provider.handler;
 const {handlers,events}=endpoints({enabled:false});
 const result=await handlers.POST(req('/api/paper-control',{track:'sports',action:'run',commandId:ID},{cookie:'__Host-sportsedge-paper='+TOKEN}));
 assert.equal(result.status,409);
 assert.match(await result.text(),/disabled/);
 assert.deepEqual(events,[]);
}));
test('CSRF denial occurs before any Supabase Auth request',()=>isolated(async()=>{
 globalThis.fetch=async()=>{throw Error('Provider should not be called on rejected origin');};
 const {handlers,events}=endpoints();
 const response=await handlers.POST(req('/api/paper-control',{track:'sports',action:'run',commandId:ID},{
  origin:'https://attacker.example',cookie:'__Host-sportsedge-paper='+TOKEN
 }));
 assert.equal(response.status,403);
 assert.deepEqual(events,[]);
}));
test('authentication outage returns unavailable without invoking paper runner',()=>isolated(async()=>{
 globalThis.fetch=async()=>new Response('failure',{status:503});
 const {handlers,events}=endpoints();
 const response=await handlers.POST(req('/api/paper-control',{track:'sports',action:'run',commandId:ID},{
  cookie:'__Host-sportsedge-paper='+TOKEN
 }));
 assert.equal(response.status,503);
 assert.deepEqual(events,[]);
 assert.doesNotMatch(await response.text(),/fixture.signed.access.token/);
}));
test('logged-in stock owner cannot execute the unconnected stock strategy',()=>isolated(async()=>{
 globalThis.fetch=authProvider().handler;
 const {handlers,events}=endpoints();
 const response=await handlers.POST(req('/api/paper-control',{track:'stocks',action:'run',commandId:ID},{
  cookie:'__Host-sportsedge-paper='+TOKEN
 }));
 assert.equal(response.status,409);
 assert.deepEqual(events,[]);
}));
test('logout clears owner cookie and subsequent request is unauthorized',()=>isolated(async()=>{
 globalThis.fetch=authProvider().handler;
 const logout=await ownerSession(req('/api/paper-control/session',{action:'logout'},{
  cookie:'__Host-sportsedge-paper='+TOKEN
 }));
 assert.equal(logout.status,200);
 assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 const {handlers,events}=endpoints();
 assert.equal((await handlers.POST(req('/api/paper-control',{track:'sports',action:'run',commandId:ID}))).status,401);
 assert.deepEqual(events,[]);
}));
