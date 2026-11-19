/** Synthetic probability examples; no network, real picks or implied returns. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {sportsScorecard,readSportsScorecard} from './scorecard.ts';
const row=(i,over={})=>({key:'synthetic-'+i,game:'g'+i,date:'2026-11-18',stat:'points',predictedAt:'2026-11-18T17:00:00Z',
 lockAt:'2026-11-18T23:00:00Z',gradedAt:'2026-11-19T03:00:00Z',pMore:0.75,outcome:'more',picked:'more',modelVersion:'baseline',
 lineGapRel:0.2,minutesCv:0.15,games:6,...over});
const group=(s,id,bin)=>s.groups.find(g=>g.id===id).rows.find(b=>b.id===bin).summary;

test('binary proper scores match hand calculations and game-clustered differences',()=>{
 const s=sportsScorecard([row(1),row(2,{pMore:0.25,picked:'less',outcome:'less'})]);
 assert.equal(s.all.brier,0.0625);assert.equal(s.all.fairBrier,0.25);assert.equal(s.all.brierDifference,-0.1875);
 assert.deepEqual(s.all.brierDifference95,{lower95:-0.1875,upper95:-0.1875});
 assert.equal(s.all.logLoss,Number((-Math.log(0.75)).toFixed(6)));
 assert.equal(s.all.meanConfidence,0.75);assert.equal(s.all.hitRate,1);assert.equal(s.all.confidenceGap,-0.25);
 assert.deepEqual(s.all.confidenceGap95,{lower95:-0.25,upper95:-0.25});assert.equal(s.all.smallSample,true);
 assert.equal(readSportsScorecard(s),s);
});

test('empty, unselected and one-game samples retain unknown uncertainty',()=>{
 const empty=sportsScorecard([]);assert.equal(empty.all.brier,null);assert.equal(empty.all.hitRate,null);assert.equal(empty.all.brierDifference95,null);
 const unselected=sportsScorecard([row(1,{picked:null}),row(2,{picked:null})]);
 assert.equal(unselected.all.lines,2);assert.equal(unselected.all.picks,0);assert.equal(unselected.all.meanConfidence,null);
 assert.equal(unselected.all.confidenceGap95,null);assert.equal(unselected.all.hitRate95,null);
 const sameGame=sportsScorecard([row(1,{game:'one'}),row(2,{game:'one'})]);assert.equal(sameGame.all.games,1);
 assert.equal(sameGame.all.brierDifference95,null);assert.equal(sameGame.all.confidenceGap95,null);
 assert.equal(readSportsScorecard(empty),empty);
});

test('predeclared subgroup boundaries partition lines and retain unknown player context',()=>{
 const s=sportsScorecard([row(1),row(2,{games:5,minutesCv:0.3,lineGapRel:0.4,pMore:0.6}),row(3,{games:null,minutesCv:null,lineGapRel:null,picked:null})]);
 assert.equal(group(s,'history','0-5').lines,1);assert.equal(group(s,'history','6-10').lines,1);assert.equal(group(s,'history','unknown').lines,1);
 assert.equal(group(s,'minutes','015-030').lines,1);assert.equal(group(s,'minutes','030-plus').lines,1);assert.equal(group(s,'minutes','unknown').lines,1);
 assert.equal(group(s,'gap','020-040').lines,1);assert.equal(group(s,'gap','040-plus').lines,1);assert.equal(group(s,'gap','unknown').lines,1);
 assert.equal(group(s,'confidence','0.6-0.65').picks,1);assert.equal(group(s,'confidence','0.7-0.8').picks,1);
 for(const id of ['stat','history','minutes','gap'])assert.equal(s.groups.find(g=>g.id===id).rows.reduce((a,b)=>a+b.summary.lines,0),3);
});

test('duplicate lines never inflate evidence and input order cannot change bootstrap output',()=>{
 const rows=Array.from({length:50},(_,i)=>row(i,{game:'g'+i%10,pMore:i%2?0.7:0.55,outcome:i%3?'more':'less'}));
 const first=sportsScorecard(rows),reverse=sportsScorecard([...rows].reverse());assert.deepEqual(first,reverse);
 const duplicate=sportsScorecard([...rows,...rows]);assert.equal(duplicate.duplicatesExcluded,50);assert.deepEqual(duplicate.all,first.all);
 assert.equal(first.all.smallSample,false);
});

test('invalid optional archives are refused; older reports simply have no scorecard',()=>{
 assert.equal(readSportsScorecard(undefined),null);
 const good=sportsScorecard([row(1)]);
 for(const edit of [r=>r.all.brier=NaN,r=>r.all.brier=-1,r=>r.all.fairBrier=0.5,r=>r.all.hits=2,r=>r.all.hitRate=0.5,
  r=>r.all.smallSample=false,r=>r.all.lines=0,r=>r.groups=[],r=>r.groups[0].rows[0].summary.brier='wrong']){
  const bad=structuredClone(good);edit(bad);assert.equal(readSportsScorecard(bad),null);
 }
 assert.throws(()=>sportsScorecard([row(1,{pMore:1})]),/SCORECARD_INVALID_ROW/);
 assert.throws(()=>sportsScorecard([row(1,{outcome:'tie'})]),/SCORECARD_INVALID_ROW/);
});
