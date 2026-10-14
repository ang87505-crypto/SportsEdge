import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFirstPaperOrder,PreflightError} from './alpaca-first-order-preflight.ts';
const now='2026-10-14T15:00:00Z'; // 11 AM New York, regular session
const stamp='2026-10-14T14:59:45Z';
const settings={keyId:'test-paper-key-id',secretKey:'a long dummy paper secret key'};
function sampleFetch(changes={}){
 const calls=[];
 const route={
 '/v2/account':{status:'ACTIVE',currency:'USD',equity:'100000.00',
  cash:'100000.00',portfolio_value:'100000.00',buying_power:'100000.00',
  account_blocked:false,trading_blocked:false},
 '/v2/positions':[],
 '/v2/orders?status=all&limit=25&direction=desc':[],
 '/v2/orders?status=all&limit=500&direction=desc&nested=false':[],
 '/v2/assets/F':{symbol:'F',status:'active',asset_class:'us_equity',exchange:'NYSE',tradable:true},
 '/v2/clock':{is_open:true,timestamp:now,next_close:'2026-10-14T20:00:00Z'},
 '/v2/stocks/F/quotes/latest?feed=iex':{quote:{bp:12.45,ap:12.50,bs:100,as:100,t:stamp}}
 };
 Object.assign(route,changes);
 const fetcher=async(url,opts)=>{
  const u=new URL(url);
  calls.push({url,method:opts?.method});
  assert.equal(opts?.method,'GET','no broker POSTs permitted');
  assert.ok(['paper-api.alpaca.markets','data.alpaca.markets'].includes(u.host));
  assert.equal(opts?.redirect,'error');
  const payload=route[u.pathname+u.search];
  if(payload===undefined)return new Response('missing',{status:404});
  if(payload instanceof Response)return payload;
  return new Response(JSON.stringify(payload),{status:200});
 };
 return {fetcher,calls};
}
const stage=async()=>({halted:true,storedIntentCount:0,unresolvedReceiptCount:0});
test('Owner preflight reads paper account, complete order history, asset, clock and IEX quote only',async()=>{
 const {fetcher,calls}=sampleFetch();
 const v=await inspectFirstPaperOrder('F',1250,settings,fetcher,stage,()=>now);
 assert.equal(calls.length,7);
 assert.ok(calls.every(c=>c.method==='GET'));
 assert.equal(v.status,'READ_ONLY_PREFLIGHT');
 assert.equal(v.marketOpen,true);
 assert.equal(v.quote.askCents,1250);
 assert.equal(v.completedBrokerOrderPages,1);
 assert.equal(v.staging,'HALTED');
 assert.deepEqual(v.blockers,['STAGING_EMERGENCY_STOP_ENGAGED',
  'NO_OWNER_APPROVED_EXECUTION_PATH','NO_DURABLE_BROKER_ORDER_RELEASE']);
 assert.equal(v.executionPermitted,false);
 assert.equal(v.brokerOrderSubmitted,false);
});
test('Client cannot set symbol, shares or limit economics outside strict one-share rule',async()=>{
 for(const [symbol,limit] of [['BTCUSD',100],['aapl',100],['F',0],['F',2501],['F',12.5],[null,100],['F',null],['F',Infinity]]){
  const {fetcher,calls}=sampleFetch();
  await assert.rejects(()=>inspectFirstPaperOrder(symbol,limit,settings,fetcher,stage,()=>now),
   e=>e instanceof PreflightError&&e.code==='INVALID_INPUT');
  assert.equal(calls.length,0);
 }
});
test('Blocked account, existing positions, partial signals, stale quotes and market closure never authorize',async()=>{
 const cases=[
 {'/v2/account':{status:'ACTIVE',currency:'USD',equity:'100000.00',cash:'0.00',
  portfolio_value:'100000.00',buying_power:'0.00',account_blocked:false,trading_blocked:false}},
 {'/v2/positions':[{symbol:'F',side:'long',qty:'1',market_value:'12.50'}]},
 {'/v2/clock':{is_open:false,timestamp:now,next_close:'2026-10-15T20:00:00Z'}},
 {'/v2/assets/F':{symbol:'F',status:'active',asset_class:'crypto',tradable:true,exchange:'NYSE'}},
 {'/v2/stocks/F/quotes/latest?feed=iex':{quote:{bp:12.45,ap:12.50,bs:10,as:20,t:'2026-10-14T12:30:00Z'}}},
 {'/v2/stocks/F/quotes/latest?feed=iex':{quote:{bp:12.1,ap:12.5,bs:10,as:20,t:stamp}}}
 ];
 for(const changed of cases){
  const {fetcher}=sampleFetch(changed);
  const v=await inspectFirstPaperOrder('F',1250,settings,fetcher,stage,()=>now);
  assert.ok(v.blockers.length>3);
  assert.equal(v.brokerOrderSubmitted,false);
  assert.equal(v.ownerApproved,false);
 }
});
test('No staging credential is always reported as an execution blocker',async()=>{
 const {fetcher}=sampleFetch();
 const v=await inspectFirstPaperOrder('F',1250,settings,fetcher,async()=>{
  throw Error('NOT_CONFIGURED');
 },()=>now);
 assert.equal(v.staging,'UNAVAILABLE');
 assert.ok(v.blockers.includes('STAGING_CREDENTIAL_OR_STATUS_UNAVAILABLE'));
});
test('Broker provider failures, malformed payloads and incomplete inventory fail closed',async()=>{
 for(const changed of [
  {'/v2/assets/F':new Response('no entitlement',{status:403})},
  {'/v2/assets/F':[]},
  {'/v2/stocks/F/quotes/latest?feed=iex':new Response('{not-json}')},
  {'/v2/orders?status=all&limit=500&direction=desc&nested=false':new Response('no',{status:429})}
 ]){
  const {fetcher,calls}=sampleFetch(changed);
  await assert.rejects(()=>inspectFirstPaperOrder('F',1250,settings,fetcher,stage,()=>now));
  assert.ok(calls.every(c=>c.method==='GET'));
 }
});
