/**
 * AI 2.0 learning engine: forward evaluation of a registered challenger from FROZEN predictions. Pure; no I/O.
 * A forward experiment names a candidate and a baseline model whose predictions were each recorded before lock on
 * the same real lines. Rows are paired by line, cross-platform duplicates count once, any prediction made at or
 * after lock is refused, and the production review gate (src/lib/props/promotion.ts) decides — unchanged.
 * A challenger that has stopped producing predictions (stale artifact) is reported as FAILED, never as evidence.
 */
import {evaluateChallenger,REVIEW_GATE,type ReviewGate} from '../../props/promotion.ts';
import type {EvaluationRow} from '../../props/research.ts';
import type {Probabilities} from '../../props/research.ts';
import type {Stat} from '../../props/contract.ts';
import type {Result} from './evaluate.ts';

export type ForwardSpec={kind:'ledger-models';candidate:string;baseline:string;maxStaleDays:number};
export type FrozenPrediction={key:string;eventId:string;date:string;stat:Stat;model:string;predictedAt:string;lockAt:string;p:Probabilities};
export type Grade={key:string;outcome:'more'|'less'|'tie'};

export type PairingReport={rows:EvaluationRow[];refusedAfterLock:number;unpaired:number;ungraded:number;latestCandidateAt:string|null};

export function pair(spec:ForwardSpec,preds:FrozenPrediction[],grades:Grade[]):PairingReport{
 const g=new Map(grades.map(x=>[x.key,x.outcome]));
 const by=new Map<string,{c?:FrozenPrediction;b?:FrozenPrediction}>();
 let refusedAfterLock=0,latest:string|null=null;
 for(const p of preds){
  if(p.model!==spec.candidate&&p.model!==spec.baseline)continue;
  if(!(Date.parse(p.predictedAt)<Date.parse(p.lockAt))){refusedAfterLock++;continue;}
  if(p.model===spec.candidate&&(!latest||p.predictedAt>latest))latest=p.predictedAt;
  const slot=by.get(p.key)??{};
  const k=p.model===spec.candidate?'c':'b';
  if(!slot[k])slot[k]=p;            // first frozen prediction wins; later revisions never replace it
  by.set(p.key,slot);
 }
 const rows:EvaluationRow[]=[];let unpaired=0,ungraded=0;
 for(const [key,s] of [...by.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
  if(!s.c||!s.b){unpaired++;continue;}
  const o=g.get(key);if(!o){ungraded++;continue;}
  rows.push({key,eventId:s.c.eventId,date:s.c.date,stat:s.c.stat,baseline:s.b.p,candidate:s.c.p,outcome:o});
 }
 return {rows,refusedAfterLock,unpaired,ungraded,latestCandidateAt:latest};
}

/** Turn paired frozen predictions into an engine Result, using the production review gate unchanged. */
export function forwardResult(spec:ForwardSpec,report:PairingReport,nowIso:string,gate:ReviewGate=REVIEW_GATE):Result&{details:Record<string,unknown>}{
 const stale=!report.latestCandidateAt||Date.parse(nowIso)-Date.parse(report.latestCandidateAt)>spec.maxStaleDays*86400_000;
 const ev=evaluateChallenger(report.rows,gate);
 const details={candidate:spec.candidate,baseline:spec.baseline,pairs:report.rows.length,dates:ev.dates,games:ev.games,
  candidateBrier:ev.candidate.brier,baselineBrier:ev.baseline.brier,interval:ev.interval,failed:ev.failed,
  refusedAfterLock:report.refusedAfterLock,unpaired:report.unpaired,ungraded:report.ungraded,latestCandidateAt:report.latestCandidateAt,stale};
 const base={evidence:'forward' as const,observations:report.rows.length,dates:ev.dates,clusters:ev.games,decisions:ev.candidate.decisions,details};
 if(stale)return {...base,disposition:'ERROR',reason:`STALE_CANDIDATE: no frozen ${spec.candidate} prediction within ${spec.maxStaleDays} days (latest ${report.latestCandidateAt??'none'}).`};
 // Size of the paired sample; a challenger that makes too few pick decisions can still be credibly worse.
 const sampleFails=ev.failed.filter(f=>f==='min_lines'||f==='min_dates'||f==='min_games');
 if(ev.eligible)return {...base,disposition:'PROMISING',reason:`Meets the review gate on ${report.rows.length} paired lines (Brier difference 95% CI ${ev.interval!.lower95.toFixed(4)} to ${ev.interval!.upper95.toFixed(4)}).`};
 if(!sampleFails.length&&ev.interval&&ev.interval.lower95>0)return {...base,disposition:'REJECTED',reason:`Credibly worse than ${spec.baseline} on ${report.rows.length} paired lines (95% CI ${ev.interval.lower95.toFixed(4)} to ${ev.interval.upper95.toFixed(4)}).`};
 return {...base,disposition:'NO_CLEAR_EFFECT',reason:sampleFails.length?`Collecting: ${report.rows.length} paired lines, ${ev.dates} dates, ${ev.games} games; gate needs ${gate.minGradedLines}/${gate.minDates}/${gate.minGames}.`
  :`Gate not met (${ev.failed.join(', ')}).`};
}
