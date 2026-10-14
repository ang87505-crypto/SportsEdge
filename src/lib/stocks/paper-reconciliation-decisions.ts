/**
 * Read-only account/outbox consistency gate.
 * A broker-history absence is never authorization to retry a previously
 * uncertain submission. No state mutation, clock, network or order route.
 */
import type {PaperOrderInventory} from '../server/alpaca-paper-reconciliation.ts';
import type {PaperReceipt,PaperReceiptState} from './paper-automation-receipts.ts';
export type ReconciliationFinding={
 intentId:string;
 clientOrderId:string;
 receiptState:PaperReceiptState;
 state:'observed_consistent'|'observed_conflict'|'not_observed_do_not_retry'|'unresolved_pending'|'invalid';
 brokerOrderId:string|null;
 brokerStatus:string|null;
 mayResubmit:false;
};
const receiptToBrokerStatus:Partial<Record<PaperReceiptState,readonly string[]>>={
 broker_filled:['filled'],broker_rejected:['rejected'],broker_canceled:['canceled','expired'],
 broker_acknowledged:['new','accepted','pending_new','accepted_for_bidding',
  'partially_filled','pending_cancel','pending_replace','done_for_day','stopped',
  'suspended','calculated','held','filled','canceled','expired','rejected','replaced'],
 submission_uncertain:['new','accepted','pending_new','accepted_for_bidding',
  'partially_filled','pending_cancel','pending_replace','done_for_day','stopped',
  'suspended','calculated','held','filled','canceled','expired','rejected','replaced']
};
export function reconcilePaperReceipts(
 inventory:PaperOrderInventory,
 receipts:ReadonlyArray<PaperReceipt&{clientOrderId:string}>
):{verifiedHistory:boolean;findings:ReconciliationFinding[];unresolvedCount:number;allClearForOrders:false}{
 if(inventory.historyComplete!==true||inventory.openOrdersComplete!==true||
    inventory.safeForExecution!==false||inventory.totalOrders!==inventory.allOrders.length)
   throw Error('Complete read-only paper history required');
 const seen=new Set<string>();
 const byClient=new Map<string,PaperOrderInventory['allOrders'][number]>();
 for(const order of inventory.allOrders){
  if(order.clientOrderId!==null){
   if(byClient.has(order.clientOrderId))throw Error('Duplicate broker client ID');
   byClient.set(order.clientOrderId,order);
  }
 }
 const findings:ReconciliationFinding[]=[];
 for(const r of receipts){
  if(!r.clientOrderId||!/^[a-zA-Z0-9_-]{1,48}$/.test(r.clientOrderId)||
    seen.has(r.clientOrderId)||r.accountKind!=='paper')throw Error('Invalid stored receipt');
  seen.add(r.clientOrderId);
  const broker=byClient.get(r.clientOrderId);
  let state:ReconciliationFinding['state'];
  if(!broker){
   state=['submitting','submission_uncertain','broker_acknowledged'].includes(r.state)?
    'not_observed_do_not_retry':'unresolved_pending';
  }else if(r.brokerOrderId!==null&&r.brokerOrderId!==broker.id){
   state='observed_conflict';
  }else if(!receiptToBrokerStatus[r.state]||
      !(receiptToBrokerStatus[r.state] as readonly string[]).includes(broker.status)){
   state='observed_conflict';
  }else if(r.state==='submission_uncertain'){
   // Observation supplies recovery evidence, not an automatic state change.
   state='unresolved_pending';
  }else{
   state='observed_consistent';
  }
  findings.push({
   intentId:r.intentId,clientOrderId:r.clientOrderId,receiptState:r.state,
   state,brokerOrderId:broker?.id??null,brokerStatus:broker?.status??null,
   mayResubmit:false
  });
 }
 return {verifiedHistory:true,findings,
  unresolvedCount:findings.filter(x=>x.state!=='observed_consistent').length,
  allClearForOrders:false};
}
