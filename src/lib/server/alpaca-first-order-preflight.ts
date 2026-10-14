/**
 * Owner-requested first Alpaca PAPER order: READ-ONLY broker preflight.
 * No order submission, owner approval, scheduler or release-toggle entry point.
 * All inputs are a proposal, NOT a broker instruction or model signal.
 */
import {alpacaPaperHeaders,getAlpacaPaperSnapshot} from './alpaca-paper-reader.ts';
import {readCompletePaperOrderInventory} from './alpaca-paper-reconciliation.ts';
import {getStagingPaperStatus} from './alpaca-staging-operator.ts';

const PAPER='https://paper-api.alpaca.markets';
const DATA='https://data.alpaca.markets';
type Settings={keyId:string;secretKey:string};
export type FirstOrderPreflight={
 status:'READ_ONLY_PREFLIGHT';
 environment:'Alpaca PAPER';
 symbol:string;shares:1;limitCents:number;
 checkedAt:string;
 marketOpen:boolean;
 quote: null|{feed:'iex';bidCents:number;askCents:number;observedAt:string};
 completedBrokerOrderPages:number;
 blockers:string[];
 staging:'HALTED'|'UNAVAILABLE';
 brokerOrderSubmitted:false;ownerApproved:false;executionPermitted:false;
};
export class PreflightError extends Error{
 readonly code:'INVALID_INPUT'|'BROKER_UNAVAILABLE'|'INVALID_BROKER_DATA';
 constructor(code:PreflightError['code']){
  super('Alpaca PAPER first-order preflight unavailable');
  this.name='PreflightError';this.code=code;
 }
}
function validInput(symbol:unknown,limitCents:unknown):
 asserts symbol is string {
 if(typeof symbol!=='string'||!/^[A-Z]{1,5}$/.test(symbol)||
  !Number.isSafeInteger(limitCents)||(limitCents as number)<1||
  (limitCents as number)>2500)throw new PreflightError('INVALID_INPUT');
}
function object(x:unknown):Record<string,unknown>{
 if(!x||typeof x!=='object'||Array.isArray(x))throw new PreflightError('INVALID_BROKER_DATA');
 return x as Record<string,unknown>;
}
function priceCents(x:unknown):number{
 if(typeof x==='number'){
  if(!Number.isFinite(x)||x<=0||x>100000||Math.abs(x*100-Math.round(x*100))>0.0001)
   return NaN;
  return Math.round(x*100);
 }
 if(typeof x==='string'&&/^\d{1,6}(?:\.\d{1,2})?$/.test(x)){
  const [whole,frac='']=x.split('.');
  return Number(whole)*100+Number(frac.padEnd(2,'0'));
 }
 return NaN;
}
function time(value:unknown):number{
 if(typeof value!=='string'||value.length>60||
   !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value))return NaN;
 return Date.parse(value);
}
async function paperGet(path:string,config:Settings,fetcher:typeof fetch,origin:string):Promise<unknown>{
 if(!path.startsWith('/v2/')||!path||![PAPER,DATA].includes(origin))
  throw new PreflightError('INVALID_INPUT');
 let response:Response;
 try{response=await fetcher(origin+path,{
   method:'GET',headers:alpacaPaperHeaders(config),
   redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8500)
 });}catch{throw new PreflightError('BROKER_UNAVAILABLE');}
 if(!response.ok)throw new PreflightError('BROKER_UNAVAILABLE');
 let body:string;
 try{body=await response.text();}catch{throw new PreflightError('BROKER_UNAVAILABLE');}
 if(body.length>12000)throw new PreflightError('INVALID_BROKER_DATA');
 try{return JSON.parse(body) as unknown;}catch{throw new PreflightError('INVALID_BROKER_DATA');}
}
function nyHour(now:number){
 const parts=new Intl.DateTimeFormat('en-US',{
  timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(new Date(now));
 const h=Number(parts.find(p=>p.type==='hour')?.value);
 const m=Number(parts.find(p=>p.type==='minute')?.value);
 return h*60+m;
}
/**
 * Deterministic, owner-initiated READ-ONLY rehearsal using actual broker/account
 * evidence. Broker requests use GET only; staging status is a database RPC POST,
 * never a broker order POST. Staging absence is a blocker, not an approval.
 */
export async function inspectFirstPaperOrder(
 symbol:unknown,limitCents:unknown,config:Settings,
 fetcher:typeof fetch=fetch,
 stagingStatus:()=>Promise<{halted:true;storedIntentCount:number;unresolvedReceiptCount:number}>=getStagingPaperStatus,
 now:()=>string=()=>new Date().toISOString()
):Promise<FirstOrderPreflight>{
 validInput(symbol,limitCents);
 const evaluated=now(),clockMs=time(evaluated);
 if(!Number.isFinite(clockMs))throw new PreflightError('INVALID_INPUT');
 const blockers:string[]=[];
 const snapshot=await getAlpacaPaperSnapshot(config,fetcher,()=>evaluated);
 if(snapshot.accountType!=='paper'||snapshot.readOnly!==true||
    snapshot.automaticPaperOrdersEnabled!==false)
  throw new PreflightError('INVALID_BROKER_DATA');
 if(snapshot.account.status!=='ACTIVE'||snapshot.account.tradingBlocked||
    snapshot.account.accountBlocked)blockers.push('PAPER_ACCOUNT_NOT_TRADEABLE');
 if(snapshot.positions.length!==0)blockers.push('PAPER_POSITIONS_NEED_REVIEW');
 if(snapshot.warnings.length!==0)blockers.push('ACCOUNT_SNAPSHOT_WARNINGS');
 const notional=limitCents as number;
 const cash=priceCents(snapshot.account.cashUsd);
 const buyingPower=priceCents(snapshot.account.buyingPowerUsd);
 const equity=priceCents(snapshot.account.equityUsd);
 if(!Number.isSafeInteger(cash)||!Number.isSafeInteger(buyingPower)||
    !Number.isSafeInteger(equity)||equity<=0)
  blockers.push('PAPER_ACCOUNT_VALUES_UNVERIFIED');
 else if(cash<notional||buyingPower<notional||notional*100>equity*20)
  blockers.push('PAPER_CASH_OR_EXPOSURE_LIMIT');
 const history=await readCompletePaperOrderInventory(config,fetcher,()=>evaluated);
 if(history.historyComplete!==true||!history.openOrdersComplete)
  throw new PreflightError('INVALID_BROKER_DATA');
 if(history.openOrders.length!==0)blockers.push('BROKER_OPEN_ORDERS_REQUIRE_REVIEW');
 if(time(history.checkedAt)>clockMs+1000||clockMs-time(history.checkedAt)>60_000)
  blockers.push('BROKER_ORDER_HISTORY_NOT_FRESH');
 const asset=object(await paperGet('/v2/assets/'+symbol,config,fetcher,PAPER));
 if(asset.symbol!==symbol||asset.asset_class!=='us_equity'||
    asset.status!=='active'||asset.tradable!==true||
    typeof asset.exchange!=='string'||
    !['NYSE','NASDAQ','AMEX','ARCA','BATS'].includes(asset.exchange))
  blockers.push('UNVERIFIED_EQUITY_ELIGIBILITY');
 const clock=object(await paperGet('/v2/clock',config,fetcher,PAPER));
 const brokerNow=time(clock.timestamp),close=time(clock.next_close);
 const marketOpen=clock.is_open===true&&Number.isFinite(brokerNow)&&
  Math.abs(clockMs-brokerNow)<=60_000&&Number.isFinite(close)&&
  close-clockMs>20*60_000&&nyHour(clockMs)>=9*60+35&&nyHour(clockMs)<16*60;
 if(!marketOpen)blockers.push('MARKET_CLOSED_OR_CLOCK_UNVERIFIED');
 const payload=object(await paperGet('/v2/stocks/'+symbol+'/quotes/latest?feed=iex',config,fetcher,DATA));
 const q=object(payload.quote),bid=priceCents(q.bp),ask=priceCents(q.ap),seen=time(q.t);
 let quote:FirstOrderPreflight['quote']=null;
 if(!Number.isSafeInteger(bid)||!Number.isSafeInteger(ask)||
  bid<1||ask<bid||typeof q.bs!=='number'||q.bs<=0||
  typeof q.as!=='number'||q.as<=0||!Number.isFinite(seen)||
  seen>clockMs+2000||clockMs-seen>60_000)
  blockers.push('QUOTE_MISSING_OR_STALE');
 else{
  quote={feed:'iex',bidCents:bid,askCents:ask,observedAt:String(q.t)};
  if(ask-bid>Math.max(5,Math.floor(ask*0.02)))
   blockers.push('WIDE_QUOTE_SPREAD');
  if(notional<ask||notional>Math.min(2500,ask+Math.max(5,Math.floor(ask*0.02))))
   blockers.push('LIMIT_OUTSIDE_REVIEW_RANGE');
 }
 let staging:FirstOrderPreflight['staging']='UNAVAILABLE';
 try{
  const state=await stagingStatus();
  if(state.halted===true&&Number.isSafeInteger(state.storedIntentCount)&&
     Number.isSafeInteger(state.unresolvedReceiptCount)){
   staging='HALTED';
   if(state.storedIntentCount!==0||state.unresolvedReceiptCount!==0)
    blockers.push('STAGING_EXISTING_INTENTS_REVIEW');
  }
 }catch{/* explicit unavailable blocker */}
 if(staging==='UNAVAILABLE')blockers.push('STAGING_CREDENTIAL_OR_STATUS_UNAVAILABLE');
 if(staging==='HALTED')blockers.push('STAGING_EMERGENCY_STOP_ENGAGED');
 blockers.push('NO_OWNER_APPROVED_EXECUTION_PATH','NO_DURABLE_BROKER_ORDER_RELEASE');
 return {
  status:'READ_ONLY_PREFLIGHT',environment:'Alpaca PAPER',symbol,shares:1,
  limitCents:notional,checkedAt:evaluated,marketOpen,quote,
  completedBrokerOrderPages:history.pageCount,blockers:[...new Set(blockers)],
  staging,brokerOrderSubmitted:false,ownerApproved:false,executionPermitted:false
 };
}
