/**
 * Never executes a network call. Immutable PAPER-order request contract for
 * isolated tests, not a broker execution service.
 */
import {createHash} from 'node:crypto';
import type {ProposedPaperIntent} from './paper-automation-plan.ts';
import {PAPER_AUTOMATION_RELEASE} from './paper-automation-release.ts';

export const FIXED_ALPACA_PAPER_ORDERS_ENDPOINT='https://paper-api.alpaca.markets/v2/orders' as const;
export type NonExecutablePaperOrder={
 target:typeof FIXED_ALPACA_PAPER_ORDERS_ENDPOINT;
 method:'POST';
 request:{
  symbol:string;side:'buy';type:'limit';time_in_force:'day';
  qty:string;limit_price:string;client_order_id:string;
 };
 authorization:'NOT_GRANTED';
 networkRequests:0;
};
export function draftBrokerPaperOrder(intent:ProposedPaperIntent):NonExecutablePaperOrder{
 if(PAPER_AUTOMATION_RELEASE.placeOrdersEnabled||
   PAPER_AUTOMATION_RELEASE.scheduledOrdersEnabled||
   PAPER_AUTOMATION_RELEASE.realMoneyEnabled)throw Error('Broker activation unexpectedly changed');
 if(intent?.mode!=='offline_preview_only'||intent.executionPermitted!==false||
   intent.side!=='buy'||intent.orderType!=='limit'||intent.timeInForce!=='day'||
   !/^preview-[a-f0-9]{32}$/.test(intent.intentId)||
   !/^[A-Z][A-Z0-9.-]{0,9}$/.test(intent.symbol)||
   !Number.isSafeInteger(intent.shares)||intent.shares<1||intent.shares>1000||
   !Number.isSafeInteger(intent.limitCents)||intent.limitCents<1||
   !Number.isSafeInteger(intent.notionalCents)||
   intent.shares*intent.limitCents!==intent.notionalCents||
   intent.notionalCents>10_000)throw Error('Unverified paper order intent');
 const stable=createHash('sha256').update('sportsedge-paper-request-v1\0'+intent.intentId).digest('hex').slice(0,32);
 return Object.freeze({
  target:FIXED_ALPACA_PAPER_ORDERS_ENDPOINT,
  method:'POST' as const,
  request:Object.freeze({
   symbol:intent.symbol,side:'buy' as const,type:'limit' as const,
   time_in_force:'day' as const,qty:String(intent.shares),
   limit_price:`${Math.floor(intent.limitCents/100)}.${String(intent.limitCents%100).padStart(2,'0')}`,
   client_order_id:'sepaper_'+stable
  }),
  authorization:'NOT_GRANTED' as const,
  networkRequests:0 as const
 });
}
/** This routine cannot send broker orders or invoke fetch, even in tests. */
export function stagePaperOrderForReview(intent:ProposedPaperIntent){
 const draft=draftBrokerPaperOrder(intent);
 return {draft,canSubmit:false as const,safeToSchedule:false as const,
  requiresOwnerApproval:true as const};
}
