/**
 * Kalshi K0 paper research engine: PURE, NO NETWORK, NO WRITES, NO ORDERS.
 * No actual fills are observed. A paper candidate only represents liquidity visible at the
 * sampled best opposing bid, not a guaranteed execution price or profitable strategy.
 */
import {createHash} from 'node:crypto';
import type {MarketSnapshot,BookSnapshot} from './client.ts';

const U=1_000_000;
const UB=1_000_000n;
const SHA=/^[a-f0-9]{64}$/;
export type Side='yes'|'no';
export type PaperDecision='PAPER_CANDIDATE'|'NO_LIQUIDITY'|'NO_POSITIVE_EDGE'|'INVALID_SPREAD';
export const FEE_POLICY='STANDARD_TAKER_M1_2026_07_07_PROVISIONAL' as const;
/**
 * Kalshi July 7, 2026 general taker schedule: fee = ceil_centicent(
 *   1 * 0.07 * contracts * P * (1-P)).
 * Fee and displayed prices are in integer microdollars; 1 centicent = 100 microdollars.
 * NONSTANDARD series/fees can differ: mark every such estimate provisional.
 * https://kalshi.com/docs/kalshi-fee-schedule.pdf
 */
export function provisionalTakerFeeMicros(priceMicros:number,contracts:number):number{
 if(!Number.isSafeInteger(priceMicros)||priceMicros<=0||priceMicros>=U||
  !Number.isSafeInteger(contracts)||contracts<1||contracts>1000)throw Error('KALSHI_INVALID_FEE_INPUT');
 const p=BigInt(priceMicros),c=BigInt(contracts);
 const numerator=7n*c*p*(UB-p);
 const divisor=100n*UB*100n;
 return Number(((numerator+divisor-1n)/divisor)*100n);
}
const ms=(s:string)=>{const t=Date.parse(s);if(!Number.isFinite(t))throw Error('KALSHI_INVALID_TIME');return t;};
const validateDigest=(digest:string)=>{if(!SHA.test(digest))throw Error('KALSHI_INVALID_DIGEST');};
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export type ForecastInput={
 market:MarketSnapshot;book:BookSnapshot;
 predictedAt:string;modelId:string;modelDataAsOf:string;modelDataDigest:string;
 probabilityYesPpm:number;maxContracts:number;
 /** Conservative per-contract execution uncertainty, explicit in the research record. */
 slippageMicrosPerContract:number;
 /** Research threshold in microdollars after estimated fee and slippage. */
 minEdgeMicrosPerContract:number;
};
export type PaperForecast={
 id:string;marketTicker:string;eventTicker:string;series:string;
 modelId:string;modelDataAsOf:string;modelDataDigest:string;
 predictedAt:string;marketFetchedAt:string;bookFetchedAt:string;closeTime:string;
 rulesPrimary:string;rulesDigest:string;bookDigest:string;
 probabilityYesPpm:number;marketMidpointYesPpm:number|null;
 feePolicy:typeof FEE_POLICY;feeVerifiedForSeries:false;
 side:Side|null;decision:PaperDecision;contracts:number;priceMicros:number|null;
 feeMicros:number;slippageMicros:number;expectedNetMicros:number|null;
 /** All hypothetical candidates are explicitly unfilled; no account/exchange execution. */
 execution:'HYPOTHETICAL_UNCONFIRMED';
};
function quoteFor(side:Side,b:BookSnapshot){
 return side==='yes'
  ? {ask:b.buyYesAskMicros,size:b.buyYesAvailableSizeMicros,bid:b.yesBestBidMicros}
  : {ask:b.buyNoAskMicros,size:b.buyNoAvailableSizeMicros,bid:b.noBestBidMicros};
}
function score(i:ForecastInput,side:Side):{
 side:Side;contracts:number;ask:number;fee:number;slippage:number;expected:number
}|null{
 const q=quoteFor(side,i.book);
 if(q.ask===null||q.size===null||q.size<U||q.ask<=0||q.ask>=U)return null;
 const contracts=Math.min(i.maxContracts,Math.floor(q.size/U));
 if(contracts<1)return null;
 const fee=provisionalTakerFeeMicros(q.ask,contracts);
 const slippage=i.slippageMicrosPerContract*contracts;
 // Conservative, fee-inclusive EV (integer microdollars).
 const p=side==='yes'?i.probabilityYesPpm:U-i.probabilityYesPpm;
 const expected=Math.floor(contracts*p)-contracts*q.ask-fee-slippage;
 return {side,contracts,ask:q.ask,fee,slippage,expected};
}
export function freezePaperForecast(i:ForecastInput):PaperForecast{
 const t=ms(i.predictedAt),b=ms(i.book.fetchedAt),m=ms(i.market.fetchedAt),data=ms(i.modelDataAsOf),close=ms(i.market.closeTime);
 if(i.market.series!=='KXHIGHNY'||!i.market.ticker.startsWith('KXHIGHNY-')||
  i.book.ticker!==i.market.ticker||!['active','open'].includes(i.market.status.toLowerCase()))
  throw Error('KALSHI_NOT_ELIGIBLE_FOR_RESEARCH');
 if(!i.market.rulesPrimary?.trim())throw Error('KALSHI_RULES_REQUIRED');
 if(!i.modelId||i.modelId.length>100||!/^[-a-zA-Z0-9_.]+$/.test(i.modelId))throw Error('KALSHI_MODEL_REQUIRED');
 validateDigest(i.modelDataDigest);
 if(!Number.isSafeInteger(i.probabilityYesPpm)||i.probabilityYesPpm<1||i.probabilityYesPpm>=U||
  !Number.isSafeInteger(i.maxContracts)||i.maxContracts<1||i.maxContracts>5||
  !Number.isSafeInteger(i.slippageMicrosPerContract)||i.slippageMicrosPerContract<0||i.slippageMicrosPerContract>100_000||
  !Number.isSafeInteger(i.minEdgeMicrosPerContract)||i.minEdgeMicrosPerContract<0||i.minEdgeMicrosPerContract>200_000)
  throw Error('KALSHI_INVALID_MODEL_INPUT');
 if(data>t||m>t||b>t||t>=close-5*60_000||t-b>120_000||t-m>600_000)
  throw Error('KALSHI_ASOF_OR_LOCK_VIOLATION');
 const mid=i.book.yesBestBidMicros!==null&&i.book.buyYesAskMicros!==null
  ? Math.round((i.book.yesBestBidMicros+i.book.buyYesAskMicros)/2):null;
 const crossed=mid!==null&&i.book.yesBestBidMicros!>i.book.buyYesAskMicros!;
 const candidates:[ReturnType<typeof score>,ReturnType<typeof score>]=[score(i,'yes'),score(i,'no')];
 const feasible=candidates.filter((x):x is NonNullable<typeof x>=>x!==null);
 const top=feasible.sort((a,b)=>b.expected-a.expected)[0];
 const meets=top&&top.expected>i.minEdgeMicrosPerContract*top.contracts;
 const decision:PaperDecision=crossed?'INVALID_SPREAD':!top?'NO_LIQUIDITY':meets?'PAPER_CANDIDATE':'NO_POSITIVE_EDGE';
 const chosen=decision==='PAPER_CANDIDATE'?top:null;
 const base:Omit<PaperForecast,'id'>={
  marketTicker:i.market.ticker,eventTicker:i.market.eventTicker,series:i.market.series,
  modelId:i.modelId,modelDataAsOf:i.modelDataAsOf,modelDataDigest:i.modelDataDigest,
  predictedAt:i.predictedAt,marketFetchedAt:i.market.fetchedAt,bookFetchedAt:i.book.fetchedAt,
  closeTime:i.market.closeTime,rulesPrimary:i.market.rulesPrimary,rulesDigest:hash(i.market.rulesPrimary),
  bookDigest:hash(i.book),probabilityYesPpm:i.probabilityYesPpm,marketMidpointYesPpm:mid,
  feePolicy:FEE_POLICY,feeVerifiedForSeries:false,
  side:chosen?.side??null,decision,contracts:chosen?.contracts??0,priceMicros:chosen?.ask??null,
  feeMicros:chosen?.fee??0,slippageMicros:chosen?.slippage??0,
  expectedNetMicros:chosen?.expected??null,
  execution:'HYPOTHETICAL_UNCONFIRMED'};
 return {id:hash(base),...base};
}
export type OfficialResult={
 marketTicker:string;eventTicker:string;status:string;result:'yes'|'no';
 rulesPrimary:string;settledAt:string;fetchedAt:string;sourceDigest:string;
 /** From GET /markets/{ticker}, independently authenticated as official response. */
 source:'kalshi-public-market-get';
};
export type PaperGrade={
 id:string;forecastId:string;marketTicker:string;eventTicker:string;
 settledAt:string;result:'yes'|'no';sourceDigest:string;
 correct:boolean|null;virtualNetMicros:number|null;virtualReturnMicros:number|null;
 /** Cannot be called realized P&L since no order was sent or filled. */
 execution:'HYPOTHETICAL_UNCONFIRMED';
};
export function gradePaperForecast(f:PaperForecast,o:OfficialResult):PaperGrade{
 if(o.source!=='kalshi-public-market-get'||o.marketTicker!==f.marketTicker||o.eventTicker!==f.eventTicker||
  o.status!=='settled'||!['yes','no'].includes(o.result)||o.rulesPrimary!==f.rulesPrimary)
  throw Error('KALSHI_SETTLEMENT_NOT_VERIFIED');
 validateDigest(o.sourceDigest);
 if(ms(o.settledAt)<ms(f.predictedAt)||ms(o.fetchedAt)<ms(o.settledAt))throw Error('KALSHI_RESULT_TIME_VIOLATION');
 const correct=f.side===null?null:f.side===o.result;
 const virtualReturnMicros=f.side===null?null:correct?f.contracts*U:0;
 const virtualNetMicros=f.side===null?null:virtualReturnMicros!-f.contracts*f.priceMicros!-f.feeMicros-f.slippageMicros;
 const base:Omit<PaperGrade,'id'>={forecastId:f.id,marketTicker:f.marketTicker,eventTicker:f.eventTicker,
  settledAt:o.settledAt,result:o.result,sourceDigest:o.sourceDigest,correct,virtualNetMicros,virtualReturnMicros,
  execution:'HYPOTHETICAL_UNCONFIRMED'};
 return {id:hash(base),...base};
}
/** Append-only in-memory verifier. Caller is responsible for owner-approved durable storage. */
export function appendUnique<T extends {id:string}>(existing:readonly T[],incoming:T):T[]{
 if(existing.some(x=>x.id===incoming.id))return [...existing];
 return [...existing,incoming];
}
