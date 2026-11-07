import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleDiagnosticRequest} from './alpaca-paper-diagnostic.ts';
import {PaperConnectionError} from './alpaca-paper-reader.ts';

// Synthetic values only. No real Alpaca call is possible: the snapshot reader is injected.
const TOKEN='synthetic-diagnostic-token-0123456789abcdef';
const env={SPORTSEDGE_ALPACA_PAPER_READ_TOKEN:TOKEN,
  ALPACA_PAPER_KEY_ID:'SYNTHETIC-KEY-ID',ALPACA_PAPER_SECRET_KEY:'SYNTHETIC-SECRET-NOT-A-KEY'};
const URL_='https://sportsedge.test/api/internal/alpaca-paper';
const req=(auth,url=URL_)=>new Request(url,{headers:auth===undefined?{}:{authorization:auth}});
const snapshot={accountType:'paper',readOnly:true,automaticPaperOrdersEnabled:false};
function spyReader(result=snapshot){
  const calls=[];
  const read=async settings=>{calls.push(settings);if(result instanceof Error)throw result;return result;};
  return {calls,read};
}
const body=async r=>JSON.parse(await r.text());

test('unauthorized requests get an opaque 404 and never reach the broker reader',async()=>{
  for(const [label,request,e] of [
    ['missing header',req(undefined),env],
    ['wrong token',req('Bearer '+TOKEN.replace(/.$/,'x')),env],
    ['token without Bearer prefix',req(TOKEN),env],
    ['token prefix only',req('Bearer '+TOKEN.slice(0,-1)),env],
    ['server token unset',req('Bearer '+TOKEN),{...env,SPORTSEDGE_ALPACA_PAPER_READ_TOKEN:undefined}],
    ['server token too short',req('Bearer short'),{...env,SPORTSEDGE_ALPACA_PAPER_READ_TOKEN:'short'}]
  ]){
    const spy=spyReader();
    const r=await handleDiagnosticRequest(request,e,spy.read);
    assert.equal(r.status,404,label);
    assert.deepEqual(await body(r),{error:'Not found'},label);
    assert.equal(r.headers.get('cache-control'),'private, no-store',label);
    assert.equal(spy.calls.length,0,label);
  }
});

test('authorized request without broker keys reaches the runtime config check',async()=>{
  const spy=spyReader();
  const r=await handleDiagnosticRequest(req('Bearer '+TOKEN),
    {SPORTSEDGE_ALPACA_PAPER_READ_TOKEN:TOKEN},spy.read);
  assert.equal(r.status,503);
  assert.deepEqual(await body(r),{status:'not_configured'});
  assert.equal(spy.calls.length,0);
});

test('authorized request rejects query parameters before reading the broker',async()=>{
  const spy=spyReader();
  const r=await handleDiagnosticRequest(req('Bearer '+TOKEN,URL_+'?symbol=AAPL'),env,spy.read);
  assert.equal(r.status,400);
  assert.equal(spy.calls.length,0);
});

test('authorized request returns the read-only snapshot with server-side keys only',async()=>{
  const spy=spyReader();
  const r=await handleDiagnosticRequest(req('Bearer '+TOKEN),env,spy.read);
  assert.equal(r.status,200);
  assert.equal(r.headers.get('cache-control'),'private, no-store');
  const text=await r.text();
  assert.deepEqual(JSON.parse(text),snapshot);
  assert.deepEqual(spy.calls,[{keyId:env.ALPACA_PAPER_KEY_ID,secretKey:env.ALPACA_PAPER_SECRET_KEY}]);
  assert.ok(!text.includes(env.ALPACA_PAPER_SECRET_KEY));
  assert.ok(!text.includes(TOKEN));
});

test('broker failures return bounded diagnostic codes, never upstream text or secrets',async()=>{
  const known=await handleDiagnosticRequest(req('Bearer '+TOKEN),env,
    spyReader(new PaperConnectionError('PAPER_AUTH_REJECTED','account')).read);
  assert.equal(known.status,503);
  assert.deepEqual(await body(known),
    {status:'paper_broker_unavailable_or_unverified',reason:'PAPER_AUTH_REJECTED',stage:'account'});
  const unknown=await handleDiagnosticRequest(req('Bearer '+TOKEN),env,
    spyReader(new Error('upstream said '+env.ALPACA_PAPER_SECRET_KEY)).read);
  const text=await unknown.text();
  assert.equal(unknown.status,503);
  assert.deepEqual(JSON.parse(text),
    {status:'paper_broker_unavailable_or_unverified',reason:'PAPER_UNEXPECTED_ERROR',stage:'unknown'});
  assert.ok(!text.includes(env.ALPACA_PAPER_SECRET_KEY));
});

test('route defers to request time before authenticating and stays GET-only',()=>{
  const route=readFileSync(new URL('../../app/api/internal/alpaca-paper/route.ts',import.meta.url),'utf8');
  const src=route.replace(/\/\/.*$/gm,'');
  assert.match(src,/import\s*\{\s*connection\s*\}\s*from\s*'next\/server'/);
  const wait=src.indexOf('await connection()');
  const handle=src.indexOf('handleDiagnosticRequest(');
  assert.ok(wait>0&&handle>wait,'connection() must run before the handler reads the request');
  for(const verb of ['POST','PUT','PATCH','DELETE'])
    assert.ok(!src.includes(`export async function ${verb}`),verb);
  assert.ok(!src.includes('use cache'));
});
