import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {temperatureScale,properScore,buildResearch,pairedInterval} from './research.ts';

const artifact=JSON.parse(readFileSync(new URL('../../data/props/research_v2.json',import.meta.url),'utf8'));
// Synthetic TEST identities only. None are observations or research evidence.
function fixture(id=1,patch={}){
 const o={id,platform:'prizepicks',provider_event_id:'TEST-event-'+id,home_team:'TEST Home',away_team:'TEST Away',
  lock_at:'2026-11-08T23:00:00Z',player_name:'TEST Player '+id,stat:'points',line:20.5,
  provider_last_update:'2026-11-08T19:10:00Z',ingested_at:'2026-11-08T19:11:00Z',recorded_at:'2026-11-08T19:12:00Z',...patch};
 const p={id:100+id,observation_id:id,model_version:artifact.baselineVersion,status:'scored',athlete_id:String(1000+id),
  p_more:0.7,p_less:0.3,p_tie:0,data_cutoff:o.ingested_at,predicted_at:'2026-11-08T19:13:00Z'};
 const k={id:200+id,prediction_id:p.id,selection_version:'props-select-v1',status:'recorded',side:'more'};
 return {o,p,k};
}
function raw(...fixtures){return {nowIso:'2026-11-08T19:20:00Z',windowStart:'2026-08-10T19:20:00Z',control:{state:'RUNNING',reason:'TEST'},
 observations:fixtures.map(x=>x.o),predictions:fixtures.map(x=>x.p),picks:fixtures.map(x=>x.k),results:[],entryLegs:[]};}
const final=(id,outcome='more',actual=25)=>({observation_id:id,revision:1,outcome,actual,graded_at:'2026-11-09T03:00:00Z'});

test('temperature reduces overconfidence, preserves ties and sums to one',()=>{
 const p={pMore:0.72,pLess:0.18,pTie:0.1};const c=temperatureScale(p,2);
 assert.ok(c.pMore<p.pMore&&c.pMore>c.pLess);assert.equal(c.pTie,0.1);assert.ok(Math.abs(c.pMore+c.pLess+c.pTie-1)<1e-12);
 assert.deepEqual(temperatureScale(p,1),p);
 assert.throws(()=>temperatureScale({...p,pMore:NaN},2));assert.throws(()=>temperatureScale(p,0));
});
test('integer-line ties are explicitly scored rather than counted as a directional loss',()=>{
 assert.equal(properScore({pMore:0.3,pLess:0.3,pTie:0.4},'tie').brier,0.27);
 const f=fixture(1,{line:20}),r=raw(f);r.nowIso='2026-11-09T10:00:00Z';r.results=[final(1,'tie',20)];
 f.p.p_more=0.4;f.p.p_less=0.4;f.p.p_tie=0.2;
 const v=buildResearch(r,artifact);assert.equal(v.baseline.n,1);assert.equal(v.baseline.directional,0);assert.equal(v.baseline.hitRate,null);
});
test('rankings sort strongest first and identify actual paper-entry membership',()=>{
 const f=fixture(),strong=fixture(2);strong.p.p_more=0.78;strong.p.p_less=0.22;
 const r=raw(f,strong);r.entryLegs=[{entry_id:7,pick_id:f.k.id}];
 const v=buildResearch(r,artifact);assert.deepEqual(v.rankings.baseline.map(x=>x.observationId),[2,1]);
 assert.deepEqual(v.rankings.baseline[1].entryIds,[7]);assert.deepEqual(v.rankings.candidate.map(x=>x.observationId),[2]);
 assert.ok(v.rankings.candidate[0].probability<v.rankings.baseline[0].probability);assert.deepEqual(v.rankings.candidate[0].entryIds,[]);
});
test('locked, buffered, stale, paused and missing-control states cannot recommend a pick',()=>{
 for(const patch of [{lock_at:'2026-11-08T19:20:00Z'},{lock_at:'2026-11-08T19:29:00Z'},
  {provider_last_update:'2026-11-08T16:00:00Z'}])assert.equal(buildResearch(raw(fixture(1,patch)),artifact).rankings.baseline.length,0);
 for(const control of [null,{state:'PAUSED',reason:'owner'},{state:'STOPPED',reason:'owner'}]){
  const r=raw(fixture());r.control=control;assert.equal(buildResearch(r,artifact).rankings.baseline.length,0);}
});
test('an unscorable newer quote does not resurrect an older qualifying quote',()=>{
 const old=fixture(),latest=fixture(2,{player_name:old.o.player_name,provider_event_id:old.o.provider_event_id,
  provider_last_update:'2026-11-08T19:15:00Z',ingested_at:'2026-11-08T19:16:00Z',recorded_at:'2026-11-08T19:17:00Z'});
 latest.p.status='unscorable';latest.p.athlete_id=old.p.athlete_id;latest.p.predicted_at='2026-11-08T19:18:00Z';
 assert.equal(buildResearch(raw(old,latest),artifact).rankings.baseline.length,0);
});
test('future timestamps, post-lock forecasts, invalid probabilities and outcomes are rejected',()=>{
 for(const mutate of [f=>{f.p.predicted_at=f.o.lock_at;},f=>{f.p.predicted_at='2026-11-08T20:00:00Z';},
  f=>{f.p.data_cutoff='2026-11-08T23:30:00Z';},f=>{f.p.p_more=NaN;},f=>{f.o.recorded_at=f.o.lock_at;}]){
  const f=fixture();mutate(f);const v=buildResearch(raw(f),artifact);assert.equal(v.rankings.baseline.length,0);assert.equal(v.progress.invalid,1);}
 const r=raw(fixture());r.nowIso='2026-11-09T10:00:00Z';r.results=[final(1,'more',10)];
 assert.equal(buildResearch(r,artifact).baseline.n,0);
});
test('identical platform lines and refreshed quotes count once using the first archived prediction',()=>{
 const first=fixture(),duplicate=fixture(2,{platform:'pick6',provider_event_id:first.o.provider_event_id,player_name:first.o.player_name});
 duplicate.p.athlete_id=first.p.athlete_id;duplicate.p.p_more=0.79;duplicate.p.p_less=0.21;
 const r=raw(first,duplicate);r.nowIso='2026-11-09T10:00:00Z';r.results=[final(1),final(2)];
 const v=buildResearch(r,artifact);assert.equal(v.baseline.n,1);assert.equal(v.progress.duplicates,1);assert.ok(Math.abs(v.baseline.brier-0.09)<1e-12);
});
test('pre-registration observations are excluded; DNP remains void; latest correction wins',()=>{
 const old=fixture(1,{ingested_at:'2026-11-07T19:11:00Z',recorded_at:'2026-11-07T19:12:00Z'}),f=fixture(2),dnp=fixture(3);
 const r=raw(old,f,dnp);r.nowIso='2026-11-09T10:00:00Z';r.results=[final(1),final(2),
  {...final(2,'less',18),revision:2,graded_at:'2026-11-09T04:00:00Z'},final(3,'void_dnp',null)];
 const v=buildResearch(r,artifact);assert.equal(v.progress.preRegistration,1);assert.equal(v.progress.voided,1);
 assert.equal(v.baseline.n,1);assert.equal(v.baseline.correct,0);
});
test('ungraded and future grades stay pending',()=>{
 const r=raw(fixture());r.results=[final(1)];const v=buildResearch(r,artifact);
 assert.equal(v.baseline.n,0);assert.equal(v.baseline.brier,null);assert.equal(v.progress.pending,1);
});
test('game-clustered paired interval is deterministic and cannot promote a model',()=>{
 const rows=[1,2,3].map(i=>({key:String(i),eventId:'TEST'+i,date:'2026-11-08',stat:'points',
  baseline:{pMore:0.9,pLess:0.1,pTie:0},candidate:{pMore:0.6,pLess:0.4,pTie:0},outcome:'less'}));
 const a=pairedInterval(rows,100,1);assert.deepEqual(a,pairedInterval(rows,100,1));assert.ok(a.upper95<0);
 const v=buildResearch(raw(fixture()),artifact);assert.equal(v.review.promotionEnabled,false);assert.equal(v.review.profitabilityDemonstrated,false);
 assert.equal(v.review.status,'collecting');assert.equal(v.review.interval,null);
});
test('a review-ready prospective comparison still cannot promote or claim profit',()=>{
 const fixtures=[],results=[];
 for(let i=0;i<500;i++){
  const day=8+Math.floor(i/10)%14,stamp=`2026-11-${String(day).padStart(2,'0')}`;
  const f=fixture(i+1,{provider_event_id:'TEST-game-'+Math.floor(i/10),stat:'rebounds',
   ingested_at:stamp+'T19:11:00Z',recorded_at:stamp+'T19:12:00Z',provider_last_update:stamp+'T19:10:00Z',lock_at:stamp+'T23:00:00Z'});
  f.p.predicted_at=stamp+'T19:13:00Z';f.p.p_more=0.75;f.p.p_less=0.25;fixtures.push(f);
  results.push({...final(i+1,i%10<6?'more':'less',i%10<6?25:18),graded_at:'2026-11-25T10:00:00Z'});
 }
 const r=raw(...fixtures);r.nowIso='2026-11-26T10:00:00Z';r.results=results;
 const v=buildResearch(r,artifact);assert.equal(v.review.status,'ready_for_review');assert.equal(v.review.promotionEnabled,false);
 assert.equal(v.review.profitabilityDemonstrated,false);assert.equal(v.progress.games,50);
});
test('research artifact pins the original artifact and registered parameters',()=>{
 const original=readFileSync(new URL('../../data/props/model_v1.json',import.meta.url));
 assert.equal(createHash('sha256').update(original).digest('hex'),artifact.baselineArtifactSha256);
 assert.equal(createHash('sha256').update(JSON.stringify(JSON.parse(original))).digest('hex'),artifact.baselineCanonicalSha256);
 const protocol=JSON.parse(readFileSync(new URL('../../../research/props_calibration_20261108/protocol.json',import.meta.url),'utf8'));
 assert.equal(artifact.protocolId,protocol.id);assert.equal(artifact.forwardStartsAt,protocol.forwardStartsAt);
 assert.deepEqual(artifact.reviewGate,protocol.forwardReviewGate);
});
