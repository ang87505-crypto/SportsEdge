/**
 * Stock PAPER research tracking (stock-v2-weekly-1). Pure and read-only, on top of evaluateStockForward/forwardPerformance.
 * Adds what those do not compute, so the forward record can be judged the way the research was:
 *  - SPY at the strategy's own realized exposure (the comparison every weekly variant has failed historically),
 *    chained over consecutive VERIFIED marks only;
 *  - forward turnover from broker-confirmed fills;
 *  - transaction costs: the research assumption (10 bps per side) on filled notional, plus observed fill price versus the
 *    order's limit (the ask when planned). A positive value means a worse price than the limit;
 *  - rejected candidates per decision (universe members the bridge skipped, by reason);
 *  - decision-to-fill reconciliation per TARGETS session and symbol.
 * Nothing here places, cancels or changes an order, a gate or a decision. Missing evidence is reported, never filled in.
 */
import type {PaperAutoLedger} from './paper-auto-ledger.ts';
import {forwardPerformance} from './paper-auto-performance.ts';
import {COST_BPS_PER_SIDE} from './paper-auto-evaluation.ts';

export type TargetStatus='FILLED'|'PARTIAL'|'UNFILLED'|'NOT_ORDERED_HELD'|'NOT_ORDERED'|'ORDER_STATE_UNKNOWN';
export type Reconciliation={session:string;targets:number;filled:number;partial:number;unfilled:number;notOrdered:number;held:number;
 unexpectedBuys:string[];exits:number;rows:{symbol:string;status:TargetStatus;orderedShares:number;filledShares:number}[]};

const at=(s:string|null|undefined)=>s?Date.parse(s):NaN;
const r6=(x:number|null)=>x===null||!Number.isFinite(x)?null:Math.round(x*1e6)/1e6;

export function stockResearchTracking(l:PaperAutoLedger,asOf:string){
 const now=at(asOf);if(!Number.isFinite(now))throw Error('STOCK_TRACKING_INVALID_CLOCK');
 const daily=l.daily.filter(m=>at(m.capturedAt)<=now);
 const perf=forwardPerformance(l.experiment.startingEquityCents,l.experiment.registeredAt,daily);
 const issues:string[]=[];

 // 1. Benchmarks over consecutive VERIFIED marks with SPY closes. Exposure is taken at the START of each link.
 const v=perf.marks.filter(m=>m.verdict==='VERIFIED'&&m.benchmarkSymbol==='SPY'&&m.benchmarkClose!==null&&m.equityCents>0);
 let strat=1,spy=1,matched=1,peakM=1,ddM=0,links=0,exposureSum=0;
 for(let i=1;i<v.length;i++){
  const a=v[i-1],b=v[i],exposure=Math.min(1,Math.max(0,a.longMarketValueCents/a.equityCents));
  const rs=b.equityCents/a.equityCents-1,rb=Number(b.benchmarkClose)/Number(a.benchmarkClose)-1;
  strat*=1+rs;spy*=1+rb;matched*=1+exposure*rb;links++;exposureSum+=exposure;
  peakM=Math.max(peakM,matched);ddM=Math.max(ddM,(peakM-matched)/peakM);
 }
 const measured=links>0;
 const benchmark={state:measured?'MEASURED':'NEEDS_TWO_VERIFIED_CLOSES' as 'MEASURED'|'NEEDS_TWO_VERIFIED_CLOSES',links,
  fromSession:measured?v[0].session:null,toSession:measured?v.at(-1)!.session:null,
  averageExposure:measured?r6(exposureSum/links):null,strategyReturn:measured?r6(strat-1):null,spyReturn:measured?r6(spy-1):null,
  matchedExposureSpyReturn:measured?r6(matched-1):null,excessVsSpy:measured?r6(strat-spy):null,excessVsMatchedSpy:measured?r6(strat-matched):null,
  matchedExposureSpyMaxDrawdown:measured?r6(ddM):null};

 // 2/3. Turnover and costs from broker-confirmed fills known by asOf.
 const fills=l.intents.filter(i=>at(i.createdAt)<=now&&at(i.updatedAt)<=now&&Number(i.filledQty)>0&&i.filledAvgPrice!==null&&Number(i.filledAvgPrice)>0);
 const notional=fills.reduce((a,i)=>a+Number(i.filledQty)*Number(i.filledAvgPrice),0);
 const verifiedEquity=perf.marks.filter(m=>m.verdict==='VERIFIED').map(m=>m.equityCents/100);
 const avgEquity=verifiedEquity.length?verifiedEquity.reduce((a,b)=>a+b,0)/verifiedEquity.length:null;
 const days=verifiedEquity.length?(at(perf.marks.filter(m=>m.verdict==='VERIFIED').at(-1)!.capturedAt)-at(l.experiment.registeredAt))/86400_000:0;
 let slipNotional=0,slipBps=0;
 for(const i of fills){
  const limit=i.limitCents/100,price=Number(i.filledAvgPrice),q=Number(i.filledQty);
  // Positive = worse than the limit: paid more on a buy, received less on a sell.
  const bps=(i.side==='buy'?price-limit:limit-price)/limit*1e4;
  if(bps>0.5)issues.push(`FILL_WORSE_THAN_LIMIT: ${i.intentId} ${i.symbol} ${bps.toFixed(1)} bps`);
  slipBps+=bps*q*price;slipNotional+=q*price;
 }
 const turnover={filledOrders:fills.length,filledNotional:r6(notional),averageVerifiedEquity:avgEquity===null?null:r6(avgEquity),
  turnover:avgEquity?r6(notional/avgEquity):null,
  annualizedTurnover:avgEquity&&days>=28?r6(notional/avgEquity*365/days):null,
  note:days<28?'Fewer than 28 days of verified marks: turnover is not annualized.':null};
 const costs={assumedBpsPerSide:COST_BPS_PER_SIDE,assumedCostDollars:r6(notional*COST_BPS_PER_SIDE/1e4),
  fillVersusLimitBps:slipNotional?r6(slipBps/slipNotional):null,
  note:'Fill versus limit measures price improvement against the planned ask or bid; the spread paid and market impact are not observable here.'};

 // 4. Rejected candidates per decision.
 const decisions=l.decisions.filter(d=>at(d.recordedAt)<=now).sort((a,b)=>a.session.localeCompare(b.session));
 const rejected=decisions.map(d=>({session:d.session,outcome:d.outcome,targets:d.targets.length,rejected:d.rejected?.total??0,byReason:d.rejected?.byReason??{}}));

 // 5. Decision-to-fill reconciliation per TARGETS session.
 const known=l.intents.filter(i=>at(i.createdAt)<=now);
 const reconciliation:Reconciliation[]=decisions.filter(d=>d.outcome==='TARGETS').map(d=>{
  const day=known.filter(i=>i.createdAt.slice(0,10)===d.session);
  const heldBefore=(symbol:string)=>known.filter(i=>i.symbol===symbol&&i.createdAt.slice(0,10)<d.session)
   .reduce((a,i)=>a+(i.side==='buy'?1:-1)*Number(i.filledQty),0);
  const rows=d.targets.map(symbol=>{
   const buys=day.filter(i=>i.symbol===symbol&&i.side==='buy');
   const ordered=buys.reduce((a,i)=>a+i.shares,0),filled=buys.reduce((a,i)=>a+Number(i.filledQty),0);
   const unknown=buys.some(i=>at(i.updatedAt)>now||i.status==='uncertain'||i.status==='submitting');
   const status:TargetStatus=unknown?'ORDER_STATE_UNKNOWN':!buys.length?(heldBefore(symbol)>0?'NOT_ORDERED_HELD':'NOT_ORDERED'):
    filled<=0?'UNFILLED':filled<ordered?'PARTIAL':'FILLED';
   return {symbol,status,orderedShares:ordered,filledShares:filled};
  });
  const unexpected=[...new Set(day.filter(i=>i.side==='buy'&&!d.targets.includes(i.symbol)).map(i=>i.symbol))];
  for(const s of unexpected)issues.push(`UNEXPECTED_BUY: ${s} on ${d.session} is not a decision target`);
  const count=(s:TargetStatus)=>rows.filter(r=>r.status===s).length;
  return {session:d.session,targets:rows.length,filled:count('FILLED'),partial:count('PARTIAL'),unfilled:count('UNFILLED'),
   notOrdered:count('NOT_ORDERED'),held:count('NOT_ORDERED_HELD'),unexpectedBuys:unexpected,exits:day.filter(i=>i.side==='sell').length,rows};
 });

 return {asOf,schema:'stock-research-tracking-v1',benchmark,drawdown:{strategy:perf.verified.maxDrawdown,observedStrategy:perf.verified.observedMaxDrawdown,
  coverage:perf.verified.drawdownCoverage,matchedExposureSpy:benchmark.matchedExposureSpyMaxDrawdown},
  turnover,costs,rejectedCandidates:rejected,reconciliation,issues,
  state:issues.some(i=>i.startsWith('UNEXPECTED_BUY'))?'INTEGRITY_ISSUES':measured?'MEASURING':'COLLECTING' as 'INTEGRITY_ISSUES'|'MEASURING'|'COLLECTING'};
}
