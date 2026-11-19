import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {wilson,calibrationBins,brierEdge} from './backtest-view.ts';

const summary=JSON.parse(readFileSync(new URL('../../data/props/backtest_v1.json',import.meta.url),'utf8'));

test('summary covers two out-of-sample seasons with the frozen versions',()=>{
 assert.deepEqual(summary.seasons.map(s=>s.label),['2024-25','2025-26']);
 assert.equal(summary.modelVersion,'props-nb-minutes-rate-v1');
 assert.equal(summary.selectionVersion,'props-select-v1');
 for(const s of summary.seasons){
  assert.ok(s.scoredLines>50000);
  assert.ok(Math.abs(s.selection.breakEven-0.5774)<1e-4);
  for(const k of ['points','rebounds','assists'])assert.ok(brierEdge(s.brier,k)>0,'model beats both baselines on '+k);
 }
});
test('wilson interval brackets the estimate and narrows with n',()=>{
 const [a,b]=wilson(0.6,100),[c,d]=wilson(0.6,10000);
 assert.ok(a<0.6&&b>0.6&&c>a&&d<b);
 assert.deepEqual(wilson(0.5,0),[0,1]);
});
test('calibration bins drop tiny bins and map to chart shape',()=>{
 const bins=calibrationBins([{bin:0,n:5,meanPredicted:0.05,observedMore:0.2},{bin:6,n:400,meanPredicted:0.64,observedMore:0.6}]);
 assert.equal(bins.length,1);
 assert.equal(bins[0].lower_bound,0.6);assert.equal(bins[0].sample_size,400);
 assert.equal(bins[0].observed_frequency_wilson_95.length,2);
});
