/**
 * Whether a shadowing challenger may replace the active model. Pure.
 * Uses the registered review gate (src/data/props/research_v2.json, kept identical by a test),
 * measured only on the challenger's own forward predictions, which it never trained on.
 */
import {summarize,pairedInterval,type EvaluationRow} from './research.ts';

export const REVIEW_GATE={minGradedLines:500,minDates:14,minGames:50,minCandidateDecisions:100,maxBrierDifferenceUpper95:-0.002,
 bootstrapReplicates:1000,bootstrapSeed:20261108,requireNoWorseLogLoss:true};
export type ReviewGate=typeof REVIEW_GATE;
export type Summary=ReturnType<typeof summarize>;
export type GateFailure='min_lines'|'min_dates'|'min_games'|'min_decisions'|'brier_interval'|'log_loss';
export type ChallengerEvaluation={eligible:boolean;failed:GateFailure[];baseline:Summary;candidate:Summary;
 interval:{lower95:number;upper95:number;games:number}|null;dates:number;games:number};

export function evaluateChallenger(rows:EvaluationRow[],gate:ReviewGate):ChallengerEvaluation{
 // The same line on PrizePicks and Pick6 is one observation of the world, not two.
 const unique=[...new Map(rows.map(r=>[r.key,r])).values()];
 const baseline=summarize(unique.map(r=>({p:r.baseline,outcome:r.outcome})));
 const candidate=summarize(unique.map(r=>({p:r.candidate,outcome:r.outcome})));
 const interval=pairedInterval(unique,gate.bootstrapReplicates,gate.bootstrapSeed);
 const dates=new Set(unique.map(r=>r.date)).size,games=new Set(unique.map(r=>r.eventId)).size;
 const failed:GateFailure[]=[];
 if(unique.length<gate.minGradedLines)failed.push('min_lines');
 if(dates<gate.minDates)failed.push('min_dates');
 if(games<gate.minGames)failed.push('min_games');
 if(candidate.decisions<gate.minCandidateDecisions)failed.push('min_decisions');
 if(!interval||interval.upper95>gate.maxBrierDifferenceUpper95)failed.push('brier_interval');
 if(gate.requireNoWorseLogLoss&&(candidate.logLoss===null||baseline.logLoss===null||candidate.logLoss>baseline.logLoss))failed.push('log_loss');
 return {eligible:failed.length===0,failed,baseline,candidate,interval,dates,games};
}
