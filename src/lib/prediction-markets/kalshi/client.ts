/**
 * Kalshi K0: public GET-only market data, ISOLATED RESEARCH CODE.
 * No auth, order placement, transfers, scheduling, persistent storage or production calls.
 * Only the documented NYC temperature series is allowlisted in this first version.
 * Docs: https://docs.kalshi.com/getting_started/quick_start_market_data
 *       https://docs.kalshi.com/getting_started/orderbook_responses
 */
export const KALSHI_API='https://external-api.kalshi.com/trade-api/v2';
export const K0_SERIES=['KXHIGHNY'] as const;
export type K0Series=typeof K0_SERIES[number];
const MAX_RESPONSE_BYTES=200_000;
const MAX_MARKETS=30;
const ONE_DOLLAR_MICROS=1_000_000;
const TICKER=/^[A-Z0-9-]{5,90}$/;
type UnknownRecord=Record<string,unknown>;
const record=(v:unknown):UnknownRecord=>{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('KALSHI_INVALID_OBJECT');
 return v as UnknownRecord;
};
const requiredString=(v:unknown,label:string):string=>{
 if(typeof v!=='string'||!v.trim()||v.length>500)throw Error('KALSHI_INVALID_'+label);
 return v;
};
const timeString=(v:unknown,label:string):string=>{
 const s=requiredString(v,label);
 if(!Number.isFinite(Date.parse(s)))throw Error('KALSHI_INVALID_'+label);
 return s;
};
/** Fixed-point dollars -> integer microdollars, NO binary floating rounding. */
export function moneyMicros(v:unknown):number{
 if(typeof v!=='string'||!/^(?:0|1)(?:\.[0-9]{1,6})?$/.test(v))throw Error('KALSHI_INVALID_PRICE');
 const [whole,fraction='']=v.split('.');
 const n=Number(whole)*ONE_DOLLAR_MICROS+Number(fraction.padEnd(6,'0'));
 if(!Number.isSafeInteger(n)||n<0||n>ONE_DOLLAR_MICROS)throw Error('KALSHI_INVALID_PRICE');
 return n;
}
const countMicros=(v:unknown):number=>{
 if(typeof v!=='string'||!/^\d{1,9}(?:\.[0-9]{1,6})?$/.test(v))throw Error('KALSHI_INVALID_COUNT');
 const [whole,fraction='']=v.split('.');
 const n=Number(whole)*ONE_DOLLAR_MICROS+Number(fraction.padEnd(6,'0'));
 if(!Number.isSafeInteger(n)||n<=0)throw Error('KALSHI_INVALID_COUNT');
 return n;
};
export type MarketSnapshot={
 ticker:string;eventTicker:string;series:K0Series;title:string;status:string;
 closeTime:string;updatedTime:string|null;fetchedAt:string;rulesPrimary:string|null;
 /** Listing prices deliberately excluded: they do not prove executable liquidity. */
};
export function normalizeMarket(input:unknown,series:K0Series,fetchedAt:string):MarketSnapshot{
 const m=record(input),ticker=requiredString(m.ticker,'TICKER');
 if(!TICKER.test(ticker)||!ticker.startsWith(series+'-')||m.market_type!=='binary')throw Error('KALSHI_MARKET_NOT_ALLOWED');
 return {ticker,eventTicker:requiredString(m.event_ticker,'EVENT'),series,
  title:requiredString(m.title,'TITLE'),status:requiredString(m.status,'STATUS'),
  closeTime:timeString(m.close_time,'CLOSE'),updatedTime:m.updated_time?timeString(m.updated_time,'UPDATED'):null,
  fetchedAt:timeString(fetchedAt,'FETCHED'),rulesPrimary:typeof m.rules_primary==='string'&&m.rules_primary.trim()?m.rules_primary:null};
}
type Level={priceMicros:number;sizeMicros:number};
const levels=(v:unknown):Level[]=>{
 if(!Array.isArray(v)||v.length>100)throw Error('KALSHI_INVALID_BOOK');
 return v.map(x=>{
  if(!Array.isArray(x)||x.length!==2)throw Error('KALSHI_INVALID_LEVEL');
  const priceMicros=moneyMicros(x[0]),sizeMicros=countMicros(x[1]);
  if(priceMicros<=0||priceMicros>=ONE_DOLLAR_MICROS)throw Error('KALSHI_INVALID_LEVEL');
  return {priceMicros,sizeMicros};
 }).sort((a,b)=>b.priceMicros-a.priceMicros);
};
export type BookSnapshot={
 ticker:string;fetchedAt:string;
 yesBestBidMicros:number|null;noBestBidMicros:number|null;
 /** Buy asks DERIVED from opposing bids, not from last price or a midpoint. */
 buyYesAskMicros:number|null;buyNoAskMicros:number|null;
 yesBidSizeMicros:number|null;noBidSizeMicros:number|null;
 buyYesAvailableSizeMicros:number|null;buyNoAvailableSizeMicros:number|null;
};
/** Kalshi sends YES and NO BIDS. NO bid Y implies a YES ask (1-Y). */
export function normalizeBook(ticker:string,input:unknown,fetchedAt:string):BookSnapshot{
 if(!TICKER.test(ticker)||!ticker.startsWith('KXHIGHNY-'))throw Error('KALSHI_TICKER_NOT_ALLOWED');
 const b=record(record(input).orderbook_fp),yes=levels(b.yes_dollars),no=levels(b.no_dollars);
 const y=yes[0]??null,n=no[0]??null;
 return {ticker,fetchedAt:timeString(fetchedAt,'FETCHED'),
  yesBestBidMicros:y?.priceMicros??null,noBestBidMicros:n?.priceMicros??null,
  buyYesAskMicros:n?ONE_DOLLAR_MICROS-n.priceMicros:null,
  buyNoAskMicros:y?ONE_DOLLAR_MICROS-y.priceMicros:null,
  yesBidSizeMicros:y?.sizeMicros??null,noBidSizeMicros:n?.sizeMicros??null,
  buyYesAvailableSizeMicros:n?.sizeMicros??null,buyNoAvailableSizeMicros:y?.sizeMicros??null};
}
async function getJson(path:string,fetcher:typeof fetch):Promise<unknown>{
 // The published Kalshi Data Terms restrict AI/software use without prior written consent.
 // All normal production calls use global fetch; injected test fakes are only for synthetic fixtures.
 // This is NOT proof of a license: a reviewer must validate its reference before setting either variable.
 if(fetcher===fetch && (process.env.KALSHI_DATA_PERMISSION_APPROVED!=='1' ||
  !/^[A-Z0-9][A-Z0-9_.-]{5,100}$/.test(process.env.KALSHI_DATA_PERMISSION_REFERENCE??'')))
  throw Error('KALSHI_DATA_RIGHTS_NOT_APPROVED');
 // Path is constructed below solely from a hardcoded route and validated identifiers.
 const url=KALSHI_API+path;
 const res=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
  headers:{Accept:'application/json'},signal:AbortSignal.timeout(8_000)});
 if(res.status===429)throw Error('KALSHI_RATE_LIMITED');
 if(!res.ok)throw Error('KALSHI_HTTP_'+res.status);
 if(!(res.headers.get('content-type')??'').includes('application/json'))throw Error('KALSHI_NOT_JSON');
 const len=res.headers.get('content-length');
 if(len!==null&&Number(len)>MAX_RESPONSE_BYTES)throw Error('KALSHI_RESPONSE_TOO_LARGE');
 if(!res.body)throw Error('KALSHI_EMPTY_BODY');
 const reader=res.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   bytes+=value.byteLength;if(bytes>MAX_RESPONSE_BYTES)throw Error('KALSHI_RESPONSE_TOO_LARGE');
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const all=new Uint8Array(bytes);let off=0;
 for(const chunk of chunks){all.set(chunk,off);off+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(all));}catch{throw Error('KALSHI_INVALID_JSON');}
}
export async function listWeatherMarkets(fetcher:typeof fetch=fetch,now:()=>string=()=>new Date().toISOString()):Promise<MarketSnapshot[]>{
 const raw=record(await getJson('/markets?series_ticker=KXHIGHNY&status=open&limit='+MAX_MARKETS,fetcher));
 if(!Array.isArray(raw.markets)||raw.markets.length>MAX_MARKETS)throw Error('KALSHI_INVALID_MARKETS');
 const fetchedAt=now();
 return raw.markets.map(m=>normalizeMarket(m,'KXHIGHNY',fetchedAt));
}
export async function getWeatherOrderbook(ticker:string,fetcher:typeof fetch=fetch,now:()=>string=()=>new Date().toISOString()):Promise<BookSnapshot>{
 if(!TICKER.test(ticker)||!ticker.startsWith('KXHIGHNY-'))throw Error('KALSHI_TICKER_NOT_ALLOWED');
 const raw=await getJson('/markets/'+ticker+'/orderbook?depth=20',fetcher);
 return normalizeBook(ticker,raw,now());
}

/**
 * GET the official market result for offline paper grading. Never query an order endpoint.
 * Incomplete, undecided, disputed or void outcomes are deliberately NOT gradeable.
 */
import {createHash as kalshiSha256} from 'node:crypto';
import type {OfficialResult} from './paper.ts';
export async function getWeatherOfficialResult(
 ticker:string,fetcher:typeof fetch=fetch,now:()=>string=()=>new Date().toISOString()
):Promise<OfficialResult>{
 if(!TICKER.test(ticker)||!ticker.startsWith('KXHIGHNY-'))throw Error('KALSHI_TICKER_NOT_ALLOWED');
 const response=record(await getJson('/markets/'+ticker,fetcher));
 const m=record(response.market);
 if(m.ticker!==ticker||m.market_type!=='binary'||m.status!=='settled'||
  (m.result!=='yes'&&m.result!=='no'))throw Error('KALSHI_RESULT_NOT_FINAL');
 const fetchedAt=timeString(now(),'FETCHED');
 const settledAt=timeString(m.settlement_ts,'SETTLED');
 if(Date.parse(fetchedAt)<Date.parse(settledAt))throw Error('KALSHI_SETTLEMENT_FUTURE');
 const rulesPrimary=requiredString(m.rules_primary,'RULES');
 return {marketTicker:ticker,eventTicker:requiredString(m.event_ticker,'EVENT'),
  status:'settled',result:m.result,rulesPrimary,
  settledAt,fetchedAt,sourceDigest:kalshiSha256('sha256').update(JSON.stringify(response)).digest('hex'),
  source:'kalshi-public-market-get'};
}
