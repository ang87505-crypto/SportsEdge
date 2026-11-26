import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decide} from './props-opponent-eval.ts';

const d=(mean,lo,hi,ll=-1e-4)=>({brier:{mean,lo,hi},logLoss:{mean:ll}});
test('the pre-registered decision rule: every condition is required; a tie or an interval through zero is not an improvement',()=>{
 const ok=[d(-2e-4,-3e-4,-1e-4),d(-1e-4,-3e-4,1e-4),d(-3e-4,-5e-4,-1e-4)];
 assert.equal(decide(d(-2e-4,-3e-4,-1e-4),ok),'QUALIFIES_FOR_FORWARD_TEST');
 assert.equal(decide(d(-2e-4,-3e-4,1e-5),ok),'NO_CLEAR_EFFECT','pooled interval includes zero');
 assert.equal(decide(d(-2e-4,-3e-4,-1e-4),[...ok.slice(0,2),d(1e-5,-1e-4,2e-4)]),'NO_CLEAR_EFFECT','one season worse');
 assert.equal(decide(d(-2e-4,-3e-4,-1e-4,1e-6),ok),'NO_CLEAR_EFFECT','log loss not better');
 assert.equal(decide(d(2e-4,1e-4,3e-4),ok),'WORSE');
});
test('the protocol pins untouched seasons and fits beta only on the season before each test season',()=>{
 const p=JSON.parse(readFileSync(new URL('../research/props_opponent_rate_v1_20261124/protocol.json',import.meta.url),'utf8'));
 assert.deepEqual(p.folds.map(f=>f.test.season.file),['player_box_2019.csv','player_box_2020.csv','player_box_2021.csv']);
 for(const f of p.folds){
  const y=Number(f.test.season.file.slice(11,15));
  assert.equal(f.fit.season.file,`player_box_${y-1}.csv`);assert.equal(f.test.prior.file,`player_box_${y-1}.csv`);
  assert.equal(f.fit.prior.file,`player_box_${y-2}.csv`);
  for(const s of [f.fit.prior,f.fit.season,f.test.prior,f.test.season])assert.match(s.sha256,/^[0-9a-f]{64}$/);
 }
 assert.equal(p.uncertainty.replicates,2000);assert.match(p.decision.promotion,/^none/);
});
