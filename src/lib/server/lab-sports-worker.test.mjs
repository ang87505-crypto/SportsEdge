// Lab forward worker with a fake in-memory store. Synthetic TEST-ONLY data; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runFreeze,runReport,verifyLabArtifact,asOf} from './lab-sports-worker.ts';
import {PropsStoreError} from './props-store.ts';

const lab=JSON.parse(readFileSync(new URL('../../data/lab/sports_ablation_v1.json',import.meta.url),'utf8'));
const model=JSON.parse(readFileSync(new URL('../../data/props/model_v1.json',import.meta.url),'utf8'));

function fakeStore(tables,{missing=false}={}){
 const writes=[];
 const match=(row,query)=>query.split('&').every(part=>{
  const i=part.indexOf('=');const k=part.slice(0,i),v=decodeURIComponent(part.slice(i+1));
  if(['select','order','limit','offset'].includes(k))return true;
  if(v.startsWith('eq.'))return String(row[k])===v.slice(3);
  if(v.startsWith('in.('))return v.slice(4,-1).split(',').map(x=>x.replace(/"/g,'')).includes(String(row[k]));
  if(v.startsWith('gt.'))return String(row[k])>v.slice(3);
  if(v.startsWith('gte.'))return String(row[k])>=v.slice(4);
  return true;
 });
 return {writes,tables,
  async select(table,query){
   if(missing&&table.startsWith('props_lab_'))throw new PropsStoreError('DB_42P01',true);
   const off=Number(/offset=(\d+)/.exec(query)?.[1]??0);if(off)return [];
   return (tables[table]??[]).filter(r=>match(r,query));
  },
  async insert(table,rows){writes.push({table,rows});tables[table]=[...(tables[table]??[]),...rows.map((r,i)=>({id:(tables[table]?.length??0)+i+1,...r}))];return [];},
  async rpc(){throw new Error('no rpc in the lab');}};
}

const NOW='2026-11-14T20:00:00.000Z';
function world(){
 const games=[];
 // Eight prior games for the player and his opponents, all retrieved long before the line was captured.
 for(let i=0;i<8;i++){
  const start=new Date(Date.parse('2026-11-01T00:00:00Z')+i*86400_000).toISOString();
  games.push({id:100+i,espn_event_id:'40199'+i,athlete_id:'1966',team_abbr:'LAL',opponent_abbr:i%2?'BOS':'NYK',game_start:start,game_status:'final',
   did_not_play:false,minutes:i<5?34:22,points:i<5?28:15,rebounds:7,assists:8,revision:1,retrieved_at:new Date(Date.parse(start)+4*3600_000).toISOString()});
 }
 // A late box-score correction retrieved AFTER the capture must be invisible to the frozen forecast.
 games.push({...games[7],id:200,points:60,revision:2,retrieved_at:'2026-11-14T19:00:00.000Z'});
 return {
  props_observations:[{id:1,provider_event_id:'evtTEST1',home_team:'Los Angeles Lakers',away_team:'Boston Celtics',lock_at:'2026-11-15T00:10:00.000Z',
   ingested_at:'2026-11-14T18:00:00.000Z',player_name:'LeBron James',stat:'points',line:24.5}],
  props_predictions:[{id:11,observation_id:1,model_version:'props-nb-minutes-rate-v1',status:'scored',athlete_id:'1966',p_more:0.62,p_less:0.36,p_tie:0.02,mean:26.1,
   inputs:{games:8,expMinutes:30,sdMinutes:6,lastPlayed:'2026-11-08T00:00:00.000Z',team:'LAL'}}],
  props_market_views:[{observation_id:1,p_more_books:0.42}],
  props_picks:[{prediction_id:11,status:'recorded',side:'more'}],
  props_player_games:games,props_line_results:[],
 };
}

test('the committed artifact verifies; a tampered one is refused before anything is written',async()=>{
 assert.equal(verifyLabArtifact(lab),true);
 const bad={...lab,artifact:{...lab.artifact,trainedThrough:'2026-12-01T00:00:00Z'}};
 const s=fakeStore(world());
 assert.equal((await runFreeze({store:s,now:()=>NOW,lab:bad,model,seasonStart:'2026-10-01T00:00:00Z'})).status,'ARTIFACT_INVALID');
 assert.equal(s.writes.length,0);
});
test('not migrated: reports NOT_MIGRATED and writes nothing',async()=>{
 const s=fakeStore(world(),{missing:true});
 assert.equal((await runFreeze({store:s,now:()=>NOW,lab,model,seasonStart:'2026-10-01T00:00:00Z'})).status,'NOT_MIGRATED');
 assert.equal(s.writes.length,0);
});
test('freeze writes every variant and the flags once, only to lab tables, with zero paid requests',async()=>{
 const s=fakeStore(world());
 const d={store:s,now:()=>NOW,lab,model,seasonStart:'2026-10-01T00:00:00Z'};
 const r=await runFreeze(d);
 assert.equal(r.status,'OK');assert.equal(r.paidRequests,0);
 assert.ok(s.writes.every(w=>w.table.startsWith('props_lab_')),'only lab tables');
 const preds=s.tables.props_lab_predictions;
 assert.equal(preds.length,9);
 assert.ok(preds.every(p=>p.data_cutoff==='2026-11-14T18:00:00.000Z'));
 // Without books the market variant equals its no-market sibling; with books (0.42 here) it moves toward the books.
 const v=id=>preds.find(p=>p.variant_id===id).p_more;
 assert.ok(v('base+recalibration+market')<v('base+recalibration'));
 assert.equal(v('base'),0.62);
 const flags=s.tables.props_lab_flags[0].flags;
 assert.ok(flags.includes('books_disagree')&&flags.includes('insufficient_history'));
 // Run again: nothing new is written for an already-frozen line.
 const again=await runFreeze(d);
 assert.equal(again.frozen,0);assert.equal(s.tables.props_lab_predictions.length,9);
});
test('inputs are limited to rows the database held at capture time',()=>{
 const rows=world().props_player_games;
 const seen=asOf(rows,'2026-11-14T18:00:00.000Z');
 assert.equal(seen.find(r=>r.espn_event_id==='401997').points,15);
 assert.equal(asOf(rows,'2026-11-14T19:30:00.000Z').find(r=>r.espn_event_id==='401997').points,60);
});
test('report grades frozen forecasts, keeps collecting below the minimums, and never promotes',async()=>{
 const w=world();const s=fakeStore(w);
 const d={store:s,now:()=>NOW,lab,model,seasonStart:'2026-10-01T00:00:00Z'};
 await runFreeze(d);
 w.props_line_results.push({observation_id:1,revision:1,outcome:'less',actual:20,player_game_id:300});
 w.props_player_games.push({id:300,minutes:12});
 const r=await runReport({...d,now:()=>'2026-11-15T09:30:00.000Z'});
 assert.equal(r.status,'OK');assert.equal(r.graded,1);assert.equal(r.picks,1);assert.equal(r.sampleMinimumsMet,false);
 assert.ok(Object.values(r.layers).every(v=>v==='collecting'||v==='not_tested'));
 const report=s.tables.props_lab_reports[0].report;
 assert.equal(report.promotion.automatic,false);
 assert.equal(report.mistakes.patterns[0].pattern,'minutes_collapse');
 assert.ok(!s.writes.some(x=>x.table==='props_lab_events'&&x.rows.some(e=>e.event==='layer_accepted'||e.event==='layer_rejected')));
});
