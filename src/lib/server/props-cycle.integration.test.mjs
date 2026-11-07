// Opt-in end-to-end test: PROPS_PG_TEST=1 (root + local PostgreSQL 15+).
// Synthetic TEST identities and provider replies only; nothing here is a genuine observation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pgFetch,psql,resetDb,testClockSql} from './props-pg-kit.mjs';
import {propsStore} from './props-store.ts';
import {runCollect,runSettle} from './props-cycle.ts';

const enabled=process.env.PROPS_PG_TEST==='1';
const DB='props_it';
let clock='2026-11-05T12:00:00.000Z';
const now=()=>clock;
const model=JSON.parse(readFileSync(new URL('../../data/props/model_v1.json',import.meta.url),'utf8'));

// Three synthetic fixtures replayed nightly; two players per team.
const GAMES=[['BOS','NY','Boston Celtics','New York Knicks'],['MIA','UTAH','Miami Heat','Utah Jazz'],['LAL','DEN','Los Angeles Lakers','Denver Nuggets']];
const PLAYERS={BOS:[['9101','Test Alpha',26,7,5],['9102','Test Bravo',12,9,2]],NY:[['9201','Test Charlie',22,5,7],['9202','Test Delta',9,3,4]],
 MIA:[['9301','Test Echo',24,6,4],['9302','Test Foxtrot',14,10,2]],UTAH:[['9401','Test Golf',20,4,6],['9402','Test Hotel',11,8,1]],
 LAL:[['9501','Test India',28,8,8],['9502','Test Juliet',10,4,3]],DEN:[['9601','Test Kilo',25,11,9],['9602','Test Lima',13,5,2]]};
const eid=(day,g)=>String(401990000+day*10+g);
const startOf=(day,g)=>`2026-11-${String(day+1).padStart(2,'0')}T0${g}:00:00Z`; // ET evening of `day`
function summary(day,g,{dnp=null,bump=0}={}){
 const [h,a]=GAMES[g];
 const team=(abbr,i)=>({team:{abbreviation:abbr},statistics:[{keys:['minutes','points','rebounds','assists'],athletes:PLAYERS[abbr].map(([id,name,p,r,as],k)=>
  id===dnp?{athlete:{id,displayName:name},didNotPlay:true,reason:'TEST DNP',stats:[]}:
  {athlete:{id,displayName:name},didNotPlay:false,stats:[String(30+((day+k+i)%5)),String(p+((day*3+k)%5)-2+bump),String(r+((day+k)%3)-1),String(as+((day+2*k)%3)-1)]})}]});
 return {header:{id:eid(day,g),competitions:[{id:eid(day,g),date:startOf(day,g),status:{type:{name:'STATUS_FINAL',completed:true,state:'post'}},
  competitors:[{homeAway:'home',team:{abbreviation:h}},{homeAway:'away',team:{abbreviation:a}}]}]},boxscore:{players:[team(h,0),team(a,1)]}};
}
function scoreboard(day){return {events:GAMES.map(([h,a],g)=>({id:eid(day,g),competitions:[{date:startOf(day,g),
 status:{type:{name:'STATUS_FINAL',completed:true,state:'post'}},competitors:[{homeAway:'home',team:{abbreviation:h}},{homeAway:'away',team:{abbreviation:a}}]}]}))};}
const finals={};  // yyyymmdd -> day index with stored finals
const overrides={};
const espn={
 scoreboard:async d=>{const day=finals[d];return day===undefined?{ok:true,httpStatus:200,body:{events:[]},receivedAt:clock}:{ok:true,httpStatus:200,body:scoreboard(day),receivedAt:clock};},
 summary:async id=>{const n=Number(id)-401990000;const day=Math.floor(n/10),g=n%10;return {ok:true,httpStatus:200,body:summary(day,g,overrides[id]??{}),receivedAt:clock};},
};
// Provider: events for the evening of Nov 7 (ET), DFS lines near each player's mean.
const EV=GAMES.map((x,g)=>({id:'evtTEST00000'+g,commence_time:startOf(7,g),home_team:x[2],away_team:x[3],sport_key:'basketball_nba'}));
let oddsCalls=0;
const odds={
 events:async()=>{oddsCalls++;return {ok:true,httpStatus:200,body:EV,receivedAt:clock,usage:{remaining:400,used:100,last:1}};},
 eventOdds:async id=>{oddsCalls++;const e=EV.find(x=>x.id===id);const g=EV.indexOf(e);const [h,a]=GAMES[g];
  const book=(key,shift)=>({key,markets:[['player_points',2],['player_rebounds',3],['player_assists',4]].map(([m,idx])=>({key:m,last_update:clock,
   outcomes:[...PLAYERS[h],...PLAYERS[a]].flatMap(pl=>{const line=Math.max(0.5,Math.floor(pl[idx]*0.8)+0.5+shift);
    return [{name:'Over',description:pl[1],price:-137,point:line,...(key==='pick6'?{multiplier:1}:{})},{name:'Under',description:pl[1],price:-137,point:line}];})}))});
  return {ok:true,httpStatus:200,body:{...e,bookmakers:[book('prizepicks',0),book('pick6',1)]},receivedAt:clock,usage:{remaining:400-oddsCalls*3,used:100+oddsCalls*3,last:3}};},
};

test('daily cycle end to end against the real schema',{skip:!enabled&&'set PROPS_PG_TEST=1 with local PostgreSQL'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'props-it-'));
 const clockFile=join(dir,'clock.sql');writeFileSync(clockFile,testClockSql);
 resetDb(DB,[new URL('../../../database/props/props_v1.sql',import.meta.url).pathname,clockFile]);
 const env={SPORTSEDGE_PROPS_SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co',SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:'sb_secret_TEST_ONLY_local_key_000'};
 const store=propsStore(env,pgFetch(DB,now));
 const deps={store,odds,espn,model,now,worker:'test:1',seasonStart:'2026-10-01T00:00:00Z'};

 // Paused by default: nothing runs and no provider call is made.
 const paused=await runCollect(deps,'collect-2026-11-05T12',null);
 assert.equal(paused.outcome,'CONTROL_PAUSED');assert.equal(oddsCalls,0);
 await store.rpc('props_set_control',{p_state:'RUNNING',p_reason:'integration test',p_actor:'owner-test'});

 // Backfill four nights of synthetic finals (player logs).
 for(const day of [1,2,3,4])finals['202611'+String(day).padStart(2,'0')]=day;
 const bf=await runSettle(deps,'backfill-test',null,{kind:'backfill',dates:['2026-11-01','2026-11-02','2026-11-03','2026-11-04']});
 assert.equal(bf.outcome,'COMPLETED');
 assert.equal(bf.summary.boxScores.newRows,48);

 // Collect on Nov 7, started 3 hours late relative to its slot.
 clock='2026-11-07T19:00:00.000Z';
 const c=await runCollect(deps,'collect-2026-11-07T16',`2026-11-07T16:00:00.000Z`);
 assert.equal(c.outcome,'COMPLETED',JSON.stringify(c.summary));
 assert.equal(c.summary.startDelaySeconds,10800);
 assert.equal(c.summary.plan.chosen.length,3);                  // 1 + 3x3 = 10 credits <= 12/day
 assert.equal(c.summary.receipt.observations,72);               // 12 players x 3 stats x 2 platforms
 assert.equal(c.summary.receipt.predictions,72);
 assert.equal(c.summary.predictions.scored,72,JSON.stringify(c.summary.predictions));
 const pp=c.summary.entries.prizepicks,p6=c.summary.entries.pick6;
 assert.ok(pp.entries.length>=1&&p6.entries.length>=1,JSON.stringify(c.summary.entries));
 const legs=JSON.parse(psql(DB,`SELECT json_agg(x) FROM (SELECT e.id,count(DISTINCT o.provider_event_id) g,count(*) n FROM props_entries e
  JOIN props_entry_legs l ON l.entry_id=e.id JOIN props_picks k ON k.id=l.pick_id JOIN props_predictions p ON p.id=k.prediction_id
  JOIN props_observations o ON o.id=p.observation_id GROUP BY e.id) x`).out);
 assert.ok(legs.every(e=>e.g===e.n&&e.n===2),'every entry spans distinct games');

 // Same slot again: idempotent. Another slot the same day: games already collected, no new paid odds calls.
 assert.equal((await runCollect(deps,'collect-2026-11-07T16',null)).outcome,'DUPLICATE');
 const before=oddsCalls;
 clock='2026-11-07T21:00:00.000Z';
 const again=await runCollect(deps,'collect-2026-11-07T21',null);
 assert.equal(again.outcome,'BUDGET_EXHAUSTED');                // 10 used; 1+3 more would exceed 12
 assert.equal(oddsCalls,before);

 // Settle after the games, with one DNP and one later stat correction.
 finals['20261107']=7;overrides[String(401990000+70)]={dnp:'9102'};
 clock='2026-11-08T07:00:00.000Z';
 const s=await runSettle(deps,'settle-2026-11-08T07',null);
 assert.equal(s.outcome,'COMPLETED',JSON.stringify(s.summary));
 assert.equal(s.summary.grading.newResults,72);
 assert.ok((s.summary.grading.graded.void_dnp??0)===6,'one DNP player voids his 3 stats on both platforms');
 const st=JSON.parse(psql(DB,`SELECT json_agg(x) FROM (SELECT a.platform,s.outcome,s.return_cents,s.profit_cents,s.wins,s.losses,s.voids
  FROM props_entry_settlements s JOIN props_entries e ON e.id=s.entry_id JOIN props_accounts a ON a.id=e.account_id) x`).out);
 assert.ok(st.length>=2);
 for(const x of st){
  if(x.platform==='pick6'){assert.equal(x.outcome,'payout_unknown');assert.equal(x.return_cents,null);}
  else assert.equal(x.profit_cents,x.return_cents-500);
 }
 // A later correction appends revisions; settlements are not rewritten.
 overrides[String(401990000+71)]={bump:7};
 clock='2026-11-08T15:00:00.000Z';
 const s2=await runSettle(deps,'settle-2026-11-08T15',null);
 assert.equal(s2.outcome,'COMPLETED');
 assert.ok(s2.summary.boxScores.corrections>0);
 assert.equal(psql(DB,'SELECT count(*) FROM props_entry_settlements').out,String(st.length));
 assert.ok(Number(psql(DB,'SELECT count(*) FROM props_line_results WHERE revision>1').out)>0);

 // Interrupted run: a run that never finishes is recovered by the next start after its lease.
 const zombie=await store.rpc('props_begin_run',{p_kind:'collect',p_slot:'collect-zombie',p_worker:'test:z',p_scheduled_for:null,p_lease_seconds:60});
 assert.equal(zombie.outcome,'STARTED');
 clock='2026-11-08T15:05:00.000Z';
 const next=await runCollect(deps,'collect-2026-11-08T15',null);
 assert.equal(next.summary.abandonedRecovered,1);
 assert.equal(psql(DB,`SELECT status FROM props_runs WHERE slot_key='collect-zombie'`).out,'abandoned');
});
