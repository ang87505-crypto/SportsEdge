import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const script=fileURLToPath(new URL('./props-watch-replay.ts',import.meta.url));
const at='2026-11-14T20:00:00.000Z';
const observation=(id,over={})=>({id,platform:'prizepicks',provider_event_id:'nba-'+id,
 home_team:'Test Home',away_team:'Test Away',player_name:'Synthetic Player '+id,stat:'rebounds',line:8.5,
 lock_at:'2026-11-12T23:00:00Z',provider_last_update:'2026-11-12T19:00:00Z',
 ingested_at:'2026-11-12T19:01:00Z',recorded_at:'2026-11-12T19:01:10Z',...over});
const prediction=(id,over={})=>({id,observation_id:id,model_version:'props-nb-minutes-rate-v1',status:'scored',
 athlete_id:String(1000+id),p_more:.65,p_less:.35,p_tie:0,
 data_cutoff:'2026-11-12T19:00:00Z',predicted_at:'2026-11-12T19:01:20Z',...over});
const grade=(observation_id,outcome,actual,revision=1,graded_at='2026-11-13T03:00:00Z')=>({
 observation_id,outcome,actual,revision,graded_at});
function fixture(){
 const first=observation(1);
 return {nowIso:at,windowStart:'2026-10-01T00:00:00Z',control:{state:'PAUSED',reason:'SYNTHETIC_TEST_ONLY'},
  observations:[first,...[2,3,4,5,6,7].map(id=>observation(id,id===3?{line:8}:{})),
   {...first,id:8,platform:'pick6',ingested_at:'2026-11-12T19:03:00Z',recorded_at:'2026-11-12T19:03:10Z'},
   {...first,id:9,provider_last_update:'2026-11-12T19:03:00Z',ingested_at:'2026-11-12T19:04:00Z',recorded_at:'2026-11-12T19:04:10Z'}],
  predictions:[...[1,2,3,4,5,6].map(id=>prediction(id)),prediction(7,{status:'unscorable',athlete_id:null,p_more:null,p_less:null,p_tie:null}),
   prediction(8,{predicted_at:'2026-11-12T19:03:20Z',p_more:.75,p_less:.25}),
   prediction(9,{predicted_at:'2026-11-12T19:04:20Z',p_more:.90,p_less:.10})],
  results:[grade(1,'more',10),grade(1,'less',6,2,'2026-11-13T04:00:00Z'),grade(2,'more',10),
   grade(3,'tie',8),grade(4,'void_dnp',null),grade(5,'void_postponed',null,1,'2026-11-14T13:00:00Z'),
   grade(7,'more',10),grade(8,'more',10),grade(8,'less',6,2,'2026-11-13T04:00:00Z')],picks:[],entryLegs:[]};
}
// Block every HTTP transport before importing the real CLI. Test data and file IO stay local.
const harness=String.raw`
 import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';
 let network=0;const refuse=()=>{network++;throw new Error('SYNTHETIC_NETWORK_REFUSED');};
 globalThis.fetch=refuse;http.request=refuse;http.get=refuse;https.request=refuse;https.get=refuse;syncBuiltinESMExports();
 process.argv=[process.execPath,process.env.REPLAY_TEST_SCRIPT,...JSON.parse(process.env.REPLAY_TEST_ARGS)];
 await import(process.env.REPLAY_TEST_SCRIPT);
 console.error('REPLAY_TEST_NETWORK_CALLS='+network);
`;
function withSnapshot(data,run){
 const dir=mkdtempSync(join(tmpdir(),'sportsedge-watch-replay-')),path=join(dir,'snapshot.json');
 try{writeFileSync(path,typeof data==='string'?data:JSON.stringify(data));return run(path);}finally{rmSync(dir,{recursive:true,force:true});}
}
function cli(args){
 const result=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings','--input-type=module','-e',harness],
  {encoding:'utf8',timeout:10_000,env:{...process.env,REPLAY_TEST_SCRIPT:script,REPLAY_TEST_ARGS:JSON.stringify(args)}});
 assert.ifError(result.error);assert.match(result.stderr,/REPLAY_TEST_NETWORK_CALLS=0/);
 return {status:result.status,out:result.stdout,err:result.stderr,
  report:result.stdout.trim()?JSON.parse(result.stdout):null};
}
test('offline replay keeps source lines, pending/void outcomes and original probabilities without a provider or write',()=>{
 withSnapshot(fixture(),path=>{
  const before=readFileSync(path),x=cli(['--input',path]),r=x.report;
  assert.equal(x.status,0,x.err);assert.equal(r.status,'REPLAYED');assert.equal(r.readOnly,true);
  assert.equal(r.inputSha256,createHash('sha256').update(before).digest('hex'));
  assert.equal(r.providerRequests,0);assert.equal(r.databaseRequests,0);assert.equal(r.ledgerWrites,0);
  assert.equal(r.sourceCounts.observations,9);assert.equal(r.rows.length,8);assert.equal(r.totals.uniqueLines,7);
  assert.equal(r.duplicateSnapshotsExcluded,1);assert.equal(r.totals.wins,1);assert.equal(r.totals.losses,1);
  assert.equal(r.totals.pushes,3);assert.equal(r.totals.pending,1);assert.equal(r.totals.unscored,1);
  assert.equal(r.totals.winRate,.5);assert.equal(r.atLeast60.uniqueLines,6);
  assert.deepEqual(r.gradeKinds,{ties:1,voids:2,voidDnp:1,voidPostponed:1});
  assert.equal(r.byPlatform.pick6.uniqueLines,1);assert.equal(r.byPlatform.pick6.losses,1);
  assert.equal(r.rows.find(row=>row.observationId===1).probability,.65);
  assert.equal(r.rows.find(row=>row.observationId===1).gradeRevision,2);
  assert.equal(r.rows.some(row=>row.observationId===9),false);
  assert.doesNotMatch(x.out,/"(?:stakeCents|profitCents|returnCents|entryId)"/);
  assert.equal(cli(['--input',path]).out,x.out,'same bytes and clock must reproduce the exact receipt');
  assert.deepEqual(readFileSync(path),before);
 });
});
test('an earlier clock sees the original grade; a later correction never rewrites its forecast or input',()=>{
 withSnapshot(fixture(),path=>{
  const earlier=cli(['--input',path,'--as-of','2026-11-13T03:30:00Z']).report;
  const later=cli(['--input',path]).report;
  const a=earlier.rows.find(row=>row.observationId===1),b=later.rows.find(row=>row.observationId===1);
  assert.equal(a.outcome,'win');assert.equal(a.gradeRevision,1);assert.equal(a.gradeOutcome,'more');
  assert.equal(b.outcome,'loss');assert.equal(b.gradeRevision,2);assert.equal(b.gradeOutcome,'less');
  assert.equal(a.probability,b.probability);assert.equal(a.predictedAt,b.predictedAt);
  assert.equal(earlier.inputSha256,later.inputSha256);assert.equal(earlier.totals.wins,2);
  assert.equal(earlier.gradeKinds.voidPostponed,0);assert.equal(earlier.totals.pending,2);
 });
});
test('before lock, future grades remain pending and produce no losses or accuracy',()=>{
 withSnapshot(fixture(),path=>{
  const x=cli(['--input',path,'--as-of','2026-11-12T20:00:00Z']);assert.equal(x.status,0,x.err);
  assert.equal(x.report.totals.pending,6);assert.equal(x.report.totals.graded,0);
  assert.equal(x.report.totals.losses,0);assert.equal(x.report.totals.winRate,null);
 });
});
test('a clock outside the declared retained snapshot window is refused rather than fetching missing history',()=>{
 withSnapshot(fixture(),path=>{
  for(const at of ['2026-11-15T00:00:00Z','2026-09-30T23:00:00Z','not-a-date']){
   const x=cli(['--input',path,'--as-of',at]);assert.equal(x.status,2);assert.equal(x.report,null);
   assert.match(x.err,/WATCH_REPLAY_(?:OUTSIDE_SNAPSHOT_WINDOW|INVALID_AS_OF)/);
  }
 });
});
test('duplicate database identities and ambiguous grade revisions cannot silently replace evidence',()=>{
 for(const group of ['observations','predictions','results']){
  const data=fixture();data[group].push({...data[group][0]});
  withSnapshot(data,path=>{const x=cli(['--input',path]);assert.equal(x.status,2);assert.match(x.err,/WATCH_REPLAY_DUPLICATE_IDENTITY/);});
 }
});
test('invalid snapshot shapes, impossible counting stats and invalid JSON fail without a fabricated result',()=>{
 const negative=fixture();negative.results[0].actual=-1;
 for(const data of [{},negative,'{"invalid":'])withSnapshot(data,path=>{
  const x=cli(['--input',path]);assert.equal(x.status,2);assert.equal(x.report,null);assert.match(x.err,/WATCH_REPLAY_INVALID_SNAPSHOT/);
 });
});
test('an empty retained snapshot has unknown accuracy',()=>{
 const data=fixture();for(const key of ['observations','predictions','results','picks','entryLegs'])data[key]=[];
 withSnapshot(data,path=>{const x=cli(['--input',path]);assert.equal(x.status,0);assert.equal(x.report.totals.uniqueLines,0);assert.equal(x.report.totals.winRate,null);});
});
test('remote input, duplicate flags and unknown options never initiate network requests',()=>{
 for(const args of [['--input','https://example.test/quotes.json'],['--input','unused','--input','other'],['--unknown','value'],[]]){
  const x=cli(args);assert.equal(x.status,2);assert.equal(x.report,null);assert.match(x.err,/WATCH_REPLAY_(?:LOCAL_INPUT_REQUIRED|INVALID_ARGUMENTS)/);
 }
});

test('replay totals and grade kinds agree when a later platform has a different grade',()=>{
 const data=fixture();
 data.results=data.results.filter(g=>g.observation_id!==1&&g.observation_id!==8);
 data.results.push(grade(1,'void_dnp',null),grade(8,'more',10));
 withSnapshot(data,path=>{
  const x=cli(['--input',path]);assert.equal(x.status,0,x.err);
  assert.equal(x.report.totals.pushes,4);
  assert.equal(x.report.gradeKinds.voidDnp,2);
  assert.equal(x.report.totals.pushes,x.report.gradeKinds.ties+x.report.gradeKinds.voids);
  assert.equal(x.report.byPlatform.pick6.wins,1);
 });
});
