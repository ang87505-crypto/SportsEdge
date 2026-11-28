/**
 * Forward evidence from the nightly stock research ledgers (research-data summary.json) for the learning engine.
 * - lab-stock-psychology-v1: frozen weekly picks per variant (summary.lab.forward), graded open-to-open against SPY.
 * - lab-stock-holdrank10-wholeshare: the same ledger under its own experiment (summary.labHoldrank10), once present.
 * - qmom-disclosure-follower-v1: the existing candidate forward summary. Sessions are reported separately and never
 *   converted to the registered weekly sample. Only explicitly supplied graded weeks count toward that gate.
 * Graded weeks are counted exactly as recorded; nothing is converted or inferred. The result is always
 * NO_CLEAR_EFFECT. Below the registered 26 weeks the engine records INSUFFICIENT_DATA. At or above it, the pre-registered
 * decision rule must be applied by the owner, because this reader never declares a winner. Terminal experiments
 * (REJECTED, FAILED) are reported, never advanced.
 */
import type {Result} from './evaluate.ts';

type Variant={weeks?:unknown;pending?:unknown;total_return?:unknown;status?:unknown;latest_session?:unknown};
export type StockResearchSummary={lab?:{forward?:{minWeeks?:unknown;variants?:Record<string,Variant>}};
 labHoldrank10?:{experiment?:unknown;forward?:Record<string,Variant>};
 candidates?:{id?:unknown;active?:unknown;forward?:{status?:unknown;sessions?:unknown;weeks?:unknown;totalReturn?:unknown}}[]};
const weeksOf=(v:Variant)=>Number.isSafeInteger(v.weeks)&&(v.weeks as number)>=0?v.weeks as number:null;
const pct=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)?(x*100).toFixed(2)+'%':'n/a';

function fromVariants(experimentId:string,variants:Record<string,Variant>|undefined,minWeeks:number):{experimentId:string;result:Result}|null{
 const entries=Object.entries(variants??{});
 if(!entries.length)return null;
 const ws=entries.map(([,v])=>weeksOf(v));
 if(ws.some(w=>w===null))throw Error('STOCK_RESEARCH_INVALID_SUMMARY');
 const weeks=Math.min(...(ws as number[]));
 const detail=entries.map(([k,v])=>`${k} ${weeksOf(v)} wk ${pct(v.total_return)}`).join('; ');
 return {experimentId,result:{evidence:'forward',disposition:'NO_CLEAR_EFFECT',observations:weeks,weeks,
  reason:(weeks<minWeeks?`${weeks}/${minWeeks} graded forward weeks (frozen before each open). `:
   `${weeks} graded forward weeks: the registered minimum is reached; the owner applies the pre-registered decision rule. `)+
   `Per variant: ${detail}. Research picks only; never orders.`}};
}
export function stockResearchResults(s:StockResearchSummary):{experimentId:string;result:Result}[]{
 const min=Number.isSafeInteger(s.lab?.forward?.minWeeks)?s.lab!.forward!.minWeeks as number:26;
 return [fromVariants('lab-stock-psychology-v1',s.lab?.forward?.variants,min),
  s.labHoldrank10?.experiment==='lab-stock-holdrank10-wholeshare'?fromVariants('lab-stock-holdrank10-wholeshare',s.labHoldrank10.forward,min):null,
  fromCandidate(s)]
  .filter((x):x is {experimentId:string;result:Result}=>x!==null);
}

function fromCandidate(s:StockResearchSummary):{experimentId:string;result:Result}|null{
 if(s.candidates!==undefined&&!Array.isArray(s.candidates))throw Error('STOCK_RESEARCH_INVALID_CANDIDATES');
 const matches=(s.candidates??[]).filter(c=>c?.id==='qmom-disclosure-follower-v1');
 if(matches.length>1)throw Error('STOCK_RESEARCH_DUPLICATE_CANDIDATE');
 const c=matches[0],f=c?.forward;if(!f)return null;
 if(c.active!==false||!Number.isSafeInteger(f.sessions)||(f.sessions as number)<0||typeof f.status!=='string'||f.status.length>100)
  throw Error('STOCK_RESEARCH_INVALID_CANDIDATE_FORWARD');
 const sessions=f.sessions as number,weeks=f.weeks===undefined?null:f.weeks;
 if(weeks!==null&&(!Number.isSafeInteger(weeks)||(weeks as number)<0||(weeks as number)>sessions))throw Error('STOCK_RESEARCH_INVALID_FORWARD_WEEKS');
 // observations means admitted WEEKLY observations for this registered experiment. Unknown weekly counts do not
 // manufacture progress from daily sessions. NO_CLEAR_EFFECT can never select or activate a strategy.
 return {experimentId:'qmom-disclosure-follower-v1',result:{evidence:'forward',disposition:'NO_CLEAR_EFFECT',
  observations:typeof weeks==='number'?weeks:0,...(weeks!==null?{weeks:weeks as number}:{}),
  reason:`QMOM research: ${sessions} forward sessions recorded. `+(weeks===null?
   'Graded weeks are not supplied; no weekly observations are credited toward the registered 26-week gate. ':
   `${weeks} explicitly recorded graded weeks; the registered 26-week gate and decision rule still apply. `)+
   `Sessions are not weeks. Recorded research return ${pct(f.totalReturn)}; status ${f.status}. No strategy is activated.`}};
}
