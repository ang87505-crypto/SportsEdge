/**
 * Staging-only one-shot owner order RPC adapter. No generic trade capability,
 * no Production URL fallback, no client-side keys or cookie handling.
 */
import {createHash,randomBytes} from 'node:crypto';
import {derivePaperClientOrderId,preparePaperSubmission,
 classifyPaperPostResponse,type SubmissionRecord} from './alpaca-paper-one-shot-writer.ts';
import {alpacaPaperHeaders} from './alpaca-paper-reader.ts';
import {haltStagingPaperExecution} from './alpaca-staging-operator.ts';
import type {FirstOrderPreflight} from './alpaca-first-order-preflight.ts';

const STAGING='https://mcaxfaaohyencpspalfe.supabase.co';
const PAPER='https://paper-api.alpaca.markets/v2/orders';
type Config={keyId:string;secretKey:string};
type State={status:string;intentId?:string;symbol?:string;shares?:number;
 limitCents?:number;brokerOrderObserved?:boolean;brokerStatus?:string|null;gateHalted:boolean};
function config(){
 const url=process.env.SPORTSEDGE_STAGING_SUPABASE_URL??'';
 const key=process.env.SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY??'';
 if(url!==STAGING&&url!==STAGING+'/')throw Error('PAPER_STAGING_URL_INVALID');
 if(key.length<24||key.length>4000)throw Error('PAPER_STAGING_KEY_UNAVAILABLE');
 return key;
}
async function rpc(name:string,body:Record<string,unknown>,fetcher:typeof fetch=fetch):Promise<unknown>{
 if(!/^sportsedge_paper_(?:first_order_(?:approve|claim|gate|receipt|status)|stage_halt)$/.test(name))
  throw Error('RPC_NOT_ALLOWED');
 const key=config();
 const response=await fetcher(STAGING+'/rest/v1/rpc/'+name,{
  method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(7500),
  headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),
   'Content-Type':'application/json',Accept:'application/json'},
  body:JSON.stringify(body)
 });
 if(!response.ok)throw Error('PAPER_STAGE_RPC_UNVERIFIED');
 const text=await response.text();
 if(text.length>10000)throw Error('PAPER_STAGE_RPC_RESPONSE_LARGE');
 return JSON.parse(text) as unknown;
}
function obj(v:unknown):Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('PAPER_UNVERIFIED_RESPONSE');
 return v as Record<string,unknown>;
}
export async function oneShotStatus(){
 const x=obj(await rpc('sportsedge_paper_first_order_status',{}));
 if(typeof x.status!=='string'||typeof x.gateHalted!=='boolean')
  throw Error('PAPER_STATUS_UNVERIFIED');
 return x as State;
}
export async function oneShotGateHalted(){
 const x=obj(await rpc('sportsedge_paper_first_order_gate',{}));
 if(typeof x.halted!=='boolean')throw Error('PAPER_GATE_UNVERIFIED');
 return x.halted;
}
async function ack(intentId:string,state:'broker_acknowledged'|'submission_uncertain',
 brokerId:string|null,status:string){
 const x=obj(await rpc('sportsedge_paper_first_order_receipt',{
  p_intent:intentId,p_state:state,p_broker:brokerId,p_status:status}));
 if(x.saved!==true||x.state!==state)throw Error('RECEIPT_NOT_PROVEN');
}
function when(value:string):string{
 const ms=Date.parse(value);
 if(!Number.isFinite(ms))throw Error('INVALID_TIME');
 return new Date(ms).toISOString();
}
function approvalRequest(pre:FirstOrderPreflight){
 const suffix=randomBytes(16).toString('hex');
 const intentId='preview-'+suffix;
 const ownerRef='owner-'+randomBytes(16).toString('hex');
 const clientId=derivePaperClientOrderId(intentId);
 if(!pre.marketOpen||!pre.quote||pre.staging!=='HALTED'||
  pre.blockers.some(b=>![
   'STAGING_EMERGENCY_STOP_ENGAGED','NO_OWNER_APPROVED_EXECUTION_PATH',
   'NO_DURABLE_BROKER_ORDER_RELEASE'].includes(b)))
  throw Error('BROKER_PREFLIGHT_BLOCKED');
 const quote=pre.quote,nowMs=Date.parse(pre.checkedAt);
 if(!Number.isFinite(nowMs)||Date.parse(quote.observedAt)<nowMs-60_000||
  !pre.sessionCloseAt)throw Error('BROKER_QUOTE_EXPIRED');
 const expiry=new Date(nowMs+120_000).toISOString();
 const digest=createHash('sha256').update(JSON.stringify({
  intentId,symbol:pre.symbol,limitCents:pre.limitCents,
  quote,ownerRef,checkedAt:pre.checkedAt,
  purpose:'ONE_MANUALLY_REVIEWED_ALPACA_PAPER_TEST_NOT_MODEL_SIGNAL'
 })).digest('hex');
 return {intentId,ownerRef,clientId,digest,
  data:{p_intent:intentId,p_client:clientId,p_symbol:pre.symbol,
   p_limit:pre.limitCents,p_digest:digest,p_owner_ref:ownerRef,
   p_quote_at:when(quote.observedAt),p_until:expiry,
   p_close_at:when(pre.sessionCloseAt),
   p_bid:quote.bidCents,p_ask:quote.askCents}};
}
export type OwnerOneOrderResult={
 status:'paper_broker_acknowledged'|'paper_submission_uncertain';
 intentId:string;symbol:string;shares:1;limitCents:number;
 brokerStatus:string|null;gateHalted:boolean;requiresReconciliation:boolean;
};
export async function performOwnerOneOrder(
 pre:FirstOrderPreflight,keys:Config,fetcher:typeof fetch=fetch
):Promise<OwnerOneOrderResult>{
 // Only called after the exact branch-restricted, owner-authenticated HTTP
 // route validates the request and rechecks broker/quote/session data.
 const q=approvalRequest(pre);
 const approved=obj(await rpc('sportsedge_paper_first_order_approve',q.data));
 if(approved.status!=='owner_approved'||approved.intentId!==q.intentId||
  approved.gateHalted!==true||approved.brokerCalls!==0)
  throw Error('OWNER_APPROVAL_NOT_PROVEN');
 let submitted=false,brokerStatus:string|null=null,acknowledged=false;
 try{
  const record=obj(await rpc('sportsedge_paper_first_order_claim',{p_intent:q.intentId}));
  if(record.intentId!==q.intentId)throw Error('FIRST_ORDER_CLAIM_UNVERIFIED');
  const prepared=preparePaperSubmission(record as unknown as SubmissionRecord,
   new Date().toISOString());
  const stopped=await oneShotGateHalted();
  if(stopped!==false)throw Error('PAPER_STOP_ENGAGED');
  const credentials=alpacaPaperHeaders(keys);
  let response:Response;
  try{
   submitted=true;
   response=await fetcher(PAPER,{
    method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8500),
    headers:{...credentials,'Content-Type':'application/json'},
    body:JSON.stringify(prepared.body)});
  }catch{throw Error('BROKER_POST_OUTCOME_UNKNOWN');}
  const body=await response.text();
  if(body.length>20000)throw Error('BROKER_REPLY_TOO_LARGE');
  const decision=classifyPaperPostResponse(response.status,JSON.parse(body) as unknown,prepared);
  if(decision.state!=='broker_acknowledged')throw Error('BROKER_POST_NOT_CONFIRMED');
  brokerStatus=decision.brokerStatus;
  await ack(q.intentId,'broker_acknowledged',decision.brokerOrderId,decision.brokerStatus);
  acknowledged=true;
 }catch{
  // A failed/ambiguous claim may already have committed. NEVER retry a POST.
  // If no broker POST was attempted, stage may still hold owner_approved.
  if(submitted){
   try{await ack(q.intentId,'submission_uncertain',null,'POST_OR_RECEIPT_UNCERTAIN');}
   catch{/* keep locked submitting, never retry */ }
  }
 }finally{
  // The durable STOP is mandatory even after success or timeout.
  try{await haltStagingPaperExecution();}
  catch{/* status below remains uncertain; operator must issue STOP */}
 }
 let halted=false;
 try{halted=await oneShotGateHalted();}catch{/* uncertain */}
 return {
  status:acknowledged&&halted?'paper_broker_acknowledged':'paper_submission_uncertain',
  intentId:q.intentId,symbol:pre.symbol,shares:1,limitCents:pre.limitCents,
  brokerStatus:acknowledged?brokerStatus:null,
  gateHalted:halted,requiresReconciliation:!acknowledged||!halted
 };
}
