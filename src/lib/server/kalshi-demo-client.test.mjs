import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,constants} from 'node:crypto';
import {kalshiDemoClient,KalshiDemoError,demoFixedMicros,KALSHI_DEMO_ORIGIN} from './kalshi-demo-client.ts';
import {NOW} from './kalshi-platform-test-kit.mjs';
const id='00000000-0000-4000-8000-000000000001',ticker='KXHIGHNY-26NOV21-T60';
const ed=generateKeyPairSync('ed25519'),rsa=generateKeyPairSync('rsa',{modulusLength:2048});
const env=pair=>({KALSHI_DEMO_KEY_ID:'synthetic-demo-key-id',KALSHI_DEMO_PRIVATE_KEY:pair.privateKey.export({type:'pkcs8',format:'pem'}),
 KALSHI_DEMO_ACCESS_APPROVED:'1',KALSHI_DEMO_PERMISSION_REFERENCE:'SYNTHETIC-TEST-ONLY'});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const ack=(extra={})=>({order_id:id,client_order_id:id,fill_count:'0.50',remaining_count:'0.00',average_fill_price:'0.6000',average_fee_paid:'0.0100',ts_ms:Date.parse(NOW),...extra});
const order={clientOrderId:id,ticker,side:'no',priceMicros:400000};
test('no credentials or reviewed demo access means zero network calls',()=>{
 let calls=0;const fake=async()=>{calls++;throw Error('no');};
 assert.throws(()=>kalshiDemoClient({},fake),/ACCOUNT_NOT_CONFIGURED/);
 assert.throws(()=>kalshiDemoClient({...env(ed),KALSHI_DEMO_ACCESS_APPROVED:'0'},fake),/ACCESS_NOT_REVIEWED/);
 assert.throws(()=>kalshiDemoClient({...env(ed),KALSHI_DEMO_PRIVATE_KEY:'bad'},fake),/INVALID_KEY/);
 assert.equal(calls,0);
});
for(const [name,pair] of [['Ed25519',ed],['RSA-PSS',rsa]])test(name+' signs the exact path without query and uses the pinned demo host',async()=>{
 const client=kalshiDemoClient(env(pair),async(url,opts)=>{
  assert.ok(url.startsWith(KALSHI_DEMO_ORIGIN+'/trade-api/v2/'));
  assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');
  const h=opts.headers,path=new URL(url).pathname,message=Buffer.from(h['KALSHI-ACCESS-TIMESTAMP']+opts.method+path);
  assert.ok(verify(name==='Ed25519'?null:'sha256',message,name==='Ed25519'?pair.publicKey:
   {key:pair.publicKey,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32},Buffer.from(h['KALSHI-ACCESS-SIGNATURE'],'base64')));
  if(path.endsWith('/balance'))return response({balance_dollars:'10.123456',portfolio_value:123,updated_ts:Date.parse(NOW)/1000});
  if(path.endsWith('/positions'))return response({market_positions:[],cursor:''});
  return response({orders:[],cursor:''});
 },()=>Date.parse(NOW));
 const account=await client.account();assert.equal(account.cashMicros,10123456);assert.equal(account.portfolioValueMicros,1230000);
});
test('V2 NO buy is an ask on YES at the complementary fixed-point price and one IOC contract',async()=>{
 let calls=0;
 const client=kalshiDemoClient(env(ed),async(url,opts)=>{
  calls++;assert.equal(url,KALSHI_DEMO_ORIGIN+'/trade-api/v2/portfolio/events/orders');assert.equal(opts.method,'POST');
  assert.deepEqual(JSON.parse(opts.body),{ticker,client_order_id:id,side:'ask',count:'1.00',price:'0.6000',
   time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',cancel_order_on_pause:true});
  return response(ack(),201);
 },()=>Date.parse(NOW));
 const result=await client.submit(order);assert.equal(calls,1);assert.equal(result.filledMicros,500000);assert.equal(result.source,'KALSHI_DEMO');
});
test('invalid tick, ticker, identity and non-positive price are refused before any POST',async()=>{
 let calls=0;const c=kalshiDemoClient(env(ed),async()=>{calls++;return response(ack(),201);},()=>Date.parse(NOW));
 for(const extra of [{priceMicros:0},{priceMicros:405000},{ticker:'https://attacker.invalid'},{clientOrderId:'invalid'},{side:'maybe'}])
  await assert.rejects(c.submit({...order,...extra}),/INVALID_ORDER/);
 assert.equal(calls,0);
});
test('a lost reply is unknown and POST is attempted only once',async()=>{
 let calls=0;const c=kalshiDemoClient(env(ed),async()=>{calls++;throw Error('lost');},()=>Date.parse(NOW));
 await assert.rejects(c.submit(order),e=>e instanceof KalshiDemoError&&e.outcomeUnknown);
 assert.equal(calls,1);
});
test('bad acknowledgements, worse fills, future receipt clocks and invalid IOC remainder are unknown',async()=>{
 for(const extra of [{average_fill_price:'0.5500'},{client_order_id:'wrong'},{fill_count:'1.01'},
  {remaining_count:'0.10'},{ts_ms:Date.parse(NOW)+31000}]){
  let calls=0;const c=kalshiDemoClient(env(ed),async()=>{calls++;return response(ack(extra),201);},()=>Date.parse(NOW));
  await assert.rejects(c.submit(order),e=>e instanceof KalshiDemoError&&e.outcomeUnknown);assert.equal(calls,1);
 }
});
test('zero fill is preserved without requiring invented fill prices or fees',async()=>{
 const c=kalshiDemoClient(env(ed),async()=>response(ack({fill_count:'0.00',average_fill_price:undefined,average_fee_paid:undefined}),201),()=>Date.parse(NOW));
 const a=await c.submit(order);assert.equal(a.filledMicros,0);assert.equal(a.averageFeeMicros,null);assert.equal(a.averageYesPriceMicros,null);
});
test('HTTP errors never expose a response body or credential and ambiguous status is not a rejection',async()=>{
 for(const [status,unknown] of [[400,false],[401,false],[409,true],[503,true]]){
  const c=kalshiDemoClient(env(ed),async()=>response({privateKey:'do-not-expose-this'},status),()=>Date.parse(NOW));
  await assert.rejects(c.submit(order),e=>{assert.equal(e.outcomeUnknown,unknown);assert.doesNotMatch(e.message,/do-not-expose|PRIVATE KEY/);return true;});
 }
});
test('overlong pagination cannot be mistaken for an empty or complete portfolio',async()=>{
 const c=kalshiDemoClient(env(ed),async url=>url.includes('/balance')?response({balance_dollars:'10.00',portfolio_value:0}):
  url.includes('/positions')?response({market_positions:[],cursor:''}):response({orders:[],cursor:'more'}),()=>Date.parse(NOW));
 await assert.rejects(c.account(),/PAGINATION_INCOMPLETE/);
});
test('demo result requires final binary settlement; preliminary or fair-price results never grade',async()=>{
 const market={ticker,event_ticker:'KXHIGHNY-26NOV21',status:'finalized',result:'yes',settlement_value_dollars:'1.0000',
  settlement_ts:'2026-11-20T19:00:00Z',rules_primary:'Central Park test',rules_secondary:null};
 const result=m=>kalshiDemoClient(env(ed),async()=>response({market:m}),()=>Date.parse(NOW)).result(ticker);
 assert.equal((await result(market)).source,'KALSHI_DEMO');
 assert.equal(await result({...market,status:'determined'}),null);
 assert.equal(await result({...market,is_provisional:true}),null);
 await assert.rejects(result({...market,settlement_value_dollars:'0.98'}),/SETTLEMENT_UNVERIFIED/);
});
test('fixed-point account amounts retain signs and microdollars without silent rounding',()=>{
 assert.equal(demoFixedMicros('-0.000001'),-1);assert.equal(demoFixedMicros('10.123456'),10123456);
 assert.throws(()=>demoFixedMicros('1.1234567'));assert.throws(()=>demoFixedMicros(123));
});
