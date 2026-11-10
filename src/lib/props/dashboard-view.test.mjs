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

// ---- learning layer in the dashboard view (synthetic TEST-ONLY rows)
const L1='props-nb-minutes-rate-v1';
function learnRaw(){
 const r=JSON.parse(JSON.stringify(raw));
 // Line 1 also has an active learn prediction (recorded pick) and a shadow prediction, inserted last.
 r.predictions.push({id:31,observation_id:1,model_version:'props-learn-v1',status:'scored',reason:'ok',p_more:0.7,p_less:0.3,p_tie:0,mean:22,
  inputs:{matchup:{oppAllowedRatio:1.12}}},
  {id:32,observation_id:1,model_version:'props-learn-v2',status:'scored',reason:'ok',p_more:0.2,p_less:0.8,p_tie:0,mean:22,inputs:{}});
 r.picks=r.picks.map(k=>k.prediction_id===11?{...k,prediction_id:31,selection_version:'props-select-v2'}:k);
 r.model={active:'props-learn-v1',previous:L1,learningEnabled:true,autoSwitchEnabled:false,
  weights:{points:[0,0.8,0.6,0,0,0.3,0,0,0],rebounds:[0,1,0,0,0,0,0,0,0],assists:[0,1,0,0,0,0,0,0,0]},
  events:[{id:5,version:'props-learn-v2',event:'shadow_start',reason:'ok',detail:{},at:'2026-11-08T10:00:00Z'},
   {id:4,version:'props-learn-v1',event:'promoted',reason:'gate',detail:{},at:'2026-11-07T10:00:00Z'},
   {id:3,version:'props-learn-v0',event:'dropped',reason:'Worse on held-out data',detail:{},at:'2026-11-06T10:00:00Z'}]};
 r.views=[{observation_id:1,books_at_same_line:2,p_more_books:0.58,line_gap:0,nearest_book_line:20.5,flags:['lagging_line']}];
 r.report={period_from:'2026-11-01',period_to:'2026-11-07',model_version:'props-learn-v1',at:'2026-11-08T10:05:00Z',
  report:{misses:{minutes_collapse:1,books_were_right:0,matchup:0,overconfidence:0,other:0},voidsExcluded:0,overconfidentBands:[]}};
 return r;
}

test('each line shows the active model\'s estimate, never a shadow\'s',()=>{
 const v=buildView(learnRaw(),'prizepicks');
 const l=v.lines.find(x=>x.id===1);
 assert.equal(l.pMore,0.7);
 assert.equal(l.modelVersion,'props-learn-v1');
 assert.equal(l.decision,'recorded');
 // Without a learning model, the stats model's estimate is shown as before.
 assert.equal(buildView(raw,'prizepicks').lines.find(x=>x.id===1).pMore,0.65);
});

test('lines carry the sportsbook view and the matchup note; unknown stays null',()=>{
 const v=buildView(learnRaw(),'prizepicks');
 const l=v.lines.find(x=>x.id===1);
 assert.deepEqual(l.market,{booksAtSameLine:2,pMoreBooks:0.58,lineGap:0,nearestBookLine:20.5,flags:['lagging_line']});
 assert.equal(l.oppAllowedRatio,1.12);
 const other=v.lines.find(x=>x.id===2);
 assert.equal(other.market,null);
 assert.equal(other.oppAllowedRatio,null);
});

test('model summary: active, switches, readable weights and challengers newest first with progress',()=>{
 const m=buildView(learnRaw(),'prizepicks').model;
 assert.deepEqual([m.active,m.previous,m.learningEnabled,m.autoSwitchEnabled],['props-learn-v1',L1,true,false]);
 assert.deepEqual(m.weights.points,{stats:0.8,books:0.6,matchup:0.3});
 assert.deepEqual(m.challengers.map(c=>[c.version,c.state]),[['props-learn-v2','shadow_start'],['props-learn-v1','promoted'],['props-learn-v0','dropped']]);
 assert.equal(m.challengers[0].gradedLines,1,'line 1 graded more; line 2 void; line 3 pending');
 assert.equal(buildView(raw,'prizepicks').model,null);
});

test('the latest weekly review is passed through',()=>{
 assert.equal(buildView(learnRaw(),'prizepicks').report.report.misses.minutes_collapse,1);
 assert.equal(buildView(raw,'prizepicks').report,null);
});

test('review fix: after a switch the dashboard shows the current (v2) accounts, with v1 one tab away',()=>{
 const r=learnRaw();
 r.accounts=[{id:1,slug:'props-prizepicks-v1',platform:'prizepicks',selection_version:'props-select-v1',initial_cents:50000,stake_cents:500,max_entries_per_day:3},
  {id:2,slug:'props-prizepicks-v2',platform:'prizepicks',selection_version:'props-select-v2',initial_cents:50000,stake_cents:500,max_entries_per_day:3}];
 r.entries.push({id:8,account_id:2,stake_cents:500,lock_at:'2026-11-09T00:00:00Z',created_at:'2026-11-08T19:11:00Z',payout_terms_version:'t'});
 const now=buildView(r,'prizepicks');
 assert.equal(now.account.slug,'props-prizepicks-v2');
 assert.deepEqual(now.entries.map(e=>e.id),[8]);
 assert.equal(now.bankroll.balanceCents,50000);
 const v1=buildView(r,'prizepicks',{record:'v1'});
 assert.equal(v1.account.slug,'props-prizepicks-v1');
 assert.equal(v1.bankroll.balanceCents,50250);
 assert.equal(buildView(raw,'prizepicks').account.id,1,'without a learning model nothing changes');
});

test('review fix: the model summary knows when it last trained',()=>{
 const r=learnRaw();
 assert.equal(buildView(r,'prizepicks').model.lastTrainedAt,null);
 r.model.events.push({id:10,version:'props-learn-v3',event:'created',reason:'weekly retrain',detail:{},at:'2026-11-08T10:00:00Z'},
  {id:2,version:'props-learn-v0',event:'created',reason:'weekly retrain',detail:{},at:'2026-11-01T10:00:00Z'});
 assert.equal(buildView(r,'prizepicks').model.lastTrainedAt,'2026-11-08T10:00:00Z');
});
