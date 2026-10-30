/** Portfolio rebalance planning for the registered stock strategy.
 * Pure function: no broker transport, credentials, scheduler or release switch.
 * Inputs require an authenticated model/source adapter; a digest is NOT proof.
 * Execution uses limit prices, so it is a forward experiment, not the frozen
 * historical open-price fill proxy. Never turn this result into a broker order
 * without durable claims, current release checks and broker reconciliation.
 */
import {createHash} from 'node:crypto';

export type ForwardTarget={securityId:string;symbol:string;sector:string};
export type ForwardPosition={securityId:string;symbol:string;shares:number};
export type ForwardQuote={securityId:string;symbol:string;bidCents:number;
 askCents:number;observedAt:string;priorAdv20Shares:number};
export type ForwardRebalanceInput={
 experimentId:string;modelVersion:string;decisionId:string;decisionAt:string;
 now:string;sessionOpenAt:string;sessionCloseAt:string;
 accountType:'paper';accountId:string;accountSnapshotAt:string;
 equityCents:number;settledCashCents:number;positionsComplete:boolean;
 ordersComplete:boolean;openOrderCount:number;unresolvedReceiptCount:number;
 targets:ForwardTarget[];positions:ForwardPosition[];quotes:ForwardQuote[];
 feeReserveCentsPerOrder:number;
};
export type RebalanceLeg={securityId:string;symbol:string;side:'buy'|'sell';
 shares:number;limitCents:number;feeReserveCents:number};
export type ForwardRebalancePlan={version:string;phase:'SELL'|'BUY'|'HOLD';
 planId:string;legs:RebalanceLeg[];unusedCashCents:number;
 diagnostics:string[];executionPermitted:false;performance:null};
export type ComputedForwardSignal={
 version:'stock-forward-signal-v1';experimentId:string;modelVersion:string;
 decisionId:string;decisionAt:string;targets:ForwardTarget[];heldSecurityIds:string[];
 priorInputs:Record<string,{symbol:string;prior_adv20_shares:number|null}>;
 executionPermitted:false;sourceIndependentlyVerified:false;
};
const VERSION='stock-forward-rebalance-v1';
const MODELS=['stock-mom252-skip21-trend200-v1',
 'stock-mom252-skip21-trend200-holdrank10-v1'];
function requireThat(ok:unknown,code:string):asserts ok {if(!ok)throw Error(code);}
function money(n:number){return Number.isSafeInteger(n)&&n>=0&&n<=1_000_000_000;}
function text(s:string){return typeof s==='string'&&s.length>0&&s.length<=160&&s.trim()===s;}
function time(s:string){
 requireThat(typeof s==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(s),'TIMEZONE_REQUIRED');
 const n=Date.parse(s);requireThat(Number.isFinite(n),'INVALID_TIME');return n;
}
function day(n:number){return new Intl.DateTimeFormat('en-CA',{
 timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(n);}
function hash(v:unknown){return createHash('sha256').update(JSON.stringify(v)).digest('hex');}

/** Consume the Python artifact, not a browser-supplied ReviewedSignal.
 * This binds identities/liquidity but does not authenticate the artifact.
 */
export function planComputedForwardSignal(signal:ComputedForwardSignal,account:Omit<
 ForwardRebalanceInput,'experimentId'|'modelVersion'|'decisionId'|'decisionAt'|'targets'>){
 requireThat(signal.version==='stock-forward-signal-v1'&&signal.executionPermitted===false&&
  signal.sourceIndependentlyVerified===false,'INVALID_SIGNAL_ARTIFACT');
 // Keep the monthly selection frozen while fills change actual holdings.
 // A durable controller must reconcile those changes to its own receipts.
 for(const p of account.positions){
  requireThat(signal.priorInputs[p.securityId]?.symbol===p.symbol,'UNRECONCILED_POSITION_IDENTITY');
 }
 for(const q of account.quotes){
  const prior=signal.priorInputs[q.securityId];
  requireThat(prior&&prior.symbol===q.symbol&&prior.prior_adv20_shares===q.priorAdv20Shares,
   'MODEL_EXECUTION_LIQUIDITY_MISMATCH');
 }
 return planStrategyRebalance({...account,experimentId:signal.experimentId,
  modelVersion:signal.modelVersion,decisionId:signal.decisionId,
  decisionAt:signal.decisionAt,targets:signal.targets});
}

export function planStrategyRebalance(x:ForwardRebalanceInput):ForwardRebalancePlan {
 requireThat(x&&x.accountType==='paper','PAPER_ACCOUNT_REQUIRED');
 requireThat([x.experimentId,x.accountId,x.decisionId].every(text),'IDENTITY_REQUIRED');
 requireThat(MODELS.includes(x.modelVersion),'UNREGISTERED_MODEL');
 const now=time(x.now),decision=time(x.decisionAt),open=time(x.sessionOpenAt),close=time(x.sessionCloseAt);
 const snapshot=time(x.accountSnapshotAt);
 requireThat(decision<open&&open<close&&close-open<=9*3600_000&&
  day(decision)===day(open)&&day(open)===day(close)&&day(now)===day(open), 'SESSION_MISMATCH');
 requireThat(new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(decision)==='08:00:00'
  &&decision%1000===0,'REGISTERED_DECISION_TIME_REQUIRED');
 requireThat(now>=open&&now<close-20*60_000,'OUTSIDE_EXECUTION_WINDOW');
 requireThat(snapshot<=now&&now-snapshot<=60_000,'STALE_ACCOUNT');
 requireThat(x.positionsComplete===true&&x.ordersComplete===true,'INCOMPLETE_ACCOUNT');
 requireThat(x.openOrderCount===0&&x.unresolvedReceiptCount===0,'RECONCILIATION_REQUIRED');
 requireThat(money(x.equityCents)&&x.equityCents>0&&money(x.settledCashCents)&&
  x.settledCashCents<=x.equityCents&&money(x.feeReserveCentsPerOrder)&&
  [0,100].includes(x.feeReserveCentsPerOrder),'INVALID_ACCOUNT_OR_FEE');
 requireThat(Array.isArray(x.targets)&&x.targets.length<=5&&Array.isArray(x.positions)&&
  Array.isArray(x.quotes),'INVALID_BASKET');
 const targets=new Map<string,ForwardTarget>(),positions=new Map<string,ForwardPosition>();
 const symbols=new Map<string,string>(),sectors=new Map<string,number>();
 function identity(v:{securityId:string;symbol:string}){
  requireThat(text(v.securityId)&&/^[A-Z][A-Z0-9.-]{0,9}$/.test(v.symbol),'INVALID_SECURITY');
  requireThat(!symbols.has(v.symbol)||symbols.get(v.symbol)===v.securityId,'TICKER_REUSE');
  symbols.set(v.symbol,v.securityId);
 }
 for(const t of x.targets){
  identity(t);requireThat(text(t.sector)&&!targets.has(t.securityId),'DUPLICATE_TARGET');
  sectors.set(t.sector,(sectors.get(t.sector)??0)+1);
  requireThat(sectors.get(t.sector)!<=2,'SECTOR_CAP');targets.set(t.securityId,t);
 }
 for(const p of x.positions){
  identity(p);requireThat(Number.isSafeInteger(p.shares)&&p.shares>0&&p.shares<=1e9&&
   !positions.has(p.securityId),'INVALID_POSITION');
  requireThat(!targets.has(p.securityId)||targets.get(p.securityId)!.symbol===p.symbol,'UNRECONCILED_RENAME');
  positions.set(p.securityId,p);
 }
 const ids=[...new Set([...targets.keys(),...positions.keys()])].sort();
 const quotes=new Map<string,ForwardQuote>();
 for(const q of x.quotes){
  identity(q);requireThat(ids.includes(q.securityId)&&!quotes.has(q.securityId),'UNEXPECTED_QUOTE');
  const at=time(q.observedAt);
  requireThat(at<=now&&now-at<=60_000,'STALE_QUOTE');
  requireThat(money(q.bidCents)&&q.bidCents>0&&money(q.askCents)&&q.askCents>=q.bidCents&&
   Number.isSafeInteger(q.priorAdv20Shares)&&q.priorAdv20Shares>0,'INVALID_QUOTE');
  requireThat((targets.get(q.securityId)??positions.get(q.securityId))!.symbol===q.symbol,'QUOTE_IDENTITY_MISMATCH');
  quotes.set(q.securityId,q);
 }
 requireThat(ids.length===quotes.size,'MISSING_QUOTE');
 const budget=Math.floor(x.equityCents/10),fee=x.feeReserveCentsPerOrder;
 const sells:RebalanceLeg[]=[],buys:RebalanceLeg[]=[],diagnostics:string[]=[];
 let gross=0;
 for(const id of ids){
  const q=quotes.get(id)!,held=positions.get(id)?.shares??0;
  const value=held*q.askCents;requireThat(Number.isSafeInteger(value),'VALUE_OVERFLOW');gross+=value;
  // Ask-side valuation reserves the full buy limit, and is conservative for
  // existing exposure. Proceeds are NEVER credited by the planner.
  const desired=targets.has(id)?Math.floor(budget/q.askCents):0;
  if(held>desired)sells.push({securityId:id,symbol:q.symbol,side:'sell',
   shares:held-desired,limitCents:q.bidCents,feeReserveCents:fee});
  else if(desired>held){
   const quantity=Math.max(0,Math.floor((budget-held*q.askCents-fee)/q.askCents));
   if(quantity)buys.push({securityId:id,symbol:q.symbol,side:'buy',shares:quantity,
    limitCents:q.askCents,feeReserveCents:fee});
   else diagnostics.push('WHOLE_SHARE_OR_FEE_BUDGET:'+id);
  }else if(!held&&targets.has(id))diagnostics.push('WHOLE_SHARE_BUDGET:'+id);
 }
 requireThat(Number.isSafeInteger(gross),'VALUE_OVERFLOW');
 let cash=x.settledCashCents,legs:RebalanceLeg[]=[];
 if(sells.length){
  requireThat(sells.length*fee<=cash,'SELL_FEE_CASH_REQUIRED');legs=sells;
  diagnostics.push('RECONCILE_ALL_SELLS_AND_SETTLEMENT_THEN_REPLAN');
 }else{
  requireThat(gross<=Math.floor(x.equityCents/2),'GROSS_CAP');
  // All-or-nothing planning; do not silently omit expensive targets when cash
  // is unsettled. A future executor still needs per-leg atomic claims.
  const required=buys.reduce((n,l)=>n+l.shares*l.limitCents+fee,0);
  requireThat(Number.isSafeInteger(required)&&required<=cash,'SETTLED_CASH_REQUIRED');
  const newGross=gross+buys.reduce((n,l)=>n+l.shares*l.limitCents,0);
  requireThat(newGross<=Math.floor(x.equityCents/2),'GROSS_CAP');
  cash-=required;legs=buys;
 }
 for(const l of legs){
  requireThat(l.shares<=Math.floor(quotes.get(l.securityId)!.priorAdv20Shares/100),'LIQUIDITY_CAP');
 }
 if(sells.length)cash-=sells.length*fee;
 const phase=sells.length?'SELL':buys.length?'BUY':'HOLD';
 // Snapshot and prices are included: planId is NOT the durable rebalance key.
 // Reserve experiment/account/decision/security/side separately in the outbox.
 const planId=hash({version:VERSION,experiment:x.experimentId,account:x.accountId,
  decision:x.decisionId,model:x.modelVersion,snapshot:x.accountSnapshotAt,
  equity:x.equityCents,cash:x.settledCashCents,phase,legs});
 return {version:VERSION,phase,planId,legs,unusedCashCents:cash,
  diagnostics,executionPermitted:false,performance:null};
}
