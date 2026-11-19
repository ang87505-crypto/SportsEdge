import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildManifest,diffManifest,recordedChanges,FROZEN_FILES,RECORDED_FILES} from './experiment-manifest-lib.mjs';

const root=new URL('../',import.meta.url);
const C={MODEL_VERSION:'m1',SELECTION_VERSION:'s1',ACTIVE_BUDGET_POLICY:{version:'b2',dailyCredits:7,monthlyCredits:200,providerFloor:60},
 REVIEW_GATE:{minGradedLines:500},PRIZEPICKS_TERMS_V1:{version:'t1'},BRAKE:{window:150,min:50,breakEven:0.577},
 CAPTURE_PLAN_V1:{version:'c1',windows:{late:{fromMin:180,toMin:35}}},PAPER_AUTO_RELEASE:{paperOnly:true,brokerWritesEnabled:false,scheduledRunsEnabled:true,realMoneyEnabled:false}};
const make=(over={},hash=()=>'a'.repeat(64))=>buildManifest({sha:hash,read:p=>readFileSync(new URL(p,root)),commit:'abc',now:'2026-11-15T18:00:00Z',constants:{...C,...over}});

test('every frozen and recorded file exists in the repository', () => {
  for (const p of [...Object.values(FROZEN_FILES).flat(), ...RECORDED_FILES]) assert.ok(readFileSync(new URL(p, root)).length > 0, p);
});

test('identical inputs verify; a changed rule file, budget, model or release flag is reported as drift', () => {
  const frozen = make();
  assert.deepEqual(diffManifest(frozen, make()), []);
  const rules = make({}, p => (p === 'src/lib/props/rules.ts' ? 'b' : 'a').repeat(64));
  assert.deepEqual(diffManifest(frozen, rules).map(d => d.path), ['src/lib/props/rules.ts']);
  assert.ok(diffManifest(frozen, make({ACTIVE_BUDGET_POLICY: {...C.ACTIVE_BUDGET_POLICY, dailyCredits: 13}})).some(d => d.key === 'budget'));
  assert.ok(diffManifest(frozen, make({MODEL_VERSION: 'm2'})).some(d => d.key === 'model'));
  assert.ok(diffManifest(frozen, make({PAPER_AUTO_RELEASE: {...C.PAPER_AUTO_RELEASE, brokerWritesEnabled: true}})).some(d => d.key === 'release'));
});

test('recorded research files may change without breaking the freeze', () => {
  const frozen = make();
  const research = make({}, p => (p === 'config/research/registry.json' ? 'c' : 'a').repeat(64));
  assert.deepEqual(diffManifest(frozen, research), []);
});

test('a recorded schedule or research change is reported (never silent) but is not drift', () => {
  const frozen = make();
  const sched = make({}, p => (p === 'vercel.json' ? 'd' : 'a').repeat(64));
  assert.deepEqual(diffManifest(frozen, sched), []);
  assert.deepEqual(recordedChanges(frozen, sched), [{path: 'vercel.json', frozen: 'a'.repeat(12), current: 'd'.repeat(12)}]);
  assert.deepEqual(recordedChanges(frozen, make()), []);
});

test('the stock registration in the manifest never carries a credential or account identifier', () => {
  const s = JSON.stringify(make().experiments[1].registration);
  assert.doesNotMatch(s, /key|secret|token|account/i);
});
