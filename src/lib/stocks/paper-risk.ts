/**
 * Stock PAPER risk read model for the owner page: planned versus filled orders, fill price versus limit,
 * exposure and concentration from the latest verified close, and decisions that did not trade. Pure; derived only
 * from the ledger. A plan, a shadow run or an unfilled intent never counts as a fill.
 */
import type {PaperAutoLedger} from './paper-auto-ledger.ts';
import {holdings} from './autopilot-view.ts';

export type PaperRisk={
 latestSession:string|null;planned:number;filled:number;partial:number;unfilled:number;
 /** Shares-weighted fill price versus limit, in basis points; negative = better than the limit. Null without fills. */
 fillVsLimitBps:number|null;
 exposure:{session:string;equityCents:number;stocksCents:number;share:number}|null;
 concentration:{symbol:string;shares:number;costCents:number;share:number}[];
 notTraded:{session:string;outcome:string;reasons:string[]}[];
 skippedRuns:Record<string,number>;
 openIssues:{unresolvedIntents:number;criticalAlerts:number};
};

const SKIP=/^(GATE_STOPPED|GATE_PAUSED|OUTSIDE_EXECUTION_WINDOW|NO_EXECUTABLE_DECISION_TODAY|SHADOW_PLAN_ONLY|NOT_CLEAN|MARK_WINDOW_PASSED)/;

export function paperRisk(l:PaperAutoLedger):PaperRisk{
 const latest=[...l.decisions].sort((a,b)=>b.session.localeCompare(a.session))[0]??null;
 const session=latest?.session??null;
 const legs=session?l.intents.filter(i=>i.createdAt.slice(0,10)>=session):[];
 const qty=(i:{filledQty:string})=>Number(i.filledQty)||0;
 const filled=legs.filter(i=>qty(i)>=i.shares).length,partial=legs.filter(i=>qty(i)>0&&qty(i)<i.shares).length;
 // Fill price versus the order's own limit: for a buy, paying less than the limit is negative (better).
 let w=0,acc=0;
 for(const i of l.intents){
  const q=qty(i),px=Number(i.filledAvgPrice);
  if(q>0&&Number.isFinite(px)&&px>0){const lim=i.limitCents/100;acc+=q*((px-lim)/lim)*(i.side==='buy'?1:-1)*1e4;w+=q;}
 }
 const marks=[...l.daily].filter(m=>!m.contaminated&&m.cashReconciled).sort((a,b)=>b.session.localeCompare(a.session));
 const mark=marks[0]??null;
 // Concentration at cost: net filled shares times their average buy fill price (no live quote is assumed).
 const cost=new Map<string,{q:number;c:number}>();
 for(const i of l.intents){const q=qty(i),px=Number(i.filledAvgPrice);if(i.side!=='buy'||q<=0||!Number.isFinite(px))continue;
  const x=cost.get(i.symbol)??{q:0,c:0};cost.set(i.symbol,{q:x.q+q,c:x.c+q*px*100});}
 const held=holdings(l).map(h=>{const c=cost.get(h.symbol);return {symbol:h.symbol,shares:h.shares,costCents:c&&c.q?Math.round(h.shares*c.c/c.q):0};});
 const total=held.reduce((a,h)=>a+h.costCents,0);
 const skippedRuns:Record<string,number>={};
 for(const r of l.runs){const code=(r.summary??'').split(/[:\s]/)[0];if(SKIP.test(code))skippedRuns[code]=(skippedRuns[code]??0)+1;}
 return {latestSession:session,planned:legs.length,filled,partial,unfilled:legs.length-filled-partial,
  fillVsLimitBps:w?acc/w:null,
  exposure:mark?{session:mark.session,equityCents:mark.equityCents,stocksCents:mark.longMarketValueCents,share:mark.equityCents?mark.longMarketValueCents/mark.equityCents:0}:null,
  concentration:held.map(h=>({...h,share:total?h.costCents/total:0})).sort((a,b)=>b.share-a.share),
  notTraded:l.decisions.filter(d=>d.outcome!=='TARGETS').sort((a,b)=>b.session.localeCompare(a.session)).slice(0,6)
   .map(d=>({session:d.session,outcome:d.outcome,reasons:d.reasons})),
  skippedRuns,openIssues:{unresolvedIntents:l.status.unresolvedIntents,criticalAlerts:l.status.unacknowledgedCriticalAlerts}};
}
