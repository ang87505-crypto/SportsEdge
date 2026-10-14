/**
 * Alpaca PAPER one-shot writer contract. Server-only, NOT a public route.
 * No caller can activate this while the checked-in release manifest is OFF.
 * An approved database-backed claim, operational STOP and broker reconciliation
 * are mandatory before this can ever be wired to a scheduled execution service.
 *
 * IMPORTANT: a staged manual "planned" draft is never an approved order.
 */
import {createHash} from 'node:crypto';
import {PAPER_AUTOMATION_RELEASE} from '../stocks/paper-automation-release.ts';
import {alpacaPaperHeaders} from './alpaca-paper-reader.ts';

const PAPER_URL='https://paper-api.alpaca.markets/v2/orders';
const HEX32=/^[a-f0-9]{32}$/;
const HEX64=/^[a-f0-9]{64}$/;
const SYMBOL=/^[A-Z]{1,5}$/;
const ACK_STATUSES=new Set([
 'accepted','pending_new','new','partially_filled','filled',
 'pending_cancel','pending_replace','done_for_day','canceled',
 'expired','rejected','replaced','accepted_for_bidding',
 'stopped','suspended','calculated','held'
]);
export type SubmissionRecord={
  environment:'SportsEdge Staging';
  accountKind:'paper';
  accountAlias:'sportsedge-paper-stage';
  status:'submitting';
  lockVersion:2;
  intentId:string;
  clientOrderId:string;
  symbol:string;
  shares:1;
  limitCents:number;
  ownerApprovalRef:string;
  modelVersion:string;
  sourceDigest:string;
  quoteVerifiedAt:string;
  approvedUntil:string;
  sessionCloseAt:string;
  signalReviewed:true;
  marketPriceReviewed:true;
  accountReconciled:true;
  receiptReconciled:true;
};
export type PreparedPaperSubmission={
 intentId:string;
 clientOrderId:string;
 url:typeof PAPER_URL;
 method:'POST';
 body:{
  symbol:string;side:'buy';type:'limit';time_in_force:'day';
  qty:'1';limit_price:string;client_order_id:string;extended_hours:false;
 };
};
export type BrokerResponseDecision=
 | {state:'broker_acknowledged';brokerOrderId:string;brokerStatus:string}
 | {state:'submission_uncertain';reason:'HTTP_UNCERTAIN'|'INVALID_REPLY'|'MISMATCH'|'UNKNOWN_STATUS'};
export class PaperWriteError extends Error{
 readonly code:'RELEASE_OFF'|'INVALID_RECORD'|'INVALID_CLOCK'|'CREDENTIALS'|
 'GATE_UNAVAILABLE'|'CLAIM_NOT_PROVEN'|'NETWORK_UNCERTAIN'|'RECEIPT_UNCERTAIN';
 constructor(code:PaperWriteError['code']){
  super('Alpaca PAPER writer is blocked or requires reconciliation');
  this.name='PaperWriteError';this.code=code;
 }
}
function utc(value:unknown):number{
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))
  return NaN;
 const ms=Date.parse(value);
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,19)===value.slice(0,19)?ms:NaN;
}
export function derivePaperClientOrderId(intentId:string):string{
 if(typeof intentId!=='string'||!/^preview-[a-f0-9]{32}$/.test(intentId))
  throw new PaperWriteError('INVALID_RECORD');
 return 'sepaper_'+createHash('sha256')
  .update('sportsedge-unapproved-paper-test-v1\0'+intentId).digest('hex').slice(0,32);
}
export function preparePaperSubmission(record:unknown,clock:string):PreparedPaperSubmission{
 const now=utc(clock);
 if(!Number.isFinite(now))throw new PaperWriteError('INVALID_CLOCK');
 if(!record||typeof record!=='object'||Array.isArray(record))
  throw new PaperWriteError('INVALID_RECORD');
 const r=record as Record<string,unknown>;
 const verified=utc(r.quoteVerifiedAt),expiry=utc(r.approvedUntil),
       close=utc(r.sessionCloseAt);
 if(r.environment!=='SportsEdge Staging'||r.accountKind!=='paper'||
  r.accountAlias!=='sportsedge-paper-stage'||r.status!=='submitting'||
  r.lockVersion!==2||typeof r.intentId!=='string'||
  !/^preview-[a-f0-9]{32}$/.test(r.intentId)||
  typeof r.clientOrderId!=='string'||
  r.clientOrderId!==derivePaperClientOrderId(r.intentId)||
  typeof r.symbol!=='string'||!SYMBOL.test(r.symbol)||
  r.shares!==1||!Number.isSafeInteger(r.limitCents)||
  (r.limitCents as number)<1||(r.limitCents as number)>2500||
  typeof r.ownerApprovalRef!=='string'||!/^owner-[a-f0-9]{32}$/.test(r.ownerApprovalRef)||
  typeof r.modelVersion!=='string'||!r.modelVersion||
  r.modelVersion.length>128||r.modelVersion.startsWith('manual-unverified')||
  typeof r.sourceDigest!=='string'||!HEX64.test(r.sourceDigest)||
  r.signalReviewed!==true||r.marketPriceReviewed!==true||
  r.accountReconciled!==true||r.receiptReconciled!==true||
  !Number.isFinite(verified)||!Number.isFinite(expiry)||!Number.isFinite(close)||
  verified>now||now-verified>60_000||
  expiry<=now||expiry>now+5*60_000||
  close<=now+20*60_000||close>now+9*60*60_000
 )throw new PaperWriteError('INVALID_RECORD');
 const limitCents=r.limitCents as number;
 return Object.freeze({
  intentId:r.intentId,clientOrderId:r.clientOrderId,
  url:PAPER_URL,method:'POST' as const,
  body:Object.freeze({
   symbol:r.symbol,side:'buy' as const,type:'limit' as const,
   time_in_force:'day' as const,qty:'1' as const,
   limit_price:`${Math.floor(limitCents/100)}.${String(limitCents%100).padStart(2,'0')}`,
   client_order_id:r.clientOrderId,extended_hours:false as const
  })
 });
}
function moneyCents(input:unknown):number{
 if(typeof input!=='string'||!/^\d{1,6}(?:\.\d{1,2})?$/.test(input))return NaN;
 const [whole,frac='']=input.split('.');
 return Number(whole)*100+Number(frac.padEnd(2,'0'));
}
/** A 4xx, timeout, invalid 2xx, or 5xx must NEVER cause an automatic retry. */
export function classifyPaperPostResponse(
 httpStatus:number,raw:unknown,prepared:PreparedPaperSubmission
):BrokerResponseDecision{
 if(!Number.isInteger(httpStatus)||httpStatus<200||httpStatus>=300)
  return {state:'submission_uncertain',reason:'HTTP_UNCERTAIN'};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
  return {state:'submission_uncertain',reason:'INVALID_REPLY'};
 const v=raw as Record<string,unknown>;
 if(typeof v.id!=='string'||v.id.length<1||v.id.length>128||
    typeof v.client_order_id!=='string'||
    v.client_order_id!==prepared.clientOrderId||
    v.symbol!==prepared.body.symbol||v.side!=='buy'||
    v.type!=='limit'||v.time_in_force!=='day'||
    v.qty!=='1'||moneyCents(v.limit_price)!==moneyCents(prepared.body.limit_price)||
    (v.legs!==undefined&&v.legs!==null&&!(Array.isArray(v.legs)&&v.legs.length===0)))
  return {state:'submission_uncertain',reason:'MISMATCH'};
 if(typeof v.status!=='string'||!ACK_STATUSES.has(v.status))
  return {state:'submission_uncertain',reason:'UNKNOWN_STATUS'};
 return {state:'broker_acknowledged',brokerOrderId:v.id,brokerStatus:v.status};
}
/** Runtime release requires deliberate reviewed source changes to ALL safety flags.
 * Vercel env vars, browser input, scheduler events and function arguments
 * CANNOT toggle these hard-coded flags.
 */
export function assertPaperWriterReleased():void{
 if(!PAPER_AUTOMATION_RELEASE.paperOnly||
  !PAPER_AUTOMATION_RELEASE.placeOrdersEnabled||
  PAPER_AUTOMATION_RELEASE.realMoneyEnabled||
  !PAPER_AUTOMATION_RELEASE.durableReceiptStoreReady||
  !PAPER_AUTOMATION_RELEASE.emergencyStopOperational||
  !PAPER_AUTOMATION_RELEASE.verifiedLiveSignalSource||
  !PAPER_AUTOMATION_RELEASE.brokerReconciliationComplete)
  throw new PaperWriteError('RELEASE_OFF');
}
export type PaperWritePorts={
 /** Single durable transaction from owner_approved v1 to submitting v2.
  * Must fail if owner approval, gate, cap, clock or CAS is not authoritative.
  */
 claimOnce:(intentId:string,expectedVersion:1)=>Promise<SubmissionRecord|null>;
 /** Must read independent operational STOP immediately before network call. */
 halted:()=>Promise<boolean>;
 /** Must persist receipt version 3; failure leaves submission ambiguous. */
 acknowledge:(intentId:string,brokerId:string,brokerStatus:string)=>Promise<boolean>;
 uncertain:(intentId:string,reason:string)=>Promise<void>;
};
/**
 * Disabled production one-shot orchestration. NEVER expose in a public route.
 * A repeated invocation CANNOT submit after claimOnce has consumed version 1.
 * Every possible ambiguous outcome locks the intent, including failed writes.
 * Future integration needs an audited, server-only database-backed port.
 */
export async function submitApprovedPaperOrderOnce(
 intentId:string,credentials:{keyId:string;secretKey:string},
 ports:PaperWritePorts,fetcher:typeof fetch=fetch,now:()=>string=()=>new Date().toISOString()
):Promise<BrokerResponseDecision>{
 assertPaperWriterReleased(); // FIRST statement: no runtime invocation is enabled.
 if(typeof intentId!=='string'||!/^preview-[a-f0-9]{32}$/.test(intentId))
  throw new PaperWriteError('INVALID_RECORD');
 let claimed:SubmissionRecord|null;
 try{claimed=await ports.claimOnce(intentId,1);}
 catch{throw new PaperWriteError('CLAIM_NOT_PROVEN');}
 if(!claimed)throw new PaperWriteError('CLAIM_NOT_PROVEN');
 let submitted=false;
 const ambiguous=async(reason:string):Promise<BrokerResponseDecision>=>{
  try{await ports.uncertain(intentId,reason);}catch{/* retain locked submitting receipt */ }
  return {state:'submission_uncertain',reason:'HTTP_UNCERTAIN'};
 };
 try{
  const prepared=preparePaperSubmission(claimed,now());
  let halted:boolean;
  try{halted=await ports.halted();}catch{return ambiguous('GATE_UNAVAILABLE');}
  if(halted!==false)return ambiguous('GATE_UNAVAILABLE');
  let headers:Record<string,string>;
  try{headers=alpacaPaperHeaders(credentials);}catch{return ambiguous('CREDENTIALS');}
  // No retries. Never redirect to live trading; output URL is fixed by source.
  let response:Response;
  try{
   submitted=true;
   response=await fetcher(PAPER_URL,{
    method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8500),
    headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify(prepared.body)
   });
  }catch{return ambiguous('NETWORK_UNCERTAIN');}
  let text:string;
  try{text=await response.text();}catch{return ambiguous('NETWORK_UNCERTAIN');}
  if(text.length>20_000)return ambiguous('OVERSIZED_REPLY');
  let raw:unknown;
  try{raw=JSON.parse(text) as unknown;}catch{return ambiguous('INVALID_REPLY');}
  const decision=classifyPaperPostResponse(response.status,raw,prepared);
  if(decision.state==='submission_uncertain')return ambiguous(decision.reason);
  try{
   if(await ports.acknowledge(intentId,decision.brokerOrderId,decision.brokerStatus)!==true)
    return ambiguous('ACK_PERSISTENCE_UNCERTAIN');
  }catch{return ambiguous('ACK_PERSISTENCE_UNCERTAIN');}
  return decision;
 }catch{
  // Invalid approval after an atomic claim cannot be retried either.
  return ambiguous(submitted?'POST_FAILURE':'PRE_SEND_BLOCKED');
 }
}
