/**
 * Forward performance of a recurring Alpaca PAPER experiment, computed only from the
 * database ledger (sportsedge_paper_auto_ledger). Pure; no network.
 *
 * - Broker observations are the after-close marks exactly as recorded.
 * - Verified strategy P&L chains the starting equity through marks that are
 *   uncontaminated and cash-reconciled. An unreconciled mark is skipped. The chain
 *   ends for good at the first contaminated mark, so a deposit, manual trade or
 *   corporate action is never presented as strategy return.
 * - Nothing is annualized, and nothing comes from a single snapshot.
 */
export const PAPER_AUTO_PERFORMANCE_LABELS=[
 'Alpaca PAPER fills are simulated: no market impact, queue position, regulatory fees or paper dividends. These are not achievable real-money returns.',
 'Verified returns use only uncontaminated, cash-reconciled after-close marks since registration. Not annualized.',
 'The SPY benchmark is a raw SIP closing-price return over the same marks, without dividends.',
] as const;

export type DailyMark={session:string;capturedAt:string;equityCents:number;cashCents:number;
 longMarketValueCents:number;externalFlowCents:number;feesCents:number;dividendsCents:number;
 benchmarkSymbol:string;benchmarkClose:string|null;benchmarkSource:string;contaminated:boolean;
 cashReconciled:boolean;cashUnexplainedCents:string;unrealizedPlCents:number|null};
export type MarkVerdict='VERIFIED'|'UNRECONCILED_SKIPPED'|'CONTAMINATED'|'AFTER_CONTAMINATION';
export type ForwardPerformance={
 startingEquityCents:number;registeredAt:string;
 marks:Array<DailyMark&{verdict:MarkVerdict}>;
 verified:{state:'NO_MARKS'|'NO_VERIFIED_MARKS'|'MEASURING'|'ENDED';endedAtSession:string|null;
  throughSession:string|null;verifiedMarks:number;skippedMarks:number;lastEquityCents:number|null;
  pnlCents:number|null;unrealizedPlCents:number|null;realizedPlCents:number|null;cumulativeReturn:number|null;
  maxDrawdown:number|null};
 benchmark:{symbol:'SPY';state:'NEEDS_TWO_VERIFIED_CLOSES'|'MEASURED';fromSession:string|null;
  toSession:string|null;strategyReturn:number|null;benchmarkReturn:number|null;excessReturn:number|null};
};

const SESSION=/^\d{4}-\d{2}-\d{2}$/;
const CLOSE=/^\d{1,10}(\.\d{1,6})?$/;
const UNEXPLAINED=/^-?\d{1,14}(\.\d{1,6})?$/;
const cents=(v:unknown,lo:number):v is number=>Number.isSafeInteger(v)&&(v as number)>=lo;
const stamp=(v:unknown):v is string=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));

/** Strictly parses ledger marks; null on any malformed or out-of-order row (fail closed). */
export function parseDailyMarks(raw:unknown):DailyMark[]|null{
 if(!Array.isArray(raw)||raw.length>4000)return null;
 const out:DailyMark[]=[];
 for(const row of raw){
  if(!row||typeof row!=='object'||Array.isArray(row))return null;
  const x=row as Record<string,unknown>;
  if(typeof x.session!=='string'||!SESSION.test(x.session)||!stamp(x.capturedAt)||
   !cents(x.equityCents,0)||!cents(x.cashCents,-1e11)||!cents(x.longMarketValueCents,0)||
   !cents(x.externalFlowCents,-1e11)||!cents(x.feesCents,0)||!cents(x.dividendsCents,0)||
   typeof x.benchmarkSymbol!=='string'||!/^[A-Z]{1,5}$/.test(x.benchmarkSymbol)||
   !(x.benchmarkClose===null||(typeof x.benchmarkClose==='string'&&CLOSE.test(x.benchmarkClose)&&
    Number(x.benchmarkClose)>0))||typeof x.benchmarkSource!=='string'||x.benchmarkSource.length>160||
   typeof x.contaminated!=='boolean'||typeof x.cashReconciled!=='boolean'||
   typeof x.cashUnexplainedCents!=='string'||!UNEXPLAINED.test(x.cashUnexplainedCents)||
   !(x.unrealizedPlCents===null||cents(x.unrealizedPlCents,-1e11)))return null;
  if(out.length&&out[out.length-1].session>=x.session)return null;
  out.push({session:x.session,capturedAt:x.capturedAt,equityCents:x.equityCents,cashCents:x.cashCents,
   longMarketValueCents:x.longMarketValueCents,externalFlowCents:x.externalFlowCents,feesCents:x.feesCents,
   dividendsCents:x.dividendsCents,benchmarkSymbol:x.benchmarkSymbol,benchmarkClose:x.benchmarkClose,
   benchmarkSource:x.benchmarkSource,contaminated:x.contaminated,cashReconciled:x.cashReconciled,
   cashUnexplainedCents:x.cashUnexplainedCents,unrealizedPlCents:x.unrealizedPlCents});
 }
 return out;
}

/** Chains verified marks from the registered starting equity; see the module comment. */
export function forwardPerformance(startingEquityCents:number,registeredAt:string,
 marks:readonly DailyMark[]):ForwardPerformance{
 if(!cents(startingEquityCents,1)||!stamp(registeredAt))throw Error('INVALID_EXPERIMENT');
 let ended:string|null=null;
 const judged=marks.map(m=>{
  let verdict:MarkVerdict;
  if(ended)verdict='AFTER_CONTAMINATION';
  // A recorded flow always contaminates; a flow on an uncontaminated mark breaks the
  // database invariant, so it ends the chain rather than being netted out.
  else if(m.contaminated||m.externalFlowCents!==0){verdict='CONTAMINATED';ended=m.session;}
  else verdict=m.cashReconciled?'VERIFIED':'UNRECONCILED_SKIPPED';
  return {...m,verdict};
 });
 const verifiedMarks=judged.filter(m=>m.verdict==='VERIFIED');
 // With no flows inside the chain, each link (E_t - F_t) / E_(t-1) is E_t / E_(t-1).
 let peak=startingEquityCents,maxDrawdown=0;
 for(const m of verifiedMarks){
  peak=Math.max(peak,m.equityCents);
  maxDrawdown=Math.max(maxDrawdown,(peak-m.equityCents)/peak);
 }
 const last=verifiedMarks.at(-1)??null;
 const pnl=last?last.equityCents-startingEquityCents:null,unrealized=last?.unrealizedPlCents??null;
 const closes=verifiedMarks.filter(m=>m.benchmarkSymbol==='SPY'&&m.benchmarkClose!==null);
 const from=closes[0]??null,to=closes.length>1?closes[closes.length-1]:null;
 const strategyReturn=from&&to?to.equityCents/from.equityCents-1:null;
 const benchmarkReturn=from&&to?Number(to.benchmarkClose)/Number(from.benchmarkClose)-1:null;
 return {startingEquityCents,registeredAt,marks:judged,
  verified:{state:!marks.length?'NO_MARKS':!last?'NO_VERIFIED_MARKS':ended?'ENDED':'MEASURING',
   endedAtSession:ended,throughSession:last?.session??null,verifiedMarks:verifiedMarks.length,
   skippedMarks:judged.filter(m=>m.verdict==='UNRECONCILED_SKIPPED').length,
   lastEquityCents:last?.equityCents??null,pnlCents:pnl,unrealizedPlCents:unrealized,
   // With no flows inside the chain, everything not still open in positions has been realized.
   realizedPlCents:pnl!==null&&unrealized!==null?pnl-unrealized:null,
   cumulativeReturn:last?last.equityCents/startingEquityCents-1:null,maxDrawdown:last?maxDrawdown:null},
  benchmark:{symbol:'SPY',state:from&&to?'MEASURED':'NEEDS_TWO_VERIFIED_CLOSES',
   fromSession:from&&to?from.session:null,toSession:to?.session??null,strategyReturn,benchmarkReturn,
   excessReturn:strategyReturn!==null&&benchmarkReturn!==null?strategyReturn-benchmarkReturn:null}};
}
