import test from 'node:test';
import assert from 'node:assert/strict';
import {buildView} from './dashboard-view.ts';
import {propsSummary,mtShort} from './summary.ts';

// Synthetic TEST rows only.
const obs=(id,lock)=>({id,platform:'prizepicks',provider_event_id:'e'+id,home_team:'H',away_team:'A',lock_at:lock,
 player_name:'P'+id,stat:'points',line:20.5,provider_last_update:'2026-11-08T18:00:00Z',ingested_at:'2026-11-08T18:05:00Z'});
const raw={nowIso:'2026-11-08T20:00:00Z',control:{state:'RUNNING',reason:'r',changed_at:'2026-11-07T00:00:00Z'},runs:[],credits:[],providerRemaining:null,
 observations:[obs(1,'2026-11-08T00:00:00Z'),obs(2,'2026-11-08T00:00:00Z'),obs(3,'2026-11-09T00:30:00Z'),obs(4,'2026-11-09T01:00:00Z')],
 predictions:[[1,0.65],[2,0.3],[3,0.62],[4,0.25]].map(([i,p])=>({id:10+i,observation_id:i,model_version:'m',status:'scored',reason:'ok',p_more:p,p_less:1-p,p_tie:0,mean:20})),
 picks:[1,2,3,4].map(i=>({id:20+i,prediction_id:10+i,status:'recorded',side:i===2||i===4?'less':'more',reason:'edge_band',selection_version:'v'})),
 results:[{observation_id:1,revision:1,outcome:'more',actual:25},{observation_id:2,revision:1,outcome:'more',actual:23}],
 accounts:[{id:1,slug:'props-prizepicks-v1',platform:'prizepicks',initial_cents:50000,stake_cents:500,max_entries_per_day:3}],
 entries:[{id:7,account_id:1,stake_cents:500,lock_at:'2026-11-08T00:00:00Z',created_at:'2026-11-07T19:11:00Z',payout_terms_version:'t'},
  {id:8,account_id:1,stake_cents:500,lock_at:'2026-11-09T00:30:00Z',created_at:'2026-11-08T19:11:00Z',payout_terms_version:'t'}],
 legs:[{entry_id:7,pick_id:21},{entry_id:7,pick_id:22},{entry_id:8,pick_id:23},{entry_id:8,pick_id:24}],
 settlements:[{entry_id:7,outcome:'lost',wins:1,losses:1,voids:0,return_cents:0,profit_cents:-500,settled_at:'2026-11-08T09:00:00Z'}]};

test('headline numbers come only from settled, known results',()=>{
 const s=propsSummary(buildView(raw,'prizepicks'));
 assert.equal(s.balanceCents,49500);
 assert.equal(s.netCents,-500);
 assert.equal(s.roi,-1);
 assert.deepEqual(s.record,{won:0,lost:1,refund:0,unknown:0});
 assert.equal(s.openEntries,1);
 assert.equal(s.hitRate,0.5);
});
test('upcoming picks exclude locked games and rank by the chosen side probability',()=>{
 const s=propsSummary(buildView(raw,'prizepicks'));
 assert.deepEqual(s.upcoming.map(p=>[p.id,p.side,Math.round(p.probability*100)]),[[4,'less',75],[3,'more',62]]);
});
test('a platform with no account shows unknown, not zero',()=>{
 const s=propsSummary(buildView(raw,'pick6'));
 assert.equal(s.balanceCents,null);assert.equal(s.netCents,null);assert.equal(s.roi,null);assert.equal(s.hitRate,null);
 assert.equal(s.upcoming.length,0);
});
test('Mountain time handles missing and daylight-saving dates',()=>{
 assert.equal(mtShort(null),'—');
 assert.match(mtShort('2026-11-08T19:10:00Z'),/12:10 PM MST/);
 assert.match(mtShort('2026-10-08T19:10:00Z'),/1:10 PM MDT/);
});
