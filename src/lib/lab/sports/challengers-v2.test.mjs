import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CHALLENGERS_V2_SPEC,CHALLENGERS_V2_SHA256,features,identityStart,fitRidge,trainChallenger,predictChallenger,baseMore,disposition,chooseLambda}
 from './challengers-v2.ts';
import {seeded} from '../stats.ts';

const P=(m,t=0.02)=>({pMore:m*(1-t),pLess:(1-m)*(1-t),pTie:t});
const X=(m,extra={})=>({base:P(m),games:20,expMinutes:30,sdMinutes:5,mean:12,line:11.5,...extra});

test('the spec is research-only, frozen by hash, and its decision rule never auto-promotes', () => {
  assert.equal(CHALLENGERS_V2_SPEC.researchOnly, true);
  assert.match(CHALLENGERS_V2_SHA256, /^[0-9a-f]{64}$/);
  assert.match(CHALLENGERS_V2_SPEC.decisionRule.promotion, /Never automatic/);
  assert.equal(CHALLENGERS_V2_SPEC.candidates.length, 4);
  for (const c of CHALLENGERS_V2_SPEC.candidates) assert.deepEqual(features(c.features, X(0.6)).length, CHALLENGERS_V2_SPEC.features[c.features].length);
});

test('features use pre-lock inputs only: the input type has no outcome and identical inputs give identical vectors', () => {
  const src = readFileSync(new URL('./challengers-v2.ts', import.meta.url), 'utf8');
  const inputType = src.match(/export type ChallengerInput=\{([^}]*)\}/)[1];
  assert.doesNotMatch(inputType, /actual|outcome|result|minutesPlayed/);
  assert.deepEqual(features('all_new', X(0.62)), features('all_new', X(0.62)));
});

test('identity start reproduces the base forecast exactly for every feature set', () => {
  for (const set of ['recal', 'side_asym', 'uncertainty', 'line_gap', 'all_new']) {
    const a = {set, weights: {points: identityStart(set), rebounds: identityStart(set), assists: identityStart(set)}};
    const p = predictChallenger(a, 'points', X(0.66));
    assert.ok(Math.abs(p.pMore / (1 - p.pTie) - 0.66) < 1e-9, set);
    assert.ok(Math.abs(p.pMore + p.pLess + p.pTie - 1) < 1e-12);
  }
  assert.equal(predictChallenger(null, 'points', X(0.7)).pTie, 0.02);
});

test('side_asym recovers a known More-only overconfidence on synthetic data; recal cannot express it', () => {
  const r = seeded(7), rows = [];
  for (let i = 0; i < 6000; i++) {
    const m = 0.2 + 0.6 * r(); const z = Math.log(m / (1 - m));
    const trueZ = z > 0 ? 0.5 * z : z;             // More-leaning forecasts are twice as confident as they should be
    const y = r() < 1 / (1 + Math.exp(-trueZ)) ? 1 : 0;
    rows.push({x: features('side_asym', X(m)), y, at: String(i).padStart(6, '0')});
  }
  const w = fitRidge(rows, 0.01, identityStart('side_asym'));
  assert.ok(Math.abs(w[1] - 0.5) < 0.12, `positive slope ${w[1]}`);
  assert.ok(Math.abs(w[2] - 1.0) < 0.15, `negative slope ${w[2]}`);
});

test('uncertainty shrinks forecasts for volatile-minutes players when the data say so', () => {
  const r = seeded(11), items = [];
  for (let i = 0; i < 6000; i++) {
    const m = 0.25 + 0.5 * r(), sd = r() < 0.5 ? 2 : 14;
    const z = Math.log(m / (1 - m)), trueZ = sd > 10 ? 0.3 * z : z;
    items.push({stat: 'points', y: r() < 1 / (1 + Math.exp(-trueZ)) ? 1 : 0, at: String(i).padStart(6, '0'), input: X(m, {sdMinutes: sd})});
  }
  const a = trainChallenger('uncertainty', items);
  const calm = predictChallenger(a, 'points', X(0.75, {sdMinutes: 2})), wild = predictChallenger(a, 'points', X(0.75, {sdMinutes: 14}));
  assert.ok(baseMore(wild) < baseMore(calm) - 0.05, `${baseMore(wild)} vs ${baseMore(calm)}`);
  assert.ok(baseMore(wild) > 0.5, 'shrinks toward 50%, never flips the side');
});

test('lambda is chosen inside the training rows only (deterministic)', () => {
  const r = seeded(3), rows = [];
  for (let i = 0; i < 500; i++) { const m = 0.3 + 0.4 * r(); rows.push({x: features('recal', X(m)), y: r() < m ? 1 : 0, at: String(i).padStart(4, '0')}); }
  assert.equal(chooseLambda(rows, 'recal'), chooseLambda([...rows].reverse(), 'recal'));
});

test('decision rule: promising needs both folds and Holm; credibly worse is rejected; otherwise no clear effect', () => {
  const ci = (mean, lo, hi) => ({mean, lower95: lo, upper95: hi});
  const f = (b, p, ll = -0.001) => ({candidate: 'x', brier: b, logLossMean: ll, pAdjusted: p});
  assert.equal(disposition(f(ci(-0.001, -0.002, 0)), f(ci(-0.002, -0.003, -0.001), 0.01)).status, 'PROMISING');
  assert.equal(disposition(f(ci(0.001, 0, 0.002)), f(ci(-0.002, -0.003, -0.001), 0.01)).status, 'NO_CLEAR_EFFECT', 'fold1 points the wrong way');
  assert.equal(disposition(f(ci(-0.001, -0.002, 0)), f(ci(-0.002, -0.003, -0.001), 0.2)).status, 'NO_CLEAR_EFFECT', 'fails Holm');
  assert.equal(disposition(f(ci(-0.001, -0.002, 0)), f(ci(0.002, 0.001, 0.003), 0.9)).status, 'REJECTED');
  assert.equal(disposition(f(ci(0.001, -0.001, 0.003)), f(ci(0.0005, -0.001, 0.002), 0.9)).status, 'REJECTED', 'wrong way in both folds');
  assert.equal(disposition(undefined, undefined).status, 'NO_CLEAR_EFFECT');
});
