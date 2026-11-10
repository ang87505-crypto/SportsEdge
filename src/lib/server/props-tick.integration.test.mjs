// Opt-in end-to-end test of the capture tick: PROPS_PG_TEST=1 (root + local PostgreSQL 15+).
// Synthetic TEST identities and provider replies only; nothing here is a genuine observation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pgFetch,psql,resetDb,testClockSql} from './props-pg-kit.mjs';
import {propsStore} from './props-store.ts';
import {runSettle} from './props-cycle.ts';
import {runTick} from './props-tick.ts';
import {captureWindows,planSlates,slateAnchor} from '../props/capture-plan.ts';
import {BUDGET_POLICY_V2} from '../props/budget.ts';

const enabled=process.env.PROPS_PG_TEST==='1';
const schema=name=>new URL('../../../database/props/'+name,import.meta.url).pathname;
const DB='props_tick_it';
let clock='2026-11-05T12:00:00.000Z';
const now=()=>clock;
const model=JSON.parse(readFileSync(new URL('../../data/props/model_v1.json',import.meta.url),'utf8'));

const GAMES=[['BOS','NY','Boston Celtics','New York Knicks'],['MIA','UTAH','Miami Heat','Utah Jazz'],['LAL','DEN','Los Angeles Lakers','Denver Nuggets']];
const PLAYERS={BOS:[['9101','Test Alpha',26,7,5],['9102','Test Bravo',12,9,2]],NY:[['9201','Test Charlie',22,5,7],['9202','Test Delta',9,3,4]],
 MIA:[['9301','Test Echo',24,6,4],['9302','Test Foxtrot',14,10,2]],UTAH:[['9401','Test Golf',20,4,6],['9402','Test Hotel',11,8,1]],
 LAL:[['9501','Test India',28,8,8],['9502','Test Juliet',10,4,3]],DEN:[['9601','Test Kilo',25,11,9],['9602','Test Lima',13,5,2]]};
const eid=(day,g)=>String(401990000+day*10+g);
const startOf=(day,g)=>`2026-11-${String(day+1).padStart(2,'0')}T0${g}:00:00Z`;
function summary(day,g){
 const [h,a]=GAMES[g];
 const team=(abbr,i)=>({team:{abbreviation:abbr},statistics:[{keys:['minutes','points','rebounds','assists'],athletes:PLAYERS[abbr].map(([id,name,p,r,as],k)=>
  ({athlete:{id,displayName:name},didNotPlay:false,stats:[String(30+((day+k+i)%5)),String(p+((day*3+k)%5)-2),String(r+((day+k)%3)-1),String(as+((day+2*k)%3)-1)]}))}]});
 return {header:{id:eid(day,g),competitions:[{id:eid(day,g),date:startOf(day,g),status:{type:{name:'STATUS_FINAL',completed:true,state:'post'}},
  competitors:[{homeAway:'home',team:{abbreviation:h}},{homeAway:'away',team:{abbreviation:a}}]}]},boxscore:{players:[team(h,0),team(a,1)]}};
}
const scoreboard=day=>({events:GAMES.map(([h,a],g)=>({id:eid(day,g),competitions:[{date:startOf(day,g),
 status:{type:{name:'STATUS_FINAL',completed:true,state:'post'}},competitors:[{homeAway:'home',team:{abbreviation:h}},{homeAway:'away',team:{abbreviation:a}}]}]}))});
const finals={};
const espn={
 scoreboard:async d=>{const day=finals[d];return {ok:true,httpStatus:200,body:day===undefined?{events:[]}:scoreboard(day),receivedAt:clock};},
 summary:async id=>{const n=Number(id)-401990000;return {ok:true,httpStatus:200,body:summary(Math.floor(n/10),n%10),receivedAt:clock};},
};
// The ET Nov 12 slate: tip-offs 00:00, 01:00 and 02:00 UTC on Nov 13.
const EV=GAMES.map((x,g)=>({id:'evtTICK0000'+g,commence_time:startOf(12,g),home_team:x[2],away_team:x[3],sport_key:'basketball_nba'}));
const calls={events:[],odds:[]};
const odds={
 events:async w=>{calls.events.push({at:clock,w});return {ok:true,httpStatus:200,body:EV,receivedAt:clock,usage:{remaining:400,used:100,last:0}};},
 eventOdds:async id=>{calls.odds.push({at:clock,id});const e=EV.find(x=>x.id===id);const [h,a]=GAMES[EV.indexOf(e)];
  const mk=(key,shift,over,under)=>({key,markets:[['player_points',2],['player_rebounds',3],['player_assists',4]].map(([m,idx])=>({key:m,last_update:clock,
   outcomes:[...PLAYERS[h],...PLAYERS[a]].flatMap(pl=>{const line=Math.max(0.5,Math.floor(pl[idx]*0.8)+0.5+shift);
    return [{name:'Over',description:pl[1],price:over,point:line,...(key==='pick6'?{multiplier:1}:{})},{name:'Under',description:pl[1],price:under,point:line}];})}))});
  return {ok:true,httpStatus:200,body:{...e,bookmakers:[mk('prizepicks',0,-137,-137),mk('pick6',1,-137,-137),mk('draftkings',0,-150,130),mk('fanduel',1,-110,-110)]},
   receivedAt:clock,usage:{remaining:400-calls.odds.length*3,used:100+calls.odds.length*3,last:3}};},
};

test('capture ticks end to end: plan once, windows, duplicate triggers, rolling budget carryover, picks and entries before lock',
 {skip:!enabled&&'set PROPS_PG_TEST=1 with local PostgreSQL'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'props-tick-'));
 const clockFile=join(dir,'clock.sql');writeFileSync(clockFile,testClockSql);
 resetDb(DB,[schema('props_v1.sql'),schema('props_budget_v2.sql'),schema('props_market_v1.sql'),schema('props_capture_v1.sql'),clockFile]);
 const env={SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'sb_secret_TEST_ONLY_local_key_000'};
 const store=propsStore(env,pgFetch(DB,now));
 const deps={store,odds,espn,model,now,worker:'test:tick',seasonStart:'2026-10-01T00:00:00Z',trigger:'github-schedule'};
 await store.rpc('props_set_control',{p_state:'RUNNING',p_reason:'tick integration test',p_actor:'owner-test'});
 for(const day of [1,2,3,4])finals['202611'+String(day).padStart(2,'0')]=day;
 assert.equal((await runSettle(deps,'backfill-tick',null,{kind:'backfill',dates:['2026-11-01','2026-11-02','2026-11-03','2026-11-04']})).outcome,'COMPLETED');

 const plus=(iso,min)=>new Date(Date.parse(iso)+min*60_000).toISOString();
 // The plan is deterministic: derive the slate's anchored windows to place the ticks (the worker plans for real below).
 const preview=planSlates({events:EV.map(e=>({id:e.id,commenceTime:e.commence_time,homeTeam:e.home_team,awayTeam:e.away_team})),existing:[],nowIso:'2026-11-11T21:00:00Z',policy:BUDGET_POLICY_V2});
 const aw=captureWindows(slateAnchor(preview.find(p=>p.selected),preview));
 const earlyId=preview.find(p=>p.selected&&p.arm==='early').provider_event_id,lateId=preview.find(p=>p.selected&&p.arm==='late').provider_event_id;
 const tickE=plus(aw.earlyFrom,20),tickL1=plus(aw.lateFrom,5),tickL2=plus(aw.lateFrom,50);

 // Yesterday's late collect (the Nov 9->10 shape, 4 credits) is still inside the rolling 24 h window at tickL1 and
 // rolls off at lateFrom + 30 min, before tickL2.
 clock=plus(aw.lateFrom,30-24*60);
 const late=await store.rpc('props_begin_run',{p_kind:'collect',p_slot:'collect-manual-carry',p_worker:'test:carry',p_scheduled_for:null,p_lease_seconds:600});
 await store.rpc('props_reserve_credits',{p_run:late.runId,p_endpoint:'events',p_event:null,p_credits:1});
 await store.rpc('props_reserve_credits',{p_run:late.runId,p_endpoint:'event_odds',p_event:'evtCARRY0001',p_credits:3});
 await store.rpc('props_finish_run',{p_run:late.runId,p_status:'completed',p_outcome:'COMPLETED',p_summary:{}});

 // 1. The evening before: the slate is planned once, outcome-blind, and nothing is spent.
 clock='2026-11-11T21:00:00.000Z';
 const t0=await runTick(deps,'collect-tick-2026-11-11T21:00');
 assert.equal(t0.outcome,'NOTHING_DUE',JSON.stringify(t0.summary));
 assert.equal(calls.odds.length,0);
 assert.equal(calls.events.length,1);
 assert.equal(calls.events[0].w.to,'2026-11-13T09:00:00.000Z');          // free events list, 36 h window
 const plans=JSON.parse(psql(DB,`SELECT json_agg(x ORDER BY x.provider_event_id) FROM (SELECT provider_event_id,selected,arm,reason FROM props_capture_plans) x`).out);
 assert.equal(plans.length,3);
 assert.equal(plans.filter(p=>p.selected).length,2);                    // 7/day and 200/30 d sustain two games
 assert.deepEqual(plans.filter(p=>p.selected).map(p=>[p.provider_event_id,p.arm]).sort(),[[earlyId,'early'],[lateId,'late']].sort());
 assert.equal(psql(DB,'SELECT count(*) FROM props_credit_reservations WHERE run_id='+t0.runId).out,'0');

 // 2. EARLY window: only the EARLY game is captured (carry 4 + 3 = 7 fits), predicted at once, no entry from one game.
 clock=tickE;
 const tA=await runTick(deps,'collect-tick-'+tickE.slice(0,16));
 assert.equal(tA.outcome,'COMPLETED',JSON.stringify(tA.summary));
 assert.deepEqual(calls.odds.map(c=>c.id),[earlyId]);
 assert.equal(tA.summary.captures[0].outcome,'stored');assert.equal(tA.summary.captures[0].window,'early');
 assert.equal(tA.summary.receipt.observations,24);                       // 4 players x 3 stats x 2 platforms
 assert.equal(tA.summary.receipt.predictions,24);                        // predicted in the same run, before lock
 assert.equal(tA.summary.receipt.entriesCreated,0);                      // one game cannot make a two-game entry
 const reasons=Object.values(tA.summary.entries).map(x=>x.noEntryReason);
 assert.ok(reasons.every(r=>['TOO_FEW_DISTINCT_GAMES','NO_QUALIFYING_PICKS'].includes(r)),JSON.stringify(tA.summary.entries));
 assert.equal(psql(DB,'SELECT sum(credits) FROM props_credit_reservations WHERE run_id='+tA.runId).out,'3');

 // 3. A duplicate trigger in the same 30-minute bucket (GitHub + Vercel) is refused before any call.
 assert.equal((await runTick(deps,'collect-tick-'+tickE.slice(0,16))).outcome,'DUPLICATE');
 assert.equal(calls.odds.length,1);

 // 4. LATE window, first tick: the carried-over credits still count, so the LATE game is deferred (never forced).
 clock=tickL1;
 const tL1=await runTick(deps,'collect-tick-'+tickL1.slice(0,16));
 assert.equal(tL1.outcome,'NOTHING_DUE',JSON.stringify(tL1.summary));
 assert.deepEqual(tL1.summary.deferred,[{event:lateId,captureKey:'primary',reason:'DAILY_CAP'}]);
 assert.equal(calls.odds.length,1);
 // 5. A later tick in the same window after the carry rolls off: captured; the EARLY game is still open, so entries form.
 clock=tickL2;
 const tB=await runTick(deps,'collect-tick-'+tickL2.slice(0,16));
 assert.equal(tB.outcome,'COMPLETED',JSON.stringify(tB.summary));
 assert.deepEqual(calls.odds.map(c=>c.id),[earlyId,lateId]);
 assert.ok(tB.summary.receipt.entriesCreated>=1,JSON.stringify(tB.summary.entries));
 const legs=JSON.parse(psql(DB,`SELECT json_agg(x) FROM (SELECT e.id,count(DISTINCT o.provider_event_id) g,count(*) n,bool_and(e.created_at<o.lock_at) pre
  FROM props_entries e JOIN props_entry_legs l ON l.entry_id=e.id JOIN props_picks k ON k.id=l.pick_id JOIN props_predictions p ON p.id=k.prediction_id
  JOIN props_observations o ON o.id=p.observation_id GROUP BY e.id) x`).out);
 assert.ok(legs.every(e=>e.g===2&&e.n===2&&e.pre),'every entry spans two games and was made before lock: '+JSON.stringify(legs));
 // PrizePicks and Pick6 stay separate: every entry's legs come from its own platform.
 assert.equal(psql(DB,`SELECT count(*) FROM props_entries e JOIN props_accounts a ON a.id=e.account_id JOIN props_entry_legs l ON l.entry_id=e.id
  JOIN props_picks k ON k.id=l.pick_id JOIN props_predictions p ON p.id=k.prediction_id JOIN props_observations o ON o.id=p.observation_id
  WHERE o.platform<>a.platform`).out,'0');
 assert.equal(psql(DB,`SELECT sum(credits) FROM props_credit_reservations WHERE run_id IN (${t0.runId},${tA.runId},${tL1.runId},${tB.runId})`).out,'6');
 const outs=JSON.parse(psql(DB,`SELECT json_agg(x) FROM (SELECT c.capture_key,c.window_name,c.fallback,o.outcome,o.provider_cost_last,o.dfs_lines
  FROM props_captures c JOIN props_capture_outcomes o ON o.capture_id=c.id ORDER BY c.id) x`).out);
 assert.deepEqual(outs.map(o=>[o.capture_key,o.window_name,o.fallback,o.outcome,o.provider_cost_last,o.dfs_lines]),
  [['primary','early',false,'stored',3,24],['primary','late',false,'stored',3,24]]);

 // 5. Later ticks: nothing new to capture (no rechecks fit the 7-credit cap) and nothing is re-priced or re-picked.
 const obsBefore=psql(DB,'SELECT count(*) FROM props_observations').out,picksBefore=psql(DB,'SELECT count(*) FROM props_picks').out;
 clock=plus(tickL2,40);
 const tC=await runTick(deps,'collect-tick-'+clock.slice(0,16));
 assert.equal(tC.outcome,'NOTHING_DUE',JSON.stringify(tC.summary));
 // 6. A tick that starts hours late, after tip-off: no paid call for any started game.
 clock='2026-11-13T04:10:00.000Z';
 const tD=await runTick(deps,'collect-tick-2026-11-13T04:00');
 assert.equal(tD.outcome,'NOTHING_DUE');
 assert.equal(calls.odds.length,2);
 assert.equal(psql(DB,'SELECT count(*) FROM props_observations').out,obsBefore);
 assert.equal(psql(DB,'SELECT count(*) FROM props_picks').out,picksBefore);
 // Original lines and predictions are permanent: append-only even for service_role.
 assert.equal(psql(DB,`SET ROLE service_role; UPDATE props_observations SET line=line+1`).ok,false);
 assert.equal(psql(DB,`SET ROLE service_role; DELETE FROM props_capture_plans`).ok,false);
 // The receipts carry the slate state for the dashboard.
 assert.deepEqual(tD.summary.slates['2026-11-12'],{CAPTURED:2,NOT_SELECTED:1});
 const w=captureWindows(EV[0].commence_time);assert.ok(Date.parse(w.lateTo)<Date.parse('2026-11-13T04:10:00Z'));
});
