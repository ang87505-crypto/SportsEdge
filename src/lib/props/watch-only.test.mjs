import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {watchOnlyLedger} from './watch-only.ts';

const AS_OF='2026-11-14T20:00:00.000Z';
const ob=(id,event='nba-100',player='Sample One',over={})=>({
 id,platform:'prizepicks',provider_event_id:event,home_team:'Denver Nuggets',away_team:'New York Knicks',
 lock_at:'2026-11-12T23:00:00.000Z',player_name:player,stat:'rebounds',line:8.5,
 provider_last_update:'2026-11-12T19:00:00.000Z',
 ingested_at:'2026-11-12T19:01:00.000Z',recorded_at:'2026-11-12T19:01:10.000Z',...over
});
const pr=(id,observation_id=id,more=.65,less=.35,tie=0,over={})=>({
 id,observation_id,model_version:'props-nb-minutes-rate-v1',status:'scored',athlete_id:String(900+id),
 p_more:more,p_less:less,p_tie:tie,data_cutoff:'2026-11-12T19:00:00.000Z',
 predicted_at:'2026-11-12T19:01:20.000Z',...over
});
const gr=(observation_id,outcome='more',actual=10,revision=1,graded_at='2026-11-13T03:00:00.000Z')=>({
 observation_id,outcome,actual,revision,graded_at
});
const raw=(observations,predictions,results=[])=>({
 nowIso:AS_OF,windowStart:'2026-10-01T00:00:00Z',control:{state:'RUNNING',reason:'TEST_ONLY'},
 observations,predictions,results,picks:[],entryLegs:[]
});

test('Watch Only includes every archived valid line, including low-confidence and unscorable ones',()=>{
 const rows=[ob(1),ob(2,'nba-200','Sample Two'),ob(3,'nba-300','No History')];
 const l=watchOnlyLedger(raw(rows,[pr(1),pr(2,2,.56,.44)] ,[gr(1),gr(2,'less',5)]));
 assert.equal(l.rows.length,3);
 assert.equal(l.report(0).uniqueLines,3);
 assert.equal(l.report(.60).uniqueLines,1);
 assert.equal(l.report(0).wins,1);
 assert.equal(l.report(0).losses,1);
 assert.equal(l.report(0).unscored,1);
 assert.equal(l.report(0).winRate,.5);
 const unscored=l.rows.find(r=>r.player==='No History');
 assert.equal(unscored?.status,'unscorable');
 assert.equal(unscored?.probability,null);
 assert.equal(unscored?.outcome,'unscored');
 assert.equal(l.rows.every(r=>r.source==='the_odds_api'),true);
 assert.equal(l.rows.every(r=>!Object.hasOwn(r,'stakeCents')&&!Object.hasOwn(r,'hypotheticalNetCents')&&
  !Object.hasOwn(r,'profit')&&!Object.hasOwn(r,'entryId')),true);
});
test('same line on PrizePicks and Pick6 remains visible twice but never inflates accuracy',()=>{
 const first=ob(1);
 const duplicate=ob(2,'nba-100','Sample One',{platform:'pick6',recorded_at:'2026-11-12T19:02:10.000Z',ingested_at:'2026-11-12T19:02:00.000Z'});
 const x=watchOnlyLedger(raw([first,duplicate],[pr(1),pr(2,2,.75,.25,0,{predicted_at:'2026-11-12T19:02:20.000Z'})],[gr(1),gr(2)]));
 assert.equal(x.rows.length,2);
 assert.equal(x.report(0).lines,2);
 assert.equal(x.report(0).uniqueLines,1);
 assert.equal(x.report(0).wins,1);
 assert.equal(x.report(0,undefined,'pick6').uniqueLines,1);
 assert.equal(x.report(0,undefined,'pick6').wins,1);
 assert.equal(x.filter(.70).length,1);
});
test('grade corrections after the game replace old results and future grades stay unknown',()=>{
 const r=raw([ob(1)],[pr(1)],[gr(1),gr(1,'less',6,2,'2026-11-13T04:00:00Z')]);
 const changed=watchOnlyLedger(r);
 assert.equal(changed.rows[0].outcome,'loss');
 assert.equal(changed.rows[0].actual,6);
 const future=watchOnlyLedger(raw([ob(1)],[pr(1)],[gr(1,'more',10,1,'2026-11-20T00:00:00Z')]));
 assert.equal(future.rows[0].outcome,'pending');
 assert.equal(future.report(0).winRate,null);
 const inconsistent=watchOnlyLedger(raw([ob(1)],[pr(1)],[gr(1,'more',6)]));
 assert.equal(inconsistent.rows[0].outcome,'pending');
});
test('pending is not a loss; ties and voids do not affect directional win rate',()=>{
 const os=[ob(1),ob(2,'nba-200','Second'),ob(3,'nba-300','Third'),ob(4,'nba-400','Fourth')];
 const ps=os.map((o,i)=>pr(i+1,i+1,.65,.35,0,{athlete_id:String(1000+i)}));
 const x=watchOnlyLedger(raw(os,ps,[gr(1),gr(2,'tie',8.5),gr(3,'void_dnp',null)]));
 assert.deepEqual(x.rows.map(y=>y.outcome).sort(),['pending','push','push','win']);
 const t=x.report(0);
 assert.equal(t.wins,1);assert.equal(t.losses,0);assert.equal(t.pushes,2);assert.equal(t.pending,1);
 assert.equal(t.winRate,1);
});
test('daily accuracy changes with valid grades only and never with future outcomes',()=>{
 const first=ob(1),later=ob(2,'nba-200','Second',{
  lock_at:'2026-11-13T23:00:00Z',
  provider_last_update:'2026-11-13T19:00:00.000Z',ingested_at:'2026-11-13T19:01:00.000Z',recorded_at:'2026-11-13T19:01:10.000Z'
 });
 const p2=pr(2,2,.65,.35,0,{data_cutoff:'2026-11-13T19:00:00.000Z',predicted_at:'2026-11-13T19:01:20.000Z'});
 const d=raw([first,later],[pr(1),p2],[gr(1),gr(2,'less',6,1,'2026-11-14T04:00:00Z')]);
 const done=watchOnlyLedger(d).impact(.60,'2026-11-13');
 assert.equal(done.before.winRate,1);
 assert.equal(done.daily.winRate,0);
 assert.equal(done.through.winRate,.5);
 assert.equal(done.deltaPercentagePoints,-50);
 const pending=watchOnlyLedger({...d,results:[gr(1)]}).impact(.60,'2026-11-13');
 assert.equal(pending.daily.pending,1);
 assert.equal(pending.through.winRate,1);
 assert.equal(pending.deltaPercentagePoints,0);
});
test('historical or malformed records cannot be forged into pregame predictions',()=>{
 const late=ob(1,'nba-100','Sample One',{recorded_at:'2026-11-12T22:55:00.000Z'});
 const old=ob(2,'nba-200','Old',{provider_last_update:'2026-11-12T15:00:00.000Z'});
 const future=ob(3,'nba-300','Future',{ingested_at:'2026-11-20T19:01:00.000Z',recorded_at:'2026-11-20T19:01:10.000Z'});
 const validObs=ob(4,'nba-400','Valid');
 const pFuture=pr(4,4,.65,.35,0,{predicted_at:'2026-11-20T19:01:20.000Z'});
 const x=watchOnlyLedger(raw([late,old,future,validObs],[pr(1),pr(2),pr(3),pFuture]));
 assert.equal(x.invalidRows,3);
 assert.equal(x.rows.length,1);
 assert.equal(x.rows[0].status,'unscorable');
 assert.equal(x.report(0).winRate,null);
 assert.throws(()=>watchOnlyLedger(raw([],[]),'invalid clock'),/WATCH_INVALID_AS_OF/);
 assert.throws(()=>x.filter(-.5),/WATCH_BAD_THRESHOLD/);
 assert.throws(()=>x.filter(1.01),/WATCH_BAD_THRESHOLD/);
 assert.throws(()=>x.impact(.60,'tomorrow'),/WATCH_BAD_DATE/);
});
test('Watch Only source has no provider, write, entry, scraping or staking operation',()=>{
 const code=readFileSync(new URL('./watch-only.ts',import.meta.url),'utf8');
 assert.doesNotMatch(code,/\bfetch\s*\(|\bstore\.(insert|update|upsert|delete)\s*\(/);
 assert.doesNotMatch(code,/\b(recordEntries|buildEntries|placeBet|submitBet|callOddsApi)\s*\(/);
});
