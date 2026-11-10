// Collection status from the REAL props run ledger of Nov 8-10 2026 (copied from the worker receipts in
// GitHub Actions runs 42532179682, 42546966254, 42739655657, 42753467042, 42892767595), plus synthetic tick rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionStatus} from './collection-status.ts';
import {BUDGET_POLICY_V2} from './budget.ts';
import {CAPTURE_PLAN_V1} from './capture-plan.ts';

const run=(id,slot,status,outcome,started,finished,delay,summary={})=>({id,kind:'collect',slot_key:slot,status,outcome,started_at:started,finished_at:finished,start_delay_seconds:delay,summary});
const RUNS=[
 run(14,'collect-2026-11-10T19','completed','BUDGET_EXHAUSTED','2026-11-10T20:11:29Z','2026-11-10T20:11:29Z',3689,{trigger:'backup-dispatch'}),
 run(11,'collect-2026-11-09T22','completed','BUDGET_EXHAUSTED','2026-11-10T04:04:29Z','2026-11-10T04:04:29Z',21269,{}),
 run(10,'collect-2026-11-09T19','completed','COMPLETED','2026-11-10T02:00:07Z','2026-11-10T02:00:14Z',24607,{plan:{chosen:['3619e1cf4b0a325c3e0ba5b1fb7f3d91']},
  entries:{prizepicks:{room:3,eligiblePicks:18,entries:[],noEntryReason:'TOO_FEW_DISTINCT_GAMES'},pick6:{room:3,eligiblePicks:6,entries:[],noEntryReason:'TOO_FEW_DISTINCT_GAMES'}}}),
 run(7,'collect-2026-11-08T22','completed','BUDGET_EXHAUSTED','2026-11-09T01:42:25Z','2026-11-09T01:42:25Z',12745,{}),
 run(6,'collect-2026-11-08T19','completed','COMPLETED','2026-11-08T22:50:03Z','2026-11-08T22:50:09Z',13203,{plan:{chosen:['a','b']}}),
];
// Reservations as recorded by those runs: 1+3 at 02:00 on Nov 10 (Nov 9 slot), 1+3+3 on Nov 8.
const CREDITS=[{credits:1,reserved_at:'2026-11-10T02:00:08Z'},{credits:3,reserved_at:'2026-11-10T02:00:09Z'},
 {credits:1,reserved_at:'2026-11-08T22:50:04Z'},{credits:3,reserved_at:'2026-11-08T22:50:05Z'},{credits:3,reserved_at:'2026-11-08T22:50:07Z'}];
const base={nowIso:'2026-11-10T21:00:00Z',runs:RUNS,credits:CREDITS,providerRemaining:482,runCounts:{'10':{decisions:36,qualifyingPicks:10,entries:0},'6':{decisions:78,qualifyingPicks:20,entries:3}},
 plans:null,captures:null,policy:BUDGET_POLICY_V2,ticksReleased:false,scheduledRunsEnabled:true,controlState:'RUNNING'};

test('real Nov 9-10 ledger: last success, budget lock-out until 02:00 UTC, late and blocked slots, no-entry reasons',()=>{
 const s=collectionStatus(base);
 assert.equal(s.mode,'slots');
 assert.equal(s.capturesAvailable,false);                     // tables not migrated: unavailable, not zero
 assert.equal(s.lastSuccess.slot,'collect-2026-11-09T19');
 assert.deepEqual([s.budget.used24h,s.budget.remaining24h,s.budget.used30d,s.budget.remaining30d],[4,3,11,189]);
 assert.equal(s.budget.nextRelease.at,'2026-11-11T02:00:08.000Z');  // the 4 late credits block the Nov 10 slate until then
 assert.equal(s.executions[0].delayMinutes,61);
 assert.equal(s.executions.find(e=>e.id===10).delayMinutes,410);
 assert.equal(s.executions.find(e=>e.id===10).qualifyingPicks,10);
 assert.equal(s.executions.find(e=>e.id===10).entries,0);
 assert.ok(s.missing.some(m=>m.when==='2026-11-10T19:10:00.000Z'&&/Rolling 24-hour/.test(m.why)));
 assert.ok(s.missing.some(m=>m.when==='2026-11-09T19:10:00.000Z'&&/410 min late/.test(m.why)));
 assert.deepEqual(s.noEntryReasons.map(r=>[r.platform,r.reason]),[['prizepicks','TOO_FEW_DISTINCT_GAMES'],['pick6','TOO_FEW_DISTINCT_GAMES']]);
 assert.equal(s.next.source,'slot');assert.equal(s.next.at,'2026-11-10T22:10:00.000Z');
 // Stages stay separate: planned slots are not runs, picks are not entries.
 assert.equal(s.stages.recordedPicks,30);assert.equal(s.stages.virtualEntries,3);assert.equal(s.stages.completedJobs,5);assert.ok(s.stages.planned>=1); // last 48 h: Nov 8 (20 picks, 3 entries) + Nov 9 (10, 0)
});

test('nothing planned is shown while the schedule or control is off',()=>{
 assert.equal(collectionStatus({...base,controlState:'PAUSED'}).next,null);
 assert.equal(collectionStatus({...base,scheduledRunsEnabled:false}).next,null);
});

test('tick mode: slates show examined, selected, captured, lines and missed windows; next window opens',()=>{
 const plan=(id,tip,selected,arm)=>({plan_version:CAPTURE_PLAN_V1.version,slate_date:'2026-11-12',provider_event_id:id,home_team:'H'+id,away_team:'A'+id,
  commence_time:tip,selected,selection_rank:1,arm,reason:selected?'selected_by_hash':'budget_games_per_slate',planned_at:'2026-11-11T21:00:00Z'});
 const plans=[plan('evtTICK0001','2026-11-13T00:00:00.000Z',true,'early'),plan('evtTICK0002','2026-11-13T03:00:00.000Z',true,'early'),
  plan('evtTICK0003','2026-11-13T01:00:00.000Z',false,null)];
 const captures=[{run_id:40,provider_event_id:'evtTICK0001',capture_key:'primary',window_name:'early',claimed_at:'2026-11-12T16:10:00.000Z',outcome:'stored',dfs_lines:36,minutes_to_tip:470}];
 const s=collectionStatus({...base,nowIso:'2026-11-12T17:00:00Z',runs:[run(40,'collect-tick-2026-11-12T16:00','completed','COMPLETED','2026-11-12T16:09:00Z','2026-11-12T16:10:30Z',null,
  {trigger:'backup-dispatch',captures:[{outcome:'stored'}]})],credits:[{credits:3,reserved_at:'2026-11-12T16:10:00Z'}],
  runCounts:{'40':{decisions:36,qualifyingPicks:9,entries:0}},plans,captures,ticksReleased:true});
 assert.equal(s.mode,'ticks');
 assert.deepEqual([s.slates[0].gamesExamined,s.slates[0].selected,s.slates[0].captured,s.slates[0].linesObserved,s.slates[0].qualifyingPicks],[3,2,1,36,9]);
 // Windows are anchored to the slate's earliest selected tip (00:00): the 03:00 game is due in the same window.
 assert.equal(s.slates[0].games.find(g=>g.event==='evtTICK0002').state,'DUE');
 assert.equal(s.next.source,'capture-window');assert.equal(s.next.at,'2026-11-12T21:00:00.000Z');assert.match(s.next.what,/LATE window/);
 assert.equal(s.executions[0].gamesCaptured,1);
 assert.equal(s.stages.planned,1);   // the 03:00 game is planned and due, not yet runassert.equal(s.stages.completedJobs,1);assert.equal(s.stages.recordedPicks,9);assert.equal(s.stages.virtualEntries,0);
 // Hours later with no tick: the second game's windows passed -> reported as missed, never as captured.
 const later=collectionStatus({...base,nowIso:'2026-11-13T04:00:00Z',runs:[],credits:[],plans,captures,ticksReleased:true});
 assert.ok(later.missing.some(m=>m.what==='AevtTICK0002 @ HevtTICK0002'&&/No tick ran/.test(m.why)));
});

test('provider-actuals policy shows effective credits and correct next release',()=>{
 const credits=[
  {credits:1,effective_credits:0,reserved_at:'2026-11-10T02:00:08Z'},
  {credits:3,effective_credits:2,reserved_at:'2026-11-10T02:00:09Z'},
  {credits:3,reserved_at:'2026-11-10T02:00:10Z'}, // unknown provider cost still reserved
 ];
 const policy={...BUDGET_POLICY_V2,countsProviderActuals:true};
 const s=collectionStatus({...base,credits,policy});
 assert.deepEqual([s.budget.used24h,s.budget.used30d,s.budget.remaining24h,s.budget.remaining30d],[5,5,2,195]);
 assert.equal(s.budget.countsProviderActuals,true);
 assert.equal(s.budget.nextRelease.at,'2026-11-11T02:00:09.000Z'); // free event doesn't delay the next actual credit release
 assert.equal(s.budget.nextRelease.credits,5);
});
