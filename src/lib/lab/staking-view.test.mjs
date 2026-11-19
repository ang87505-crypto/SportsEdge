import test from 'node:test';
import assert from 'node:assert/strict';
import {gradedPicks} from './staking-view.ts';
const cutoff='2026-11-19T12:00:00Z';
function data(){return {observations:[{id:1,provider_event_id:'SYNTHETIC',player_name:'Test Player',stat:'points',line:10.5,lock_at:'2026-11-17T23:00:00Z'}],
 predictions:[{id:2,observation_id:1,p_more:0.7,p_less:0.3}],picks:[{id:3,prediction_id:2,status:'recorded',side:'more'}],
 results:[{observation_id:1,revision:1,outcome:'more',actual:12,graded_at:'2026-11-18T04:00:00Z'}]};}
test('calibration uses only the latest grade revision that existed before entry creation',()=>{
 const r=data();r.results.push({...r.results[0],revision:2,outcome:'less',actual:9,graded_at:'2026-11-20T04:00:00Z'});
 assert.equal(gradedPicks(r,cutoff)[0].correct,true);assert.equal(gradedPicks(r)[0].correct,false);
});
test('an old lock does not make a later or unknown grade available for sizing',()=>{
 for(const at of [undefined,'bad',cutoff,'2026-11-20T00:00:00Z']){
  const r=data();r.results[0].graded_at=at;assert.deepEqual(gradedPicks(r,cutoff),[]);
 }
});
