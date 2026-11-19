// Research challenger props-nb-availability-v1: availability categories from EARLIER box scores only, unknown stays
// unknown, the adjustment reduces to the baseline at m=1/s=0, and the pre-registered scoring and verdict rule.
// All inputs here are SYNTHETIC test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {availabilityWindow,categorize,statusIn,adjustedProbabilities,fitAdjustment,pairedGameBootstrap,calibration,verdict,
  pMoreNoTie,COACH_REASON,WINDOW_GAMES} from './availability.ts';
import {predictLine,lineProbabilities} from './model.ts';

const game = (i, listed) => ({game: 'g' + i, start: new Date(Date.UTC(2026, 10, 1 + i, 0)).toISOString(), listed: new Map(Object.entries(listed))});
const P = {didNotPlay: false, reason: null}, OUT = {didNotPlay: true, reason: 'LEFT ANKLE SPRAIN'}, COACH = {didNotPlay: true, reason: COACH_REASON};

test('statuses: played, stated absence, coach decision, and unlisted (unknown, never assumed available)', () => {
  const g = game(1, {a: P, b: OUT, c: COACH, d: {didNotPlay: true, reason: '  '}});
  assert.deepEqual(['a', 'b', 'c', 'd', 'zzz'].map(x => statusIn(g, x)), ['PLAYED', 'ABSENT_STATED', 'ABSENT_COACH', 'UNLISTED', 'UNLISTED']);
});

test('the window uses only earlier team games since the player first appeared for the team, most recent first', () => {
  const games = [game(1, {x: P}), game(2, {a: P}), game(3, {a: OUT}), game(4, {a: P}), game(5, {}), game(6, {a: P}), game(7, {a: P}), game(8, {a: OUT})];
  const w = availabilityWindow(games, 'a', games[7].start);
  assert.deepEqual(w, ['PLAYED', 'PLAYED', 'UNLISTED', 'PLAYED', 'ABSENT_STATED'], 'game 8 is the predicted game and is never used; game 1 predates the player');
  assert.equal(w.length, WINDOW_GAMES);
  assert.deepEqual(availabilityWindow(games, 'a', games[1].start), [], 'no earlier listing for this team: empty window');
  assert.deepEqual(availabilityWindow(games, 'a', games[2].start), ['PLAYED']);
});

test('categories: RETURNING beats RECENT beats UNKNOWN beats CLEAR; a coach decision is rotation, not availability', () => {
  assert.equal(categorize(['ABSENT_STATED', 'PLAYED']), 'RETURNING');
  assert.equal(categorize(['PLAYED', 'UNLISTED', 'ABSENT_STATED']), 'RECENT');
  assert.equal(categorize(['PLAYED', 'UNLISTED', 'ABSENT_COACH']), 'UNKNOWN');
  assert.equal(categorize(['ABSENT_COACH', 'PLAYED']), 'CLEAR');
  assert.equal(categorize([]), 'CLEAR');
});

test('the adjustment at m=1, s=0 is the baseline distribution; lower expected minutes lowers P(more); extra spread pulls toward the middle', () => {
  const logs = Array.from({length: 8}, (_, i) => ({gameStart: new Date(Date.UTC(2026, 9, 20 + i)).toISOString(), minutes: 30 + (i % 3), didNotPlay: false,
    points: 18 + (i % 4), rebounds: 6, assists: 4}));
  const params = {version: 'props-nb-minutes-rate-v1', minMinutesForRate: 6, minCurrentGames: 3, maxGapDays: 21, minutesHalfLife: 4, rateHalfLife: 8, maxGames: 20,
    priorStrengthMinutes: 120, priorMinMinutes: 300, maxMinutes: 53, leagueRate: {points: 0.5, rebounds: 0.2, assists: 0.1}, dispersion: {points: 20, rebounds: 15, assists: 10}};
  const p = predictLine({logs, prior: null, stat: 'points', line: 18.5, cutoff: '2026-11-01T00:00:00Z', params});
  assert.equal(p.status, 'scored');
  const x = {rate: p.inputs.rate, expMinutes: p.inputs.expMinutes, sdMinutes: p.inputs.sdMinutes, dispersion: 20, line: 18.5};
  assert.ok(Math.abs(pMoreNoTie(adjustedProbabilities(x, {m: 1, s: 0})) - pMoreNoTie(p)) < 1e-5);
  const lower = pMoreNoTie(adjustedProbabilities(x, {m: 0.85, s: 0}));
  assert.ok(lower < pMoreNoTie(p));
  const far = {...x, line: 30.5}, base = pMoreNoTie(adjustedProbabilities(far, {m: 1, s: 0})), wide = pMoreNoTie(adjustedProbabilities(far, {m: 1, s: 0.3}));
  assert.ok(base < 0.5 && wide > base, 'more spread raises a small tail probability toward 0.5');
  assert.throws(() => adjustedProbabilities(x, {m: 0, s: 0}), /INVALID_ADJUSTMENT/);
  const lp = lineProbabilities(18.5, p.mean, p.inputs.size);
  assert.ok(Math.abs(lp.pMore - p.pMore) < 1e-5);
});

test('fit: m is the mean minutes ratio (capped); s is only the spread beyond what the baseline assumes', () => {
  const rows = [{minutes: 20, expMinutes: 25, sdMinutes: 0}, {minutes: 30, expMinutes: 25, sdMinutes: 0}, {minutes: 60, expMinutes: 50, sdMinutes: 0}];
  const f = fitAdjustment(rows);
  const r = [0.8, 1.2, 53 / 50], mean = r.reduce((a, b) => a + b) / 3, v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / 2;
  assert.equal(f.m, Math.round(mean * 1e4) / 1e4);
  assert.equal(f.s, Math.round(Math.sqrt(v) * 1e4) / 1e4);
  const covered = fitAdjustment(rows.map(x => ({...x, sdMinutes: x.expMinutes})));
  assert.equal(covered.s, 0, 'baseline spread already covers it: no extra spread');
  assert.throws(() => fitAdjustment([rows[0]]), /TOO_FEW_ROWS/);
});

test('scoring: paired game bootstrap is deterministic and resamples games; calibration and the verdict rule', () => {
  const rs = [];
  for (let g = 0; g < 40; g++) for (let k = 0; k < 5; k++) {
    const y = (g + k) % 2;
    rs.push({game: 'G' + g, y, p: {base: 0.7, good: y ? 0.6 : 0.4}});
  }
  const a = pairedGameBootstrap(rs, 'good', 'base', 500, 7), b = pairedGameBootstrap(rs, 'good', 'base', 500, 7);
  assert.deepEqual(a, b);
  assert.equal(a.games, 40);
  assert.equal(a.lines, 200);
  assert.ok(a.brier.upper95 < 0 && a.logLoss.difference < 0);
  assert.equal(verdict(a), 'IMPROVES');
  assert.equal(verdict(pairedGameBootstrap(rs, 'base', 'good', 500, 7)), 'WORSE');
  assert.equal(verdict(pairedGameBootstrap(rs.slice(0, 100), 'good', 'base', 500, 7)), 'INSUFFICIENT_DATA', 'under 150 lines');
  assert.equal(verdict(null), 'INSUFFICIENT_DATA');
  const same = pairedGameBootstrap(rs, 'base', 'base', 200, 1);
  assert.equal(verdict(same), 'NO_CLEAR_EFFECT', 'identical forecasts are not an improvement');
  const c = calibration(rs, 'base');
  assert.equal(c.meanPredictedMore, 0.7);
  assert.equal(c.observedMore, 0.5);
  assert.equal(c.calibrationInTheLarge, 0.2, 'over-predicts More by 20 points');
  assert.equal(c.ece, 0.2);
});
