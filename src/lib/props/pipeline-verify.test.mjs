import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPipeline} from './pipeline-verify.ts';

const NOW='2026-11-28T12:00:00Z';
function fixture(){
 const o=(id,event,player,lock='2026-11-27T01:00:00Z')=>({id,run_id:10,platform:'prizepicks',provider_event_id:event,player_name:player,stat:'points',line:20.5,
  lock_at:lock,commence_time:lock,provider_last_update:'2026-11-26T22:50:00Z',ingested_at:'2026-11-26T23:00:00Z'});
 const p=(id,obs,pm,pl,pt)=>({id,observation_id:obs,model_version:'props-nb-minutes-rate-v1',status:'scored',p_more:pm,p_less:pl,p_tie:pt,
  predicted_at:'2026-11-26T23:01:00Z',data_cutoff:'2026-11-26T23:00:00Z'});
 const k=(id,pred,status,side,reason)=>({id,prediction_id:pred,run_id:10,selection_version:'props-select-v1',status,side,reason,decided_at:'2026-11-26T23:02:00Z'});
 return {nowIso:NOW,
  observations:[o(1,'eventAAAA','Alpha One'),o(2,'eventBBBB','Beta Two'),o(3,'eventCCCC','Gamma Three'),o(4,'eventDDDD','Delta Four')],
  predictions:[p(101,1,0.65,0.33,0.02),p(102,2,0.13,0.85,0.02),p(103,3,0.62,0.32,0.06),p(104,4,0.30,0.65,0.05)],
  picks:[k(201,101,'recorded','more','edge_band'),k(202,102,'skipped',null,'extreme_disagreement'),k(203,103,'skipped',null,'tie_risk'),k(204,104,'recorded','less','edge_band')],
  entries:[{id:1,account_id:7,run_id:10,pick_count:2,stake_cents:500,lock_at:'2026-11-27T01:00:00Z',created_at:'2026-11-26T23:03:00Z'}],
  legs:[{entry_id:1,pick_id:201},{entry_id:1,pick_id:204}],
  results:[{id:301,observation_id:1,revision:1,outcome:'more',graded_at:'2026-11-27T10:30:00Z'},{id:302,observation_id:4,revision:1,outcome:'less',graded_at:'2026-11-27T10:30:00Z'},
   {id:303,observation_id:2,revision:1,outcome:'less',graded_at:'2026-11-27T10:30:00Z'},{id:304,observation_id:3,revision:1,outcome:'more',graded_at:'2026-11-27T10:30:00Z'}],
  settlements:[{entry_id:1,outcome:'won',settled_at:'2026-11-27T10:31:00Z'}],
  accounts:[{id:7,slug:'props-prizepicks-v1',platform:'prizepicks',selection_version:'props-select-v1'}],
  views:[],
  plans:[{id:1,slate_date:'2026-11-26',provider_event_id:'eventAAAA',selected:true,commence_time:'2026-11-27T01:10:00Z',planned_at:'2026-11-26T15:00:00Z'}],
  claims:[{id:1,plan_id:1,run_id:10,provider_event_id:'eventAAAA',capture_key:'primary',claimed_at:'2026-11-26T23:00:00Z'}],
  claimOutcomes:[{capture_id:1,outcome:'stored',dfs_lines:4,minutes_to_tip:130}],
  runs:[{id:10,kind:'collect',slot_key:'collect-tick-2026-11-26T23:00',status:'completed',outcome:'COMPLETED',started_at:'2026-11-26T23:00:00Z',start_delay_seconds:40}],
  pennyCohorts:[],pennyEntries:[],pennySettlements:[]};
}

test('a consistent ledger is CLEAN and the 60-80% rule is re-derived from stored probabilities', ()=>{
 const r=verifyPipeline(fixture());
 assert.equal(r.status,'CLEAN',JSON.stringify(r.issues));
 assert.equal(r.pickRule.checked,4);assert.equal(r.pickRule.mismatches,0);assert.equal(r.pickRule.recorded,2);
 assert.equal(r.coverage.band60to80,2);assert.equal(r.coverage.withPick,2);assert.equal(r.coverage.above80,1);
 assert.equal(r.quotes.ageMinutes.p50,10);
});

test('a stored pick that disagrees with the frozen rule is a mismatch', ()=>{
 const f=fixture();f.picks[1]={...f.picks[1],status:'recorded',side:'less',reason:'edge_band'};
 const r=verifyPipeline(f);
 assert.equal(r.pickRule.mismatches,1);assert.equal(r.pickRule.recordedOutsideBand,1);
 assert.equal(r.issueCounts.pick_rule_mismatch,1);
});

test('a qualifying line without any pick row is reported; recheck lines are observe-only', ()=>{
 const f=fixture();f.picks=f.picks.filter(k=>k.id!==201);f.legs=[];f.entries=[];f.settlements=[];
 let r=verifyPipeline(f);
 assert.equal(r.coverage.missing,1);assert.equal(r.issueCounts.qualifying_line_without_pick,1);
 f.claims[0]={...f.claims[0],capture_key:'recheck'};
 r=verifyPipeline(f);
 assert.equal(r.coverage.missing,0);assert.equal(r.coverage.observeOnlyRecheck,1);
});

test('forecast or decision at or after lock, and same-game legs, are flagged', ()=>{
 const f=fixture();f.predictions[0]={...f.predictions[0],predicted_at:'2026-11-27T01:00:00Z'};
 f.observations[3]={...f.observations[3],provider_event_id:'eventAAAA'};
 const r=verifyPipeline(f);
 assert.equal(r.chronology.predictionsAfterLock,1);
 assert.match(r.issues.find(i=>i.check==='entry_construction').detail,/same game twice/);
});

test('a settlement older than a later grade revision is stale; graded but unsettled is overdue', ()=>{
 const f=fixture();f.results.push({id:305,observation_id:1,revision:2,outcome:'less',graded_at:'2026-11-27T16:30:00Z'});
 let r=verifyPipeline(f);
 assert.equal(r.settlement.stale,1);assert.equal(r.settlement.revisedResults,1);
 f.settlements=[];r=verifyPipeline(f);
 assert.equal(r.settlement.overdueUnsettled,1);
});

test('the same real line and side reused by one account in two entries is flagged', ()=>{
 const f=fixture();
 f.observations.push({...f.observations[0],id:5,provider_last_update:'2026-11-26T23:20:00Z',ingested_at:'2026-11-26T23:30:00Z'},
  {...f.observations[1],id:6,provider_event_id:'eventEEEE',player_name:'Echo Five'});
 f.predictions.push({...f.predictions[0],id:105,observation_id:5},{...f.predictions[3],id:106,observation_id:6});
 f.picks.push({...f.picks[0],id:205,prediction_id:105},{...f.picks[3],id:206,prediction_id:106});
 f.entries.push({...f.entries[0],id:2,created_at:'2026-11-26T23:31:00Z'});f.legs.push({entry_id:2,pick_id:205},{entry_id:2,pick_id:206});
 const r=verifyPipeline(f);
 assert.equal(r.entries.duplicateRealLines,1);
});

test('penny stakes and returns are recomputed: two 65% legs give 414050 ppm and 8 cents', ()=>{
 const f=fixture();
 f.pennyCohorts=[{id:'penny-paper-entry-v1',registered_at:'2026-11-26T00:00:00Z'}];
 const inputs={availableCents:50000,usedTodayCents:0,referenceAvailableCents:50000,referenceUsedTodayCents:0,
  legs:[{probability:0.65,side:'more',pick_id:201},{probability:0.65,side:'less',pick_id:204}]};
 f.pennyEntries=[{id:1,source_entry_id:1,probability_ppm:414050,payout_multiplier_milli:3000,stake_cents:8,reference_stake_cents:10,reason:'SIZED',
  recorded_at:'2026-11-26T23:04:00Z',lock_at:'2026-11-27T01:00:00Z',inputs}];
 f.pennySettlements=[{id:1,penny_entry_id:1,revision:1,grade_ids:[301,302],outcome:'won',multiplier_milli:3000,return_cents:24,profit_cents:16,
  reference_return_cents:30,reference_profit_cents:20,recorded_at:'2026-11-27T10:40:00Z'}];
 let r=verifyPipeline(f);
 assert.equal(r.penny.mismatches,0,JSON.stringify(r.issues));assert.equal(r.penny.sourceEntriesSinceRegistration,1);
 f.pennyEntries[0]={...f.pennyEntries[0],stake_cents:9};
 r=verifyPipeline(f);
 assert.equal(r.issueCounts.penny_stake_mismatch,1);
 f.pennyEntries=[];r=verifyPipeline(f);
 assert.equal(r.penny.sourceEntriesNotMirrored,1);
});

test('failed and long-running runs are reported', ()=>{
 const f=fixture();
 f.runs.push({id:11,kind:'settle',slot_key:'settle-2026-11-27T09',status:'failed',outcome:'STORE_ERROR',started_at:'2026-11-27T10:30:00Z',start_delay_seconds:null},
  {id:12,kind:'collect',slot_key:'collect-tick-x',status:'running',outcome:'IN_PROGRESS',started_at:'2026-11-28T08:00:00Z',start_delay_seconds:5});
 const r=verifyPipeline(f);
 assert.equal(r.issueCounts.run_failed,1);assert.equal(r.issueCounts.run_stuck,1);
});
