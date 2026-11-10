// props-capture-v1 planner: slate planning, windows, budget, late ticks and duplicates. Pure; synthetic events only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CAPTURE_PLAN_V1 as CFG,planSlates,dueCaptures,captureState,captureWindows,gamesPerSlate,slateDateOf,slateArm,
 slateFullyVisible,nextWindowOpen,hashUnit} from './capture-plan.ts';
import {BUDGET_POLICY_V2} from './budget.ts';

// The real Nov 10 (ET) slate as listed by ESPN; ids are synthetic.
const NOV10=[['2026-11-11T00:30:00Z','New York Knicks','Milwaukee Bucks'],['2026-11-11T01:00:00Z','Philadelphia 76ers','Boston Celtics'],
 ['2026-11-11T02:00:00Z','Phoenix Suns','LA Clippers'],['2026-11-11T02:00:00Z','Utah Jazz','Miami Heat'],
 ['2026-11-11T03:00:00Z','Sacramento Kings','Orlando Magic'],['2026-11-11T04:00:00Z','Portland Trail Blazers','Oklahoma City Thunder']]
 .map(([t,h,a],i)=>({id:'evtNOV10game'+i,commenceTime:t,homeTeam:h,awayTeam:a}));
const fresh={used24h:0,used30d:0,providerRemaining:480};
const plan=(nowIso,events=NOV10,existing=[],policy=BUDGET_POLICY_V2)=>planSlates({events,existing,nowIso,policy});

test('budget sizes the slate: 7/day and 200/30 days sustain two games, never a pick quota',()=>{
 assert.equal(gamesPerSlate(BUDGET_POLICY_V2),2);                      // min(7, 200/30=6) / 3
 assert.equal(gamesPerSlate({...BUDGET_POLICY_V2,dailyCredits:12,monthlyCredits:400}),4);
 assert.equal(gamesPerSlate({...BUDGET_POLICY_V2,dailyCredits:2}),0);
});

test('slates are ET days and are planned only once the whole slate is visible',()=>{
 assert.equal(slateDateOf('2026-11-11T04:00:00Z'),'2026-11-10');      // 11 pm ET still belongs to Nov 10
 assert.equal(slateFullyVisible('2026-11-10','2026-11-09T19:00:00Z'),false);
 assert.equal(slateFullyVisible('2026-11-10','2026-11-09T20:00:00Z'),true);
 assert.deepEqual(plan('2026-11-09T19:00:00Z'),[]);
 const rows=plan('2026-11-10T09:00:00Z');
 assert.equal(rows.length,6);
 assert.equal(rows.filter(r=>r.selected).length,2);
 const arm=slateArm('2026-11-10');
 for(const r of rows.filter(r=>r.selected))assert.equal(r.arm,arm);   // blocked by slate: entries stay single-arm
 assert.ok(rows.filter(r=>!r.selected).every(r=>r.arm===null&&r.reason==='budget_games_per_slate'));
 // Deterministic and outcome-blind: same events, same plan, regardless of order.
 assert.deepEqual(plan('2026-11-10T09:00:00Z',[...NOV10].reverse()).map(r=>[r.provider_event_id,r.selected]).sort(),rows.map(r=>[r.provider_event_id,r.selected]).sort());
});

test('a slate is never re-planned; late additions are recorded as not selected',()=>{
 const rows=plan('2026-11-10T09:00:00Z').map(r=>({...r,planned_at:'2026-11-10T09:00:00Z'}));
 assert.deepEqual(plan('2026-11-10T15:00:00Z',NOV10,rows),[]);
 const added={id:'evtNOV10late99',commenceTime:'2026-11-11T03:30:00Z',homeTeam:'Golden State Warriors',awayTeam:'Houston Rockets'};
 const more=plan('2026-11-10T15:00:00Z',[...NOV10,added],rows);
 assert.deepEqual(more.map(r=>[r.provider_event_id,r.selected,r.reason]),[['evtNOV10late99',false,'added_after_plan']]);
});

test('planning mid-slate never selects a game that has started or is inside its last window',()=>{
 const rows=plan('2026-11-11T01:40:00Z');                              // 00:30 and 01:00 games already started
 assert.ok(rows.every(r=>Date.parse(r.commence_time)>Date.parse('2026-11-11T01:40:00Z')));
 const early=planSlates({events:NOV10.map(e=>({...e})),existing:[],nowIso:'2026-11-11T01:30:00Z',policy:BUDGET_POLICY_V2});
 const g2=early.find(r=>r.provider_event_id==='evtNOV10game2');      // 02:00 tip, 30 min away < 35-min margin
 assert.equal(g2.selected,false);assert.equal(g2.reason,'too_close_when_planned');
});

test('windows: EARLY 8-4 h before tip, LATE 3 h-35 min, recheck 75-35 min',()=>{
 const w=captureWindows('2026-11-11T00:30:00Z');
 assert.equal(w.earlyFrom,'2026-11-10T16:30:00.000Z');assert.equal(w.earlyTo,'2026-11-10T20:30:00.000Z');
 assert.equal(w.lateFrom,'2026-11-10T21:30:00.000Z');assert.equal(w.lateTo,'2026-11-10T23:55:00.000Z');
});

const mk=(arm,id='evtA00000001',tip='2026-11-11T01:00:00Z')=>({plan_version:CFG.version,slate_date:'2026-11-10',provider_event_id:id,home_team:'H',away_team:'A',
 commence_time:tip,selected:true,selection_rank:1,arm,reason:'selected_by_hash'});

test('due captures follow each game window; a tick between windows or after lock spends nothing',()=>{
 const p=[mk('early')];
 const at=t=>dueCaptures({plans:p,captures:[],nowIso:t,policy:BUDGET_POLICY_V2,state:fresh}).due.map(d=>[d.captureKey,d.window,d.fallback]);
 assert.deepEqual(at('2026-11-10T16:30:00Z'),[]);                       // before 8 h
 assert.deepEqual(at('2026-11-10T17:00:00Z'),[['primary','early',false]]);
 assert.deepEqual(at('2026-11-10T21:00:00Z'),[]);                       // gap between windows
 assert.deepEqual(at('2026-11-10T22:30:00Z'),[['primary','late',true]]);  // missed EARLY falls back, stays labelled EARLY
 assert.deepEqual(at('2026-11-11T00:30:00Z'),[]);                       // 30 min to tip: inside the lock margin
 assert.deepEqual(at('2026-11-11T05:00:00Z'),[]);                       // a tick hours late: started game, no spend
 const late=[mk('late')];
 assert.deepEqual(dueCaptures({plans:late,captures:[],nowIso:'2026-11-10T17:00:00Z',policy:BUDGET_POLICY_V2,state:fresh}).due,[]);
 assert.equal(dueCaptures({plans:late,captures:[],nowIso:'2026-11-10T23:00:00Z',policy:BUDGET_POLICY_V2,state:fresh}).due.length,1);
});

test('duplicate triggers: a claimed capture is never claimed again, and an unknown outcome is never retried',()=>{
 const p=[mk('early')];const now='2026-11-10T17:30:00Z';
 const claimed={provider_event_id:'evtA00000001',capture_key:'primary',window_name:'early',claimed_at:'2026-11-10T17:00:00Z',outcome:null,dfs_lines:null};
 assert.deepEqual(dueCaptures({plans:p,captures:[claimed],nowIso:now,policy:BUDGET_POLICY_V2,state:fresh}).due,[]);
 assert.equal(captureState(p[0],[claimed],now),'ATTEMPT_UNRESOLVED');
 const stored={...claimed,outcome:'stored',dfs_lines:40};
 assert.deepEqual(dueCaptures({plans:p,captures:[stored],nowIso:now,policy:BUDGET_POLICY_V2,state:fresh}).due,[]);
 assert.equal(captureState(p[0],[stored],now),'CAPTURED');
 const failed={...claimed,outcome:'provider_error'};
 assert.deepEqual(dueCaptures({plans:p,captures:[failed],nowIso:'2026-11-10T22:30:00Z',policy:BUDGET_POLICY_V2,state:fresh}).due,[]);
 assert.equal(captureState(p[0],[failed],'2026-11-10T22:30:00Z'),'FAILED');
});

test('no PrizePicks/Pick6 lines yet: one retry, after a wait, only with credits no other game needs',()=>{
 const a=mk('early'),b=mk('early','evtB00000002','2026-11-11T03:00:00Z');
 const empty={provider_event_id:a.provider_event_id,capture_key:'primary',window_name:'early',claimed_at:'2026-11-10T16:10:00Z',outcome:'no_dfs_lines',dfs_lines:0};
 // 7/day cap with 3 already reserved by the empty attempt: b's primary still needs 3, so the retry must wait.
 const r1=dueCaptures({plans:[a,b],captures:[empty],nowIso:'2026-11-10T17:30:00Z',policy:BUDGET_POLICY_V2,state:{...fresh,used24h:3,used30d:3}});
 assert.deepEqual(r1.due,[]);
 assert.deepEqual(r1.deferred,[{event:a.provider_event_id,captureKey:'retry',reason:'DAILY_CAP'}]);
 // With b captured, the retry may use the remaining credits... but 3+3+3 > 7, so it is still refused: never forced.
 const bDone={provider_event_id:b.provider_event_id,capture_key:'primary',window_name:'early',claimed_at:'2026-11-10T18:10:00Z',outcome:'stored',dfs_lines:30};
 assert.deepEqual(dueCaptures({plans:[a,b],captures:[empty,bDone],nowIso:'2026-11-10T22:30:00Z',policy:BUDGET_POLICY_V2,state:{...fresh,used24h:6,used30d:6}}).due,[]);
 // Under a larger cap the retry happens once, in the late window, and is labelled as such.
 const big={...BUDGET_POLICY_V2,dailyCredits:12,monthlyCredits:400};
 const r3=dueCaptures({plans:[a,b],captures:[empty,bDone],nowIso:'2026-11-10T22:30:00Z',policy:big,state:{...fresh,used24h:6,used30d:6}});
 assert.deepEqual(r3.due.map(d=>[d.captureKey,d.window,d.fallback]),[['retry','late',true]]);
 assert.equal(captureState(a,[empty],'2026-11-11T01:00:00Z'),'NO_LINES_FOUND');
});

test('budget: primaries in deadline order until the rolling cap, the rest deferred with the reason',()=>{
 const g=[mk('late','evtG00000001','2026-11-11T01:00:00Z'),mk('late','evtG00000002','2026-11-11T00:30:00Z'),mk('late','evtG00000003','2026-11-11T01:30:00Z')];
 const r=dueCaptures({plans:g,captures:[],nowIso:'2026-11-10T23:00:00Z',policy:BUDGET_POLICY_V2,state:fresh});
 assert.deepEqual(r.due.map(d=>d.plan.provider_event_id),['evtG00000002','evtG00000001']);
 assert.deepEqual(r.deferred,[{event:'evtG00000003',captureKey:'primary',reason:'DAILY_CAP'}]);
 // Yesterday's late spend still inside the rolling window: only one game now; the other stays eligible for a later tick.
 const carry=dueCaptures({plans:g.slice(0,2),captures:[],nowIso:'2026-11-10T23:00:00Z',policy:BUDGET_POLICY_V2,state:{...fresh,used24h:4,used30d:22}});
 assert.equal(carry.due.length,1);
 const floor=dueCaptures({plans:g,captures:[],nowIso:'2026-11-10T23:00:00Z',policy:BUDGET_POLICY_V2,state:{...fresh,providerRemaining:62}});
 assert.deepEqual(floor.due,[]);assert.ok(floor.deferred.every(d=>d.reason==='PROVIDER_FLOOR'));
});

test('recheck (closing observation) only for EARLY captures and only from leftover credits',()=>{
 const a=mk('early');
 const got={provider_event_id:a.provider_event_id,capture_key:'primary',window_name:'early',claimed_at:'2026-11-10T16:30:00Z',outcome:'stored',dfs_lines:38};
 const now='2026-11-11T00:00:00Z';
 assert.deepEqual(dueCaptures({plans:[a],captures:[got],nowIso:now,policy:BUDGET_POLICY_V2,state:{...fresh,used24h:6,used30d:6}}).due,[]);
 const big={...BUDGET_POLICY_V2,dailyCredits:12,monthlyCredits:400};
 assert.deepEqual(dueCaptures({plans:[a],captures:[got],nowIso:now,policy:big,state:{...fresh,used24h:6,used30d:6}}).due.map(d=>d.captureKey),['recheck']);
 const lateCap={...got,window_name:'late',claimed_at:'2026-11-10T22:30:00Z'};
 assert.deepEqual(dueCaptures({plans:[mk('late')],captures:[lateCap],nowIso:now,policy:big,state:fresh}).due,[]);
});

test('states for the dashboard: missed windows are explicit, never shown as captured',()=>{
 const a=mk('early');
 assert.equal(captureState(a,[],'2026-11-10T12:00:00Z'),'WAITING_FOR_WINDOW');
 assert.equal(captureState(a,[],'2026-11-10T17:00:00Z'),'DUE');
 assert.equal(captureState(a,[],'2026-11-11T00:30:00Z'),'MISSED');
 assert.equal(captureState({...a,selected:false,arm:null},[],'2026-11-10T17:00:00Z'),'NOT_SELECTED');
 const n=nextWindowOpen([a],[],'2026-11-10T12:00:00Z');
 assert.equal(n.at,'2026-11-10T17:00:00.000Z');assert.equal(n.window,'early');
 assert.equal(nextWindowOpen([a],[],'2026-11-10T17:30:00Z').window,'late');
});

test('hash assignment is stable and roughly balanced over a season of slates',()=>{
 assert.equal(hashUnit('s','k'),hashUnit('s','k'));
 let early=0;for(let d=0;d<160;d++){const s=new Date(Date.UTC(2026,9,20+d)).toISOString().slice(0,10);if(slateArm(s)==='early')early++;}
 assert.ok(early>55&&early<105,'early slates '+early);
});
