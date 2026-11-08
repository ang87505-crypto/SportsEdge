/** Pure release checks. These inspect receipts; they never start a worker or change a gate. */
import {settleEntry,legResult} from '../src/lib/props/rules.ts';
import {parseLedger} from '../src/lib/stocks/paper-auto-ledger.ts';

export const NOT_BEFORE=Date.parse('2026-11-08T16:00:00Z');
export const EXPIRES=Date.parse('2026-11-11T07:00:00Z'); // end of Nov 10 in New Mexico
const ms=x=>typeof x==='string'?Date.parse(x):NaN;
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):NaN;
const no=reason=>({ready:false,reason});
const latest=(rows,key)=>new Map(rows.map(r=>[id(r[key]),rows.filter(x=>id(x[key])===id(r[key]))
 .sort((a,b)=>Number(b.revision)-Number(a.revision))[0]]));

export function propsReleaseGate(e,now){
 if(!Number.isFinite(now)||now<NOT_BEFORE)return no('PROPS_BUDGET_NOT_ACTIVE_YET');
 if(e.control?.state!=='RUNNING')return no('PROPS_OWNER_PAUSED_OR_STOPPED');
 const b=e.policy;
 if(b?.version!=='props-budget-v2'||Number(b.daily_credits)!==7||Number(b.monthly_credits)!==200||
  Number(b.provider_floor)!==60||ms(b.active_from)>now)return no('PROPS_BUDGET_V2_UNVERIFIED');
 const c=e.collect;
 if(!c||c.kind!=='collect'||c.status!=='completed'||c.outcome!=='COMPLETED'||
  !/^gha:42404093295:[1-9][0-9]*$/.test(c.worker)||!Number.isFinite(ms(c.finished_at)))
  return no('PROPS_REAL_COLLECTION_MISSING');
 if(!e.runs.some(r=>r.kind==='settle'&&r.status==='completed'&&r.outcome==='COMPLETED'&&
  ms(r.started_at)>ms(c.finished_at)&&ms(r.finished_at)<=now))return no('PROPS_SETTLEMENT_RUN_MISSING');
 const obs=e.observations;
 if(!obs.length||obs.length!==Number(c.summary?.receipt?.observations)||
  obs.some(o=>id(o.run_id)!==id(c.id)||o.is_fixture!==false||o.provider!=='the_odds_api'||
   !Number.isFinite(ms(o.ingested_at))||!(ms(o.ingested_at)<ms(o.lock_at))||
   !(ms(o.recorded_at)<ms(o.lock_at))||ms(o.lock_at)>=now))return no('PROPS_PRELOCK_LINES_UNVERIFIED');
 const results=latest(e.results,'observation_id');
 for(const platform of ['prizepicks','pick6']){
  const lines=obs.filter(o=>o.platform===platform);
  const scored=lines.map(o=>({o,p:e.predictions.find(p=>id(p.observation_id)===id(o.id)&&p.status==='scored')}))
   .filter(x=>x.p);
  if(!lines.length||!scored.length)return no('PROPS_BOTH_PLATFORMS_REQUIRED');
  let genuineFinal=0;
  for(const {o,p} of scored){
   const raw=e.raw.find(r=>id(r.id)===id(o.raw_response_id));
   if(!raw||raw.source!=='the_odds_api'||raw.http_status!==200||raw.content_sha256!==o.response_sha256||
    p.model_version!=='props-nb-minutes-rate-v1'||!(ms(p.data_cutoff)<ms(o.lock_at))||
    !(ms(p.predicted_at)<ms(o.lock_at)))return no('PROPS_PROVENANCE_UNVERIFIED');
   const r=results.get(id(o.id));
   if(!r||!(ms(r.graded_at)>ms(o.lock_at))||ms(r.graded_at)>now)return no('PROPS_OBSERVED_LINES_NOT_GRADED');
   // The first real cycle requires final box-score evidence. A missing player or a
   // postponed game may remain waiting; a backfill alone never satisfies this gate.
   const g=e.playerGames.find(g=>id(g.id)===id(r.player_game_id));
   const link=e.links.find(l=>l.provider_event_id===o.provider_event_id);
   if(!g||!link||g.source!=='espn_summary'||g.game_status!=='final'||g.athlete_id!==p.athlete_id||
    g.espn_event_id!==link.espn_event_id||!(ms(g.retrieved_at)>ms(g.game_start))||
    ms(g.retrieved_at)>ms(r.graded_at))return no('PROPS_FINAL_BOX_SCORES_UNVERIFIED');
   const actual=g[o.stat],expected=g.did_not_play?'void_dnp':Number(actual)>Number(o.line)?'more':
    Number(actual)<Number(o.line)?'less':'tie';
   if(r.outcome!==expected||(g.did_not_play?r.actual!==null:
    actual===null||!Number.isFinite(Number(actual))||Number(r.actual)!==Number(actual)))
    return no('PROPS_GRADING_MISMATCH');
   if(!g.did_not_play)genuineFinal++;
  }
  if(!genuineFinal)return no('PROPS_NO_PLAYED_FINAL_ON_BOTH_PLATFORMS');
 }
 // No entry quota: a genuine no-entry collection can pass. Any entries actually
 // created must all settle, with the captured PrizePicks simulation and unknown Pick6 return.
 for(const entry of e.entries){
  const account=e.accounts.find(a=>id(a.id)===id(entry.account_id));
  const legs=e.legs.filter(l=>id(l.entry_id)===id(entry.id));
  const s=e.settlements.find(s=>id(s.entry_id)===id(entry.id));
  if(!account||!['prizepicks','pick6'].includes(account.platform)||!s||
   legs.length!==Number(entry.pick_count)||legs.length<2||
   !(ms(entry.created_at)<ms(entry.lock_at))||!(ms(s.settled_at)>ms(entry.lock_at)))
   return no('PROPS_ENTRY_SETTLEMENTS_MISSING');
  const outcomes=[];
  for(const leg of legs){
   const pick=e.picks.find(p=>id(p.id)===id(leg.pick_id));
   const pred=pick&&e.predictions.find(p=>id(p.id)===id(pick.prediction_id));
   const o=pred&&obs.find(o=>id(o.id)===id(pred.observation_id));
   const r=o&&results.get(id(o.id));
   if(!pick||pick.status!=='recorded'||!['more','less'].includes(pick.side)||
    !o||o.platform!==account.platform||!r)return no('PROPS_ENTRY_LEGS_UNVERIFIED');
   outcomes.push(legResult(pick.side,r.outcome));
  }
  const expected=settleEntry(account.platform,Number(entry.stake_cents),outcomes);
  const compare={outcome:expected.outcome,wins:expected.wins,losses:expected.losses,voids:expected.voids,
   return_cents:expected.returnCents,profit_cents:expected.profitCents,payout_terms_version:expected.termsVersion};
  if(Object.entries(compare).some(([k,v])=>v===null?s[k]!==null:
   typeof v==='number'?Number(s[k])!==v:s[k]!==v))return no('PROPS_PAYOUT_MISMATCH');
 }
 return {ready:true,reason:'PROPS_REAL_CYCLE_VERIFIED',observations:obs.length,entries:e.entries.length};
}

/** Receipt is taken from a successful manual Actions job on the exact reviewed release head. */
export function stockReleaseGate(raw,receipts,now){
 const l=parseLedger(raw);
 if(!l?.registered||l.experimentId!=='stock-v2-weekly-1')return no('STOCK_LEDGER_UNVERIFIABLE');
 const s=l.status;
 if(s.gateMode!=='ARMED'||s.gateChangedBy!=='owner')return no('STOCK_OWNER_START_REQUIRED');
 if(s.unresolvedIntents||s.activeIntents||s.unacknowledgedCriticalAlerts||s.executingRunId||
  s.lastCheckOk!==true||s.lastCheckBlockers.length||
  !(ms(s.lastCheckAt)>now-26*3600_000)||ms(s.lastCheckAt)>now)
  return no('STOCK_ACCOUNT_NOT_CLEAN');
 if(Object.entries(l.activityCounts).some(([kind,n])=>kind!=='strategy_fill'&&n>0))
  return no('STOCK_UNEXPLAINED_ACTIVITY');
 const receipt=receipts.find(p=>p.status==='DONE'&&p.kind==='execute'&&p.experimentId===l.experimentId&&
  p.outcome==='SUCCEEDED'&&p.posts>0&&l.runs.some(r=>r.runId===p.runId&&r.kind==='execute'&&r.status==='succeeded'));
 if(!receipt)return no('STOCK_SUPERVISED_EXECUTE_REQUIRED');
 const run=l.runs.find(r=>r.runId===receipt.runId),session=run.slot.slice(0,10);
 const d=l.decisions.find(d=>d.session===session&&d.outcome==='TARGETS'&&d.targets.length>0&&
  ms(d.recordedAt)<=ms(run.startedAt));
 if(!d||!raw.intents.some(i=>i.decisionId===d.decisionId&&Number(i.filledQty)>0&&
  ['filled','canceled','expired'].includes(i.status)&&ms(i.createdAt)>=ms(run.startedAt)&&
  ms(i.createdAt)<=ms(run.finishedAt)))return no('STOCK_FIRST_SESSION_FILL_REQUIRED');
 const arm=l.gateEvents.find(g=>g.actor==='owner'&&g.toMode==='ARMED'&&ms(g.at)<=ms(run.startedAt));
 const stop=l.gateEvents.find(g=>g.actor==='owner'&&g.toMode==='STOPPED'&&ms(g.at)>ms(run.finishedAt));
 const restart=stop&&l.gateEvents.find(g=>g.actor==='owner'&&g.toMode==='ARMED'&&ms(g.at)>ms(stop.at));
 if(!arm||!stop||!restart)return no('STOCK_STOP_RESTART_ACCEPTANCE_REQUIRED');
 const clean=l.runs.find(r=>r.kind==='reconcile'&&r.status==='succeeded'&&r.summary==='CLEAN'&&
  ms(r.finishedAt)>ms(stop.at)&&ms(r.finishedAt)<=ms(restart.at));
 if(!clean)return no('STOCK_FIRST_SESSION_RECONCILIATION_REQUIRED');
 const mark=l.daily.find(m=>m.session===session&&m.cashReconciled&&!m.contaminated&&
  m.externalFlowCents===0&&Number(m.cashUnexplainedCents)===0&&ms(m.capturedAt)>ms(restart.at)&&
  ms(m.capturedAt)<=now);
 const monitor=mark&&l.runs.find(r=>r.kind==='monitor'&&r.slot===session&&r.status==='succeeded'&&
  ms(r.startedAt)<=ms(mark.capturedAt)&&ms(r.finishedAt)>=ms(mark.capturedAt));
 if(!mark||!monitor)return no('STOCK_SAME_SESSION_CLOSE_REQUIRED');
 return {ready:true,reason:'STOCK_SUPERVISED_SESSION_VERIFIED',session};
}
