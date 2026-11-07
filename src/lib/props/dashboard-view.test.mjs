import test from 'node:test';
import assert from 'node:assert/strict';
import {buildView} from './dashboard-view.ts';

// Synthetic TEST rows only.
const raw={nowIso:'2026-11-08T12:00:00Z',control:{state:'RUNNING',reason:'r',changed_at:'2026-11-07T00:00:00Z'},
 runs:[{id:1,kind:'collect',slot_key:'collect-x',status:'completed',outcome:'COMPLETED',started_at:'2026-11-07T19:10:00Z',finished_at:'2026-11-07T19:12:00Z',start_delay_seconds:0,summary:{}},
  {id:2,kind:'settle',slot_key:'settle-x',status:'failed',outcome:'FAILED_X',started_at:'2026-11-08T09:20:00Z',finished_at:'2026-11-08T09:21:00Z',start_delay_seconds:0,summary:{}}],
 credits:[{credits:3,reserved_at:'2026-11-07T19:10:00Z'},{credits:1,reserved_at:'2026-11-01T19:10:00Z'}],providerRemaining:420,
 observations:[1,2,3].map(i=>({id:i,platform:'prizepicks',provider_event_id:'e'+i,home_team:'H',away_team:'A',lock_at:'2026-11-08T00:00:00Z',
  player_name:'P'+i,stat:'points',line:20.5,provider_last_update:'2026-11-07T19:00:00Z',ingested_at:'2026-11-07T19:10:00Z'})),
 predictions:[1,2,3].map(i=>({id:10+i,observation_id:i,model_version:'props-nb-minutes-rate-v1',status:'scored',reason:'ok',p_more:0.65,p_less:0.35,p_tie:0,mean:22})),
 picks:[1,2,3].map(i=>({id:20+i,prediction_id:10+i,status:'recorded',side:'more',reason:'edge_band',selection_version:'props-select-v1'})),
 results:[{observation_id:1,revision:1,outcome:'more',actual:25},{observation_id:2,revision:1,outcome:'void_dnp',actual:null}],
 accounts:[{id:1,slug:'props-prizepicks-v1',platform:'prizepicks',initial_cents:50000,stake_cents:500,max_entries_per_day:3}],
 entries:[{id:7,account_id:1,stake_cents:500,lock_at:'2026-11-08T00:00:00Z',created_at:'2026-11-07T19:11:00Z',payout_terms_version:'t'}],
 legs:[{entry_id:7,pick_id:21},{entry_id:7,pick_id:22}],
 settlements:[{entry_id:7,outcome:'won',wins:1,losses:0,voids:1,return_cents:750,profit_cents:250,settled_at:'2026-11-08T09:00:00Z'}]};

test('accuracy excludes voids and pending; unknown stays unknown',()=>{
 const v=buildView(raw,'prizepicks');
 assert.deepEqual([v.accuracy.graded,v.accuracy.correct,v.accuracy.voided,v.accuracy.pending],[1,1,1,1]);
 assert.equal(v.lines.find(l=>l.id===3).result,null);
 assert.equal(v.bankroll.balanceCents,50250);
 assert.equal(v.automation.lastFailure.outcome,'FAILED_X');
 assert.equal(v.automation.budget.used24h,3);
 assert.equal(v.automation.budget.used30d,4);
});
test('a platform with no rows shows no invented data',()=>{
 const v=buildView(raw,'pick6');
 assert.equal(v.lines.length,0);assert.equal(v.bankroll,null);assert.equal(v.accuracy.hitRate,null);assert.equal(v.entries.length,0);
});
