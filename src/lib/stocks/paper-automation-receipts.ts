/**
 * Immutable paper-only receipt state machine. This models the durable outbox
 * that must exist BEFORE any future broker writer is authorized.
 * No database, schedule or broker operation is implemented here.
 */
export type PaperReceiptState=
 'planned'|'owner_approved'|'submitting'|'broker_acknowledged'|
 'broker_filled'|'broker_rejected'|'broker_canceled'|'submission_uncertain'|
 'stopped';
export type ReceiptEvent=
 'approve'|'start_submission'|'acknowledge'|'fill'|'reject'|'cancel'|
 'unknown_response'|'emergency_stop'|'reconcile_acknowledged'|
 'reconcile_rejected';
export type PaperReceipt={
 intentId:string;
 accountKind:'paper';
 state:PaperReceiptState;
 version:number;
 brokerOrderId:string|null;
 approvedBy:string|null;
 history:Array<{event:ReceiptEvent;from:PaperReceiptState;to:PaperReceiptState;at:string}>;
};
const transitions:Readonly<Record<PaperReceiptState,Partial<Record<ReceiptEvent,PaperReceiptState>>>>={
 planned:{approve:'owner_approved',emergency_stop:'stopped'},
 owner_approved:{start_submission:'submitting',emergency_stop:'stopped'},
 submitting:{acknowledge:'broker_acknowledged',unknown_response:'submission_uncertain',
  emergency_stop:'submission_uncertain'},
 broker_acknowledged:{fill:'broker_filled',reject:'broker_rejected',cancel:'broker_canceled',
  emergency_stop:'submission_uncertain'},
 submission_uncertain:{reconcile_acknowledged:'broker_acknowledged',
  reconcile_rejected:'broker_rejected'},
 broker_filled:{},broker_rejected:{},broker_canceled:{},stopped:{}
};
export function createPaperReceipt(intentId:string):PaperReceipt{
 if(!/^preview-[a-f0-9]{32}$/.test(intentId))throw Error('Expected deterministic preview intent');
 return {intentId,accountKind:'paper',state:'planned',version:0,
  brokerOrderId:null,approvedBy:null,history:[]};
}
export function advancePaperReceipt(input:PaperReceipt,details:{
 event:ReceiptEvent;at:string;expectedVersion:number;
 brokerOrderId?:string;ownerId?:string;
}):PaperReceipt {
 if(input.accountKind!=='paper'||input.version!==details.expectedVersion||
   input.history.length!==input.version)throw Error('Receipt version conflict');
 const at=Date.parse(details.at);
 if(!Number.isFinite(at)||details.at.length>50||
   (input.history.length>0&&at<Date.parse(input.history.at(-1)!.at)))
   throw Error('Invalid receipt timestamp');
 const next=transitions[input.state]?.[details.event];
 if(!next)throw Error('Forbidden receipt transition');
 const ownerId=details.ownerId;
 const brokerOrderId=details.brokerOrderId;
 if(details.event==='approve'&&(!ownerId||ownerId.length>128))throw Error('Owner approval identity required');
 if(['acknowledge','reconcile_acknowledged'].includes(details.event)&&
   (!brokerOrderId||brokerOrderId.length>128))throw Error('Broker order identity required');
 if(brokerOrderId&&input.brokerOrderId&&brokerOrderId!==input.brokerOrderId)
   throw Error('Broker order identity mismatch');
 // A response timeout is NEVER treated as a definite broker rejection, and
 // emergency stop after submission begins cannot promise order cancellation.
 return {...input,state:next,version:input.version+1,
  approvedBy:details.event==='approve'?ownerId!:input.approvedBy,
  brokerOrderId:brokerOrderId??input.brokerOrderId,
  history:[...input.history,{event:details.event,from:input.state,to:next,at:details.at}]};
}
export function locksFurtherOrders(receipt:PaperReceipt):boolean{
 return ['owner_approved','submitting','broker_acknowledged','submission_uncertain'].includes(receipt.state);
}
