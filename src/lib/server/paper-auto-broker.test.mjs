import test from 'node:test';
import assert from 'node:assert/strict';
import {alpacaPaperAutoBroker,classifyOrderPost,classifyActivityType,dollarsToCents,quoteCents,
 parseOrder,parseActivity,limitPriceText,PaperAutoBrokerError} from './paper-auto-broker.ts';
import {stagingPaperAutoStore,refusalCode,PaperAutoStoreError} from './paper-auto-store.ts';
import {nyDate,nyLocalToUtcMs,quarterHourSlot} from './paper-auto-time.ts';
import {PAPER_AUTO_RELEASE} from '../stocks/paper-auto-release.ts';

const KEYS={keyId:'PKTESTKEY00000001',secretKey:'secret-test-value-0000000001'};
const REQ={clientOrderId:'sepa'+'a'.repeat(40),symbol:'AAA',side:'buy',shares:3,limitCents:3001};
const order=(over={})=>({id:'b-1',client_order_id:REQ.clientOrderId,symbol:'AAA',side:'buy',type:'limit',
 time_in_force:'day',status:'accepted',qty:'3',filled_qty:'0',filled_avg_price:null,limit_price:'30.01',
 submitted_at:'2026-10-19T13:45:01Z',extended_hours:false,legs:null,...over});
function recorder(routes){
 const calls=[];
 const fetcher=async(url,init)=>{
  calls.push({url:String(url),method:init.method,headers:init.headers,redirect:init.redirect,body:init.body});
  const u=new URL(String(url));
  const hit=routes.find(([prefix])=>(u.origin+u.pathname).startsWith(prefix));
  if(!hit)return new Response('{"message":"no route"}',{status:599});
  const [,status,body]=typeof hit[1]==='function'?hit[1](u,calls.length):[hit[0],hit[1],hit[2]];
  return new Response(typeof body==='string'?body:JSON.stringify(body),{status});
 };
 return {calls,fetcher};
}

test('the recurring release manifest is OFF in source',()=>{
 assert.deepEqual(PAPER_AUTO_RELEASE,{paperOnly:true,brokerWritesEnabled:false,scheduledRunsEnabled:false,
  realMoneyEnabled:false});
});

test('a POST acknowledgement must match the request exactly',()=>{
 assert.equal(classifyOrderPost(200,JSON.stringify(order()),REQ).kind,'acknowledged');
 for(const over of [{qty:'4'},{limit_price:'30.02'},{client_order_id:'sepa'+'b'.repeat(40)},
  {time_in_force:'gtc'},{extended_hours:true},{side:'sell'},{symbol:'AAB'},{type:'market'}])
  assert.deepEqual(classifyOrderPost(200,JSON.stringify(order(over)),REQ),{kind:'uncertain',reason:'MISMATCH'},
   JSON.stringify(over));
 assert.deepEqual(classifyOrderPost(200,'not json',REQ),{kind:'uncertain',reason:'INVALID_REPLY'});
 assert.deepEqual(classifyOrderPost(201,JSON.stringify(order({legs:[{}]})),REQ),{kind:'uncertain',reason:'INVALID_REPLY'});
 assert.deepEqual(classifyOrderPost(200,JSON.stringify(order({status:'mystery'})),REQ),
  {kind:'uncertain',reason:'INVALID_REPLY'});
});

test('only explicit Alpaca refusals are rejections; duplicates and everything else stay uncertain',()=>{
 assert.deepEqual(classifyOrderPost(422,'{"code":40010001,"message":"client_order_id must be unique"}',REQ),
  {kind:'duplicate_client_id'});
 assert.deepEqual(classifyOrderPost(422,'{"code":42210000,"message":"client_order_id is already used"}',REQ),
  {kind:'duplicate_client_id'});
 assert.deepEqual(classifyOrderPost(403,'{"code":40310000,"message":"insufficient buying power"}',REQ),
  {kind:'rejected',httpStatus:403,code:'40310000',message:'insufficient buying power'});
 for(const [status,body] of [[403,'<html>proxy</html>'],[429,'{"code":42910000}'],[500,'{"code":50010000}'],
  [502,''],[404,'{"code":40410000}'],[302,'']])
  assert.equal(classifyOrderPost(status,body,REQ).kind,'uncertain',String(status));
});

test('money parsing is exact and conservative',()=>{
 assert.equal(dollarsToCents('100000'),10_000_000);
 assert.equal(dollarsToCents('99.999'),9999);
 assert.equal(dollarsToCents('-12.505'),-1251);
 assert.equal(dollarsToCents('0.01'),1);
 for(const bad of ['1e3','12.','','abc',' 1',12])assert.throws(()=>dollarsToCents(bad),PaperAutoBrokerError);
 assert.equal(quoteCents(182.37),18237);
 assert.equal(quoteCents('30.01'),3001);
 assert.throws(()=>quoteCents(182.375),PaperAutoBrokerError);
 assert.equal(limitPriceText(3001),'30.01');
 assert.equal(limitPriceText(5),'0.05');
 assert.throws(()=>limitPriceText(0),PaperAutoBrokerError);
});

test('orders with legs or unknown states are rejected as payloads',()=>{
 assert.equal(parseOrder(order()).limitPrice,'30.01');
 assert.throws(()=>parseOrder(order({legs:[{id:'x'}]})),PaperAutoBrokerError);
 assert.throws(()=>parseOrder(order({status:'new_state'})),PaperAutoBrokerError);
 assert.throws(()=>parseOrder(order({side:'short'})),PaperAutoBrokerError);
});

test('activities: fills keep their order id; dated activities land at 00:00 New York',()=>{
 const fill=parseActivity({id:'20261019134501000::f1',activity_type:'FILL',transaction_time:'2026-10-19T13:45:01Z',
  symbol:'AAA',side:'buy',qty:'3',price:'30.01',order_id:'b-1',type:'fill',cum_qty:'3',leaves_qty:'0'});
 assert.equal(fill.orderId,'b-1');assert.match(fill.rawDigest,/^[a-f0-9]{64}$/);
 const div=parseActivity({id:'20261102000000000::d1',activity_type:'DIV',date:'2026-11-02',net_amount:'1.23',
  symbol:'AAA',qty:'3',per_share_amount:'0.41'});
 assert.equal(div.at,'2026-11-02T05:00:00.000Z');
 assert.equal(div.netAmountCents,123);
 assert.equal(classifyActivityType('DIV'),'dividend');
 assert.equal(classifyActivityType('DIVFEE'),'fee');
 assert.equal(classifyActivityType('CSD'),'external_cashflow');
 assert.equal(classifyActivityType('JNLS'),'external_cashflow');
 assert.equal(classifyActivityType('SSP'),'corporate_action');
 assert.equal(classifyActivityType('MA'),'corporate_action');
 assert.equal(classifyActivityType('INT'),'other');
 assert.equal(classifyActivityType('MISC'),'other');
});

test('with writes released OFF, POST and DELETE never reach the network',async()=>{
 const {calls,fetcher}=recorder([]);
 const broker=alpacaPaperAutoBroker(KEYS,fetcher);
 assert.equal(broker.writesEnabled,false);
 await assert.rejects(()=>broker.submitLimitOrder(REQ),e=>e instanceof PaperAutoBrokerError&&e.code==='RELEASE_OFF');
 await assert.rejects(()=>broker.cancelOrder('b-1'),e=>e instanceof PaperAutoBrokerError&&e.code==='RELEASE_OFF');
 assert.equal(calls.length,0);
});

test('reads use GET on the fixed PAPER and data hosts only, with no redirects',async()=>{
 const {calls,fetcher}=recorder([
  ['https://paper-api.alpaca.markets/v2/account',200,{id:'00000001-1111-2222-3333-444444444444',
   account_number:'PA0X',status:'ACTIVE',currency:'USD',cash:'1000.00',equity:'1000.00',last_equity:'1000',
   long_market_value:'0',buying_power:'1000',trading_blocked:false,account_blocked:false}],
  ['https://paper-api.alpaca.markets/v2/positions',200,[]],
  ['https://paper-api.alpaca.markets/v2/orders:by_client_order_id',404,{message:'not found'}],
  ['https://paper-api.alpaca.markets/v2/orders',200,[order()]],
  ['https://paper-api.alpaca.markets/v2/clock',200,{timestamp:'2026-11-02T09:31:00-05:00',is_open:true,
   next_open:'2026-11-03T09:30:00-05:00',next_close:'2026-11-02T16:00:00-05:00'}],
  ['https://paper-api.alpaca.markets/v2/calendar',200,[{date:'2026-11-27',open:'09:30',close:'13:00'}]],
  ['https://data.alpaca.markets/v2/stocks/quotes/latest',200,{quotes:{AAA:{ap:30.01,bp:30,as:1,bs:1,
   t:'2026-11-02T14:31:00.1Z'}}}],
 ]);
 const broker=alpacaPaperAutoBroker(KEYS,fetcher,()=>Date.parse('2026-11-02T14:31:01Z'));
 assert.equal((await broker.account()).equityCents,100000);
 assert.deepEqual(await broker.positions(),[]);
 assert.equal((await broker.openOrders()).length,1);
 assert.equal(await broker.orderByClientId(REQ.clientOrderId),null,'404 is "not observed", never proof');
 assert.equal((await broker.clock()).isOpen,true);
 assert.deepEqual(await broker.session('2026-11-27'),{date:'2026-11-27',openAt:'2026-11-27T14:30:00.000Z',
  closeAt:'2026-11-27T18:00:00.000Z'});
 assert.equal((await broker.latestQuotes(['AAA'])).get('AAA').askCents,3001);
 for(const c of calls){
  assert.equal(c.method,'GET');assert.equal(c.redirect,'error');assert.equal(c.body,undefined);
  assert.ok(['https://paper-api.alpaca.markets','https://data.alpaca.markets'].includes(new URL(c.url).origin));
  assert.equal(c.headers['APCA-API-KEY-ID'],KEYS.keyId);
 }
 assert.ok(calls.some(c=>c.url.includes('feed=iex')));
 assert.ok(calls.some(c=>c.url.includes('status=open')&&c.url.includes('limit=500')));
 await assert.rejects(()=>broker.orderByClientId('not-a-client-id'),PaperAutoBrokerError);
});

test('a full page of open orders is incomplete, and activities page by token',async()=>{
 const full=Array.from({length:500},(_,k)=>order({id:'b-'+k,client_order_id:null}));
 const page=(n,from)=>Array.from({length:n},(_,k)=>({id:`2026101913450${String(from+k).padStart(4,'0')}::a`,
  activity_type:'FILL',transaction_time:'2026-10-19T13:45:01Z',symbol:'AAA',side:'buy',qty:'1',price:'30',
  order_id:'b-'+(from+k)}));
 const {calls,fetcher}=recorder([
  ['https://paper-api.alpaca.markets/v2/orders',200,full],
  ['https://paper-api.alpaca.markets/v2/account/activities',(u)=>
   [u,200,u.searchParams.get('page_token')?page(3,100):page(100,0)]],
 ]);
 const broker=alpacaPaperAutoBroker(KEYS,fetcher);
 await assert.rejects(()=>broker.openOrders(),e=>e.code==='INCOMPLETE');
 const acts=await broker.activitiesSince('2026-10-19T11:00:00Z');
 assert.equal(acts.length,103);
 assert.equal(new URL(calls.at(-1).url).searchParams.get('page_token'),acts[99].id);
});

test('order history pages through every status without skipping a shared boundary timestamp',async()=>{
 // One order per second, except that orders 498-501 share a timestamp across the first page boundary.
 const at=(k)=>new Date(Date.parse('2026-10-19T13:45:00Z')+1000*(k>=498&&k<=501?498:k)).toISOString();
 const all=Array.from({length:1203},(_,k)=>order({id:'b-'+k,client_order_id:'sepa'+String(k).padStart(40,'0'),
  status:'filled',filled_qty:'3',filled_avg_price:'30.01',submitted_at:at(k)}));
 const {calls,fetcher}=recorder([['https://paper-api.alpaca.markets/v2/orders',(u)=>{
  const after=Date.parse(u.searchParams.get('after'));
  return [u,200,all.filter(o=>Date.parse(o.submitted_at)>after).slice(0,500)];
 }]]);
 const history=await alpacaPaperAutoBroker(KEYS,fetcher).ordersSubmittedSince('2026-10-19T13:45:00.000Z');
 assert.equal(history.length,1203,'orders sharing the boundary timestamp are re-read, not skipped');
 assert.equal(new Set(history.map(o=>o.id)).size,1203);
 for(const c of calls){
  const u=new URL(c.url);
  assert.equal(c.method,'GET');
  assert.deepEqual([u.searchParams.get('status'),u.searchParams.get('direction'),u.searchParams.get('limit')],
   ['all','asc','500']);
 }
 assert.equal(new URL(calls[0].url).searchParams.get('after'),'2026-10-19T13:44:59.999Z');
 // A full page that adds nothing new cannot progress: incomplete, never a partial history.
 const stuck=recorder([['https://paper-api.alpaca.markets/v2/orders',(u)=>[u,200,all.slice(0,500).map(o=>
  ({...o,submitted_at:'2026-10-19T13:45:00.000Z'}))]]]);
 await assert.rejects(()=>alpacaPaperAutoBroker(KEYS,stuck.fetcher).ordersSubmittedSince('2026-10-19T13:00:00Z'),
  e=>e.code==='INCOMPLETE');
 await assert.rejects(()=>alpacaPaperAutoBroker(KEYS,stuck.fetcher).ordersSubmittedSince('yesterday'),
  e=>e.code==='INVALID_REQUEST');
});

test('the benchmark close uses free historical SIP bars ending at least 15 minutes ago',async()=>{
 const {calls,fetcher}=recorder([['https://data.alpaca.markets/v2/stocks/bars',200,
  {bars:{SPY:[{t:'2026-10-19T04:00:00Z',o:580,h:582,l:579,c:581.25,v:1}]}}]]);
 const broker=alpacaPaperAutoBroker(KEYS,fetcher,()=>Date.parse('2026-10-19T20:30:00Z'));
 assert.deepEqual(await broker.dailyClose('SPY','2026-10-19'),{symbol:'SPY',session:'2026-10-19',close:'581.25',
  source:'alpaca:sip:1Day:adjustment=raw'});
 const u=new URL(calls[0].url);
 assert.equal(u.searchParams.get('feed'),'sip');
 assert.ok(Date.parse(u.searchParams.get('end'))<=Date.parse('2026-10-19T20:14:00Z'));
});

test('the store is pinned to staging, posts {p}, and separates refusals from unknown outcomes',async()=>{
 assert.throws(()=>stagingPaperAutoStore({}),e=>e.code==='NOT_CONFIGURED');
 assert.throws(()=>stagingPaperAutoStore({SPORTSEDGE_STAGING_SUPABASE_URL:'https://evil.supabase.co',
  SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY:'x'.repeat(40)}),e=>e.code==='INVALID_CONFIG');
 const env={SPORTSEDGE_STAGING_SUPABASE_URL:'https://mcaxfaaohyencpspalfe.supabase.co',
  SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY:'sb_secret_'+'x'.repeat(30)};
 const replies=[[200,'{"state":"STOPPED"}'],[400,'{"code":"P0001","message":"PAPER_AUTO_NOT_ARMED"}'],
  [409,'{"code":"23505","message":"duplicate key value"}'],[503,'upstream'],[504,'{"message":"PAPER_AUTO_X_Y"}']];
 const seen=[];
 const store=stagingPaperAutoStore(env,async(url,init)=>{
  seen.push({url:String(url),body:init.body});
  const [status,body]=replies.shift();
  return new Response(body,{status});
 });
 assert.deepEqual(await store.call('status',{experiment_id:'e-1'}),{state:'STOPPED'});
 assert.equal(seen[0].url,'https://mcaxfaaohyencpspalfe.supabase.co/rest/v1/rpc/sportsedge_paper_auto_status');
 assert.equal(seen[0].body,'{"p":{"experiment_id":"e-1"}}');
 await assert.rejects(()=>store.call('claim_intent',{}),e=>e.code==='PAPER_AUTO_NOT_ARMED'&&e.refused===true);
 await assert.rejects(()=>store.call('reserve_intents',{}),e=>e.code==='DB_23505'&&e.refused===true);
 await assert.rejects(()=>store.call('claim_intent',{}),e=>e.code==='STORE_HTTP_503'&&e.refused===false);
 await assert.rejects(()=>store.call('claim_intent',{}),e=>e.code==='PAPER_AUTO_X_Y'&&e.refused===false);
 await assert.rejects(()=>store.call('drop_everything',{}),e=>e instanceof PaperAutoStoreError&&e.code==='RPC_NOT_ALLOWED');
 assert.equal(refusalCode('{"message":"PAPER_AUTO_LEASE_NOT_HELD"}'),'PAPER_AUTO_LEASE_NOT_HELD');
 assert.equal(refusalCode('<html>'),null);
});

test('New York session helpers handle the November 1 2026 DST change',()=>{
 assert.equal(nyDate(Date.parse('2026-10-20T03:59:59Z')),'2026-10-19');
 assert.equal(nyDate(Date.parse('2026-11-02T04:59:59Z')),'2026-11-01');
 assert.equal(new Date(nyLocalToUtcMs('2026-10-30','09:30')).toISOString(),'2026-10-30T13:30:00.000Z');
 assert.equal(new Date(nyLocalToUtcMs('2026-11-02','09:30')).toISOString(),'2026-11-02T14:30:00.000Z');
 assert.equal(new Date(nyLocalToUtcMs('2026-11-02','08:00')).toISOString(),'2026-11-02T13:00:00.000Z');
 assert.equal(quarterHourSlot(Date.parse('2026-11-02T14:59:59.999Z')),'2026-11-02T14:45Z');
 assert.equal(quarterHourSlot(Date.parse('2026-11-02T15:00:00Z')),'2026-11-02T15:00Z');
});
