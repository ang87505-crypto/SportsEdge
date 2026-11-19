/**
 * Forward evaluation of the stock PAPER strategy (stock-v2-weekly-1) from its own ledger. Pure; read-only.
 * Reuses forwardPerformance (equity, drawdown, SPY, mark verdicts) and adds what it does not compute:
 *  - completed round-trip trades from REAL fills only (FIFO per symbol), wins/losses, average winner/loser,
 *    net of an estimated trading cost;
 *  - each session classified CLEAN / CONTAMINATED / UNRESOLVED / MISSING_MARK;
 *  - a no-lookahead integrity check (every order must come after its session's recorded decision; nothing after
 *    `asOf` is used);
 *  - an explicit sample gate: below the minimums the verdict is INSUFFICIENT_DATA, never a win rate;
 *  - a per-session funnel that keeps the four stages apart: decision TARGETS -> orders actually sent (a shadow
 *    plan is not an order) -> broker-confirmed fills -> realized round trips. Nov 16 2026 is the reference case:
 *    TARGETS, five shadow legs on main, zero orders, zero fills (stage SHADOW_ONLY).
 * Unfilled, rejected, cancelled-without-fill and skipped orders are counted but never produce profit.
 * The weekly model records targets and reasons, not per-stock expected returns, so prediction accuracy is
 * reported as NOT_PROVIDED_BY_MODEL rather than invented.
 */
import type {PaperAutoLedger} from './paper-auto-ledger.ts';
import {forwardPerformance,type ForwardPerformance} from './paper-auto-performance.ts';

/** Research cost assumption (analytics/stock_weekly_backtest_v1.py): 10 bps per side. */
export const COST_BPS_PER_SIDE=10;
/** Below these, results are reported as INSUFFICIENT_DATA. */
export const MINIMUMS={completedTrades:20,cleanSessions:8};

export type SessionState='CLEAN'|'CONTAMINATED'|'UNRESOLVED'|'MISSING_MARK';
export type CompletedTrade={symbol:string;shares:number;entryPrice:number;exitPrice:number;openedAt:string;closedAt:string;
 entrySession:string;grossReturn:number;netReturn:number;netPnlCents:number};
/** Where a decided session stopped. Only FILLED_OPEN and REALIZED involve real fills; only REALIZED has a result. */
export type FunnelStage='NO_TARGETS'|'NOT_EXECUTED'|'SHADOW_ONLY'|'ORDERS_UNFILLED'|'FILLED_OPEN'|'REALIZED';
export type SessionFunnel={session:string;outcome:string;targets:number;shadowPlans:number;executeRuns:number;
 ordersSent:number;ordersFilled:number;filledShares:number;realizedTrades:number;realizedNetPnlCents:number;stage:FunnelStage};
export type StockEvaluation={
 asOf:string;verdict:'INSUFFICIENT_DATA'|'MEASURED'|'INTEGRITY_FAILED';reasons:string[];
 orders:{proposed:number;submitted:number;filled:number;partiallyFilled:number;unfilled:number;rejected:number;
  canceledOrExpired:number;notSubmitted:number;uncertain:number};
 trades:{completed:number;winners:number;losers:number;breakeven:number;winRate:number|null;
  averageWinnerReturn:number|null;averageLoserReturn:number|null;netPnlCents:number;openLots:number;list:CompletedTrade[]};
 sessions:{decided:number;targets:number;withFills:number;states:Record<string,SessionState>;clean:number;funnel:SessionFunnel[]};
 predictions:{state:'NOT_PROVIDED_BY_MODEL';note:string};
 forward:ForwardPerformance;
 minimums:typeof MINIMUMS;costBpsPerSide:number;
};

const SUBMITTED=new Set(['open','partially_filled','filled','canceled','expired','rejected','uncertain','confirmed_absent']);
const at=(s:string|null|undefined)=>s?Date.parse(s):NaN;

export function evaluateStockForward(l:PaperAutoLedger,asOf:string):StockEvaluation{
 const now=at(asOf),reasons:string[]=[];
 const intents=l.intents.filter(i=>at(i.createdAt)<=now);
 // No lookahead: every order on a session must come after that session's recorded decision.
 const decisionBySession=new Map(l.decisions.filter(d=>at(d.recordedAt)<=now).map(d=>[d.session,d]));
 for(const i of intents){
  const session=i.createdAt.slice(0,10),d=decisionBySession.get(session);
  if(d&&!(at(d.recordedAt)<at(i.createdAt)))reasons.push(`LOOKAHEAD: order ${i.intentId} precedes its decision`);
 }
 const filledQty=(i:typeof intents[number])=>Number(i.filledQty);
 const orders={proposed:intents.length,submitted:intents.filter(i=>SUBMITTED.has(i.status)).length,
  filled:intents.filter(i=>i.status==='filled').length,partiallyFilled:intents.filter(i=>filledQty(i)>0&&i.status!=='filled').length,
  unfilled:intents.filter(i=>filledQty(i)===0).length,rejected:intents.filter(i=>i.status==='rejected').length,
  canceledOrExpired:intents.filter(i=>(i.status==='canceled'||i.status==='expired')&&filledQty(i)===0).length,
  notSubmitted:intents.filter(i=>i.status==='not_submitted'||i.status==='reserved').length,
  uncertain:intents.filter(i=>i.status==='uncertain'||i.status==='submitting').length};
 // Completed round trips from real fills only (FIFO per symbol), using fills known by asOf.
 const fills=intents.filter(i=>filledQty(i)>0&&i.filledAvgPrice!==null&&Number(i.filledAvgPrice)>0&&at(i.updatedAt)<=now)
  .sort((a,b)=>at(a.updatedAt)-at(b.updatedAt)||a.intentId.localeCompare(b.intentId));
 const lots=new Map<string,{qty:number;price:number;at:string;session:string}[]>(),list:CompletedTrade[]=[];
 const cost=COST_BPS_PER_SIDE/1e4;
 for(const f of fills){
  const q=filledQty(f),p=Number(f.filledAvgPrice),book=lots.get(f.symbol)??[];
  if(f.side==='buy'){book.push({qty:q,price:p,at:f.updatedAt,session:f.createdAt.slice(0,10)});lots.set(f.symbol,book);continue;}
  let left=q;
  while(left>1e-9&&book.length){
   const lot=book[0],take=Math.min(lot.qty,left);
   const gross=p/lot.price-1,net=(p*(1-cost))/(lot.price*(1+cost))-1;
   list.push({symbol:f.symbol,shares:take,entryPrice:lot.price,exitPrice:p,openedAt:lot.at,closedAt:f.updatedAt,
    entrySession:lot.session,grossReturn:gross,netReturn:net,netPnlCents:Math.round(take*(p*(1-cost)-lot.price*(1+cost))*100)});
   lot.qty-=take;left-=take;if(lot.qty<=1e-9)book.shift();
  }
  if(left>1e-9)reasons.push(`UNMATCHED_SELL: ${f.symbol} sold ${left} more shares than bought in this experiment`);
 }
 const winners=list.filter(t=>t.netReturn>0),losers=list.filter(t=>t.netReturn<0);
 const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
 // Sessions: a decided TARGETS session needs a same-session close mark to count.
 const marks=new Map(l.daily.filter(m=>at(m.capturedAt)<=now).map(m=>[m.session,m]));
 const states:Record<string,SessionState>={};
 for(const d of l.decisions.filter(d=>at(d.recordedAt)<=now&&d.outcome==='TARGETS')){
  const m=marks.get(d.session);
  states[d.session]=!m?'MISSING_MARK':m.contaminated?'CONTAMINATED':!m.cashReconciled||Number(m.cashUnexplainedCents)!==0?'UNRESOLVED':'CLEAN';
 }
 const sessionsWithFills=new Set(fills.map(f=>f.updatedAt.slice(0,10)));
 // Funnel: what each decided session actually became. Execute runs are matched by date; an intent belongs to the
 // session it was created in. A shadow plan (SHADOW_PLAN_ONLY) never reserves an intent, so it can never count as an order.
 const execs=l.runs.filter(r=>r.kind==='execute'&&at(r.startedAt)<=now);
 const funnel:SessionFunnel[]=l.decisions.filter(d=>at(d.recordedAt)<=now).sort((a,b)=>a.session.localeCompare(b.session)).map(d=>{
  const day=intents.filter(i=>i.createdAt.slice(0,10)===d.session),sent=day.filter(i=>SUBMITTED.has(i.status));
  const filled=day.filter(i=>filledQty(i)>0),realized=list.filter(t=>t.entrySession===d.session);
  const runs=execs.filter(r=>r.startedAt.slice(0,10)===d.session),shadow=runs.filter(r=>r.summary==='SHADOW_PLAN_ONLY').length;
  const stage:FunnelStage=d.outcome!=='TARGETS'?'NO_TARGETS':realized.length?'REALIZED':filled.length?'FILLED_OPEN':
   sent.length?'ORDERS_UNFILLED':shadow?'SHADOW_ONLY':'NOT_EXECUTED';
  return {session:d.session,outcome:d.outcome,targets:d.targets.length,shadowPlans:shadow,executeRuns:runs.length,
   ordersSent:sent.length,ordersFilled:filled.length,filledShares:filled.reduce((a,i)=>a+filledQty(i),0),
   realizedTrades:realized.length,realizedNetPnlCents:realized.reduce((a,t)=>a+t.netPnlCents,0),stage};
 });
 const clean=Object.values(states).filter(s=>s==='CLEAN').length;
 const forward=forwardPerformance(l.experiment.startingEquityCents,l.experiment.registeredAt,
  l.daily.filter(m=>at(m.capturedAt)<=now));
 if(list.length<MINIMUMS.completedTrades)reasons.push(`completed trades ${list.length}/${MINIMUMS.completedTrades}`);
 if(clean<MINIMUMS.cleanSessions)reasons.push(`clean sessions ${clean}/${MINIMUMS.cleanSessions}`);
 const integrity=reasons.some(r=>r.startsWith('LOOKAHEAD')||r.startsWith('UNMATCHED_SELL'));
 return {asOf,verdict:integrity?'INTEGRITY_FAILED':list.length>=MINIMUMS.completedTrades&&clean>=MINIMUMS.cleanSessions?'MEASURED':'INSUFFICIENT_DATA',reasons,
  orders,
  trades:{completed:list.length,winners:winners.length,losers:losers.length,breakeven:list.length-winners.length-losers.length,
   winRate:list.length>=MINIMUMS.completedTrades?winners.length/list.length:null,
   averageWinnerReturn:avg(winners.map(t=>t.netReturn)),averageLoserReturn:avg(losers.map(t=>t.netReturn)),
   netPnlCents:list.reduce((a,t)=>a+t.netPnlCents,0),openLots:[...lots.values()].reduce((a,b)=>a+b.length,0),list:list.slice(-50)},
  sessions:{decided:l.decisions.filter(d=>at(d.recordedAt)<=now).length,targets:Object.keys(states).length,
   withFills:sessionsWithFills.size,states,clean,funnel},
  predictions:{state:'NOT_PROVIDED_BY_MODEL',note:'stock-v2-weekly-1 records target symbols and reasons, not per-stock expected returns; prediction accuracy cannot be measured without inventing predictions.'},
  forward,minimums:MINIMUMS,costBpsPerSide:COST_BPS_PER_SIDE};
}
