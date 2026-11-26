/** Demo lifecycle with durable intent before one POST. No production exchange adapter. */
import type {KalshiPlatformStore} from './kalshi-platform-store.ts';
import {KalshiDemoError,type KalshiDemoClient,type DemoAccount,type DemoAcknowledgement} from './kalshi-demo-client.ts';
import {forecastHighPmf,eventProbabilitiesPpm,type WeatherContractForecastV1} from '../prediction-markets/kalshi/weather-distribution.ts';
import {verifyContractForecast} from '../prediction-markets/kalshi/contract-grade.ts';
import {expectedValueMicros,validateStrikePartition} from '../prediction-markets/kalshi/contract-math.ts';
import type {WeatherTrainingDay} from '../prediction-markets/kalshi/weather-model.ts';
export type DemoIntent={id:string;ticker:string;side:'yes'|'no';price_micros:number;kind:'MODEL'|'SMOKE';key_fingerprint:string;close_at:string;created_at:string;decision_document:string};
type Receipt={id:number;intent_id:string;kind:string;document:string;recorded_at:string};
export type DemoControl={state:'ARMED'|'STOPPED';key_fingerprint:string|null;checked_at:string|null};
export async function demoIntentHistory(store:KalshiPlatformStore){
 const [intents,receipts]=await Promise.all([
  store.select<DemoIntent>('kalshi_demo_intents','select=*&order=created_at.asc&limit=301'),
  store.select<Receipt>('kalshi_demo_receipts','select=*&order=id.asc&limit=1501')]);
 if(intents.length>300||receipts.length>1500)throw Error('KALSHI_DEMO_HISTORY_LIMIT');
 return {intents,receipts};
}
export async function reconcileKalshiDemo(store:KalshiPlatformStore,client:KalshiDemoClient){
 const account=await client.account();
 const {intents,receipts}=await demoIntentHistory(store);
 let settlementChecks=0;
 for(const i of intents.filter(i=>i.key_fingerprint===client.fingerprint)){
  const order=account.orders.find(o=>o.clientOrderId===i.id);
  const history=receipts.filter(r=>r.intent_id===i.id),priorSettlement=history.filter(r=>r.kind==='SETTLED').at(-1);
  if(order){
   if(order.ticker!==i.ticker||order.side!==i.side)throw Error('KALSHI_DEMO_ORDER_IDENTITY_MISMATCH');
   const previous=history.filter(r=>r.kind==='RECONCILED').at(-1),document=JSON.stringify({source:'KALSHI_DEMO',order});
   if(previous?.document!==document)await store.insert('kalshi_demo_receipts',[{intent_id:i.id,kind:'RECONCILED',document}]);
  }
  // An absent order read never proves non-submission. A prior matching acknowledgement can still prove a fill.
  const filled=Math.max(order?.filledMicros??0,...history.map(r=>{const d=JSON.parse(r.document);return Number(d.filledMicros??d.order?.filledMicros??0);}));
  if(filled>0&&Date.parse(i.close_at)<Date.parse(account.fetchedAt)&&settlementChecks<6&&
   (!priorSettlement||Date.parse(account.fetchedAt)-Date.parse(i.close_at)<3*86400000)){
   settlementChecks++;
   const result=await client.result(i.ticker);
   if(result){
    const decision=JSON.parse(i.decision_document);
    if(result.eventTicker!==decision.market?.eventTicker||result.rulesPrimary!==decision.market?.rulesPrimary||
     result.rulesSecondary!==decision.market?.rulesSecondary)throw Error('KALSHI_DEMO_SETTLEMENT_RULES_CHANGED');
    const sameResult=(a:Record<string,unknown>)=>{const {fetchedAt:unused,...rest}=a;void unused;return JSON.stringify(rest);};
    if(!priorSettlement||sameResult(JSON.parse(priorSettlement.document))!==sameResult(result))
     await store.insert('kalshi_demo_receipts',[{intent_id:i.id,kind:'SETTLED',document:JSON.stringify(result)}]);
   }
  }
 }
 await store.insert('kalshi_demo_account_snapshots',[{key_fingerprint:client.fingerprint,document:JSON.stringify(account)}]);
 return account;
}
function clean(account:DemoAccount,intents:DemoIntent[],fingerprint:string){
 const own=new Set(intents.filter(i=>i.key_fingerprint===fingerprint).map(i=>i.ticker));
 if(account.cashMicros<1_100_000||account.orders.some(o=>o.status==='resting'||o.remainingMicros>0)||
  account.positions.some(p=>p.quantityMicros!==0&&!own.has(p.ticker)))throw Error('KALSHI_DEMO_ACCOUNT_NOT_CLEAN');
}
export async function startKalshiDemo(store:KalshiPlatformStore,client:KalshiDemoClient){
 const account=await reconcileKalshiDemo(store,client),history=await demoIntentHistory(store);
 clean(account,history.intents,client.fingerprint);
 if(history.intents.some(i=>i.key_fingerprint===client.fingerprint&&
  !history.receipts.some(r=>r.intent_id===i.id&&['ACKNOWLEDGED','REJECTED','RECONCILED','SETTLED'].includes(r.kind))))
  throw Error('KALSHI_DEMO_RECONCILE_REQUIRED');
 await store.rpc('kalshi_set_demo_control',{p_state:'ARMED',p_fingerprint:client.fingerprint});
 return {state:'ARMED',account};
}
export async function stopKalshiDemo(store:KalshiPlatformStore,client?:KalshiDemoClient){
 // Disarm first, even if credentials are missing or a subsequent broker read fails.
 await store.rpc('kalshi_set_demo_control',{p_state:'STOPPED',p_fingerprint:null});
 if(client){
  const {intents}=await demoIntentHistory(store),account=await client.account();
  const own=new Set(intents.filter(i=>i.key_fingerprint===client.fingerprint).map(i=>i.id));
  for(const order of account.orders.filter(o=>own.has(o.clientOrderId)&&o.remainingMicros>0))await client.cancel(order.orderId,order.ticker);
  await reconcileKalshiDemo(store,client);
 }
 return {state:'STOPPED'};
}
const eventFor=(day:string)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('KALSHI_DEMO_BAD_DATE');
 return 'KXHIGHNY-'+day.slice(2,4)+['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(day.slice(5,7))-1]+day.slice(8,10);
};
async function submitOnce(store:KalshiPlatformStore,client:KalshiDemoClient,candidate:{ticker:string;side:'yes'|'no';price:number;close:string;kind:'MODEL'|'SMOKE';decision:string}){
 const returned=await store.rpc<DemoIntent|DemoIntent[]>('kalshi_claim_demo_intent',{
  p_ticker:candidate.ticker,p_side:candidate.side,p_price:candidate.price,p_close:candidate.close,
  p_kind:candidate.kind,p_fingerprint:client.fingerprint,p_decision:candidate.decision});
 const intent=Array.isArray(returned)&&returned.length===1?returned[0]:returned as DemoIntent;
 if(!intent||typeof intent.id!=='string'||intent.ticker!==candidate.ticker||intent.side!==candidate.side||
  Number(intent.price_micros)!==candidate.price)throw Error('KALSHI_DEMO_UNVERIFIED_INTENT');
 let acknowledgement:DemoAcknowledgement;
 try{acknowledgement=await client.submit({clientOrderId:intent.id,ticker:intent.ticker,side:intent.side,priceMicros:Number(intent.price_micros)});}
 catch(e){
  const definitive=e instanceof KalshiDemoError&&!e.outcomeUnknown;
  try{await store.insert('kalshi_demo_receipts',[{intent_id:intent.id,kind:definitive?'REJECTED':'OUTCOME_UNKNOWN',
   document:JSON.stringify({source:'KALSHI_DEMO',code:e instanceof KalshiDemoError?e.code:'UNCONFIRMED'})}]);}
  finally{if(!definitive)await store.rpc('kalshi_set_demo_control',{p_state:'STOPPED',p_fingerprint:null});}
  throw e;
 }
 // If persistence fails after acknowledgement, the pending intent blocks another POST.
 await store.insert('kalshi_demo_receipts',[{intent_id:intent.id,kind:'ACKNOWLEDGED',document:JSON.stringify(acknowledgement)}]);
 return {status:'ACKNOWLEDGED',intentId:intent.id,kind:candidate.kind,acknowledgement};
}
export async function runKalshiDemo(store:KalshiPlatformStore,client:KalshiDemoClient,x:{
 forecast:WeatherContractForecastV1;training:WeatherTrainingDay[];kind:'MODEL'|'SMOKE';now?:()=>number;
}){
 const now=x.now??(()=>Date.now()),[control]=await store.select<DemoControl>('kalshi_demo_control','select=*&id=eq.true');
 if(control?.state!=='ARMED'||control.key_fingerprint!==client.fingerprint)return {status:'STOPPED'};
 const f=verifyContractForecast(x.forecast);
 const account=await reconcileKalshiDemo(store,client),history=await demoIntentHistory(store);
 clean(account,history.intents,client.fingerprint);
 // Fresh account reads renew health, never the owner's stopped/armed state.
 await store.rpc('kalshi_note_demo_check',{p_fingerprint:client.fingerprint});
 if(x.kind==='MODEL'&&f.status!=='UNCALIBRATED_EXPERIMENTAL_MODEL')return {status:'AWAITING_VERIFIED_HISTORY'};
 const markets=await client.markets(eventFor(f.input.targetLocalDate));
 if(markets.length<2||markets.length>10)return {status:'NO_ELIGIBLE_MARKETS'};
 validateStrikePartition(markets.map(m=>m.strike));
 let probs:number[]=[];
 if(x.kind==='MODEL'){
  const pmf=forecastHighPmf({forecastHighF:f.input.forecastHighF,targetLocalDate:f.input.targetLocalDate,
   asOf:f.asOf,forecastAvailableAt:f.input.forecastAvailableAt,
   training:x.training.filter(t=>Date.parse(t.observedAvailableAt)<Date.parse(f.asOf))});
  if(pmf.trainingDigest!==f.trainingDigest)throw Error('KALSHI_DEMO_MODEL_ARTIFACT_MISMATCH');
  probs=eventProbabilitiesPpm(pmf,markets.map(m=>m.strike));
 }
 const books=await Promise.all(markets.map(m=>client.book(m.market.ticker)));
 const candidates:{ticker:string;side:'yes'|'no';price:number;close:string;kind:'MODEL'|'SMOKE';score:number;decision:string}[]=[];
 markets.forEach(({market},index)=>{
  const book=books[index],t=now();
  if(!['active','open'].includes(market.status)||market.isProvisional||Date.parse(market.closeTime)<=t+300000||
   Date.parse(market.fetchedAt)>t||t-Date.parse(market.fetchedAt)>600000||Date.parse(book.fetchedAt)>t||
   t-Date.parse(book.fetchedAt)>120000||book.ticker!==market.ticker||
   (book.yesBestBidMicros!==null&&book.buyYesAskMicros!==null&&book.yesBestBidMicros>book.buyYesAskMicros)||
   history.intents.some(i=>i.ticker===market.ticker))return;
  for(const side of (x.kind==='SMOKE'?['yes']:['yes','no']) as ('yes'|'no')[]){
   const price=side==='yes'?book.buyYesAskMicros:book.buyNoAskMicros,size=side==='yes'?book.buyYesAvailableSizeMicros:book.buyNoAvailableSizeMicros;
   if(price===null||size===null||size<1_000_000||price<10000||price>990000||price%10000!==0)continue;
   const ev=x.kind==='MODEL'?expectedValueMicros({priceMicros:price,contracts:1,role:'taker',rounding:'SCHEDULE_TABLE_CENT',
    probabilityWinPpm:side==='yes'?probs[index]:1_000_000-probs[index]}).expectedNetMicros-10000:null;
   if(ev!==null&&ev<30000)continue;
   candidates.push({ticker:market.ticker,side,price,close:market.closeTime,kind:x.kind,score:ev??-price,
    decision:JSON.stringify({source:'KALSHI_DEMO',ticker:market.ticker,kind:x.kind,market,book,
     modelForecastId:x.kind==='MODEL'?f.id:null,probabilityYesPpm:x.kind==='MODEL'?probs[index]:null,
     side,priceMicros:price,estimatedEdgeMicros:ev,feeEstimate:'SCHEDULE_TABLE_CENT',slippageMicros:10000,
     decidedAt:new Date(t).toISOString()})});
  }
 });
 candidates.sort((a,b)=>b.score-a.score||a.ticker.localeCompare(b.ticker));
 if(!candidates.length)return {status:'NO_ELIGIBLE_EDGE_OR_LIQUIDITY'};
 return submitOnce(store,client,candidates[0]);
}
