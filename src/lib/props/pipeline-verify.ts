/**
 * Read-only reliability checks for the NBA props paper pipeline (pure; no I/O). Fills the gaps not covered by
 * scripts/props-ledger-verify.mjs (entry re-grades, settlement recompute, bankrolls) and scripts/props-ledger-audit.ts
 * (grading, identity, Brier): it re-derives every stored pick decision from its stored probabilities, checks
 * coverage of qualifying lines, chronology, entry construction, duplicate real lines across entries, settlement
 * staleness against result revisions, capture-plan completion, quote age, run health and the penny cohort's
 * database-computed stakes and returns. It never changes a rule: every check compares against the frozen code.
 */
import {decidePick,decidePickV2,SELECTION_RULE_V1} from './rules.ts';
import {SELECTION_VERSION_V2,OBSERVATION_RULES,MODEL_VERSION} from './contract.ts';
import {playerKey} from './identity.ts';
import {pennyJointPpm,pennyReturnCents} from '../lab/penny-paper.ts';
import type {MarketView} from './market.ts';

export type Obs={id:number;run_id:number;platform:string;provider_event_id:string;player_name:string;stat:string;line:number|string;
 lock_at:string;commence_time:string;provider_last_update:string;ingested_at:string};
export type Pred={id:number;observation_id:number;model_version:string;status:string;p_more:number|string|null;p_less:number|string|null;
 p_tie:number|string|null;predicted_at:string;data_cutoff:string};
export type Pick={id:number;prediction_id:number;run_id:number;selection_version:string;status:string;side:string|null;reason:string;decided_at:string};
export type Entry={id:number;account_id:number;run_id:number;pick_count:number;stake_cents:number;lock_at:string;created_at:string};
export type Leg={entry_id:number;pick_id:number};
export type Result={id:number;observation_id:number;revision:number;outcome:string;graded_at:string};
export type Settle={entry_id:number;outcome:string;settled_at:string};
export type Account={id:number;slug:string;platform:string;selection_version:string};
export type View={observation_id:number;run_id:number;flags:string[]|null};
export type Plan={id:number;slate_date:string;provider_event_id:string;selected:boolean;commence_time:string;planned_at:string};
export type Claim={id:number;plan_id:number;run_id:number;provider_event_id:string;capture_key:string;claimed_at:string};
export type ClaimOutcome={capture_id:number;outcome:string;dfs_lines:number|null;minutes_to_tip:number|string|null};
export type Run={id:number;kind:string;slot_key:string;status:string;outcome:string;started_at:string;start_delay_seconds:number|null};
export type PennyEntry={id:number;source_entry_id:number;probability_ppm:number|null;payout_multiplier_milli:number|null;stake_cents:number;
 reference_stake_cents:number;reason:string;recorded_at:string;lock_at:string;inputs:{availableCents?:number;usedTodayCents?:number;
 referenceAvailableCents?:number;referenceUsedTodayCents?:number;legs?:{probability:number|string;side:string;pick_id:number}[]}};
export type PennySettle={id:number;penny_entry_id:number;revision:number;grade_ids:number[];outcome:string;multiplier_milli:number|null;
 return_cents:number|null;profit_cents:number|null;reference_return_cents:number|null;reference_profit_cents:number|null;recorded_at:string};

export type Input={nowIso:string;observations:Obs[];predictions:Pred[];picks:Pick[];entries:Entry[];legs:Leg[];results:Result[];
 settlements:Settle[];accounts:Account[];views:View[];plans:Plan[];claims:Claim[];claimOutcomes:ClaimOutcome[];runs:Run[];
 pennyCohorts:{id:string;registered_at:string}[];pennyEntries:PennyEntry[];pennySettlements:PennySettle[]};

const t=(s:string)=>Date.parse(s);
const num=(v:number|string|null)=>v===null?null:Number(v);
const quantile=(xs:number[],q:number)=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))];};
const dist=(xs:number[])=>({n:xs.length,min:quantile(xs,0),p50:quantile(xs,0.5),p90:quantile(xs,0.9),max:xs.length?Math.max(...xs):null});
const cap=<T>(xs:T[],n=15)=>xs.slice(0,n);
const realLine=(o:Obs)=>[o.provider_event_id,playerKey(o.player_name),o.stat,Number(o.line)].join('|');

/** The frozen decision for a stored pick, from its own stored probabilities (and stored market flags for v2). */
export function expectedDecision(pick:Pick,pred:Pred,view:View|null){
 const input={status:pred.status==='scored'?'scored' as const:'unscorable' as const,pMore:num(pred.p_more),pLess:num(pred.p_less),pTie:num(pred.p_tie)};
 if(pick.selection_version===SELECTION_VERSION_V2)
  return decidePickV2(input,view?{flags:view.flags??[]} as unknown as MarketView:null);
 return decidePick(input);
}

export function verifyPipeline(x:Input){
 const now=t(x.nowIso);
 const obs=new Map(x.observations.map(o=>[o.id,o]));
 const pred=new Map(x.predictions.map(p=>[p.id,p]));
 const pickById=new Map(x.picks.map(p=>[p.id,p]));
 const viewByObs=new Map(x.views.map(v=>[v.observation_id,v]));   // one view per observation (UNIQUE)
 const issues:{check:string;detail:string}[]=[];
 const flag=(check:string,detail:string)=>issues.push({check,detail});

 // 1. Every stored pick decision equals the frozen rule applied to its stored probabilities.
 const rule={checked:0,mismatches:0,recorded:0,recordedOutsideBand:0,bySelection:{} as Record<string,Record<string,number>>};
 for(const k of x.picks){
  const p=pred.get(k.prediction_id);if(!p){flag('pick_without_prediction','pick '+k.id);continue;}
  const view=viewByObs.get(p.observation_id)??null;
  const d=expectedDecision(k,p,view);rule.checked++;
  const tally=rule.bySelection[k.selection_version]??={};tally[k.reason]=(tally[k.reason]??0)+1;
  if(k.status==='recorded'){
   rule.recorded++;
   const prob=k.side==='more'?num(p.p_more):num(p.p_less);
   if(prob===null||prob<SELECTION_RULE_V1.minSideProbability||prob>SELECTION_RULE_V1.maxSideProbability||num(p.p_tie)!>SELECTION_RULE_V1.maxTieProbability)rule.recordedOutsideBand++;
  }
  if(d.status!==k.status||d.side!==k.side||d.reason!==k.reason){
   rule.mismatches++;flag('pick_rule_mismatch',`pick ${k.id} ${k.selection_version}: stored ${k.status}/${k.side}/${k.reason}, rule gives ${d.status}/${d.side}/${d.reason}`);
  }
 }

 // 2. Coverage: every scored line in the 60-80% band (tie <= 5%) of a model that made picks in that run has a pick row.
 const picksByPred=new Map<number,Pick[]>();for(const k of x.picks)(picksByPred.get(k.prediction_id)??picksByPred.set(k.prediction_id,[]).get(k.prediction_id)!).push(k);
 const pickModelsByRun=new Map<number,Set<string>>();
 for(const k of x.picks){const p=pred.get(k.prediction_id);if(p)(pickModelsByRun.get(k.run_id)??pickModelsByRun.set(k.run_id,new Set()).get(k.run_id)!).add(p.model_version);}
 // Recheck captures are observe-only by design (props-tick.ts): their lines are forecast but never picked.
 const recheck=new Set(x.claims.filter(c=>c.capture_key==='recheck').map(c=>c.run_id+'|'+c.provider_event_id));
 const coverage={qualifying:0,withPick:0,missing:0,observeOnlyRecheck:0,modelNotPickingInRun:0,above80:0,band60to80:0};
 for(const p of x.predictions){
  if(p.status!=='scored')continue;
  const o=obs.get(p.observation_id);if(!o)continue;
  const pm=num(p.p_more)!,pl=num(p.p_less)!,pt=num(p.p_tie)!;const side=Math.max(pm,pl);
  if(side>SELECTION_RULE_V1.maxSideProbability)coverage.above80++;
  if(side<SELECTION_RULE_V1.minSideProbability||side>SELECTION_RULE_V1.maxSideProbability||pt>SELECTION_RULE_V1.maxTieProbability)continue;
  coverage.band60to80++;
  const models=pickModelsByRun.get(o.run_id);
  if(recheck.has(o.run_id+'|'+o.provider_event_id)){coverage.observeOnlyRecheck++;continue;}
  // Picks follow the active model only; a run with no pick rows at all is a failed pick write, not a policy skip.
  if(models&&!models.has(p.model_version)){coverage.modelNotPickingInRun++;continue;}
  if(!models&&p.model_version!==MODEL_VERSION){coverage.modelNotPickingInRun++;continue;}
  coverage.qualifying++;
  if(picksByPred.get(p.id)?.length)coverage.withPick++;
  else{coverage.missing++;flag('qualifying_line_without_pick',`prediction ${p.id} (${p.model_version}) obs ${p.observation_id} p=${side.toFixed(3)}`);}
 }

 // 3. Chronology: forecast and decision strictly before the lock; data cutoff not after the forecast.
 const chronology={predictionsAfterLock:0,picksAfterLock:0,cutoffAfterPrediction:0,lockLeadMinutes:[] as number[]};
 for(const p of x.predictions){
  const o=obs.get(p.observation_id);if(!o)continue;
  if(t(p.predicted_at)>=t(o.lock_at)){chronology.predictionsAfterLock++;flag('prediction_after_lock','prediction '+p.id);}
  if(t(p.data_cutoff)>t(p.predicted_at)){chronology.cutoffAfterPrediction++;flag('cutoff_after_prediction','prediction '+p.id);}
 }
 for(const k of x.picks){
  const p=pred.get(k.prediction_id);const o=p&&obs.get(p.observation_id);if(!o)continue;
  if(t(k.decided_at)>=t(o.lock_at)){chronology.picksAfterLock++;flag('pick_after_lock','pick '+k.id);}
  if(k.status==='recorded')chronology.lockLeadMinutes.push(Math.round((t(o.lock_at)-t(k.decided_at))/60_000));
 }

 // 4. Entries: legs, recorded picks, distinct games/players, lock buffer, same real line reused by one account.
 const legsByEntry=new Map<number,number[]>();for(const l of x.legs)(legsByEntry.get(l.entry_id)??legsByEntry.set(l.entry_id,[]).get(l.entry_id)!).push(l.pick_id);
 const account=new Map(x.accounts.map(a=>[a.id,a]));
 const entries={checked:0,problems:0,duplicateRealLines:0};
 const seenLine=new Map<string,number>();
 for(const e of [...x.entries].sort((a,b)=>a.id-b.id)){
  entries.checked++;
  const ids=legsByEntry.get(e.id)??[];const legs=ids.map(id=>{const k=pickById.get(id);const p=k&&pred.get(k.prediction_id);return {k,p,o:p&&obs.get(p.observation_id)};});
  const bad:string[]=[];
  if(ids.length!==e.pick_count)bad.push(`legs ${ids.length}/${e.pick_count}`);
  if(legs.some(l=>!l.k||!l.o))bad.push('unresolved leg');
  else{
   if(legs.some(l=>l.k!.status!=='recorded'))bad.push('leg not a recorded pick');
   if(new Set(legs.map(l=>l.o!.provider_event_id)).size!==legs.length)bad.push('same game twice');
   if(new Set(legs.map(l=>playerKey(l.o!.player_name))).size!==legs.length)bad.push('same player twice');
   const firstLock=Math.min(...legs.map(l=>t(l.o!.lock_at)));
   if(firstLock-t(e.created_at)<OBSERVATION_RULES.lockBufferMs)bad.push('created inside lock buffer');
   const acc=account.get(e.account_id);
   if(acc&&legs.some(l=>l.o!.platform!==acc.platform))bad.push('leg from another platform');
   for(const l of legs){
    const key=e.account_id+'|'+realLine(l.o!)+'|'+l.k!.side;const prior=seenLine.get(key);
    if(prior!==undefined){entries.duplicateRealLines++;flag('real_line_reused',`entry ${e.id} reuses ${realLine(l.o!)} ${l.k!.side} from entry ${prior}`);}
    else seenLine.set(key,e.id);
   }
  }
  if(bad.length){entries.problems++;flag('entry_construction',`entry ${e.id}: ${bad.join(', ')}`);}
 }

 // 5. Settlements vs. result revisions: a settlement is stale when a leg's latest grade is newer than it, or a leg is ungraded.
 const resultsByObs=new Map<number,Result[]>();for(const r of x.results)(resultsByObs.get(r.observation_id)??resultsByObs.set(r.observation_id,[]).get(r.observation_id)!).push(r);
 const settleByEntry=new Map(x.settlements.map(s=>[s.entry_id,s]));
 const settlement={settled:0,stale:0,settledWithUngradedLeg:0,overdueUnsettled:0,revisedResults:x.results.filter(r=>r.revision>1).length};
 for(const e of x.entries){
  const s=settleByEntry.get(e.id);
  const obsIds=(legsByEntry.get(e.id)??[]).map(id=>{const k=pickById.get(id);return k?pred.get(k.prediction_id)?.observation_id:undefined;});
  const latest=obsIds.map(id=>id===undefined?undefined:(resultsByObs.get(id)??[]).sort((a,b)=>b.revision-a.revision)[0]);
  if(!s){
   if(latest.every(r=>r)&&latest.length){settlement.overdueUnsettled++;flag('graded_but_unsettled','entry '+e.id);}
   continue;
  }
  settlement.settled++;
  if(latest.some(r=>!r)){settlement.settledWithUngradedLeg++;flag('settled_with_ungraded_leg','entry '+e.id);}
  if(latest.some(r=>r&&t(r.graded_at)>t(s.settled_at))){settlement.stale++;flag('stale_settlement',`entry ${e.id} settled ${s.settled_at} before a newer grade`);}
 }
 // Lines locked more than 36 h ago (the postponement window) with no grade at all.
 const gradedObs=new Set(x.results.map(r=>r.observation_id));
 const overdueGrades=x.observations.filter(o=>now-t(o.lock_at)>36*3600_000&&!gradedObs.has(o.id));
 const overdueByEvent:Record<string,number>={};for(const o of overdueGrades)overdueByEvent[o.provider_event_id]=(overdueByEvent[o.provider_event_id]??0)+1;

 // 6. Captures: planned games, claims, outcomes; a selected game with no claim or no stored lines is a miss.
 const claimsByPlan=new Map<number,Claim[]>();for(const c of x.claims)(claimsByPlan.get(c.plan_id)??claimsByPlan.set(c.plan_id,[]).get(c.plan_id)!).push(c);
 const outcome=new Map(x.claimOutcomes.map(o=>[o.capture_id,o]));
 const obsEvents=new Set(x.observations.map(o=>o.provider_event_id));
 const capture={plannedGames:x.plans.length,selected:0,notSelected:0,selectedWithoutClaim:0,selectedWithoutStoredLines:0,
  unresolvedClaims:0,outcomes:{} as Record<string,number>,bySlate:{} as Record<string,{planned:number;selected:number;stored:number}>,minutesToTip:[] as number[]};
 for(const p of x.plans){
  const slate=capture.bySlate[p.slate_date]??={planned:0,selected:0,stored:0};slate.planned++;
  if(!p.selected){capture.notSelected++;continue;}
  capture.selected++;slate.selected++;
  const cs=claimsByPlan.get(p.id)??[];
  const past=now>t(p.commence_time);
  if(!cs.length){if(past){capture.selectedWithoutClaim++;flag('selected_game_never_claimed',`${p.slate_date} ${p.provider_event_id}`);}continue;}
  let stored=false;
  for(const c of cs){
   const o=outcome.get(c.id);
   if(!o){if(now-t(c.claimed_at)>15*60_000){capture.unresolvedClaims++;flag('claim_without_outcome','claim '+c.id);}continue;}
   capture.outcomes[o.outcome]=(capture.outcomes[o.outcome]??0)+1;
   if(o.minutes_to_tip!==null)capture.minutesToTip.push(Number(o.minutes_to_tip));
   if(o.outcome==='stored')stored=true;
  }
  if(stored)slate.stored++;
  if(past&&!stored&&!obsEvents.has(p.provider_event_id)){capture.selectedWithoutStoredLines++;}
 }

 // 7. Quote freshness: provider update to our ingestion, and ingestion to lock.
 const quoteAge=x.observations.map(o=>Math.round((t(o.ingested_at)-t(o.provider_last_update))/60_000));
 const ingestToLock=x.observations.map(o=>Math.round((t(o.lock_at)-t(o.ingested_at))/60_000));
 const staleQuotes=x.observations.filter(o=>t(o.ingested_at)-t(o.provider_last_update)>60*60_000).length;

 // 8. Runs.
 const runs={byKindOutcome:{} as Record<string,number>,failedOrAbandoned:[] as string[],stuckRunning:[] as string[],startDelaySeconds:dist([])};
 for(const r of x.runs){
  const k=r.kind+':'+r.status+':'+r.outcome;runs.byKindOutcome[k]=(runs.byKindOutcome[k]??0)+1;
  if(r.status==='failed'||r.status==='abandoned')runs.failedOrAbandoned.push(`${r.id} ${r.slot_key} ${r.status}/${r.outcome}`);
  if(r.status==='running'&&now-t(r.started_at)>2*3600_000)runs.stuckRunning.push(`${r.id} ${r.slot_key}`);
 }
 runs.startDelaySeconds=dist(x.runs.map(r=>r.start_delay_seconds).filter((v):v is number=>v!==null));
 for(const f of runs.failedOrAbandoned)flag('run_failed',f);
 for(const f of runs.stuckRunning)flag('run_stuck',f);

 // 9. Penny cohort: recompute probability, stake, reference stake and returns from the frozen inputs.
 const penny={registered:x.pennyCohorts.length>0,registeredAt:x.pennyCohorts[0]?.registered_at??null,entries:x.pennyEntries.length,
  settlements:x.pennySettlements.length,mismatches:0,byReason:{} as Record<string,number>,sourceEntriesSinceRegistration:0,sourceEntriesNotMirrored:0};
 const pennyBySource=new Set(x.pennyEntries.map(e=>e.source_entry_id));
 if(penny.registeredAt){
  for(const e of x.entries)if(t(e.created_at)>=t(penny.registeredAt)){
   penny.sourceEntriesSinceRegistration++;
   if(!pennyBySource.has(e.id)&&t(e.lock_at)<now){penny.sourceEntriesNotMirrored++;flag('penny_not_mirrored','source entry '+e.id);}
  }
 }
 const pennyEntry=new Map(x.pennyEntries.map(e=>[e.id,e]));
 for(const e of x.pennyEntries){
  penny.byReason[e.reason]=(penny.byReason[e.reason]??0)+1;
  if(e.probability_ppm===null)continue;
  const legs=e.inputs.legs??[];
  const ppm=legs.length===2?pennyJointPpm(Math.floor(Number(legs[0].probability)*1e6),Math.floor(Number(legs[1].probability)*1e6)):null;
  const raw=ppm===null?null:Math.max(0,Math.floor((ppm*3000-1e9)/3e7));
  const avail=e.inputs.availableCents,used=e.inputs.usedTodayCents,ra=e.inputs.referenceAvailableCents,ru=e.inputs.referenceUsedTodayCents;
  const stake=raw===null||avail===undefined||used===undefined?null:Math.min(raw,50,Math.max(0,avail),Math.max(0,1500-used));
  const ref=ra===undefined||ru===undefined?null:Math.min(10,Math.max(0,ra),Math.max(0,1500-ru));
  if(ppm!==e.probability_ppm||stake!==e.stake_cents||ref!==e.reference_stake_cents){
   penny.mismatches++;flag('penny_stake_mismatch',`penny ${e.id}: stored ppm=${e.probability_ppm} stake=${e.stake_cents} ref=${e.reference_stake_cents}; recomputed ${ppm}/${stake}/${ref}`);
  }
 }
 for(const s of x.pennySettlements){
  const e=pennyEntry.get(s.penny_entry_id);if(!e||s.multiplier_milli===null)continue;
  const ret=pennyReturnCents(e.stake_cents,s.multiplier_milli),rr=pennyReturnCents(e.reference_stake_cents,s.multiplier_milli);
  if(ret!==s.return_cents||ret-e.stake_cents!==s.profit_cents||rr!==s.reference_return_cents||rr-e.reference_stake_cents!==s.reference_profit_cents){
   penny.mismatches++;flag('penny_return_mismatch',`penny settlement ${s.id}`);
  }
 }

 const counts:Record<string,number>={};for(const i of issues)counts[i.check]=(counts[i.check]??0)+1;
 return {
  generatedAt:x.nowIso,
  status:issues.length?'ISSUES':'CLEAN',
  issueCounts:counts,
  issues:cap(issues,60),
  pickRule:rule,
  coverage,
  chronology:{...chronology,lockLeadMinutes:dist(chronology.lockLeadMinutes)},
  entries,
  settlement:{...settlement,overdueGrades:overdueGrades.length,overdueByEvent},
  capture:{...capture,minutesToTip:dist(capture.minutesToTip)},
  quotes:{ageMinutes:dist(quoteAge),ingestToLockMinutes:dist(ingestToLock),olderThan60Min:staleQuotes},
  runs,
  penny,
 };
}
