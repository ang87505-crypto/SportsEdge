/**
 * Alpaca PAPER execution planning contract — OFFLINE, READ-ONLY, DRY RUN ONLY.
 *
 * This module does not load credentials or make network calls. A valid plan is
 * not an authorization to trade. No broker-order writer exists in this PR.
 * Inputs must eventually come from independently reviewed dated source data.
 */
import {createHash} from 'node:crypto';

export const PAPER_AUTOMATION_RELEASE={
  paperOnly:true,
  placeOrdersEnabled:false,
  scheduledOrdersEnabled:false,
  realMoneyEnabled:false,
  durableReceiptStoreReady:false,
  emergencyStopOperational:false,
  verifiedLiveSignalSource:false,
  brokerReconciliationComplete:false
} as const;

export type PaperBlocker=
 | 'PAPER_EXECUTION_DISABLED'|'EMERGENCY_STOP_NOT_OPERATIONAL'
 | 'UNVERIFIED_SIGNAL_SOURCE'|'DURABLE_RECEIPTS_NOT_READY'|'BROKER_RECONCILIATION_NOT_READY'
 | 'INVALID_REQUEST'|'NON_PAPER_ACCOUNT'|'ACCOUNT_UNAVAILABLE'|'BROKER_BLOCKED'
 | 'INCOMPLETE_BROKER_SNAPSHOT'|'UNRECONCILED_ORDER'
 | 'UNSUPPORTED_SIDE'|'INVALID_SYMBOL'|'STALE_QUOTE'|'UNVERIFIED_MARKET_PRICE'
 | 'STALE_SIGNAL'|'INVALID_ACCOUNT_VALUE'|'INSUFFICIENT_CASH'
 | 'OPEN_POSITION_EXISTS'|'DUPLICATE_SIGNAL'|'POSITION_LIMIT'|'ORDER_LIMIT'
 | 'DAILY_LIMIT'|'PORTFOLIO_LIMIT'|'OPEN_ORDER_LIMIT';

export type PaperBrokerState={
  accountType:'paper'|'live'|'unknown';
  status:string;
  tradingBlocked:boolean;
  accountBlocked:boolean;
  snapshotAt:string;
  equityCents:number;
  cashCents:number;
  buyingPowerCents:number;
  positions:Array<{symbol:string;marketValueCents:number}>;
  openOrderSymbols:string[];
  /** Must come from complete authoritative order enumeration, NOT last-25 alone. */
  openOrdersComplete:boolean;
  positionsComplete:boolean;
  submittedNotionalTodayCents:number;
  acceptedOrderCountToday:number;
  /** Verified receipt store must flag unsettled/unknown broker orders. */
  uncertainReceiptCount:number;
};

export type ReviewedSignal={
  id:string;
  symbol:string;
  side:'buy'|'sell';
  publishedAt:string;
  quoteAt:string;
  quoteCents:number;
  limitCents:number;
  shares:number;
  /** Synthetic fixtures may populate these fields, never usable to enable execution. */
  sourceReviewed:boolean;
  sourceDigest:string;
  modelVersion:string;
};

export type ProposedPaperIntent={
  mode:'offline_preview_only';
  symbol:string;
  side:'buy';
  orderType:'limit';
  timeInForce:'day';
  shares:number;
  limitCents:number;
  notionalCents:number;
  sourceDigest:string;
  modelVersion:string;
  signalId:string;
  intentId:string;
  /** NOT sent to Alpaca or persisted as a broker order. */
  executionPermitted:false;
};

export type PaperPlan={
  state:'BLOCKED'|'PREVIEW_ONLY';
  blockers:PaperBlocker[];
  intent:ProposedPaperIntent|null;
  checkedAt:string;
};

const MAX_QUOTE_AGE_MS=120_000;
const MAX_SIGNAL_AGE_MS=24*60*60_000;
const MAX_ORDER_CENTS=10_000;   // Hard cap $100
const MAX_DAILY_CENTS=20_000;   // Hard cap $200
const MAX_POSITION_CENTS=25_000;// Hard cap $250 per symbol
const MAX_OPEN_ORDERS=5;
const MAX_ORDERS_PER_DAY=5;
const MAX_TOTAL_EXPOSURE_PCT=20;
const hex64=/^[a-f0-9]{64}$/i;
const symbolPattern=/^[A-Z][A-Z0-9.-]{0,9}$/;

function cents(value:number){return Number.isSafeInteger(value)&&value>=0;}
function safeTimestamp(value:string,nowMs:number,maxAgeMs:number):boolean {
  if(typeof value!=='string')return false;
  const ms=Date.parse(value);
  return Number.isFinite(ms)&&ms<=nowMs&&nowMs-ms<=maxAgeMs;
}
function unique(values:PaperBlocker[]):PaperBlocker[]{return [...new Set(values)];}
function stableId(signal:ReviewedSignal):string {
  // Deterministic candidate fingerprint, not an Alpaca client_order_id reservation.
  return 'preview-'+createHash('sha256').update(
    JSON.stringify(['SportsEdge-Paper-Preview-v1',signal.modelVersion,signal.id,
      signal.symbol,signal.shares,signal.limitCents,signal.sourceDigest])
  ).digest('hex').slice(0,32);
}

/**
 * Validate an untrusted signal and broker snapshot into a deterministic
 * offline-intent candidate. Fail closed if any economic uncertainty exists.
 * The result always includes PAPER_EXECUTION_DISABLED and is never an order.
 */
export function planPaperIntent(input:{
 signal:ReviewedSignal;
 account:PaperBrokerState;
 previouslySeenSignalIds:string[];
 now:string;
}):PaperPlan {
 const blockers:PaperBlocker[]=['PAPER_EXECUTION_DISABLED','EMERGENCY_STOP_NOT_OPERATIONAL',
   'DURABLE_RECEIPTS_NOT_READY','BROKER_RECONCILIATION_NOT_READY'];
 const nowMs=Date.parse(input.now);
 if(!Number.isFinite(nowMs))throw Error('Invalid evaluation clock');
 const {signal:s,account:a}=input;
 if(!s||!a||!Array.isArray(input.previouslySeenSignalIds)) {
  return {state:'BLOCKED',blockers:unique([...blockers,'INVALID_REQUEST']),intent:null,checkedAt:input.now};
 }
 if(a.accountType!=='paper')blockers.push('NON_PAPER_ACCOUNT');
 if(a.status!=='ACTIVE')blockers.push('ACCOUNT_UNAVAILABLE');
 if(a.tradingBlocked||a.accountBlocked)blockers.push('BROKER_BLOCKED');
 if(!safeTimestamp(a.snapshotAt,nowMs,60_000)||!a.openOrdersComplete||!a.positionsComplete||
    !Array.isArray(a.positions)||!Array.isArray(a.openOrderSymbols))
   blockers.push('INCOMPLETE_BROKER_SNAPSHOT');
 if(!cents(a.equityCents)||!cents(a.cashCents)||!cents(a.buyingPowerCents)||
    a.equityCents===0||!cents(a.submittedNotionalTodayCents)||
    !cents(a.acceptedOrderCountToday)||!cents(a.uncertainReceiptCount)||
    !Array.isArray(a.positions)||a.positions.some(p=>!cents(p.marketValueCents))||
    !Array.isArray(a.openOrderSymbols))
   blockers.push('INVALID_ACCOUNT_VALUE');
 if(a.uncertainReceiptCount!==0)blockers.push('UNRECONCILED_ORDER');
 if(typeof s.sourceReviewed!=='boolean'||!s.sourceReviewed||!hex64.test(s.sourceDigest))
   blockers.push('UNVERIFIED_SIGNAL_SOURCE');
 if(s.side!=='buy')blockers.push('UNSUPPORTED_SIDE');
 if(typeof s.symbol!=='string'||!symbolPattern.test(s.symbol)||
    typeof s.id!=='string'||!s.id||s.id.length>128||
    typeof s.modelVersion!=='string'||!s.modelVersion||s.modelVersion.length>128)
   blockers.push('INVALID_SYMBOL');
 if(!safeTimestamp(s.quoteAt,nowMs,MAX_QUOTE_AGE_MS))blockers.push('STALE_QUOTE');
 if(!safeTimestamp(s.publishedAt,nowMs,MAX_SIGNAL_AGE_MS)||Date.parse(s.publishedAt)>Date.parse(s.quoteAt))
   blockers.push('STALE_SIGNAL');
 if(!cents(s.quoteCents)||s.quoteCents===0||!cents(s.limitCents)||s.limitCents===0||
    !Number.isSafeInteger(s.shares)||s.shares<1||s.shares>1000||s.limitCents<s.quoteCents)
   blockers.push('UNVERIFIED_MARKET_PRICE');
 if(input.previouslySeenSignalIds.includes(s.id))blockers.push('DUPLICATE_SIGNAL');
 if(a.openOrderSymbols?.includes(s.symbol))blockers.push('UNRECONCILED_ORDER');
 if(a.positions?.some(p=>p.symbol===s.symbol&&p.marketValueCents!==0))blockers.push('OPEN_POSITION_EXISTS');
 if((a.openOrderSymbols?.length??MAX_OPEN_ORDERS)>=MAX_OPEN_ORDERS)blockers.push('OPEN_ORDER_LIMIT');
 if(a.acceptedOrderCountToday>=MAX_ORDERS_PER_DAY)blockers.push('ORDER_LIMIT');

 let intent:ProposedPaperIntent|null=null;
 const notional=s.shares*s.limitCents;
 if(!Number.isSafeInteger(notional)||notional<=0)blockers.push('UNVERIFIED_MARKET_PRICE');
 else if(notional>MAX_ORDER_CENTS||notional>MAX_POSITION_CENTS)blockers.push('POSITION_LIMIT');
 if(Number.isSafeInteger(notional)&&notional>0){
  if(!cents(a.cashCents)||!cents(a.buyingPowerCents)||notional>a.cashCents||notional>a.buyingPowerCents)
    blockers.push('INSUFFICIENT_CASH');
  if(!cents(a.submittedNotionalTodayCents)||a.submittedNotionalTodayCents+notional>MAX_DAILY_CENTS)
    blockers.push('DAILY_LIMIT');
  const exposure=Array.isArray(a.positions)?a.positions.reduce((sum,p)=>sum+p.marketValueCents,0):Number.NaN;
  if(!Number.isSafeInteger(exposure)||!cents(a.equityCents)||
     (exposure+notional)*100>a.equityCents*MAX_TOTAL_EXPOSURE_PCT)
    blockers.push('PORTFOLIO_LIMIT');
 }
 const economicBlockers=unique(blockers).filter(b=>![
  'PAPER_EXECUTION_DISABLED','EMERGENCY_STOP_NOT_OPERATIONAL',
  'DURABLE_RECEIPTS_NOT_READY','BROKER_RECONCILIATION_NOT_READY'
 ].includes(b));
 if(economicBlockers.length===0){
  intent={
   mode:'offline_preview_only',symbol:s.symbol,side:'buy',orderType:'limit',
   timeInForce:'day',shares:s.shares,limitCents:s.limitCents,
   notionalCents:notional,sourceDigest:s.sourceDigest,modelVersion:s.modelVersion,
   signalId:s.id,intentId:stableId(s),executionPermitted:false
  };
 }
 return {state:intent?'PREVIEW_ONLY':'BLOCKED',blockers:unique(blockers),intent,checkedAt:input.now};
}
