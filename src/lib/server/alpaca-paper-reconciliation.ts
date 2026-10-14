/**
 * Alpaca PAPER historical-order reconciliation, READ-ONLY.
 * Never submit, modify, replace or cancel orders from this module.
 * A complete view requires exhausting the account's paginated orders; it is
 * NOT inferred from the private dashboard's 25 most recent orders.
 *
 * This module must remain server-only. Fail closed for truncation, pagination
 * ambiguity, unexpected broker statuses, bad payloads and missing history.
 */
import {alpacaPaperHeaders} from './alpaca-paper-reader.ts';

const PAPER_HOST='https://paper-api.alpaca.markets';
const PAGE_SIZE=500;
const MAX_PAGES=12;
const MAX_BYTES=2_000_000;
type PaperSettings={keyId:string;secretKey:string};
type FetchLike=typeof fetch;
const OPEN=new Set(['new','accepted','pending_new','accepted_for_bidding',
 'partially_filled','pending_cancel','pending_replace','done_for_day',
 'stopped','suspended','calculated','held']);
const CLOSED=new Set(['filled','canceled','expired','rejected','replaced']);
export type NormalizedPaperOrder={
 id:string;
 clientOrderId:string|null;
 symbol:string;
 side:'buy'|'sell';
 status:string;
 submittedAt:string;
 filledQty:string;
 qty:string;
};
export type PaperOrderInventory={
 source:'alpaca_paper_order_history';
 pageCount:number;
 checkedAt:string;
 historyComplete:true;
 openOrdersComplete:true;
 totalOrders:number;
 openOrders:NormalizedPaperOrder[];
 allOrders:NormalizedPaperOrder[];
 /** Could be false even with a complete inventory: unresolved account receipts matter. */
 safeForExecution:false;
};
export class PaperReconciliationError extends Error {
 readonly reason:'AUTH'|'ACCESS'|'THROTTLED'|'NETWORK'|'UPSTREAM'|
  'BAD_PAYLOAD'|'UNVERIFIABLE_HISTORY'|'HISTORY_TOO_LARGE'|'NOT_FOUND';
 readonly stage:'history'|'lookup';
 constructor(reason:PaperReconciliationError['reason'],stage:PaperReconciliationError['stage']) {
  super('Alpaca paper read-only reconciliation unavailable');
  this.name='PaperReconciliationError';
  this.reason=reason;
  this.stage=stage;
 }
}
function isObject(v:unknown):v is Record<string,unknown>{
 return v!==null&&typeof v==='object'&&!Array.isArray(v);
}
function cleanText(v:unknown,max=128):v is string{
 return typeof v==='string'&&v.length>=1&&v.length<=max;
}
function parseOrder(raw:unknown):NormalizedPaperOrder{
 if(!isObject(raw)||!cleanText(raw.id,128)||
    !(raw.client_order_id===null||raw.client_order_id===undefined||cleanText(raw.client_order_id,128))||
    !cleanText(raw.symbol,16)||!(/^[A-Z][A-Z0-9.-]{0,15}$/).test(raw.symbol)||
    (raw.side!=='buy'&&raw.side!=='sell')||!cleanText(raw.status,50)||
    !cleanText(raw.submitted_at,50)||!Number.isFinite(Date.parse(raw.submitted_at))||
    typeof raw.qty!=='string'||!/^\d+(\.\d{1,9})?$/.test(raw.qty)||
    typeof raw.filled_qty!=='string'||!/^\d+(\.\d{1,9})?$/.test(raw.filled_qty)||
    (raw.legs!==null&&raw.legs!==undefined)) {
  throw new PaperReconciliationError('BAD_PAYLOAD','history');
 }
 if(!OPEN.has(raw.status)&&!CLOSED.has(raw.status))
  throw new PaperReconciliationError('UNVERIFIABLE_HISTORY','history');
 return {id:raw.id,clientOrderId:raw.client_order_id??null,
  symbol:raw.symbol,side:raw.side,status:raw.status,
  submittedAt:raw.submitted_at,qty:raw.qty,filledQty:raw.filled_qty};
}
async function getPaperJson(url:URL,config:PaperSettings,fetcher:FetchLike,stage:'history'|'lookup'){
 if(url.origin!==PAPER_HOST)throw new PaperReconciliationError('BAD_PAYLOAD',stage);
 let res:Response;
 try {
  res=await fetcher(url.toString(),{method:'GET',headers:alpacaPaperHeaders(config),
    redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});
 } catch{throw new PaperReconciliationError('NETWORK',stage);}
 if(!res.ok){
  const reason=res.status===401?'AUTH':res.status===403?'ACCESS':res.status===429?'THROTTLED':
   res.status===404&&stage==='lookup'?'NOT_FOUND':'UPSTREAM';
  // Never include provider reply text, headers, IDs or raw error in errors/logs.
  throw new PaperReconciliationError(reason,stage);
 }
 let raw:string;
 try{raw=await res.text();}catch{throw new PaperReconciliationError('NETWORK',stage);}
 if(raw.length>MAX_BYTES)throw new PaperReconciliationError('HISTORY_TOO_LARGE',stage);
 try{return JSON.parse(raw) as unknown;}catch{throw new PaperReconciliationError('BAD_PAYLOAD',stage);}
}
/**
 * GET all account order pages using the documented before_order_id cursor.
 * Fail closed at the page limit instead of treating a partial list as complete.
 * May be provider-expensive; run on-demand in an owner-reviewed diagnostic only.
 * Only a FULL inventory can be used for historical order deduplication.
 */
export async function readCompletePaperOrderInventory(
 config:PaperSettings,fetcher:FetchLike=fetch,
 now:()=>string=()=>new Date().toISOString()
):Promise<PaperOrderInventory>{
 const seenIds=new Set<string>(),seenClientIds=new Set<string>();
 const all:NormalizedPaperOrder[]=[];
 let cursor:string|null=null;
 let priorOldestMs=Number.POSITIVE_INFINITY;
 const cursorSet=new Set<string>();
 for(let page=0;page<MAX_PAGES;page++){
  const url=new URL('/v2/orders',PAPER_HOST);
  url.searchParams.set('status','all');
  url.searchParams.set('limit',String(PAGE_SIZE));
  url.searchParams.set('direction','desc');
  url.searchParams.set('nested','false');
  if(cursor)url.searchParams.set('before_order_id',cursor);
  const raw=await getPaperJson(url,config,fetcher,'history');
  if(!Array.isArray(raw)||raw.length>PAGE_SIZE)
    throw new PaperReconciliationError('BAD_PAYLOAD','history');
  const orders=raw.map(parseOrder);
  for(const o of orders){
   const submittedMs=Date.parse(o.submittedAt);
   if(submittedMs>priorOldestMs||seenIds.has(o.id)||
      (o.clientOrderId!==null&&seenClientIds.has(o.clientOrderId)))
    throw new PaperReconciliationError('UNVERIFIABLE_HISTORY','history');
   seenIds.add(o.id);
   if(o.clientOrderId!==null)seenClientIds.add(o.clientOrderId);
   priorOldestMs=submittedMs;
   all.push(o);
  }
  if(orders.length<PAGE_SIZE){
   const capturedAt=now();
   if(!Number.isFinite(Date.parse(capturedAt)))throw new PaperReconciliationError('BAD_PAYLOAD','history');
   return {source:'alpaca_paper_order_history',pageCount:page+1,
    checkedAt:capturedAt,historyComplete:true,openOrdersComplete:true,
    totalOrders:all.length,allOrders:all,
    openOrders:all.filter(o=>OPEN.has(o.status)),safeForExecution:false};
  }
  const last=orders.at(-1)?.id;
  if(!last||cursorSet.has(last))throw new PaperReconciliationError('UNVERIFIABLE_HISTORY','history');
  cursorSet.add(last);
  cursor=last;
 }
 throw new PaperReconciliationError('HISTORY_TOO_LARGE','history');
}
/**
 * Read by deterministic client ID to resolve an uncertain POST response in
 * a future release. A 404 is "not observed" and is NEVER proof that a broker
 * submission was rejected or that it is safe to retry.
 */
export async function inspectPaperOrderByClientId(
 config:PaperSettings,clientOrderId:string,fetcher:FetchLike=fetch
):Promise<{status:'found';order:NormalizedPaperOrder}|{status:'not_observed_retry_forbidden'}>{
 if(!/^[a-zA-Z0-9_-]{1,48}$/.test(clientOrderId))
  throw new PaperReconciliationError('BAD_PAYLOAD','lookup');
 const url=new URL('/v2/orders:by_client_order_id',PAPER_HOST);
 url.searchParams.set('client_order_id',clientOrderId);
 try {
  const raw=await getPaperJson(url,config,fetcher,'lookup');
  const order=parseOrder(raw);
  if(order.clientOrderId!==clientOrderId)
   throw new PaperReconciliationError('UNVERIFIABLE_HISTORY','lookup');
  return {status:'found',order};
 }catch(e){
  if(e instanceof PaperReconciliationError&&e.reason==='NOT_FOUND')
   return {status:'not_observed_retry_forbidden'};
  throw e;
 }
}
