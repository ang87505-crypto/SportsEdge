/** Demo-only exchange adapter. The production host is never accepted or selected. */
import {createPrivateKey,sign,constants,createHash,type KeyObject} from 'node:crypto';
import {normalizeMarket,normalizeBook,moneyMicros,type MarketSnapshot,type BookSnapshot} from '../prediction-markets/kalshi/client.ts';
import type {TemperatureStrike} from '../prediction-markets/kalshi/contract-math.ts';
export const KALSHI_DEMO_ORIGIN='https://external-api.demo.kalshi.co';
const ROOT='/trade-api/v2';
const TICKER=/^KXHIGHNY-[A-Z0-9.-]{5,80}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class KalshiDemoError extends Error{
 readonly code:string;readonly outcomeUnknown:boolean;
 constructor(code:string,outcomeUnknown=false){super('KALSHI_DEMO_'+code);this.name='KalshiDemoError';this.code=code;this.outcomeUnknown=outcomeUnknown;}
}
const bad=():never=>{throw new KalshiDemoError('BAD_REPLY');};
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return bad();return v as Record<string,unknown>;}
function text(v:unknown,max=100):string{if(typeof v!=='string'||!v||v.length>max)return bad();return v;}
/** Signed decimal -> fixed-point integer without floating-point monetary rounding. */
export function demoFixedMicros(v:unknown):number{
 if(typeof v!=='string'||!/^[-]?\d{1,10}(?:\.\d{1,6})?$/.test(v))return bad();
 const negative=v.startsWith('-'),[whole,part='']=v.replace(/^-/,'').split('.');
 const n=BigInt(whole)*BigInt(1_000_000)+BigInt(part.padEnd(6,'0'));
 if(n>BigInt(Number.MAX_SAFE_INTEGER))return bad();return Number(negative?-n:n);
}
export function kalshiDemoConfig(env:Readonly<Record<string,string|undefined>>=process.env){
 const keyId=env.KALSHI_DEMO_KEY_ID??'',pem=env.KALSHI_DEMO_PRIVATE_KEY?.replace(/\\n/g,'\n')??'';
 if(!keyId||!pem)throw new KalshiDemoError('ACCOUNT_NOT_CONFIGURED');
 if(env.KALSHI_DEMO_ACCESS_APPROVED!=='1'||!/^[A-Z0-9][A-Z0-9_.-]{5,100}$/.test(env.KALSHI_DEMO_PERMISSION_REFERENCE??''))
  throw new KalshiDemoError('ACCESS_NOT_REVIEWED');
 if(!/^[A-Za-z0-9-]{8,100}$/.test(keyId)||pem.length<80||pem.length>12000)throw new KalshiDemoError('INVALID_KEY');
 let key:KeyObject;try{key=createPrivateKey(pem);}catch{throw new KalshiDemoError('INVALID_KEY');}
 if(key.asymmetricKeyType!=='ed25519'&&key.asymmetricKeyType!=='rsa')throw new KalshiDemoError('UNSUPPORTED_KEY_TYPE');
 if(key.asymmetricKeyType==='rsa'&&(key.asymmetricKeyDetails?.modulusLength??0)<2048)throw new KalshiDemoError('INVALID_KEY');
 return {keyId,key,fingerprint:createHash('sha256').update(keyId).digest('hex')};
}
export type DemoOrder={orderId:string;clientOrderId:string;ticker:string;side:'yes'|'no';
 status:'resting'|'canceled'|'executed';filledMicros:number;remainingMicros:number;
 costMicros:number;feesMicros:number};
export type DemoAcknowledgement={source:'KALSHI_DEMO';orderId:string;clientOrderId:string;
 filledMicros:number;remainingMicros:0;averageYesPriceMicros:number|null;averageFeeMicros:number|null;processedAt:string};
export type DemoAccount={source:'KALSHI_DEMO';fetchedAt:string;cashMicros:number;portfolioValueMicros:number;
 orders:DemoOrder[];positions:{ticker:string;quantityMicros:number;realizedPnlMicros:number;feesMicros:number}[]};
export type DemoMarket={market:MarketSnapshot;strike:TemperatureStrike};
export type DemoSettlement={source:'KALSHI_DEMO';ticker:string;eventTicker:string;result:'yes'|'no';settledAt:string;fetchedAt:string;rulesPrimary:string;rulesSecondary:string|null};
export interface KalshiDemoClient{
 fingerprint:string;
 account():Promise<DemoAccount>;
 markets(eventTicker:string):Promise<DemoMarket[]>;
 book(ticker:string):Promise<BookSnapshot>;
 submit(i:{clientOrderId:string;ticker:string;side:'yes'|'no';priceMicros:number}):Promise<DemoAcknowledgement>;
 cancel(orderId:string,ticker:string):Promise<void>;
 result(ticker:string):Promise<DemoSettlement|null>;
}
export function kalshiDemoClient(env:Readonly<Record<string,string|undefined>>=process.env,
 fetcher:typeof fetch=fetch,now:()=>number=()=>Date.now()):KalshiDemoClient{
 const {keyId,key,fingerprint}=kalshiDemoConfig(env);
 let nextBalanceAt=0,balanceTail:Promise<unknown>=Promise.resolve();
 async function request(path:string,method:'GET'|'POST'|'DELETE'='GET',body?:object):Promise<Record<string,unknown>>{
  const timestamp=now();if(!Number.isSafeInteger(timestamp)||timestamp<1_000_000_000_000)throw new KalshiDemoError('INVALID_CLOCK');
  const message=Buffer.from(String(timestamp)+method+ROOT+path.split('?')[0]);
  const signature=(key.asymmetricKeyType==='ed25519'?sign(null,message,key):
   sign('sha256',message,{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:constants.RSA_PSS_SALTLEN_DIGEST})).toString('base64');
  const write=method!=='GET';let response:Response;
  try{response=await fetcher(KALSHI_DEMO_ORIGIN+ROOT+path,{method,redirect:'error',credentials:'omit',cache:'no-store',
   signal:AbortSignal.timeout(8000),headers:{Accept:'application/json','Content-Type':'application/json',
    'KALSHI-ACCESS-KEY':keyId,'KALSHI-ACCESS-TIMESTAMP':String(timestamp),'KALSHI-ACCESS-SIGNATURE':signature},
   ...(body?{body:JSON.stringify(body)}:{})});}
  catch{throw new KalshiDemoError(write?'ORDER_OUTCOME_UNKNOWN':'TRANSPORT_FAILED',write);}
  if(!response.ok)throw new KalshiDemoError('HTTP_'+response.status,write&&(response.status>=500||response.status===409));
  if(!response.headers.get('content-type')?.includes('application/json')||!response.body)
   throw new KalshiDemoError('BAD_REPLY',write);
  const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,bodyText='';
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
   if(bytes>500000){await reader.cancel();throw new Error('size');}bodyText+=decoder.decode(part.value,{stream:true});}
   bodyText+=decoder.decode();return object(JSON.parse(bodyText));}
  catch{throw new KalshiDemoError('BAD_REPLY',write);}
 }
 async function pages(path:string,field:string):Promise<unknown[]>{
  const all:unknown[]=[];let cursor='';
  for(let page=0;page<3;page++){
   const result=await request(path+(path.includes('?')?'&':'?')+'limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
   if(!Array.isArray(result[field])||result[field].length>100||typeof result.cursor!=='string')return bad();
   all.push(...result[field]);cursor=result.cursor;if(!cursor)return all;
   if(cursor.length>1000)return bad();
  }
  throw new KalshiDemoError('PAGINATION_INCOMPLETE');
 }
 function balanceRead(){
  const read=balanceTail.then(async()=>{
   const delay=nextBalanceAt-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
   nextBalanceAt=Date.now()+1100;
   return request('/portfolio/balance');
  });
  balanceTail=read.catch(()=>undefined);return read;
 }
 return {fingerprint,
  async account(){
   const [balance,orders,positions]=await Promise.all([balanceRead(),pages('/portfolio/orders','orders'),
    pages('/portfolio/positions?settlement_status=all','market_positions')]);
   const cash=demoFixedMicros(balance.balance_dollars),pv=balance.portfolio_value;
   if(cash<0||!Number.isSafeInteger(pv)||Number(pv)<0||!Number.isSafeInteger(Number(pv)*10000))return bad();
   return {source:'KALSHI_DEMO',fetchedAt:new Date(now()).toISOString(),cashMicros:cash,portfolioValueMicros:Number(pv)*10000,
    orders:orders.map(v=>{const o=object(v),side=o.outcome_side,status=o.status;
     if((side!=='yes'&&side!=='no')||!['resting','canceled','executed'].includes(String(status)))return bad();
     const filled=demoFixedMicros(o.fill_count_fp),remaining=demoFixedMicros(o.remaining_count_fp);
     if(filled<0||remaining<0)return bad();
     return {orderId:text(o.order_id),clientOrderId:text(o.client_order_id),ticker:text(o.ticker),side,
      status:status as DemoOrder['status'],filledMicros:filled,remainingMicros:remaining,
      costMicros:demoFixedMicros(o.taker_fill_cost_dollars)+demoFixedMicros(o.maker_fill_cost_dollars),
      feesMicros:demoFixedMicros(o.taker_fees_dollars)+demoFixedMicros(o.maker_fees_dollars)};}),
    positions:positions.map(v=>{const p=object(v);return {ticker:text(p.ticker),quantityMicros:demoFixedMicros(p.position_fp),
     realizedPnlMicros:demoFixedMicros(p.realized_pnl_dollars),feesMicros:demoFixedMicros(p.fees_paid_dollars)};})};
  },
  async markets(eventTicker){
   if(!/^KXHIGHNY-\d{2}[A-Z]{3}\d{2}$/.test(eventTicker))throw new KalshiDemoError('INVALID_EVENT');
   const result=await request('/markets?event_ticker='+eventTicker),at=new Date(now()).toISOString();
   if(!Array.isArray(result.markets)||result.markets.length>40||result.cursor)return bad();
   return result.markets.map(v=>{const m=object(v);let strike:TemperatureStrike;
    if(m.event_ticker!==eventTicker||typeof m.rules_primary!=='string'||!/Central Park|KNYC/i.test(m.rules_primary))
     throw new KalshiDemoError('UNVERIFIED_MARKET_MAPPING');
    if(m.strike_type==='greater'&&typeof m.floor_strike==='number')strike={kind:'above',thresholdF:m.floor_strike};
    else if(m.strike_type==='less'&&typeof m.cap_strike==='number')strike={kind:'below',thresholdF:m.cap_strike};
    else if(m.strike_type==='between'&&typeof m.floor_strike==='number'&&typeof m.cap_strike==='number')
     strike={kind:'between',lowerF:m.floor_strike,upperF:m.cap_strike};
    else throw new KalshiDemoError('UNVERIFIED_MARKET_MAPPING');
    return {market:normalizeMarket(m,'KXHIGHNY',at),strike};});
  },
  async book(ticker){
   if(!TICKER.test(ticker))throw new KalshiDemoError('INVALID_TICKER');
   return normalizeBook(ticker,await request('/markets/'+ticker+'/orderbook?depth=20'),new Date(now()).toISOString());
  },
  async submit(i){
   if(!UUID.test(i.clientOrderId)||!TICKER.test(i.ticker)||!['yes','no'].includes(i.side)||
    !Number.isSafeInteger(i.priceMicros)||i.priceMicros<10000||i.priceMicros>990000||i.priceMicros%10000!==0)
    throw new KalshiDemoError('INVALID_ORDER');
   const yesPrice=i.side==='yes'?i.priceMicros:1_000_000-i.priceMicros;
   const response=await request('/portfolio/events/orders','POST',{ticker:i.ticker,client_order_id:i.clientOrderId,
    side:i.side==='yes'?'bid':'ask',count:'1.00',price:'0.'+String(yesPrice/100).padStart(4,'0'),
    time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',cancel_order_on_pause:true});
   try{
    const filled=demoFixedMicros(response.fill_count),remaining=demoFixedMicros(response.remaining_count);
    const average=filled?moneyMicros(response.average_fill_price):null,fee=filled?moneyMicros(response.average_fee_paid):null;
    if(response.client_order_id!==i.clientOrderId||!UUID.test(String(response.order_id))||filled<0||filled>1_000_000||remaining!==0||
     (average!==null&&(i.side==='yes'?average:1_000_000-average)>i.priceMicros)||
     !Number.isSafeInteger(response.ts_ms)||Number(response.ts_ms)>now()+30000)return bad();
    return {source:'KALSHI_DEMO',orderId:String(response.order_id),clientOrderId:i.clientOrderId,
     filledMicros:filled,remainingMicros:0,averageYesPriceMicros:average,averageFeeMicros:fee,
     processedAt:new Date(Number(response.ts_ms)).toISOString()};
   }catch{throw new KalshiDemoError('ORDER_OUTCOME_UNKNOWN',true);}
  },
  async cancel(orderId,ticker){
   if(!UUID.test(orderId)||!TICKER.test(ticker))throw new KalshiDemoError('INVALID_ORDER');
   const r=await request('/portfolio/events/orders/'+orderId+'?market_ticker='+ticker+'&exchange_index=-1','DELETE');
   if(r.order_id!==orderId)throw new KalshiDemoError('ORDER_OUTCOME_UNKNOWN',true);
  },
  async result(ticker){
   if(!TICKER.test(ticker))throw new KalshiDemoError('INVALID_TICKER');
   const m=object((await request('/markets/'+ticker)).market);
   if(!['settled','finalized'].includes(String(m.status))||m.is_provisional===true)return null;
   if(m.ticker!==ticker||(m.result!=='yes'&&m.result!=='no')||typeof m.settlement_ts!=='string'||
    !Number.isFinite(Date.parse(m.settlement_ts))||Date.parse(m.settlement_ts)>now()||
    (m.settlement_value_dollars!==undefined&&moneyMicros(m.settlement_value_dollars)!==(m.result==='yes'?1_000_000:0)))
    throw new KalshiDemoError('SETTLEMENT_UNVERIFIED');
   return {source:'KALSHI_DEMO',ticker,eventTicker:text(m.event_ticker),result:m.result,settledAt:m.settlement_ts,
    fetchedAt:new Date(now()).toISOString(),rulesPrimary:text(m.rules_primary,10000),rulesSecondary:typeof m.rules_secondary==='string'?m.rules_secondary:null};
  }
 };
}
