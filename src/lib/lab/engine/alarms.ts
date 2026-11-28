/**
 * Absolute performance alarms for the sports ledger (review only). Drift (drift.ts) compares recent with earlier
 * windows; these alarms catch what a relative test cannot: a model that is overconfident throughout, accuracy below
 * break-even, outcomes that never arrive, and a ledger that has stopped updating. They never retrain, promote, pause,
 * change gates or stakes; an ALARM is a request for owner review. Thresholds are fixed here and versioned.
 */
import {clusteredDifference,wilson,round} from '../stats.ts';
import type {SportsRow} from './diagnostics.ts';
import type {DriftReport} from './drift.ts';

export const ALARM_POLICY={version:'sports-alarms-v1',
 calibrationDays:60,minPicks:100,minPickGames:20,maxConfidenceGapLower95:0.03,
 accuracyDays:30,minAccuracyPicks:50,breakEven:0.577,
 overdueHours:36,maxOverdueShare:0.02,minOverdueLines:5,
 staleDays:3,activityDays:14,replicates:2000,seed:20261124} as const;

/** Outcome coverage of scored baseline predictions, counted by the ledger reader (nothing is dropped silently). */
export type Coverage={scored:number;locked:number;graded:number;overdue:number;contradictoryGrades:number;
 newestPredictedAt:string|null;newestGradedAt:string|null};
export type Alarm={code:'OVERCONFIDENT'|'ACCURACY_BELOW_BREAK_EVEN'|'MISSING_OUTCOMES'|'CONTRADICTORY_GRADES'|'STALE_PREDICTIONS'|
 'STALE_OUTCOMES'|'PERFORMANCE_DETERIORATED';detail:string;value:number|null;threshold:number|null};
export type AlarmReport={policy:typeof ALARM_POLICY;status:'OK'|'ALARM'|'COLLECTING'|'IDLE';alarms:Alarm[];
 calibration:{picks:number;games:number;confidenceGap:number|null;lower95:number|null;upper95:number|null};
 accuracy:{picks:number;hitRate:number|null;upper95:number|null};coverage:Coverage;reason:string};

export function sportsAlarms(rows:readonly SportsRow[],coverage:Coverage,drift:DriftReport|null,nowIso:string,P=ALARM_POLICY):AlarmReport{
 const now=Date.parse(nowIso);if(!Number.isFinite(now))throw Error('ALARM_INVALID_CLOCK');
 const day=86400_000,alarms:Alarm[]=[];
 const age=(iso:string|null)=>iso&&Number.isFinite(Date.parse(iso))?(now-Date.parse(iso))/day:Infinity;
 const picksSince=(days:number)=>rows.filter(r=>r.picked&&Date.parse(r.lockAt)>now-days*day&&Date.parse(r.gradedAt)<=now);

 // 1. Absolute overconfidence: confidence of picked sides above their hit rate, game-clustered.
 const cal=picksSince(P.calibrationDays),games=new Set(cal.map(r=>r.game)).size;
 const gap=cal.length?clusteredDifference(cal.map(r=>({cluster:r.game,candidate:r.picked==='more'?r.pMore:1-r.pMore,reference:Number(r.picked===r.outcome)})),
  P.replicates,P.seed):null;
 const calEnough=cal.length>=P.minPicks&&games>=P.minPickGames;
 if(calEnough&&gap&&gap.lower95>P.maxConfidenceGapLower95)alarms.push({code:'OVERCONFIDENT',value:round(gap.mean,6),threshold:P.maxConfidenceGapLower95,
  detail:`Last ${P.calibrationDays} days: picks were ${(gap.mean*100).toFixed(1)} points more confident than their hit rate (95% lower bound ${(gap.lower95*100).toFixed(1)}).`});

 // 2. Accuracy confidently below break-even (independent of the production safety brake, which acts on its own window).
 const acc=picksSince(P.accuracyDays),hits=acc.filter(r=>r.picked===r.outcome).length,w=wilson(hits,acc.length);
 if(acc.length>=P.minAccuracyPicks&&w.upper<P.breakEven)alarms.push({code:'ACCURACY_BELOW_BREAK_EVEN',value:round(hits/acc.length,6),threshold:P.breakEven,
  detail:`Last ${P.accuracyDays} days: ${hits}/${acc.length} picks correct; the 95% upper bound ${(w.upper*100).toFixed(1)}% is below the ${(P.breakEven*100).toFixed(1)}% break-even.`});

 // 3. Outcomes that never arrived, or contradict the box-score actual.
 const share=coverage.locked?coverage.overdue/coverage.locked:0;
 if(coverage.overdue>=P.minOverdueLines&&share>P.maxOverdueShare)alarms.push({code:'MISSING_OUTCOMES',value:coverage.overdue,threshold:P.maxOverdueShare,
  detail:`${coverage.overdue} of ${coverage.locked} locked lines (${(share*100).toFixed(1)}%) have no valid grade ${P.overdueHours}+ hours after lock.`});
 if(coverage.contradictoryGrades>0)alarms.push({code:'CONTRADICTORY_GRADES',value:coverage.contradictoryGrades,threshold:0,
  detail:`${coverage.contradictoryGrades} grades disagree with their own box-score actual and were excluded.`});

 // 4. Staleness, only while the ledger is active (an idle off-season ledger is reported as IDLE, not as fresh).
 const active=age(coverage.newestPredictedAt)<=P.activityDays;
 if(active&&age(coverage.newestPredictedAt)>P.staleDays)alarms.push({code:'STALE_PREDICTIONS',value:round(age(coverage.newestPredictedAt),2),threshold:P.staleDays,
  detail:`No new prediction for ${age(coverage.newestPredictedAt).toFixed(1)} days.`});
 if(active&&coverage.locked>0&&age(coverage.newestGradedAt)>P.staleDays)alarms.push({code:'STALE_OUTCOMES',value:age(coverage.newestGradedAt)===Infinity?null:round(age(coverage.newestGradedAt),2),
  threshold:P.staleDays,detail:coverage.newestGradedAt?`No new grade for ${age(coverage.newestGradedAt).toFixed(1)} days while predictions continue.`:'Locked lines exist but no grade has ever been recorded.'});

 // 5. Relative deterioration, from the registered drift rule.
 if(drift?.status==='REVIEW_REQUESTED')alarms.push({code:'PERFORMANCE_DETERIORATED',value:null,threshold:null,detail:drift.reason});

 const status=alarms.length?'ALARM':!active?'IDLE':!calEnough?'COLLECTING':'OK';
 return {policy:P,status,alarms,
  calibration:{picks:cal.length,games,confidenceGap:round(gap?.mean,6),lower95:round(gap?.lower95,6),upper95:round(gap?.upper95,6)},
  accuracy:{picks:acc.length,hitRate:acc.length?round(hits/acc.length,6):null,upper95:acc.length?round(w.upper,6):null},coverage,
  reason:alarms.length?'Owner review requested. The active model, picks, gates, stakes and the safety brake are unchanged by this report.':
   status==='IDLE'?`No prediction in ${P.activityDays} days: no freshness or performance conclusion.`:
   status==='COLLECTING'?`Fewer than ${P.minPicks} picks or ${P.minPickGames} games in ${P.calibrationDays} days: no calibration conclusion.`:
   'No alarm under sports-alarms-v1. This does not establish accuracy or profitability.'};
}
