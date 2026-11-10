import test from 'node:test';
import assert from 'node:assert/strict';
import {readResearchRows,loadPropsResearch} from './props-research-data.ts';

test('read-only snapshot paginates beyond the server page limit without silently truncating',async()=>{
 const calls=[];const store={select:async(table,q)=>{calls.push(q);return q.includes('offset=0')?Array.from({length:500},(_,id)=>({id})):Array.from({length:7},(_,id)=>({id:500+id}));}};
 const rows=await readResearchRows(store,'props_observations','select=id&order=id.asc');
 assert.equal(rows.length,507);assert.equal(calls.length,2);assert.match(calls[1],/offset=500/);
});
test('a saturated snapshot is refused instead of reporting a partial sample',async()=>{
 const store={select:async()=>Array.from({length:500},(_,id)=>({id}))};
 await assert.rejects(readResearchRows(store,'props_observations','select=id'),/RESEARCH_SNAPSHOT_LIMIT/);
});
test('snapshot calls select only, bounds time, pins model versions, and avoids a paid feed',async()=>{
 const calls=[];
 const store={select:async(table,query)=>{calls.push({table,query});return table==='props_control'?[{state:'PAUSED',reason:'TEST'}]:[];},
  insert:()=>{throw new Error('unexpected mutation');},rpc:()=>{throw new Error('unexpected mutation');}};
 const r=await loadPropsResearch(store,'2026-11-08T19:00:00Z');
 assert.equal(r.control.state,'PAUSED');assert.equal(r.observations.length,0);assert.deepEqual(r.entryLegs,[]);
 assert.deepEqual(new Set(calls.map(c=>c.table)),new Set(['props_control','props_observations','props_predictions','props_picks','props_line_results']));
 assert.match(calls.find(c=>c.table==='props_predictions').query,/model_version=eq.props-nb-minutes-rate-v1/);
 assert.match(calls.find(c=>c.table==='props_observations').query,/is_fixture=eq.false/);
 assert.ok(calls.filter(c=>c.table!=='props_control').every(c=>c.query.includes('=lte.2026-11-08T19%3A00%3A00Z')));
});
