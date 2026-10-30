/**
 * Alpaca PAPER broker adapter for the recurring controller. SERVER/WORKER ONLY.
 * Fixed hosts: the PAPER trading API and the market-data API. There is no live
 * host, no caller-controlled URL, method or redirect, and no retry of any POST.
 * Order writes (POST and DELETE /v2/orders) refuse to run while the checked-in
 * release manifest is OFF; read methods never write.
 */
import {createHash} from 'node:crypto';
import {alpacaPaperHeaders} from './alpaca-paper-reader.ts';
import {PAPER_AUTO_RELEASE} from '../stocks/paper-auto-release.ts';
import {nyLocalToUtcMs,iso} from './paper-auto-time.ts';

const PAPER='https://paper-api.alpaca.markets';
const DATA='https://data.alpaca.markets';
const OPEN_STATES=new Set(['new','accepted','pending_new','accepted_for_bidding','partially_filled',
 'pending_cancel','pending_replace','done_for_day','stopped','suspended','calculated','held']);
const CLOSED_STATES=new Set(['filled','canceled','expired','rejected','replaced']);
type Settings={keyId:string;secretKey:string};
type Json=Record<string,unknown>;

export type BrokerAccount={id:string;accountNumber:string;status:string;currency:string;
 cashCents:number;equityCents:number;lastEquityCents:number;longMarketValueCents:number;
 buyingPowerCents:number;tradingBlocked:boolean;accountBlocked:boolean;readAt:string};
export type BrokerPosition={symbol:string;assetId:string;qty:string;side:'long'|'short';marketValueCents:number;
 costBasisCents:number};
export type BrokerOrder={id:string;clientOrderId:string|null;symbol:string;side:'buy'|'sell';
 type:string;timeInForce:string;status:string;qty:string;filledQty:string;
 filledAvgPrice:string|null;limitPrice:string|null;submittedAt:string;extendedHours:boolean};
export type BrokerClock={timestamp:string;isOpen:boolean;nextOpen:string;nextClose:string};
export type BrokerSession={date:string;openAt:string;closeAt:string};
export type BrokerQuote={symbol:string;bidCents:number;askCents:number;observedAt:string;feed:'iex'};
export type BrokerActivity={id:string;activityType:string;at:string;symbol:string|null;
 side:'buy'|'sell'|null;qty:string|null;price:string|null;netAmountCents:number|null;
 orderId:string|null;rawDigest:string};
export type OrderRequest={clientOrderId:string;symbol:string;side:'buy'|'sell';shares:number;limitCents:number};
export type SubmitOutcome=
 | {kind:'acknowledged';order:BrokerOrder}
 | {kind:'rejected';httpStatus:400|401|403|422;code:string;message:string}
 | {kind:'duplicate_client_id'}
 | {kind:'uncertain';reason:string};
export type CancelOutcome='requested'|'not_cancelable'|'not_found';
export type DailyClose={symbol:string;session:string;close:string;source:string};
export interface PaperAutoBroker{
 readonly writesEnabled:boolean;
 account():Promise<BrokerAccount>;
 positions():Promise<BrokerPosition[]>;
 openOrders():Promise<BrokerOrder[]>;
 /** null means "not observed", which is NEVER proof that a submission failed. */
 orderByClientId(clientOrderId:string):Promise<BrokerOrder|null>;
 /** Every order submitted after afterIso, in any status; INCOMPLETE rather than a partial list. */
 ordersSubmittedSince(afterIso:string):Promise<BrokerOrder[]>;
 submitLimitOrder(order:OrderRequest):Promise<SubmitOutcome>;
 cancelOrder(brokerOrderId:string):Promise<CancelOutcome>;
 clock():Promise<BrokerClock>;
 session(date:string):Promise<BrokerSession|null>;
 latestQuotes(symbols:string[]):Promise<Map<string,BrokerQuote>>;
 activitiesSince(afterIso:string):Promise<BrokerActivity[]>;
 dailyClose(symbol:string,session:string):Promise<DailyClose|null>;
}
export class PaperAutoBrokerError extends Error{
 readonly code:'AUTH'|'ACCESS'|'THROTTLED'|'UPSTREAM'|'NETWORK'|'BAD_PAYLOAD'|'TOO_LARGE'|
  'NOT_FOUND'|'INCOMPLETE'|'RELEASE_OFF'|'INVALID_REQUEST';
 constructor(code:PaperAutoBrokerError['code']){
  super('Alpaca PAPER broker request failed');
  this.name='PaperAutoBrokerError';this.code=code;
 }
}
function bad():never{throw new PaperAutoBrokerError('BAD_PAYLOAD');}
function object(v:unknown):Json{
 if(!v||typeof v!=='object'||Array.isArray(v))bad();
 return v as Json;
}
function text(v:unknown,max=128):string{
 if(typeof v!=='string'||v.length<1||v.length>max)bad();
 return v;
}
function stamp(v:unknown):string{
 const s=text(v,64);
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(s)||!Number.isFinite(Date.parse(s)))bad();
 return s;
}
function quantity(v:unknown):string{
 const s=text(v,32);
 if(!/^\d{1,10}(\.\d{1,9})?$/.test(s))bad();
 return s;
}
function symbolOf(v:unknown):string{
 const s=text(v,16);
 if(!/^[A-Z][A-Z0-9.-]{0,15}$/.test(s))bad();
 return s;
}
/** Exact decimal dollars to integer cents, rounded toward negative infinity. */
export function dollarsToCents(v:unknown):number{
 const s=text(v,32),m=/^(-?)(\d{1,13})(?:\.(\d{1,9}))?$/.exec(s);
 if(!m)bad();
 const frac=(m[3]??'').padEnd(9,'0');
 const whole=Number(m[2])*100+Number(frac.slice(0,2));
 const rest=Number(frac.slice(2))>0;
 const cents=m[1]==='-'?-(whole+(rest?1:0)):whole;
 if(!Number.isSafeInteger(cents))bad();
 return cents;
}
/** Quote prices must be exact cents; sub-cent quotes are rejected, not rounded. */
export function quoteCents(v:unknown):number{
 if(typeof v==='number'){
  if(!Number.isFinite(v)||v<0||v>1_000_000)bad();
  const c=Math.round(v*100);
  if(Math.abs(v*100-c)>1e-6)bad();
  return c;
 }
 const s=text(v,24);
 if(!/^\d{1,7}(\.\d{1,2})?$/.test(s))bad();
 return dollarsToCents(s);
}
export function limitPriceText(cents:number):string{
 if(!Number.isSafeInteger(cents)||cents<1||cents>100_000_000)throw new PaperAutoBrokerError('INVALID_REQUEST');
 return `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
}
export function parseOrder(raw:unknown):BrokerOrder{
 const o=object(raw);
 if((o.legs!==null&&o.legs!==undefined&&!(Array.isArray(o.legs)&&o.legs.length===0))||
  (o.side!=='buy'&&o.side!=='sell'))bad();
 const status=text(o.status,40);
 if(!OPEN_STATES.has(status)&&!CLOSED_STATES.has(status))bad();
 return {id:text(o.id),clientOrderId:o.client_order_id==null?null:text(o.client_order_id),
  symbol:symbolOf(o.symbol),side:o.side,type:text(o.type ?? o.order_type,20),
  timeInForce:text(o.time_in_force,8),status,qty:quantity(o.qty),filledQty:quantity(o.filled_qty),
  filledAvgPrice:o.filled_avg_price==null?null:quantity(o.filled_avg_price),
  limitPrice:o.limit_price==null?null:quantity(o.limit_price),submittedAt:stamp(o.submitted_at),
  extendedHours:o.extended_hours===true};
}
export function isOpenOrder(o:BrokerOrder):boolean{return OPEN_STATES.has(o.status);}
/** The only acknowledgement: an order body that matches the request exactly. */
export function classifyOrderPost(httpStatus:number,body:string,request:OrderRequest):SubmitOutcome{
 let raw:unknown;
 try{raw=JSON.parse(body) as unknown;}catch{raw=undefined;}
 if(httpStatus>=200&&httpStatus<300){
  if(raw===undefined)return {kind:'uncertain',reason:'INVALID_REPLY'};
  let order:BrokerOrder;
  try{order=parseOrder(raw);}catch{return {kind:'uncertain',reason:'INVALID_REPLY'};}
  if(order.clientOrderId!==request.clientOrderId||order.symbol!==request.symbol||
   order.side!==request.side||order.type!=='limit'||order.timeInForce!=='day'||
   order.qty!==String(request.shares)||order.extendedHours||order.limitPrice===null||
   dollarsToCents(order.limitPrice)!==request.limitCents)
   return {kind:'uncertain',reason:'MISMATCH'};
  return {kind:'acknowledged',order};
 }
 if([400,401,403,422].includes(httpStatus)&&raw&&typeof raw==='object'&&!Array.isArray(raw)){
  const r=raw as Json,code=r.code,message=typeof r.message==='string'?r.message.slice(0,200):'';
  if(code===40010001||/client_order_id/i.test(message))return {kind:'duplicate_client_id'};
  if(Number.isSafeInteger(code))
   return {kind:'rejected',httpStatus:httpStatus as 400|401|403|422,code:String(code),message};
 }
 return {kind:'uncertain',reason:'HTTP_'+(Number.isInteger(httpStatus)?httpStatus:'UNKNOWN')};
}
/** Classifies Alpaca non-trade activity types; anything else is unsupported ('other'). */
export function classifyActivityType(type:string):'dividend'|'fee'|'external_cashflow'|'corporate_action'|'other'{
 if(['FEE','CFEE','PTC','DIVFEE'].includes(type))return 'fee';
 if(/^DIV[A-Z]*$/.test(type))return 'dividend';
 if(['CSD','CSW','TRANS','JNL','JNLC','JNLS','ACATC','ACATS'].includes(type))return 'external_cashflow';
 if(['MA','NC','REORG','SC','SSO','SSP','OPASN','OPEXP','OPXRC'].includes(type))return 'corporate_action';
 return 'other';
}
function canonical(v:unknown):string{
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v&&typeof v==='object')return '{'+Object.keys(v as Json).sort().map(k=>
  JSON.stringify(k)+':'+canonical((v as Json)[k])).join(',')+'}';
 return JSON.stringify(v);
}
export function parseActivity(raw:unknown):BrokerActivity{
 const a=object(raw),type=text(a.activity_type,8);
 if(!/^[A-Z]{2,8}$/.test(type))bad();
 const id=text(a.id,128);
 if(!/^[A-Za-z0-9:._-]{8,128}$/.test(id))bad();
 const digest=createHash('sha256').update(canonical(a)).digest('hex');
 if(type==='FILL'){
  if(a.side!=='buy'&&a.side!=='sell')bad();
  return {id,activityType:type,at:stamp(a.transaction_time),symbol:symbolOf(a.symbol),side:a.side,
   qty:quantity(a.qty),price:quantity(a.price),netAmountCents:null,orderId:text(a.order_id),rawDigest:digest};
 }
 // Non-trade activities carry a date; it is recorded at 00:00 New York of that date.
 const date=text(a.date,40);
 const at=/^\d{4}-\d{2}-\d{2}$/.test(date)?iso(nyLocalToUtcMs(date,'00:00')):stamp(date);
 return {id,activityType:type,at,symbol:a.symbol==null?null:symbolOf(a.symbol),side:null,
  qty:a.qty==null?null:quantity(String(a.qty).replace(/^-/,'')),price:null,
  netAmountCents:a.net_amount==null?null:dollarsToCents(String(a.net_amount)),orderId:null,rawDigest:digest};
}

type Request={method:'GET'|'POST'|'DELETE';origin:typeof PAPER|typeof DATA;path:string;
 query?:Record<string,string>;body?:string;maxBytes:number;timeoutMs:number};
/** Real HTTPS adapter. Reads are GET-only; writes require PAPER_AUTO_RELEASE. */
export function alpacaPaperAutoBroker(settings:Settings,fetcher:typeof fetch=fetch,
 now:()=>number=()=>Date.now()):PaperAutoBroker{
 const headers=alpacaPaperHeaders(settings);
 async function send(r:Request):Promise<{status:number;body:string}>{
  if(![PAPER,DATA].includes(r.origin)||!r.path.startsWith('/v2/'))throw new PaperAutoBrokerError('INVALID_REQUEST');
  if(r.method!=='GET'&&(r.origin!==PAPER||!/^\/v2\/orders(\/[A-Za-z0-9-]{1,128})?$/.test(r.path)))
   throw new PaperAutoBrokerError('INVALID_REQUEST');
  const url=new URL(r.path,r.origin);
  for(const [k,v] of Object.entries(r.query??{}))url.searchParams.set(k,v);
  if(url.origin!==r.origin)throw new PaperAutoBrokerError('INVALID_REQUEST');
  let response:Response;
  try{
   response=await fetcher(url.toString(),{method:r.method,cache:'no-store',redirect:'error',
    signal:AbortSignal.timeout(r.timeoutMs),
    headers:r.body===undefined?headers:{...headers,'Content-Type':'application/json'},body:r.body});
  }catch{throw new PaperAutoBrokerError('NETWORK');}
  let body:string;
  try{body=await response.text();}catch{throw new PaperAutoBrokerError('NETWORK');}
  if(body.length>r.maxBytes)throw new PaperAutoBrokerError('TOO_LARGE');
  return {status:response.status,body};
 }
 async function getJson(origin:Request['origin'],path:string,query:Record<string,string>={},
  maxBytes=200_000):Promise<unknown>{
  const {status,body}=await send({method:'GET',origin,path,query,maxBytes,timeoutMs:12_000});
  if(status<200||status>=300){
   throw new PaperAutoBrokerError(status===401?'AUTH':status===403?'ACCESS':status===429?'THROTTLED':
    status===404?'NOT_FOUND':'UPSTREAM');
  }
  try{return JSON.parse(body) as unknown;}catch{bad();}
 }
 function requireWrites(){
  if(!PAPER_AUTO_RELEASE.paperOnly||PAPER_AUTO_RELEASE.realMoneyEnabled||
   (PAPER_AUTO_RELEASE.brokerWritesEnabled as boolean)!==true)throw new PaperAutoBrokerError('RELEASE_OFF');
 }
 return {
  writesEnabled:(PAPER_AUTO_RELEASE.brokerWritesEnabled as boolean)===true&&!PAPER_AUTO_RELEASE.realMoneyEnabled,
  async account(){
   const a=object(await getJson(PAPER,'/v2/account'));
   if(typeof a.trading_blocked!=='boolean'||typeof a.account_blocked!=='boolean')bad();
   return {id:text(a.id,36),accountNumber:text(a.account_number,32),status:text(a.status,32),
    currency:text(a.currency,8),cashCents:dollarsToCents(a.cash),equityCents:dollarsToCents(a.equity),
    lastEquityCents:dollarsToCents(a.last_equity),longMarketValueCents:dollarsToCents(a.long_market_value),
    buyingPowerCents:dollarsToCents(a.buying_power),tradingBlocked:a.trading_blocked,
    accountBlocked:a.account_blocked,readAt:iso(now())};
  },
  async positions(){
   const raw=await getJson(PAPER,'/v2/positions',{},1_000_000);
   if(!Array.isArray(raw)||raw.length>200)bad();
   return raw.map(r=>{
    const p=object(r);
    if(p.side!=='long'&&p.side!=='short')bad();
    return {symbol:symbolOf(p.symbol),assetId:text(p.asset_id,64),qty:quantity(p.qty),side:p.side,
     marketValueCents:dollarsToCents(p.market_value),costBasisCents:dollarsToCents(p.cost_basis)};
   });
  },
  async openOrders(){
   const raw=await getJson(PAPER,'/v2/orders',{status:'open',limit:'500',nested:'false',direction:'asc'},2_000_000);
   if(!Array.isArray(raw))bad();
   if(raw.length>=500)throw new PaperAutoBrokerError('INCOMPLETE');
   return raw.map(parseOrder);
  },
  async orderByClientId(clientOrderId){
   if(!/^sepa[a-f0-9]{40}$/.test(clientOrderId))throw new PaperAutoBrokerError('INVALID_REQUEST');
   try{
    const order=parseOrder(await getJson(PAPER,'/v2/orders:by_client_order_id',{client_order_id:clientOrderId}));
    if(order.clientOrderId!==clientOrderId)bad();
    return order;
   }catch(e){
    if(e instanceof PaperAutoBrokerError&&e.code==='NOT_FOUND')return null;
    throw e;
   }
  },
  async submitLimitOrder(order){
   requireWrites();
   if(!/^sepa[a-f0-9]{40}$/.test(order.clientOrderId)||!/^[A-Z][A-Z0-9.-]{0,9}$/.test(order.symbol)||
    !Number.isSafeInteger(order.shares)||order.shares<1||order.shares>1_000_000)
    throw new PaperAutoBrokerError('INVALID_REQUEST');
   const body=JSON.stringify({symbol:order.symbol,qty:String(order.shares),side:order.side,type:'limit',
    time_in_force:'day',limit_price:limitPriceText(order.limitCents),client_order_id:order.clientOrderId,
    extended_hours:false});
   // Exactly one attempt. A transport failure is an unknown outcome, never a retry.
   let reply:{status:number;body:string};
   try{reply=await send({method:'POST',origin:PAPER,path:'/v2/orders',body,maxBytes:50_000,timeoutMs:8_500});}
   catch(e){return {kind:'uncertain',reason:e instanceof PaperAutoBrokerError?e.code:'NETWORK'};}
   return classifyOrderPost(reply.status,reply.body,order);
  },
  async cancelOrder(brokerOrderId){
   requireWrites();
   if(!/^[A-Za-z0-9-]{1,128}$/.test(brokerOrderId))throw new PaperAutoBrokerError('INVALID_REQUEST');
   const {status}=await send({method:'DELETE',origin:PAPER,path:'/v2/orders/'+brokerOrderId,
    maxBytes:50_000,timeoutMs:8_500});
   if(status===204||status===200)return 'requested';
   if(status===404)return 'not_found';
   if(status===422)return 'not_cancelable';
   throw new PaperAutoBrokerError(status===429?'THROTTLED':'UPSTREAM');
  },
  async clock(){
   const c=object(await getJson(PAPER,'/v2/clock'));
   if(typeof c.is_open!=='boolean')bad();
   return {timestamp:stamp(c.timestamp),isOpen:c.is_open,nextOpen:stamp(c.next_open),nextClose:stamp(c.next_close)};
  },
  async session(date){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new PaperAutoBrokerError('INVALID_REQUEST');
   const raw=await getJson(PAPER,'/v2/calendar',{start:date,end:date});
   if(!Array.isArray(raw)||raw.length>1)bad();
   if(raw.length===0)return null;
   const s=object(raw[0]);
   if(s.date!==date||typeof s.open!=='string'||typeof s.close!=='string'||
    !/^\d{2}:\d{2}$/.test(s.open)||!/^\d{2}:\d{2}$/.test(s.close))bad();
   const open=nyLocalToUtcMs(date,s.open),close=nyLocalToUtcMs(date,s.close);
   if(!(open<close&&close-open<=9*3_600_000))bad();
   return {date,openAt:iso(open),closeAt:iso(close)};
  },
  async latestQuotes(symbols){
   if(symbols.length<1||symbols.length>50||symbols.some(s=>!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)))
    throw new PaperAutoBrokerError('INVALID_REQUEST');
   // The free market-data plan provides real-time IEX quotes only (not SIP).
   const raw=object(await getJson(DATA,'/v2/stocks/quotes/latest',{symbols:symbols.join(','),feed:'iex'}));
   const quotes=object(raw.quotes),out=new Map<string,BrokerQuote>();
   for(const symbol of symbols){
    const q=quotes[symbol];
    if(q===undefined)continue;
    const v=object(q);
    out.set(symbol,{symbol,bidCents:quoteCents(v.bp),askCents:quoteCents(v.ap),observedAt:stamp(v.t),feed:'iex'});
   }
   return out;
  },
  async ordersSubmittedSince(afterIso){
   if(!Number.isFinite(Date.parse(afterIso)))throw new PaperAutoBrokerError('INVALID_REQUEST');
   const out=new Map<string,BrokerOrder>();
   let cursor=iso(Date.parse(afterIso)-1);
   for(let page=0;page<20;page++){
    const raw=await getJson(PAPER,'/v2/orders',{status:'all',limit:'500',nested:'false',direction:'asc',
     after:cursor},5_000_000);
    if(!Array.isArray(raw)||raw.length>500)bad();
    const orders=raw.map(parseOrder);
    let fresh=0;
    for(const o of orders)if(!out.has(o.id)){out.set(o.id,o);fresh++;}
    if(orders.length<500)return [...out.values()];
    if(!fresh)throw new PaperAutoBrokerError('INCOMPLETE');
    // Step back 1 ms so orders sharing the boundary timestamp are re-read and deduplicated, never skipped.
    cursor=iso(Date.parse(orders[orders.length-1].submittedAt)-1);
   }
   throw new PaperAutoBrokerError('INCOMPLETE');
  },
  async activitiesSince(afterIso){
   if(!Number.isFinite(Date.parse(afterIso)))throw new PaperAutoBrokerError('INVALID_REQUEST');
   const out:BrokerActivity[]=[],seen=new Set<string>();
   let token:string|null=null;
   for(let page=0;page<20;page++){
    const query:Record<string,string>={direction:'asc',page_size:'100',after:afterIso};
    if(token)query.page_token=token;
    const raw=await getJson(PAPER,'/v2/account/activities',query,1_000_000);
    if(!Array.isArray(raw)||raw.length>100)bad();
    for(const r of raw){
     const a=parseActivity(r);
     if(seen.has(a.id))throw new PaperAutoBrokerError('INCOMPLETE');
     seen.add(a.id);out.push(a);
    }
    if(raw.length<100)return out;
    token=out[out.length-1].id;
   }
   throw new PaperAutoBrokerError('INCOMPLETE');
  },
  async dailyClose(symbol,session){
   if(!/^[A-Z]{1,5}$/.test(symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(session))
    throw new PaperAutoBrokerError('INVALID_REQUEST');
   // Free historical SIP bars must end at least 15 minutes in the past.
   const end=iso(Math.min(now()-16*60_000,nyLocalToUtcMs(session,'23:59')));
   const raw=object(await getJson(DATA,'/v2/stocks/bars',{symbols:symbol,timeframe:'1Day',
    start:session,end,adjustment:'raw',feed:'sip',limit:'5'}));
   const bars=object(raw.bars)[symbol];
   if(bars===undefined)return null;
   if(!Array.isArray(bars))bad();
   for(const b of bars){
    const bar=object(b);
    if(typeof bar.t==='string'&&bar.t.slice(0,10)===session&&typeof bar.c==='number'&&bar.c>0)
     return {symbol,session,close:bar.c.toFixed(4).replace(/0+$/,'').replace(/\.$/,''),
      source:'alpaca:sip:1Day:adjustment=raw'};
   }
   return null;
  }
 };
}
