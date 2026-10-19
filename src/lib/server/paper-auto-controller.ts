/**
 * Recurring Alpaca PAPER controller: one scheduler slot per call. SERVER/WORKER ONLY.
 * The database contract (paper_auto_v1) is the authority for STOP, leases, claims,
 * caps and receipts. Astra's frozen planner (stock-forward-rebalance-v1) sizes
 * every leg; this module never changes a target, a size or a limit price.
 * It never retries an unknown POST, never trades on a mismatch, and stops the
 * experiment (with a critical alert) on any external or unexplained broker state.
 */
import {createHash} from 'node:crypto';
import {planComputedForwardSignal,type ComputedForwardSignal,type ForwardRebalancePlan}
 from '../stocks/paper-strategy-rebalance.ts';
import {classifyActivityType,dollarsToCents,isOpenOrder,type BrokerAccount,type BrokerOrder,
 type BrokerPosition,type OrderRequest,type PaperAutoBroker} from './paper-auto-broker.ts';
import {PaperAutoStoreError,storeCode,type PaperAutoStore,type StoreReply} from './paper-auto-store.ts';
import {iso,nyDate,nyMinutes} from './paper-auto-time.ts';
import {paperRiskBreach} from './paper-auto-risk.ts';

export const CONTROLLER_LIMITS={
 /** A working limit order older than this is canceled and re-planned on fresh quotes. */
 restingOrderMs:5*60_000,
 /** Observers leave a claim this fresh to the run that is submitting it. */
 inFlightClaimMs:2*60_000,
 fillPollMs:5_000,
 fillPollRounds:12,
 lookupDelayMs:2_000,
 planningRounds:2,
 /** Exchange quote timestamps may lead the local clock by at most this much. */
 clockSkewMs:2_000
} as const;
export type ControllerDeps={store:PaperAutoStore;broker:PaperAutoBroker;now:()=>number;
 sleep:(ms:number)=>Promise<void>;worker:string};
export type SlotKind='decision'|'execute'|'monitor'|'reconcile';
export type SlotOutcome='SKIPPED'|'SUCCEEDED'|'BLOCKED'|'STOPPED'|'FAILED';
export type SlotResult={experimentId:string;kind:SlotKind;slot:string;outcome:SlotOutcome;reason:string;
 runId:string|null;posts:number;cancels:number;detail:Record<string,unknown>};

type Experiment={experimentId:string;modelVersion:string;brokerAccountId:string;brokerAccountNumber:string;
 registeredAt:string;startingEquityCents:number;capitalLimitCents:number;drawdownStopBps:number;
 feeReserveCents:number};
type Decision={decisionId:string;session:string;decisionAt:string;outcome:string;signal:unknown};
export type IntentRow={intentId:string;decisionId:string;securityId:string;symbol:string;side:'buy'|'sell';
 shares:number;limitCents:number;clientOrderId:string;status:string;brokerOrderId:string|null;
 brokerStatus:string|null;filledQty:string;filledAvgPrice:string|null;lockVersion:number;
 createdAt:string;updatedAt:string};
type WorkerState={gateMode:string;experiment:Experiment;decision:Decision|null;intents:IntentRow[];
 filled:Map<string,{securityId:string;shares:number}>;highWaterCents:number;brokerOrderIds:Set<string>;
 activityAfter:string;knownActivityIds:Set<string>};
const ACTIVE=new Set(['reserved','submitting','open','partially_filled','uncertain']);
const WORKING=new Set(['open','partially_filled']);
const UNRESOLVED=new Set(['submitting','uncertain']);

/** A state that needs the owner: the experiment is stopped with a critical alert. */
class ControllerStop extends Error{
 readonly code:string;readonly detail:Record<string,unknown>;
 constructor(code:string,detail:Record<string,unknown>={}){
  super('Recurring PAPER controller stop: '+code);this.name='ControllerStop';this.code=code.slice(0,64);
  this.detail=detail;
 }
}
/** A refusal that only blocks this run (planner input, timing or clock problems). */
class RunBlocked extends Error{
 readonly code:string;
 constructor(code:string){super('Recurring PAPER run blocked: '+code);this.name='RunBlocked';this.code=code.slice(0,64);}
}
function invalid(what:string):never{throw new ControllerStop('STATE_INVALID',{what});}
function obj(v:unknown,what:string):Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v))invalid(what);
 return v as Record<string,unknown>;
}
function str(o:Record<string,unknown>,k:string):string{
 const v=o[k];
 if(typeof v!=='string'||!v)invalid(k);
 return v;
}
function optStr(o:Record<string,unknown>,k:string):string|null{
 const v=o[k];
 if(v===null||v===undefined)return null;
 if(typeof v!=='string')invalid(k);
 return v;
}
function int(o:Record<string,unknown>,k:string):number{
 const v=o[k];
 if(!Number.isSafeInteger(v))invalid(k);
 return v as number;
}
function wholeShares(v:string):number{
 if(!/^\d{1,10}(\.0+)?$/.test(v))throw new ControllerStop('FRACTIONAL_QUANTITY',{qty:v});
 return Number(v.split('.')[0]);
}
/** Integer cents of shares x decimal price, rounded up (conservative for unsettled proceeds). */
export function proceedsCents(qty:number,price:string):number{
 const m=/^(\d{1,10})(?:\.(\d{1,9}))?$/.exec(price);
 if(!m||!Number.isSafeInteger(qty)||qty<0)throw new ControllerStop('PRICE_INVALID');
 const micros=BigInt(m[1])*BigInt(1_000_000)+BigInt((m[2]??'').padEnd(6,'0').slice(0,6));
 return Number((BigInt(qty)*micros+BigInt(9_999))/BigInt(10_000));
}
function truncatePrice(p:string):string{
 const [whole,frac='']=p.split('.');
 const f=frac.slice(0,6).replace(/0+$/,'');
 return f?`${whole}.${f}`:whole;
}
function parseIntent(raw:unknown):IntentRow{
 const i=obj(raw,'intent'),side=i.side;
 if(side!=='buy'&&side!=='sell')invalid('side');
 return {intentId:str(i,'intentId'),decisionId:str(i,'decisionId'),securityId:str(i,'securityId'),
  symbol:str(i,'symbol'),side,shares:int(i,'shares'),limitCents:int(i,'limitCents'),
  clientOrderId:str(i,'clientOrderId'),status:str(i,'status'),brokerOrderId:optStr(i,'brokerOrderId'),
  brokerStatus:optStr(i,'brokerStatus'),filledQty:str(i,'filledQty'),filledAvgPrice:optStr(i,'filledAvgPrice'),
  lockVersion:int(i,'lockVersion'),createdAt:str(i,'createdAt'),updatedAt:str(i,'updatedAt')};
}
type Ctx=ControllerDeps&{experimentId:string;runId:string;posts:number;cancels:number};
async function readState(ctx:Ctx):Promise<WorkerState>{
 const raw=await ctx.store.call('worker_state',{experiment_id:ctx.experimentId});
 if(raw.state==='NOT_REGISTERED')throw new ControllerStop('NOT_REGISTERED');
 const status=obj(raw.status,'status'),x=obj(raw.experiment,'experiment');
 const experiment:Experiment={experimentId:str(x,'experimentId'),modelVersion:str(x,'modelVersion'),
  brokerAccountId:str(x,'brokerAccountId'),brokerAccountNumber:str(x,'brokerAccountNumber'),
  registeredAt:str(x,'registeredAt'),startingEquityCents:int(x,'startingEquityCents'),
  capitalLimitCents:int(x,'capitalLimitCents'),drawdownStopBps:int(x,'drawdownStopBps'),
  feeReserveCents:int(x,'feeReserveCents')};
 if(experiment.experimentId!==ctx.experimentId)invalid('experimentId');
 let decision:Decision|null=null;
 if(raw.latestDecision!==null&&raw.latestDecision!==undefined){
  const d=obj(raw.latestDecision,'latestDecision');
  decision={decisionId:str(d,'decisionId'),session:str(d,'session'),decisionAt:str(d,'decisionAt'),
   outcome:str(d,'outcome'),signal:d.signal};
 }
 if(!Array.isArray(raw.intents)||!Array.isArray(raw.filledBySecurity)||!Array.isArray(raw.knownActivityIds)||
  !Array.isArray(raw.brokerOrderIds))invalid('lists');
 const filled=new Map<string,{securityId:string;shares:number}>();
 for(const f of raw.filledBySecurity){
  const row=obj(f,'filled'),n=Number(str(row,'netShares'));
  if(!Number.isInteger(n)||n<0)throw new ControllerStop('FILL_LEDGER_INVALID');
  if(n>0)filled.set(str(row,'symbol'),{securityId:str(row,'securityId'),shares:n});
 }
 const hw=raw.equityHighWaterCents;
 const cursor=raw.activityCursor===null||raw.activityCursor===undefined?null:obj(raw.activityCursor,'cursor');
 // Re-read one day of overlap; the store deduplicates activity ids and refuses changed content.
 const after=cursor?iso(Date.parse(str(cursor,'activityAt'))-86_400_000):experiment.registeredAt;
 return {gateMode:str(status,'gateMode'),experiment,decision,intents:raw.intents.map(parseIntent),filled,
  highWaterCents:Number.isSafeInteger(hw)?Math.max(hw as number,experiment.startingEquityCents)
   :experiment.startingEquityCents,brokerOrderIds:new Set(raw.brokerOrderIds.map(v=>String(v))),
  activityAfter:after,knownActivityIds:new Set(raw.knownActivityIds.map(v=>String(v)))};
}
async function heartbeat(ctx:Ctx){await ctx.store.call('heartbeat',{run_id:ctx.runId});}
async function record(ctx:Ctx,i:IntentRow,next:string,extra:Record<string,unknown>={}){
 return ctx.store.call('record_order',{run_id:ctx.runId,intent_id:i.intentId,expected_version:i.lockVersion,
  next_status:next,...extra});
}
/** Maps a broker order onto the intent state machine; null means unsupported or inconsistent. */
export function intentStatusFor(order:BrokerOrder,orderShares:number):string|null{
 let filled:number;
 try{filled=wholeShares(order.filledQty);}catch{return null;}
 if(filled>orderShares)return null;
 switch(order.status){
  case 'filled':return filled===orderShares?'filled':null;
  case 'canceled':return 'canceled';
  case 'expired':return 'expired';
  case 'rejected':return filled===0?'rejected':null;
  case 'replaced':return null;
  default:
   if(!isOpenOrder(order))return null;
   return filled===0?'open':filled<orderShares?'partially_filled':null;
 }
}
function orderMatchesIntent(o:BrokerOrder,i:IntentRow):boolean{
 return o.clientOrderId===i.clientOrderId&&o.symbol===i.symbol&&o.side===i.side&&o.type==='limit'&&
  o.timeInForce==='day'&&o.qty===String(i.shares)&&!o.extendedHours&&o.limitPrice!==null&&
  dollarsToCents(o.limitPrice)===i.limitCents&&(i.brokerOrderId===null||i.brokerOrderId===o.id);
}
/** Records what the broker shows for one intent. A mismatched order is never recorded. */
async function observe(ctx:Ctx,i:IntentRow,o:BrokerOrder):Promise<boolean>{
 if(!orderMatchesIntent(o,i))throw new ControllerStop('BROKER_ORDER_MISMATCH',{symbol:i.symbol});
 const next=intentStatusFor(o,i.shares);
 if(next===null)throw new ControllerStop('UNSUPPORTED_BROKER_ORDER_STATE',{symbol:i.symbol,status:o.status});
 const filled=wholeShares(o.filledQty);
 if(next===i.status&&o.status===i.brokerStatus&&filled===Number(i.filledQty)&&o.id===i.brokerOrderId)return false;
 if(filled>0&&o.filledAvgPrice===null)throw new ControllerStop('FILL_PRICE_MISSING',{symbol:i.symbol});
 const price=filled>0&&o.filledAvgPrice?truncatePrice(o.filledAvgPrice):null;
 await record(ctx,i,next,{broker_order_id:o.id,broker_status:o.status,filled_qty:String(filled),
  ...(price?{filled_avg_price:price}:{}),
  detail:price&&price!==o.filledAvgPrice?{brokerFilledAvgPrice:o.filledAvgPrice}:{}});
 return true;
}
/** Brings every live or unresolved intent up to date from client-order-id lookups. */
async function syncIntents(ctx:Ctx,state:WorkerState):Promise<number>{
 let changed=0;
 for(const i of state.intents){
  if(!ACTIVE.has(i.status))continue;
  const age=ctx.now()-Date.parse(i.updatedAt);
  if(i.status==='reserved'){
   // Only the 5-minute claim window can turn a reservation into a POST.
   if(ctx.now()-Date.parse(i.createdAt)>=5*60_000){
    await record(ctx,i,'not_submitted',{detail:{reason:'RESERVATION_ABANDONED'}});changed++;
   }
   continue;
  }
  if(i.status==='submitting'&&age<CONTROLLER_LIMITS.inFlightClaimMs)continue;
  const o=await ctx.broker.orderByClientId(i.clientOrderId);
  if(o===null){
   if(i.status==='submitting'){
    // Not observed is never proof of failure: uncertain, never retried.
    await record(ctx,i,'uncertain',{detail:{reason:'CLIENT_ID_NOT_OBSERVED'}});changed++;
   }else if(WORKING.has(i.status))throw new ControllerStop('BROKER_ORDER_MISSING',{symbol:i.symbol});
   continue;
  }
  if(await observe(ctx,i,o))changed++;
 }
 return changed;
}
/** Open orders and positions the strategy ledger cannot explain (fills in flight are allowed). */
function externalState(state:WorkerState,orders:BrokerOrder[],positions:BrokerPosition[]):string[]{
 const blockers:string[]=[];
 const ours=new Set(state.intents.filter(i=>ACTIVE.has(i.status)).map(i=>i.clientOrderId));
 for(const o of orders)if(!o.clientOrderId||!ours.has(o.clientOrderId))blockers.push('EXTERNAL_OPEN_ORDER:'+o.symbol);
 const range=new Map<string,{lo:number;hi:number}>();
 for(const [symbol,f] of state.filled)range.set(symbol,{lo:f.shares,hi:f.shares});
 for(const i of state.intents){
  if(!WORKING.has(i.status)&&!UNRESOLVED.has(i.status))continue;
  const r=range.get(i.symbol)??{lo:0,hi:0},left=i.shares-Number(i.filledQty);
  if(i.side==='buy')r.hi+=left;else r.lo-=left;
  range.set(i.symbol,r);
 }
 const seen=new Set<string>();
 for(const p of positions){
  seen.add(p.symbol);
  if(p.side!=='long'){blockers.push('SHORT_POSITION:'+p.symbol);continue;}
  if(!/^\d{1,10}(\.0+)?$/.test(p.qty)){blockers.push('FRACTIONAL_POSITION:'+p.symbol);continue;}
  const held=Number(p.qty.split('.')[0]),r=range.get(p.symbol)??{lo:0,hi:0};
  if(held<r.lo||held>r.hi)blockers.push('POSITION_MISMATCH:'+p.symbol);
 }
 for(const [symbol,r] of range)if(!seen.has(symbol)&&r.lo>0)blockers.push('POSITION_MISSING:'+symbol);
 return blockers;
}
function accountBlockers(a:BrokerAccount,expectedId:string,expectedNumber:string):string[]{
 const b:string[]=[];
 if(a.id!==expectedId||a.accountNumber!==expectedNumber)b.push('ACCOUNT_IDENTITY_MISMATCH');
 if(a.status!=='ACTIVE')b.push('ACCOUNT_NOT_ACTIVE');
 if(a.currency!=='USD')b.push('ACCOUNT_CURRENCY');
 if(a.tradingBlocked||a.accountBlocked)b.push('ACCOUNT_BLOCKED');
 return b;
}
/** Records new broker activities with attribution; any external or unsupported one is a blocker. */
async function syncActivities(ctx:Ctx,state:WorkerState):Promise<string[]>{
 if(state.intents.some(i=>UNRESOLVED.has(i.status)))return [];
 const all=await ctx.broker.activitiesSince(state.activityAfter);
 const fresh=all.filter(a=>!state.knownActivityIds.has(a.id));
 if(!fresh.length)return [];
 const ours=state.brokerOrderIds;
 const rows=fresh.map(a=>({activity_id:a.id,activity_type:a.activityType,activity_at:a.at,
  ...(a.symbol?{symbol:a.symbol}:{}),...(a.side?{side:a.side}:{}),...(a.qty?{qty:a.qty}:{}),
  ...(a.price?{price:truncatePrice(a.price)}:{}),...(a.netAmountCents!==null?{net_amount_cents:a.netAmountCents}:{}),
  ...(a.orderId?{order_id:a.orderId}:{}),
  classification:a.activityType==='FILL'?(a.orderId&&ours.has(a.orderId)?'strategy_fill':'external_fill')
   :classifyActivityType(a.activityType),raw_digest:a.rawDigest}));
 let external=0;
 for(let k=0;k<rows.length;k+=1000){
  const r=await ctx.store.call('record_activities',{run_id:ctx.runId,activities:rows.slice(k,k+1000)});
  external+=Number(r.newExternalOrUnsupported)||0;
 }
 return external>0?['EXTERNAL_OR_UNSUPPORTED_ACTIVITY']:[];
}
async function stopExperiment(ctx:Ctx,code:string,detail:Record<string,unknown>):Promise<void>{
 await ctx.store.call('stop',{experiment_id:ctx.experimentId,reason:code.slice(0,64),
  actor:'worker:'+ctx.worker,alert:{code:code.slice(0,64),detail},evidence:{runId:ctx.runId,...detail}});
}
async function finish(ctx:Ctx,kind:SlotKind,slot:string,outcome:SlotOutcome,reason:string,
 detail:Record<string,unknown>={},check?:{ok:boolean;blockers:string[]}):Promise<SlotResult>{
 const status=outcome==='SUCCEEDED'?'succeeded':outcome==='FAILED'?'failed':'blocked';
 await ctx.store.call('finish_run',{run_id:ctx.runId,status,
  result:{summary:reason,posts:ctx.posts,cancels:ctx.cancels,...detail},...(check?{check}:{})});
 return {experimentId:ctx.experimentId,kind,slot,outcome,reason,runId:ctx.runId,posts:ctx.posts,
  cancels:ctx.cancels,detail};
}
async function begin(deps:ControllerDeps,experimentId:string,kind:SlotKind,slot:string)
 :Promise<{ctx:Ctx}|{skipped:SlotResult}>{
 const r=await deps.store.call('begin_run',{experiment_id:experimentId,kind,slot,worker:deps.worker});
 if(r.started!==true)return {skipped:{experimentId,kind,slot,outcome:'SKIPPED',reason:String(r.reason??'NOT_STARTED'),
  runId:typeof r.runId==='string'?r.runId:null,posts:0,cancels:0,detail:{}}};
 return {ctx:{...deps,experimentId,runId:str(r,'runId'),posts:0,cancels:0}};
}
/** STOP-worthy states stop the experiment; anything else fails or blocks only this run. */
async function guarded(ctx:Ctx,kind:SlotKind,slot:string,body:()=>Promise<SlotResult>):Promise<SlotResult>{
 try{return await body();}
 catch(e){
  if(e instanceof RunBlocked){
   try{
    await ctx.store.call('raise_alert',{run_id:ctx.runId,severity:'warning',code:e.code,detail:{}});
    return await finish(ctx,kind,slot,'BLOCKED',e.code,{},{ok:false,blockers:[e.code]});
   }catch{return {experimentId:ctx.experimentId,kind,slot,outcome:'FAILED',reason:e.code,runId:ctx.runId,
    posts:ctx.posts,cancels:ctx.cancels,detail:{}};}
  }
  if(process.env.PAPER_AUTO_DEBUG==='1')console.error(e);
  const stop=e instanceof ControllerStop;
  const code=stop?e.code:e instanceof PaperAutoStoreError?e.code:
   e&&typeof e==='object'&&'code' in e&&typeof (e as {code:unknown}).code==='string'
    ?String((e as {code:string}).code).slice(0,64):'CONTROLLER_EXCEPTION';
  const detail=stop?e.detail:{};
  let stopped=false;
  try{
   if(stop){await stopExperiment(ctx,code,detail);stopped=true;}
   else await ctx.store.call('raise_alert',{run_id:ctx.runId,severity:'warning',
    code:/^[A-Z0-9_]{3,64}$/.test(code)?code:'CONTROLLER_EXCEPTION',detail:{}});
  }catch{/* reported below as an unconfirmed stop; the owner STOP remains available */}
  // Once STOPPED, the kill switch cancels working strategy orders in this run, best effort,
  // and never in an account other than the registered one.
  if(stopped&&code!=='ACCOUNT_IDENTITY_MISMATCH'){
   try{await cancelWorking(ctx,await readState(ctx));}catch{/* the next execute or reconcile run cancels */}
  }
  const outcome:SlotOutcome=stopped?'STOPPED':'FAILED';
  const reason=stop&&!stopped?'STOP_NOT_CONFIRMED:'+code:code;
  try{return await finish(ctx,kind,slot,outcome,reason,detail,{ok:false,blockers:[code]});}
  catch{return {experimentId:ctx.experimentId,kind,slot,outcome,reason,runId:ctx.runId,posts:ctx.posts,
   cancels:ctx.cancels,detail};}
 }
}
type Seen={account:BrokerAccount;positions:BrokerPosition[];orders:BrokerOrder[];state:WorkerState;
 accountIssues:string[];external:string[]};
/** Fresh broker reads plus ledger reconciliation, shared by every run kind. */
async function reconcileBroker(ctx:Ctx):Promise<Seen>{
 let state=await readState(ctx);
 const account=await ctx.broker.account();
 const accountIssues=accountBlockers(account,state.experiment.brokerAccountId,state.experiment.brokerAccountNumber);
 if(accountIssues.includes('ACCOUNT_IDENTITY_MISMATCH'))throw new ControllerStop('ACCOUNT_IDENTITY_MISMATCH');
 if(await syncIntents(ctx,state)>0)state=await readState(ctx);
 await heartbeat(ctx);
 const positions=await ctx.broker.positions(),orders=await ctx.broker.openOrders();
 const external=[...externalState(state,orders,positions),...await syncActivities(ctx,state)];
 return {account,positions,orders,state,accountIssues,external};
}
function requireClean(seen:Seen){
 if(seen.external.length)throw new ControllerStop(seen.external[0].split(':')[0],{blockers:seen.external});
}
/** Apply the same operational risk policy on execute, reconcile and daily monitor. */
function enforceRisk(seen:Seen){
 const x=seen.state.experiment;
 let code;
 try{code=paperRiskBreach({equityCents:seen.account.equityCents,highWaterCents:seen.state.highWaterCents,
  capitalLimitCents:x.capitalLimitCents,drawdownStopBps:x.drawdownStopBps});}
 catch{throw new ControllerStop('STATE_INVALID',{what:'risk'});}
 if(code)throw new ControllerStop(code,{equityCents:seen.account.equityCents,
  highWaterCents:seen.state.highWaterCents});
}
/** Polls working intents until terminal or the poll budget ends. */
async function settle(ctx:Ctx):Promise<WorkerState>{
 let state=await readState(ctx);
 for(let round=0;round<CONTROLLER_LIMITS.fillPollRounds;round++){
  const working=state.intents.filter(i=>WORKING.has(i.status));
  if(!working.length)break;
  await ctx.sleep(CONTROLLER_LIMITS.fillPollMs);
  await heartbeat(ctx);
  let changed=false;
  for(const i of working){
   const o=await ctx.broker.orderByClientId(i.clientOrderId);
   if(o===null)throw new ControllerStop('BROKER_ORDER_MISSING',{symbol:i.symbol});
   if(await observe(ctx,i,o))changed=true;
  }
  if(changed)state=await readState(ctx);
 }
 return state;
}
/** Kill switch: while STOPPED, cancel every working strategy order and record the outcome. */
async function cancelWorking(ctx:Ctx,state:WorkerState):Promise<void>{
 const working=state.intents.filter(i=>WORKING.has(i.status)&&i.brokerOrderId!==null);
 if(!working.length||!ctx.broker.writesEnabled)return;
 for(const i of working){await ctx.broker.cancelOrder(i.brokerOrderId as string);ctx.cancels++;}
 await settle(ctx);
}
function signalOf(d:Decision,x:Experiment):ComputedForwardSignal{
 const s=obj(d.signal,'signal');
 if(s.version!=='stock-forward-signal-v1'||s.experimentId!==x.experimentId||s.modelVersion!==x.modelVersion||
  s.decisionId!==d.decisionId||s.executionPermitted!==false||s.sourceIndependentlyVerified!==false||
  !Array.isArray(s.targets)||!s.priorInputs||typeof s.priorInputs!=='object'||Array.isArray(s.priorInputs))
  throw new ControllerStop('DECISION_SIGNAL_INVALID');
 return s as unknown as ComputedForwardSignal;
}
function snapshotDigest(v:unknown):string{return createHash('sha256').update(JSON.stringify(v)).digest('hex');}
type Planned={plan:ForwardRebalancePlan;snapshotId:number};
/** Fresh, validated broker inputs into Astra's frozen planner; records the snapshot it used. */
async function plan(ctx:Ctx,state:WorkerState,decision:Decision,session:{openAt:string;closeAt:string})
 :Promise<Planned>{
 const x=state.experiment,signal=signalOf(decision,x);
 const account=await ctx.broker.account();
 if(accountBlockers(account,x.brokerAccountId,x.brokerAccountNumber).length)
  throw new ControllerStop('ACCOUNT_NOT_TRADEABLE');
 const brokerPositions=await ctx.broker.positions(),orders=await ctx.broker.openOrders();
 const external=externalState(state,orders,brokerPositions);
 if(external.length)throw new ControllerStop(external[0].split(':')[0],{blockers:external});
 const ids=new Map<string,string>();
 for(const [securityId,p] of Object.entries(signal.priorInputs))ids.set(p.symbol,securityId);
 const positions=brokerPositions.map(p=>{
  const securityId=ids.get(p.symbol);
  if(!securityId)throw new ControllerStop('UNRECONCILED_POSITION_IDENTITY',{symbol:p.symbol});
  return {securityId,symbol:p.symbol,shares:wholeShares(p.qty)};
 });
 const wanted=new Map<string,string>();
 for(const t of signal.targets)wanted.set(t.symbol,t.securityId);
 for(const p of positions)wanted.set(p.symbol,p.securityId);
 const quotes=await ctx.broker.latestQuotes([...wanted.keys()].sort());
 const localNow=ctx.now();
 let latestQuote=0;
 const planQuotes=[...wanted.entries()].flatMap(([symbol,securityId])=>{
  const q=quotes.get(symbol);
  if(!q)return [];
  latestQuote=Math.max(latestQuote,Date.parse(q.observedAt));
  return [{securityId,symbol,bidCents:q.bidCents,askCents:q.askCents,observedAt:q.observedAt,
   priorAdv20Shares:signal.priorInputs[securityId]?.prior_adv20_shares as number}];
 });
 if(latestQuote-localNow>CONTROLLER_LIMITS.clockSkewMs)throw new RunBlocked('CLOCK_SKEW');
 const plannerNow=Math.max(localNow,latestQuote);
 // Conservative settled cash: today's sale proceeds settle on the next business day (T+1).
 const today=nyDate(plannerNow);
 const unsettled=state.intents.filter(i=>i.side==='sell'&&Number(i.filledQty)>0&&i.filledAvgPrice!==null&&
  nyDate(Date.parse(i.updatedAt))===today)
  .reduce((n,i)=>n+proceedsCents(Number(i.filledQty),i.filledAvgPrice as string),0);
 const settled=Math.max(0,Math.min(account.cashCents-unsettled,account.equityCents));
 const unresolved=state.intents.filter(i=>ACTIVE.has(i.status)).length;
 let result:ForwardRebalancePlan;
 try{
  result=planComputedForwardSignal(signal,{now:iso(plannerNow),sessionOpenAt:session.openAt,
   sessionCloseAt:session.closeAt,accountType:'paper',accountId:account.id,accountSnapshotAt:account.readAt,
   equityCents:account.equityCents,settledCashCents:settled,positionsComplete:true,ordersComplete:true,
   openOrderCount:orders.length,unresolvedReceiptCount:unresolved,positions,quotes:planQuotes,
   feeReserveCentsPerOrder:x.feeReserveCents});
 }catch(e){throw new RunBlocked('PLANNER_'+(e instanceof Error?e.message:'REFUSED'));}
 const snapshot={account:account.id,readAt:account.readAt,equityCents:account.equityCents,cashCents:account.cashCents,
  settledCashCents:settled,positions,openOrders:orders.map(o=>({id:o.id,symbol:o.symbol,status:o.status}))};
 const snap=await ctx.store.call('record_snapshot',{run_id:ctx.runId,captured_at:account.readAt,
  account_id:account.id,equity_cents:account.equityCents,cash_cents:account.cashCents,
  settled_cash_cents:settled,positions,open_orders:snapshot.openOrders,digest:snapshotDigest(snapshot)});
 return {plan:result,snapshotId:int(snap,'snapshotId')};
}
/** One claim, at most one POST. Returns false when submissions must pause. */
async function submitLeg(ctx:Ctx,intentId:string):Promise<boolean>{
 let claimed:StoreReply;
 try{claimed=await ctx.store.call('claim_intent',{run_id:ctx.runId,intent_id:intentId});}
 catch(e){
  // A refused claim forbids the POST; an unknown claim outcome is never followed by a POST either.
  if(e instanceof PaperAutoStoreError)return false;
  throw e;
 }
 const side=claimed.side;
 if(side!=='buy'&&side!=='sell')invalid('side');
 const request:OrderRequest={clientOrderId:str(claimed,'clientOrderId'),symbol:str(claimed,'symbol'),side,
  shares:int(claimed,'shares'),limitCents:int(claimed,'limitCents')};
 ctx.posts++;
 const outcome=await ctx.broker.submitLimitOrder(request);
 const intent=(await readState(ctx)).intents.find(i=>i.intentId===intentId);
 if(!intent||intent.status!=='submitting')throw new ControllerStop('CLAIM_STATE_LOST',{intentId});
 if(outcome.kind==='acknowledged'){await observe(ctx,intent,outcome.order);return true;}
 if(outcome.kind==='rejected'){
  await record(ctx,intent,'rejected',{rejection:{http_status:outcome.httpStatus,code:outcome.code,
   message:outcome.message}});
  throw new ControllerStop('ORDER_REJECTED',{symbol:intent.symbol,httpStatus:outcome.httpStatus,code:outcome.code});
 }
 // Unknown outcome: record it, look once by client order id, and never re-send.
 await record(ctx,intent,'uncertain',{detail:{reason:outcome.kind==='duplicate_client_id'?
  'DUPLICATE_CLIENT_ID':outcome.reason}});
 await ctx.sleep(CONTROLLER_LIMITS.lookupDelayMs);
 const seen=await ctx.broker.orderByClientId(request.clientOrderId);
 if(seen===null)return false;
 const after=(await readState(ctx)).intents.find(i=>i.intentId===intentId);
 if(!after)throw new ControllerStop('CLAIM_STATE_LOST',{intentId});
 await observe(ctx,after,seen);
 return true;
}
async function voidReserved(ctx:Ctx,reason:string){
 for(const i of (await readState(ctx)).intents)
  if(i.status==='reserved')await record(ctx,i,'not_submitted',{detail:{reason}});
}
const OK={ok:true,blockers:[] as string[]};

/** One execute slot: reconcile, manage working orders, plan with the frozen planner, submit. */
export async function runExecuteSlot(deps:ControllerDeps,experimentId:string,slot:string):Promise<SlotResult>{
 const started=await begin(deps,experimentId,'execute',slot);
 if('skipped' in started)return started.skipped;
 const ctx=started.ctx;
 return guarded(ctx,'execute',slot,async()=>{
  const lease=await ctx.store.call('acquire_lease',{run_id:ctx.runId});
  if(lease.acquired!==true)return finish(ctx,'execute',slot,'BLOCKED','LEASE_HELD');
  let seen=await reconcileBroker(ctx);
  if(seen.state.gateMode==='STOPPED'){
   // The kill switch acts first: external state that persists must not keep orders working.
   await cancelWorking(ctx,seen.state);
   requireClean(seen);
   return finish(ctx,'execute',slot,'BLOCKED','GATE_STOPPED');
  }
  requireClean(seen);
  if(seen.state.gateMode!=='ARMED')return finish(ctx,'execute',slot,'BLOCKED','GATE_'+seen.state.gateMode);
  if(seen.accountIssues.length)throw new ControllerStop(seen.accountIssues[0]);
  if(seen.state.intents.some(i=>UNRESOLVED.has(i.status)))
   return finish(ctx,'execute',slot,'BLOCKED','UNRESOLVED_SUBMISSION',{},{ok:false,blockers:['UNRESOLVED_SUBMISSION']});
  enforceRisk(seen);
  const nowMs=ctx.now(),today=nyDate(nowMs),decision=seen.state.decision;
  if(!decision||decision.session!==today||!['TARGETS','HOLD_NO_TARGETS'].includes(decision.outcome))
   return finish(ctx,'execute',slot,'SUCCEEDED','NO_EXECUTABLE_DECISION_TODAY',{},OK);
  const clock=await ctx.broker.clock(),session=await ctx.broker.session(today);
  // Skew is checked once, against the moment the broker clock was read.
  if(Math.abs(Date.parse(clock.timestamp)-ctx.now())>60_000)throw new RunBlocked('CLOCK_SKEW');
  if(!session||!clock.isOpen||nowMs<Date.parse(session.openAt)||nowMs>=Date.parse(session.closeAt)-20*60_000)
   return finish(ctx,'execute',slot,'SUCCEEDED','OUTSIDE_EXECUTION_WINDOW',{},OK);
  const rounds:Record<string,unknown>[]=[];
  for(let round=0;round<CONTROLLER_LIMITS.planningRounds;round++){
   // Working orders: wait while any is fresh; cancel stale ones, then re-plan on fresh quotes.
   const working=seen.state.intents.filter(i=>WORKING.has(i.status));
   if(working.length){
    const stale=working.filter(i=>ctx.now()-Date.parse(i.createdAt)>=CONTROLLER_LIMITS.restingOrderMs);
    if(stale.length<working.length||!ctx.broker.writesEnabled)
     return finish(ctx,'execute',slot,'SUCCEEDED','ORDERS_WORKING',{rounds},OK);
    for(const i of stale){await ctx.broker.cancelOrder(i.brokerOrderId as string);ctx.cancels++;}
    if((await settle(ctx)).intents.some(i=>WORKING.has(i.status)))
     return finish(ctx,'execute',slot,'SUCCEEDED','CANCEL_PENDING',{rounds},OK);
    seen=await reconcileBroker(ctx);
    requireClean(seen);
   }
   const {plan:p,snapshotId}=await plan(ctx,seen.state,decision,session);
   rounds.push({phase:p.phase,planId:p.planId,diagnostics:p.diagnostics,unusedCashCents:p.unusedCashCents,
    legs:p.legs.map(l=>({symbol:l.symbol,side:l.side,shares:l.shares,limitCents:l.limitCents}))});
   if(!p.legs.length)return finish(ctx,'execute',slot,'SUCCEEDED','PLAN_HOLD',{rounds},OK);
   // With broker writes released OFF this is a shadow run: the plan is recorded, nothing is reserved.
   if(!ctx.broker.writesEnabled)
    return finish(ctx,'execute',slot,'SUCCEEDED','SHADOW_PLAN_ONLY',{rounds,shadow:true},OK);
   await heartbeat(ctx);
   let reserved:StoreReply;
   try{
    reserved=await ctx.store.call('reserve_intents',{run_id:ctx.runId,decision_id:decision.decisionId,
     plan_id:p.planId,snapshot_id:snapshotId,legs:p.legs.map(l=>({security_id:l.securityId,
      symbol:l.symbol,side:l.side,shares:l.shares,limit_cents:l.limitCents}))});
   }catch(e){
    // A refused reservation (caps, rejected or exhausted legs) blocks this plan as a whole:
    // the frozen planner is all-or-nothing, so no leg is silently dropped.
    if(e instanceof PaperAutoStoreError&&e.refused)throw new RunBlocked('RESERVE_'+e.code.replace(/^PAPER_AUTO_/,''));
    throw e;
   }
   if(!Array.isArray(reserved.reserved))invalid('reserved');
   for(const leg of reserved.reserved as unknown[]){
    await heartbeat(ctx);
    if(!(await submitLeg(ctx,str(obj(leg,'leg'),'intentId')))){
     await voidReserved(ctx,'SUBMISSIONS_PAUSED');
     return finish(ctx,'execute',slot,'BLOCKED','SUBMISSIONS_PAUSED',{rounds},
      {ok:false,blockers:['UNRESOLVED_SUBMISSION']});
    }
   }
   const settled=await settle(ctx);
   // Record this slot's own fills now, so attribution never waits for the monitor run.
   const activity=await syncActivities(ctx,settled);
   if(activity.length)throw new ControllerStop(activity[0]);
   if(settled.intents.some(i=>WORKING.has(i.status)))
    return finish(ctx,'execute',slot,'SUCCEEDED','ORDERS_WORKING',{rounds},OK);
   if(p.phase!=='SELL')return finish(ctx,'execute',slot,'SUCCEEDED','ORDERS_COMPLETE',{rounds},OK);
   // All sells are final: re-plan once more in this slot, exactly as the planner instructs.
   seen=await reconcileBroker(ctx);
   requireClean(seen);
  }
  return finish(ctx,'execute',slot,'SUCCEEDED','PLANNING_ROUNDS_USED',{rounds},OK);
 });
}

/** Reconcile slot: the clean evidence RESUME requires, and the STOP kill switch. */
export async function runReconcileSlot(deps:ControllerDeps,experimentId:string,slot:string):Promise<SlotResult>{
 const started=await begin(deps,experimentId,'reconcile',slot);
 if('skipped' in started)return started.skipped;
 const ctx=started.ctx;
 return guarded(ctx,'reconcile',slot,async()=>{
  const lease=await ctx.store.call('acquire_lease',{run_id:ctx.runId});
  if(lease.acquired!==true)
   return finish(ctx,'reconcile',slot,'SUCCEEDED','LEASE_HELD',{clean:false,accountId:null},
    {ok:false,blockers:['LEASE_HELD']});
  const seen=await reconcileBroker(ctx);
  if(seen.state.gateMode==='STOPPED')await cancelWorking(ctx,seen.state);
  requireClean(seen);
  enforceRisk(seen);
  const state=await readState(ctx);
  const blockers=[...seen.accountIssues,
   ...(state.intents.some(i=>UNRESOLVED.has(i.status))?['UNRESOLVED_SUBMISSION']:[])];
  const clean=blockers.length===0;
  return finish(ctx,'reconcile',slot,'SUCCEEDED',clean?'CLEAN':'NOT_CLEAN',
   {clean,accountId:seen.account.id,blockers,equityCents:seen.account.equityCents},{ok:clean,blockers});
 });
}

/** Monitor slot: final order states, attributed activities and the after-close daily mark. */
export async function runMonitorSlot(deps:ControllerDeps,experimentId:string,session:string):Promise<SlotResult>{
 // A session is marked only on its own evening: an early delivery must not consume the
 // slot, and a later one must never record today's equity under an earlier session.
 const nowMs=deps.now(),skip=(reason:string):SlotResult=>({experimentId,kind:'monitor',slot:session,
  outcome:'SKIPPED',reason,runId:null,posts:0,cancels:0,detail:{}});
 if(nyDate(nowMs)>session)return skip('MARK_WINDOW_PASSED');
 if(nyDate(nowMs)<session||nyMinutes(nowMs)<16*60+15)return skip('BEFORE_CLOSE');
 const started=await begin(deps,experimentId,'monitor',session);
 if('skipped' in started)return started.skipped;
 const ctx=started.ctx;
 return guarded(ctx,'monitor',session,async()=>{
  const seen=await reconcileBroker(ctx);
  let daily:StoreReply|null=null;
  try{if(await ctx.broker.session(session)){
   const benchmark=await ctx.broker.dailyClose('SPY',session);
   // External state contaminates the mark; it is still recorded so the series stays continuous.
   daily=await ctx.store.call('record_daily',{run_id:ctx.runId,session_date:session,
    captured_at:seen.account.readAt,equity_cents:seen.account.equityCents,cash_cents:seen.account.cashCents,
    long_market_value_cents:seen.account.longMarketValueCents,
    positions:seen.positions.map(p=>({symbol:p.symbol,qty:p.qty,marketValueCents:p.marketValueCents,
     costBasisCents:p.costBasisCents})),
    benchmark_symbol:'SPY',...(benchmark?{benchmark_close:benchmark.close}:{}),
    benchmark_source:benchmark?.source??'unavailable:alpaca:sip:1Day',contaminated:seen.external.length>0});
  }}catch(e){
   // An auxiliary benchmark or mark-write failure must not hide a breach
   // already visible in the fresh account. External-state halts take priority.
   if(!seen.external.length)enforceRisk(seen);
   throw e;
  }
  requireClean(seen);
  if(daily&&daily.cashReconciled===false){
   // Fills of an unresolved submission cannot be attributed yet; otherwise cash moved
   // without any broker activity explaining it, which is never strategy return.
   if(seen.state.intents.some(i=>UNRESOLVED.has(i.status)))throw new RunBlocked('MARK_PENDING_ATTRIBUTION');
   throw new ControllerStop('UNEXPLAINED_CASH_CHANGE',{session,cashUnexplainedCents:String(daily.cashUnexplainedCents)});
  }
  // The SQL mark transaction also halts on a clean-mark breach. This observer
  // check gives the run its explicit risk outcome and covers non-SQL adapters.
  enforceRisk(seen);
  return finish(ctx,'monitor',session,'SUCCEEDED',daily?'DAILY_RECORDED':'NOT_A_SESSION',daily?{daily}:{},OK);
 });
}

export type DecisionInput={experimentId:string;session:string;decisionId:string;decisionAt:string;
 outcome:'TARGETS'|'HOLD_NO_TARGETS'|'MISSED'|'INPUT_REJECTED';signal?:Record<string,unknown>;
 inputDigest?:string;scoringReportId?:string;diagnostics?:Record<string,unknown>};
/** Records the frozen strategy's decision for one session, including HOLD and MISSED. */
export async function recordDecisionSlot(deps:ControllerDeps,input:DecisionInput):Promise<SlotResult>{
 const started=await begin(deps,input.experimentId,'decision',input.session);
 if('skipped' in started)return started.skipped;
 const ctx=started.ctx;
 try{
  const r=await ctx.store.call('record_decision',{run_id:ctx.runId,decision_id:input.decisionId,
   outcome:input.outcome,decision_at:input.decisionAt,...(input.signal?{signal:input.signal}:{}),
   ...(input.inputDigest?{input_digest:input.inputDigest}:{}),
   ...(input.scoringReportId?{scoring_report_id:input.scoringReportId}:{}),diagnostics:input.diagnostics??{}});
  return await finish(ctx,'decision',input.session,'SUCCEEDED',r.duplicate===true?'DUPLICATE':'RECORDED',
   {outcome:input.outcome});
 }catch(e){
  try{return await finish(ctx,'decision',input.session,'FAILED',storeCode(e));}
  catch{return {experimentId:input.experimentId,kind:'decision',slot:input.session,outcome:'FAILED',
   reason:storeCode(e),runId:ctx.runId,posts:0,cancels:0,detail:{}};}
 }
}

export type Registration={experimentId:string;ownerRef:string;modelVersion:string;
 decisionWindowStart:string;decisionWindowEnd:string;capitalLimitCents:number;maxOrderNotionalCents:number;
 maxDailyNotionalCents:number;maxOrdersPerDay:number;maxOpenOrders:number;maxAttemptsPerLeg:number;
 drawdownStopBps:number;feeReserveCents:number};
/** Owner-only: registers a dedicated, flat, active PAPER account. The experiment starts STOPPED. */
export async function registerExperiment(deps:Pick<ControllerDeps,'store'|'broker'>,r:Registration){
 const account=await deps.broker.account();
 const positions=await deps.broker.positions(),orders=await deps.broker.openOrders();
 const blockers=accountBlockers(account,account.id,account.accountNumber);
 if(positions.length)blockers.push('ACCOUNT_NOT_FLAT');
 if(orders.length)blockers.push('ACCOUNT_HAS_OPEN_ORDERS');
 if(account.equityCents>r.capitalLimitCents)blockers.push('EQUITY_ABOVE_CAPITAL_LIMIT');
 if(blockers.length)return {registered:false as const,blockers};
 const status=await deps.store.call('register',{experiment_id:r.experimentId,owner_ref:r.ownerRef,
  account_observed_at:account.readAt,model_version:r.modelVersion,broker_account_id:account.id,
  broker_account_number:account.accountNumber,decision_window_start:r.decisionWindowStart,
  decision_window_end:r.decisionWindowEnd,starting_equity_cents:account.equityCents,
  capital_limit_cents:r.capitalLimitCents,max_order_notional_cents:r.maxOrderNotionalCents,
  max_daily_notional_cents:r.maxDailyNotionalCents,max_orders_per_day:r.maxOrdersPerDay,
  max_open_orders:r.maxOpenOrders,max_attempts_per_leg:r.maxAttemptsPerLeg,
  drawdown_stop_bps:r.drawdownStopBps,fee_reserve_cents:r.feeReserveCents});
 return {registered:true as const,status};
}

const REGISTRATION_KEYS=['experimentId','modelVersion','decisionWindowStart','decisionWindowEnd','capitalLimitCents',
 'maxOrderNotionalCents','maxDailyNotionalCents','maxOrdersPerDay','maxOpenOrders','maxAttemptsPerLeg',
 'drawdownStopBps','feeReserveCents'] as const;
/** A reviewed registration file (config/paper-auto/<id>.json): exact keys, the database's ranges; else null. */
export function parseRegistrationConfig(raw:unknown,experimentId:string):Omit<Registration,'ownerRef'>|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const x=raw as Record<string,unknown>;
 if(Object.keys(x).length!==REGISTRATION_KEYS.length||!REGISTRATION_KEYS.every(k=>Object.hasOwn(x,k)))return null;
 const n=(k:string,lo:number,hi:number)=>Number.isSafeInteger(x[k])&&(x[k] as number)>=lo&&(x[k] as number)<=hi;
 const day=(k:string)=>typeof x[k]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x[k] as string)&&
  new Date((x[k] as string)+'T12:00:00Z').toISOString().slice(0,10)===x[k];
 if(x.experimentId!==experimentId||!/^[a-z0-9][a-z0-9-]{2,62}$/.test(experimentId)||
  (x.modelVersion!=='stock-mom252-skip21-trend200-v1'&&x.modelVersion!=='stock-mom252-skip21-trend200-holdrank10-v1')||
  !day('decisionWindowStart')||!day('decisionWindowEnd')||
  (x.decisionWindowEnd as string)<(x.decisionWindowStart as string)||
  !n('capitalLimitCents',1,100_000_000_000)||!n('maxOrderNotionalCents',1,100_000_000_000)||
  !n('maxDailyNotionalCents',x.maxOrderNotionalCents as number,100_000_000_000)||!n('maxOrdersPerDay',1,200)||
  !n('maxOpenOrders',1,20)||!n('maxAttemptsPerLeg',1,5)||!n('drawdownStopBps',100,9000)||
  (x.feeReserveCents!==0&&x.feeReserveCents!==100))return null;
 return Object.fromEntries(REGISTRATION_KEYS.map(k=>[k,x[k]])) as Omit<Registration,'ownerRef'>;
}

export type AbsenceResult={confirmed:boolean;reason:'CONFIRMED_ABSENT'|'NOT_UNCERTAIN'|'SESSION_NOT_CLOSED'|
 'ORDER_FOUND_RECONCILE_INSTEAD'};
/**
 * Owner-only recovery for an uncertain submission. After 16:15 New York on its session,
 * the client-id lookup must miss AND a complete order history since before the
 * reservation must not contain the client order id. A missed lookup alone proves
 * nothing, and a found order is left to the next reconcile run to record.
 */
export async function confirmIntentAbsent(deps:ControllerDeps,experimentId:string,intentId:string,
 ownerRef:string):Promise<AbsenceResult>{
 if(!/^owner-[a-f0-9]{32}$/.test(ownerRef))throw Error('INVALID_OWNER_REF');
 const state=await readState({...deps,experimentId,runId:'',posts:0,cancels:0});
 const intent=state.intents.find(i=>i.intentId===intentId);
 if(!intent||intent.status!=='uncertain')return {confirmed:false,reason:'NOT_UNCERTAIN'};
 const session=nyDate(Date.parse(intent.updatedAt)),now=deps.now();
 if(!(nyDate(now)>session||(nyDate(now)===session&&nyMinutes(now)>=16*60+15)))
  return {confirmed:false,reason:'SESSION_NOT_CLOSED'};
 if(await deps.broker.orderByClientId(intent.clientOrderId))return {confirmed:false,reason:'ORDER_FOUND_RECONCILE_INSTEAD'};
 const lookupAt=iso(deps.now());
 const history=await deps.broker.ordersSubmittedSince(iso(Date.parse(intent.createdAt)-5*60_000));
 if(history.some(o=>o.clientOrderId===intent.clientOrderId))return {confirmed:false,reason:'ORDER_FOUND_RECONCILE_INSTEAD'};
 await deps.store.call('confirm_absent',{intent_id:intentId,owner_ref:ownerRef,client_id_lookup_not_found_at:lookupAt,
  complete_history_checked_at:iso(deps.now()),history_complete:true});
 return {confirmed:true,reason:'CONFIRMED_ABSENT'};
}
