import test from 'node:test';
import assert from 'node:assert/strict';
import {readCompletePaperOrderInventory,inspectPaperOrderByClientId,PaperReconciliationError}
 from './alpaca-paper-reconciliation.ts';

const credentials={keyId:'PAPERKEY123456',secretKey:'PAPERSECRET000000000000'};
const t0=Date.parse('2026-10-14T12:00:00Z');
const order=(i,override={})=>({
 id:'paper-order-'+i,client_order_id:'se_paper_'+i,
 symbol:'AAPL',side:'buy',status:'filled',
 submitted_at:new Date(t0-i*1000).toISOString(),qty:'2',filled_qty:'2',
 ...override
});
function mockPages(pages){
 const urls=[];
 const fetcher=async(url,opts)=>{
  urls.push(String(url));
  assert.equal(opts.method,'GET');
  assert.ok(String(url).startsWith('https://paper-api.alpaca.markets/v2/orders'));
  assert.equal(opts.redirect,'error');
  const index=urls.length-1;
  if(index>=pages.length)throw Error('Unexpected fetch');
  const body=pages[index];
  if(body instanceof Response)return body;
  return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
 };
 return {fetcher,urls};
}
test('Exhausts multiple 500-row pages by documented before_order_id cursor',async()=>{
 const one=Array.from({length:500},(_,i)=>order(i));
 const two=[order(500,{status:'new',filled_qty:'0'}),order(501,{status:'canceled',filled_qty:'0'})];
 const m=mockPages([one,two]);
 const snapshot=await readCompletePaperOrderInventory(credentials,m.fetcher,()=>'2026-10-14T12:05:00Z');
 assert.equal(snapshot.pageCount,2);
 assert.equal(snapshot.totalOrders,502);
 assert.equal(snapshot.historyComplete,true);
 assert.equal(snapshot.openOrdersComplete,true);
 assert.equal(snapshot.openOrders.length,1);
 assert.equal(snapshot.openOrders[0].id,'paper-order-500');
 assert.equal(snapshot.safeForExecution,false);
 assert.equal(new URL(m.urls[0]).searchParams.get('before_order_id'),null);
 assert.equal(new URL(m.urls[1]).searchParams.get('before_order_id'),'paper-order-499');
 assert.ok(!JSON.stringify(snapshot).includes('PAPERSECRET'));
});
test('Exactly 500 orders requires a confirming empty next page',async()=>{
 const m=mockPages([Array.from({length:500},(_,i)=>order(i)),[]]);
 assert.equal((await readCompletePaperOrderInventory(credentials,m.fetcher)).pageCount,2);
});
test('Reject incomplete history at bounded pagination cap',async()=>{
 const f=async(url)=>{const u=new URL(url);let n=0;
  const cursor=u.searchParams.get('before_order_id');
  if(cursor)n=Number(cursor.split('-').at(-1))+1;
  return new Response(JSON.stringify(Array.from({length:500},(_,i)=>order(n+i))));
 };
 await assert.rejects(()=>readCompletePaperOrderInventory(credentials,f),e=>
  e instanceof PaperReconciliationError&&e.reason==='HISTORY_TOO_LARGE');
});
test('Reject duplicate IDs, reused client IDs, reordered pages and unknown status',async()=>{
 for(const pages of [
  [[order(0),order(0)]],
  [[order(0),order(1,{client_order_id:'se_paper_0'})]],
  [[order(1),order(0)]],
  [[order(0,{status:'arbitrary_unknown_state'})]],
  [[order(0,{legs:[{id:'hidden-leg'}]})]],
  [[order(0,{symbol:'../bad'})]],
  [[order(0,{qty:'NaN'})]],
  [{}],
  [[order(0)],{wrong:'payload'}]
 ]){
  const m=mockPages(pages);
  if(pages.length===2&&Array.isArray(pages[0])&&pages[0].length===1)continue;
  await assert.rejects(()=>readCompletePaperOrderInventory(credentials,m.fetcher));
 }
});
test('Transport, 401 and oversized reply fail closed with only fixed codes',async()=>{
 for(const [f,reason] of [
  [async()=>{throw Error('secret transport text')},'NETWORK'],
  [async()=>new Response('sensitive html',{status:401}),'AUTH'],
  [async()=>new Response('x'.repeat(2_000_001)),'HISTORY_TOO_LARGE']
 ]){
  await assert.rejects(()=>readCompletePaperOrderInventory(credentials,f),e=>
   e instanceof PaperReconciliationError&&e.reason===reason&&
   !String(e).includes('secret')&&!String(e).includes('sensitive'));
 }
});
test('Lookup by client id is exact, GET-only; 404 never authorizes retry',async()=>{
 const m=mockPages([order(0)]);
 const found=await inspectPaperOrderByClientId(credentials,'se_paper_0',m.fetcher);
 assert.equal(found.status,'found');
 assert.equal(found.order.clientOrderId,'se_paper_0');
 assert.ok(m.urls[0].includes('orders:by_client_order_id'));
 const missing=await inspectPaperOrderByClientId(credentials,'se_paper_missing',
  async()=>new Response('not found',{status:404}));
 assert.deepEqual(missing,{status:'not_observed_retry_forbidden'});
 await assert.rejects(()=>inspectPaperOrderByClientId(credentials,'secret?a=2',m.fetcher));
 await assert.rejects(()=>inspectPaperOrderByClientId(credentials,'se_paper_0',
  async()=>new Response(JSON.stringify(order(1)))));
});
