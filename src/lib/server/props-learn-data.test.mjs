// Forward-line loader: fake store, synthetic TEST-ONLY rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadForwardLines} from './props-learn-data.ts';

const obs={id:1,platform:'prizepicks',provider_event_id:'evtTEST000001',home_team:'Boston Celtics',away_team:'New York Knicks',
 lock_at:'2026-11-08T00:00:00.000Z',ingested_at:'2026-11-07T19:00:00.000Z',player_name:'Test Alpha',stat:'points',line:20.5};
const pred={id:10,observation_id:1,model_version:'props-nb-minutes-rate-v1',status:'scored',athlete_id:'9101',p_more:0.6,p_less:0.4,p_tie:0,
 inputs:{expMinutes:31,team:'BOS'}};
function store(){
 const reads=[];
 return {reads,select:async(t,q)=>{reads.push(t+'?'+q);
  if(t==='props_observations')return q.includes('offset=0')?[obs]:[];
  if(t==='props_predictions')return [pred];
  if(t==='props_line_results')return [{observation_id:1,revision:1,outcome:'more',graded_at:'2026-11-08T09:20:00Z',player_game_id:null}];
  if(t==='props_player_games')return [];   // a capped or truncated page
  return [];},rpc:async()=>{},insert:async()=>{}};
}

test('review fix: the team comes from the prediction, not a capped player-game lookup',async()=>{
 const s=store();
 const [l]=await loadForwardLines(s,'2026-11-01T00:00:00.000Z');
 assert.equal(l.team,'BOS');
 assert.equal(l.outcome,'more');
 assert.ok(!s.reads.some(r=>r.startsWith('props_player_games?select=athlete_id')),'no unbounded per-athlete history read when the team is known');
});
