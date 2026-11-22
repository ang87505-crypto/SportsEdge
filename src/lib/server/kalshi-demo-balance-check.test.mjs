import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,constants} from 'node:crypto';
import {issueOwnerSession} from './alpaca-owner-session.ts';
import {handleKalshiOwnerPost,handleKalshiTick} from './kalshi-platform-owner.ts';
import {checkKalshiDemoConnection} from './kalshi-demo-balance-check.ts';
import {kalshiDemoClient} from './kalshi-demo-client.ts';

const at=Date.parse('2026-11-22T03:45:00Z'),secret='a'.repeat(64);
const ownerEnv={SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY:secret};
const request=()=>({url:'https://sports-edge-eta.vercel.app/api/internal/kalshi-paper',
 origin:'https://sports-edge-eta.vercel.app',ownerCookie:issueOwnerSession(secret,at),
 body:{action:'check-demo-connection'}});
const report={status:'DEMO_CONNECTION_VERIFIED',source:'KALSHI_DEMO',cashMicros:100_000_000,
 checkedAt:new Date(at).toISOString(),readOnly:true}; // SYNTHETIC TEST-ONLY cash

test('an owner can verify a demo connection without invoking the data/trading client or database',async()=>{
 let checks=0,stores=0,demos=0;
 const result=await handleKalshiOwnerPost(request(),{env:ownerEnv,now:()=>at,
  connection:async()=>{checks++;return report;},
  store:()=>{stores++;throw Error('KALSHI_STORE_NOT_CONFIGURED');},
  demo:()=>{demos++;throw Error('KALSHI_DEMO_ACCESS_NOT_REVIEWED');}});
 assert.equal(result.status,200);
 assert.deepEqual(result.body,{status:'CHECKED',action:'check-demo-connection',result:report});
 assert.deepEqual([checks,stores,demos],[1,0,0]);
});

test('owner authentication, same origin and exact connection action precede the check',async()=>{
 let checks=0,bodyReads=0;
 const deps={env:ownerEnv,now:()=>at,connection:async()=>{checks++;return report;}};
 assert.equal((await handleKalshiOwnerPost({...request(),ownerCookie:undefined,
  readBody:async()=>{bodyReads++;return request().body;}},deps)).status,401);
 assert.equal((await handleKalshiOwnerPost({...request(),ownerCookie:issueOwnerSession(secret,at-31*60_000)},deps)).status,401);
 assert.equal((await handleKalshiOwnerPost({...request(),origin:'https://attacker.invalid'},deps)).status,403);
 assert.equal((await handleKalshiOwnerPost({...request(),origin:null},deps)).status,403);
 assert.equal((await handleKalshiOwnerPost({...request(),body:{action:'check-demo-connection',path:'/portfolio/orders'}},deps)).status,400);
 assert.equal((await handleKalshiOwnerPost({...request(),body:{action:'check-demo-connection',start:true}},deps)).status,400);
 assert.equal((await handleKalshiOwnerPost({...request(),body:{action:'execute-live'}},deps)).status,400);
 assert.deepEqual([checks,bodyReads],[0,0]);
});

test('scheduler access never authorizes the owner connection check',async()=>{
 let checks=0,runs=0;
 const deps={env:{...ownerEnv,CRON_SECRET:'synthetic-scheduler'},now:()=>at,
  connection:async()=>{checks++;return report;},store:()=>({}),
  run:async()=>{runs++;return {status:'COMPLETED'};}};
 assert.equal((await handleKalshiTick({authorization:'Bearer synthetic-scheduler'},deps)).status,200);
 assert.equal((await handleKalshiOwnerPost({...request(),ownerCookie:undefined},deps)).status,401);
 assert.deepEqual([checks,runs],[0,1]);
});

// Synthetic ephemeral keys and cash only. Every transport is intercepted.
const ed=generateKeyPairSync('ed25519'),rsa=generateKeyPairSync('rsa',{modulusLength:2048});
const keyEnv=(pair=ed)=>Object.freeze({...ownerEnv,KALSHI_DEMO_KEY_ID:'synthetic-demo-key-id',
 KALSHI_DEMO_PRIVATE_KEY:pair.privateKey.export({type:'pkcs8',format:'pem'})});
const good=()=>Response.json({balance:10000,balance_dollars:'100.0000',portfolio_value:0,updated_ts:123});

for(const [name,pair] of [['Ed25519',ed],['RSA-PSS',rsa]])test(name+' signs exactly one fixed demo balance GET',async()=>{
 const env=keyEnv(pair);let calls=0;
 const result=await checkKalshiDemoConnection(env,async(url,init)=>{
  calls++;assert.equal(url,'https://external-api.demo.kalshi.co/trade-api/v2/portfolio/balance');
  assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'error');
  assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.ok(init.signal instanceof AbortSignal);
  const headers=new Headers(init.headers),message=Buffer.from(String(at)+'GET/trade-api/v2/portfolio/balance');
  assert.equal(headers.get('KALSHI-ACCESS-KEY'),env.KALSHI_DEMO_KEY_ID);
  assert.equal(headers.get('KALSHI-ACCESS-TIMESTAMP'),String(at));
  const key=name==='Ed25519'?pair.publicKey:{key:pair.publicKey,padding:constants.RSA_PKCS1_PSS_PADDING,
   saltLength:constants.RSA_PSS_SALTLEN_DIGEST};
  assert.ok(verify(name==='Ed25519'?null:'sha256',message,key,Buffer.from(headers.get('KALSHI-ACCESS-SIGNATURE'),'base64')));
  return good();
 },()=>at);
 assert.deepEqual(result,report);assert.equal(calls,1);
 assert.equal(JSON.stringify(result).includes(env.KALSHI_DEMO_KEY_ID),false);
 assert.equal(JSON.stringify(result).includes('PRIVATE KEY'),false);
 assert.throws(()=>kalshiDemoClient(env,()=>{throw Error('forbidden');}),/ACCESS_NOT_REVIEWED/);
});

test('the real owner action reads only balance while data/trading access remains closed',async t=>{
 const env=keyEnv();let calls=0,stores=0,demos=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls++;assert.equal(url,'https://external-api.demo.kalshi.co/trade-api/v2/portfolio/balance');
  assert.equal(init.method,'GET');return good();
 });
 const result=await handleKalshiOwnerPost(request(),{env,now:()=>at,
  store:()=>{stores++;throw Error('forbidden');},demo:()=>{demos++;throw Error('forbidden');}});
 assert.equal(result.status,200);assert.deepEqual(result.body.result,report);
 assert.deepEqual([calls,stores,demos],[1,0,0]);
 assert.equal(env.KALSHI_DEMO_ACCESS_APPROVED,undefined);
 assert.equal(env.KALSHI_DEMO_PERMISSION_REFERENCE,undefined);
});

test('missing, malformed, unsupported and weak credentials stop before any request',async()=>{
 const ec=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),weak=generateKeyPairSync('rsa',{modulusLength:1024});
 let calls=0;const blocked=()=>{calls++;throw Error('NETWORK_FORBIDDEN');};
 for(const [env,code] of [
  [{},'ACCOUNT_NOT_CONFIGURED'],
  [{...keyEnv(),KALSHI_DEMO_KEY_ID:''},'ACCOUNT_NOT_CONFIGURED'],
  [{...keyEnv(),KALSHI_DEMO_KEY_ID:'unsafe\nheader'},'INVALID_KEY'],
  [{...keyEnv(),KALSHI_DEMO_PRIVATE_KEY:'bad'.repeat(40)},'INVALID_KEY'],
  [keyEnv(ec),'UNSUPPORTED_KEY_TYPE'],[keyEnv(weak),'INVALID_KEY'],
  [{...keyEnv(),SPORTSEDGE_PREVIEW_FIXTURES:'1'},'PREVIEW_FIXTURES'],
 ])await assert.rejects(checkKalshiDemoConnection(env,blocked,()=>at),e=>e.code===code);
 assert.equal(calls,0);
});

test('invalid clocks are rejected without a request',async()=>{
 let calls=0;const blocked=()=>{calls++;throw Error('NETWORK_FORBIDDEN');};
 for(const time of [NaN,Infinity,0,at+0.5,8_640_000_000_000_001])
  await assert.rejects(checkKalshiDemoConnection(keyEnv(),blocked,()=>time),/INVALID_CLOCK/);
 assert.equal(calls,0);
});

test('escaped PEM newlines work and environment host overrides cannot change the destination',async()=>{
 const env={...keyEnv(),KALSHI_DEMO_PRIVATE_KEY:keyEnv().KALSHI_DEMO_PRIVATE_KEY.replaceAll('\n','\\n'),
  KALSHI_API_ORIGIN:'https://external-api.kalshi.com',KALSHI_DEMO_ORIGIN:'https://attacker.invalid'};
 const result=await checkKalshiDemoConnection(env,async url=>{
  assert.equal(url,'https://external-api.demo.kalshi.co/trade-api/v2/portfolio/balance');return good();
 },()=>at);
 assert.deepEqual(result,report);
});

test('transport and HTTP failures are not retried and expose no raw body or secret',async()=>{
 const env=keyEnv(),privateText=env.KALSHI_DEMO_PRIVATE_KEY;
 for(const status of [301,401,403,429,500]){
  let calls=0;
  await assert.rejects(checkKalshiDemoConnection(env,async()=>{calls++;
   return new Response(privateText,{status,headers:{Location:'https://external-api.kalshi.com'}});
  },()=>at),e=>e.code==='HTTP_'+status&&!e.message.includes(privateText));
  assert.equal(calls,1);
 }
 let calls=0;
 await assert.rejects(checkKalshiDemoConnection(env,async()=>{calls++;throw Error(privateText);},()=>at),
  e=>e.code==='TRANSPORT_FAILED'&&!e.message.includes(privateText));
 assert.equal(calls,1);
});

test('a timeout after response headers is a sanitized transport failure without a retry',async t=>{
 const env=keyEnv(),timeout=new AbortController();let calls=0,headersReturned=false;
 t.mock.method(AbortSignal,'timeout',milliseconds=>{assert.equal(milliseconds,8000);return timeout.signal;});
 await assert.rejects(checkKalshiDemoConnection(env,async()=>{
  calls++;
  const body=new ReadableStream({pull(controller){
   assert.ok(headersReturned);
   timeout.abort(new DOMException(env.KALSHI_DEMO_PRIVATE_KEY,'TimeoutError'));
   controller.error(timeout.signal.reason);
  }},{highWaterMark:0});
  const response=new Response(body,{headers:{'content-type':'application/json'}});
  headersReturned=true;return response;
 },()=>at),error=>error.code==='TRANSPORT_FAILED'&&!error.message.includes(env.KALSHI_DEMO_PRIVATE_KEY));
 assert.equal(calls,1);
});

test('malformed balances never become a fabricated zero or usable cash value',async()=>{
 for(const data of [null,[],{}, {balance_dollars:100},{balance_dollars:'NaN'},{balance_dollars:'Infinity'},
  {balance_dollars:'-1.0000'},{balance_dollars:'1e3'},{balance_dollars:'1.0000001'},
  {balance_dollars:'9999999999.999999'}])
  await assert.rejects(checkKalshiDemoConnection(keyEnv(),async()=>Response.json(data),()=>at),/BAD_REPLY/);
 for(const [value,cash] of [['0.0000',0],['0.0001',100],['12.3456',12345600]]){
  const result=await checkKalshiDemoConnection(keyEnv(),async()=>Response.json({balance_dollars:value}),()=>at);
  assert.equal(result.cashMicros,cash);
 }
});

test('non-JSON, broken UTF-8 and oversized replies are refused',async()=>{
 for(const response of [new Response('100'),Response.json({balance_dollars:'100.0000',extra:'x'.repeat(16384)}),
  new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}}),
  new Response('{bad',{headers:{'content-type':'application/json'}})])
  await assert.rejects(checkKalshiDemoConnection(keyEnv(),async()=>response,()=>at),/BAD_REPLY/);
});
