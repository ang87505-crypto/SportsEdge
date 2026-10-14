/**
 * Strictly offline scheduled paper-run rehearsal.
 * No cron route, broker writer, credentials or database connection.
 * The returned result CANNOT authorize an order under any circumstances.
 */
import {planPaperIntent,type PaperBrokerState,type ReviewedSignal,type PaperBlocker} from './paper-automation-plan.ts';
import {PAPER_AUTOMATION_RELEASE} from './paper-automation-release.ts';

export type VerifiedExchangeSession={
 venue:'XNYS';
 sessionDate:string;
 verifiedAt:string;
 source:'reviewed_exchange_calendar';
 sourceDigest:string;
 marketOpenAt:string;
 marketCloseAt:string;
 isTradingDay:boolean;
};
export type RehearsalBlocker=PaperBlocker|
 'RELEASE_NOT_AUTHORIZED'|'STAGING_GATE_HALTED'|'STAGING_GATE_UNKNOWN'|
 'INVALID_CALENDAR'|'MARKET_CLOSED'|'MARKET_OPEN_BUFFER'|
 'MARKET_CLOSE_BUFFER'|'CALENDAR_STALE'|'UNCERTAIN_RECEIPT_LOCK';
export type PaperRehearsal={
 mode:'dry_run_only';
 result:'BLOCKED'|'PREVIEW_ONLY';
 blockers:RehearsalBlocker[];
 intentId:string|null;
 brokerCalls:0;
 orderSubmissions:0;
 scheduledExecutions:0;
 executionPermitted:false;
 inspectedAt:string;
};
function isoUtc(v:string):number{
 if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v))return NaN;
 const n=Date.parse(v);
 return Number.isFinite(n)&&new Date(n).toISOString().slice(0,19)===v.slice(0,19)?n:NaN;
}
function nyDate(ms:number):string{
 const date=new Date(ms);
 return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function rehearseScheduledPaperTick(input:{
 now:string;
 session:VerifiedExchangeSession|null;
 account:PaperBrokerState;
 signal:ReviewedSignal;
 previouslySeenSignalIds:string[];
 gateStatus:'HALTED'|'UNKNOWN';
 unresolvedReceipts:number;
}):PaperRehearsal{
 const clock=isoUtc(input.now);
 if(!Number.isFinite(clock))throw Error('Valid UTC evaluation clock required');
 const blockers:RehearsalBlocker[]=['RELEASE_NOT_AUTHORIZED'];
 if(input.gateStatus==='HALTED')blockers.push('STAGING_GATE_HALTED');
 else blockers.push('STAGING_GATE_UNKNOWN');
 if(!Number.isSafeInteger(input.unresolvedReceipts)||input.unresolvedReceipts!==0)
  blockers.push('UNCERTAIN_RECEIPT_LOCK');
 const session=input.session;
 if(!session||session.venue!=='XNYS'||session.source!=='reviewed_exchange_calendar'||
    !/^[a-f0-9]{64}$/i.test(session.sourceDigest)||
    !/^\d{4}-\d{2}-\d{2}$/.test(session.sessionDate)||
    session.sessionDate!==nyDate(clock)){
  blockers.push('INVALID_CALENDAR');
 }else{
  const verified=isoUtc(session.verifiedAt);
  const start=isoUtc(session.marketOpenAt),end=isoUtc(session.marketCloseAt);
  if(!Number.isFinite(verified)||!Number.isFinite(start)||!Number.isFinite(end)||
    end<=start||end-start>9*3600_000||end-start<60*60_000||
    nyDate(start)!==session.sessionDate||nyDate(end)!==session.sessionDate){
   blockers.push('INVALID_CALENDAR');
  }else{
   if(verified>clock||clock-verified>15*60_000)blockers.push('CALENDAR_STALE');
   if(!session.isTradingDay||clock<start||clock>=end)blockers.push('MARKET_CLOSED');
   if(clock<start+5*60_000)blockers.push('MARKET_OPEN_BUFFER');
   if(clock>=end-20*60_000)blockers.push('MARKET_CLOSE_BUFFER');
  }
 }
 const plan=planPaperIntent({signal:input.signal,account:input.account,
  previouslySeenSignalIds:input.previouslySeenSignalIds,now:input.now});
 blockers.push(...plan.blockers);
 // DO NOT substitute a mock trading engine for durable exact-once behavior.
 // Runtime release flags are hard-off constants and cannot be overwritten.
 if(PAPER_AUTOMATION_RELEASE.placeOrdersEnabled||PAPER_AUTOMATION_RELEASE.scheduledOrdersEnabled||
   PAPER_AUTOMATION_RELEASE.realMoneyEnabled)
  throw Error('Unexpected change in hard-disabled release manifest');
 const nonRelease=blockers.filter(x=>!['RELEASE_NOT_AUTHORIZED',
  'STAGING_GATE_HALTED','STAGING_GATE_UNKNOWN',
  'PAPER_EXECUTION_DISABLED','EMERGENCY_STOP_NOT_OPERATIONAL',
  'DURABLE_RECEIPTS_NOT_READY','BROKER_RECONCILIATION_NOT_READY'].includes(x));
 return {mode:'dry_run_only',result:plan.intent&&nonRelease.length===0?'PREVIEW_ONLY':'BLOCKED',
  blockers:[...new Set(blockers)],intentId:plan.intent?.intentId??null,
  brokerCalls:0,orderSubmissions:0,scheduledExecutions:0,
  executionPermitted:false,inspectedAt:input.now};
}
