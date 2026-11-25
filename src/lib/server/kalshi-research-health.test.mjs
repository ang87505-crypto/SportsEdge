import test from 'node:test';
import assert from 'node:assert/strict';
import {loadKalshiResearchHealth} from './kalshi-research-health.ts';
import {memoryFixture} from './kalshi-platform-test-kit.mjs';
const NOW='2026-11-20T20:00:00.000Z';
function setup({weather,scorecard}={}){
 return {weather:async()=>weather??{state:'RECORDED',memory:memoryFixture(),grade:null},
  scorecard:async()=>scorecard??{state:'RECORDED',scorecard:{lastDate:'2026-11-19',evaluatedDays:3}}};
}
test('healthy public collection below the 30-day model minimum has no private capability or output',async()=>{
 const deps=setup();Object.defineProperty(deps,'store',{get(){throw Error('PRIVATE_ACCESS_FORBIDDEN');}});
 const h=await loadKalshiResearchHealth(NOW,deps);
 assert.equal(h.state,'OK');assert.equal(h.archive.requiredPairs,30);assert.equal(h.archive.trainingPairs,0);
 assert.deepEqual(h.issues,[]);assert.equal('worker' in h,false);assert.equal('account' in h,false);
});
test('a stale forecast is visible even when an outcome is current',async()=>{
 const m=memoryFixture();m.capturedAt='2026-11-18T07:00:00Z';
 const h=await loadKalshiResearchHealth(NOW,setup({weather:{state:'RECORDED',memory:m}}));
 assert.equal(h.state,'ATTENTION');assert.deepEqual(h.issues,['FORECAST_STALE']);
});
test('a stale outcome is visible even when the next forecast is current',async()=>{
 const h=await loadKalshiResearchHealth(NOW,setup({scorecard:{state:'RECORDED',scorecard:{lastDate:'2026-11-17',evaluatedDays:1}}}));
 assert.equal(h.state,'ATTENTION');assert.deepEqual(h.issues,['OUTCOME_STALE']);
});
test('missing/corrupt archive records never appear as healthy zero counts',async()=>{
 const h=await loadKalshiResearchHealth(NOW,setup({weather:{state:'ARCHIVE_UNAVAILABLE'},scorecard:{state:'ARCHIVE_UNAVAILABLE'}}));
 assert.equal(h.state,'UNAVAILABLE');assert.equal(h.archive.trainingPairs,null);assert.equal(h.archive.gradedDays,null);
 assert.deepEqual(h.issues,['FORECAST_UNAVAILABLE','OUTCOME_UNAVAILABLE']);
});
test('future forecast captures and unfinished climate days are refused',async()=>{
 const m=memoryFixture();m.capturedAt='2026-11-21T07:00:00Z';
 const h=await loadKalshiResearchHealth(NOW,setup({weather:{state:'RECORDED',memory:m},
  scorecard:{state:'RECORDED',scorecard:{lastDate:'2026-11-20',evaluatedDays:3}}}));
 assert.equal(h.state,'UNAVAILABLE');assert.deepEqual(h.issues,['FORECAST_UNAVAILABLE','OUTCOME_UNAVAILABLE']);
});
test('a source failure is isolated and no raw provider reply leaves the heartbeat',async()=>{
 const deps=setup();deps.weather=async()=>{throw Error('PRIVATE_PROVIDER_REPLY');};
 const h=await loadKalshiResearchHealth(NOW,deps);
 assert.equal(h.state,'UNAVAILABLE');assert.deepEqual(h.issues,['FORECAST_UNAVAILABLE']);
 assert.equal(h.archive.gradedDays,3);assert.equal(JSON.stringify(h).includes('PRIVATE_PROVIDER_REPLY'),false);
});
test('next-morning report delay has bounded grace and becomes stale without another completed day',async()=>{
 const h=await loadKalshiResearchHealth('2026-11-20T06:00:00Z',setup({weather:{state:'RECORDED',
  memory:{...memoryFixture(),capturedAt:'2026-11-19T07:00:00Z'}},
  scorecard:{state:'RECORDED',scorecard:{lastDate:'2026-11-18',evaluatedDays:2}}}));
 assert.equal(h.state,'OK');
 const stale=await loadKalshiResearchHealth(NOW,setup({scorecard:{state:'RECORDED',scorecard:{lastDate:'2026-11-18',evaluatedDays:2}}}));
 assert.ok(stale.issues.includes('OUTCOME_STALE'));
});
test('invalid clock is refused before any source read',async()=>{
 let reads=0;const deps=setup();deps.weather=async()=>{reads++;throw Error('UNEXPECTED');};
 await assert.rejects(loadKalshiResearchHealth('invalid',deps),/INVALID_CLOCK/);assert.equal(reads,0);
});
