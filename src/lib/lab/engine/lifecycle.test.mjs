/**
 * End-to-end lifecycle rehearsal of the learning engine runner, offline and isolated (temp dirs only).
 * ALL prediction/grade fixtures here are LABELLED SYNTHETIC: they exercise the machinery; they are not evidence.
 * Real records are evaluated only by the workflow run (props-activation-preflight engine step, GET-only).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pair,forwardResult} from './forward.ts';
import {seeded} from '../stats.ts';

const ROOT = new URL('../../../../', import.meta.url);
const SEED = 'research/engine/registry.json';
const ID = 'props-learn-v1-shadow';
const SEED_STATUS = JSON.parse(readFileSync(new URL(SEED, ROOT), 'utf8')).experiments.find(e => e.id === ID).status;
const SPEC = {kind: 'ledger-models', candidate: 'props-learn-v1', baseline: 'props-nb-minutes-rate-v1', maxStaleDays: 7};

/** SYNTHETIC: n lines over 20 dates / 60 games; `better` decides which model knows the true probability. */
function fixture(n, better, seed = 7) {
  const r = seeded(seed), predictions = [], grades = [];
  for (let i = 0; i < n; i++) {
    const day = String(5 + (i % 20)).padStart(2, '0'), key = `SYNTH|g${i % 60}|p${i}|points|20.5`;
    const q = r() < 0.5 ? 0.72 : 0.28, outcome = r() < q ? 'more' : 'less';
    const informed = {pMore: q, pLess: 1 - q, pTie: 0}, flat = {pMore: 0.5, pLess: 0.5, pTie: 0};
    const common = {key, eventId: `SYNTH-g${i % 60}`, date: `2026-11-${day}`, stat: 'points', predictedAt: `2026-11-${day}T15:00:00Z`, lockAt: `2026-11-${day}T23:00:00Z`};
    predictions.push({...common, model: SPEC.candidate, p: better === 'candidate' ? informed : flat});
    predictions.push({...common, model: SPEC.baseline, p: better === 'candidate' ? flat : informed});
    grades.push({key, outcome});
  }
  return {label: 'SYNTHETIC — rehearsal fixture, not evidence', predictions, grades};
}

function run(dir, {registry = SEED, fwd, now = '2026-11-28T00:00:00Z', state = join(dir, 'state'), extra = [], env = {}} = {}) {
  const fwdPath = join(dir, 'fwd-' + Math.random().toString(36).slice(2) + '.json');
  if (fwd !== undefined) writeFileSync(fwdPath, typeof fwd === 'string' ? fwd : JSON.stringify(fwd));
  writeFileSync(join(dir, 'rows.json'), '[]');
  const args = ['--experimental-strip-types', '--no-warnings', 'scripts/research-engine.ts', '--registry', registry, '--out', join(dir, 'out'), '--state', state,
    '--now', now, ...(fwd !== undefined ? ['--sports-rows', join(dir, 'rows.json'), '--forward-input', fwdPath, '--evaluate-forward'] : []), ...extra];
  let code = 0, stdout;
  try { stdout = execFileSync(process.execPath, args, {cwd: ROOT, encoding: 'utf8', env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe']}); }
  catch (e) { code = e.status; stdout = e.stdout; }
  const summary = JSON.parse(stdout.trim().split('\n').at(-1));
  const reg = JSON.parse(readFileSync(join(state, 'registry.json'), 'utf8'));
  const report = JSON.parse(readFileSync(join(state, 'report.json'), 'utf8'));
  return {code, summary, report, exp: reg.experiments.find(e => e.id === ID), reg};
}
const tmp = () => mkdtempSync(join(tmpdir(), 'lifecycle-'));

test('pairing: predictions at/after lock are refused, the first frozen prediction wins, unpaired and ungraded lines are counted', () => {
  const f = fixture(10, 'candidate');
  const late = {...f.predictions[0], predictedAt: f.predictions[0].lockAt, p: {pMore: 0.99, pLess: 0.01, pTie: 0}};
  const revised = {...f.predictions[2], predictedAt: '2026-11-06T16:00:00Z', p: {pMore: 0.01, pLess: 0.99, pTie: 0}};
  const orphan = {...f.predictions[4], key: 'SYNTH|orphan', model: SPEC.candidate};
  const rep = pair(SPEC, [...f.predictions, late, revised, orphan], f.grades.slice(1));
  assert.equal(rep.refusedAfterLock, 1);
  assert.equal(rep.unpaired, 1);
  assert.equal(rep.ungraded, 1);
  assert.equal(rep.rows.length, 9);
  const row2 = rep.rows.find(x => x.key === f.predictions[2].key);
  assert.deepEqual(row2.candidate, f.predictions[2].p, 'a later revision never replaces the frozen prediction');
});

test('insufficient forward sample → INSUFFICIENT_DATA; nothing is proposed or promoted', () => {
  const dir = tmp(), r = run(dir, {fwd: fixture(120, 'candidate')});
  assert.equal(r.code, 0);
  assert.equal(r.exp.status, 'INSUFFICIENT_DATA');
  assert.match(r.report.forward[0].reason, /below the registered minimums/);
  assert.equal(r.report.forward[0].details.pairs, 120);
});

test('challenger meeting the production gate → READY_FOR_REVIEW (owner review), and a repeat run on the same data changes nothing', () => {
  const dir = tmp(), f = fixture(700, 'candidate');
  const a = run(dir, {fwd: f});
  assert.equal(a.exp.status, 'READY_FOR_REVIEW', a.report.forward[0]?.reason);
  assert.match(a.exp.history.at(-1).reason, /Owner review required; nothing is promoted automatically/);
  const b = run(dir, {fwd: f});
  assert.equal(b.summary.registryChanged, false, 'idempotent');
  assert.equal(b.exp.history.length, a.exp.history.length);
  const runs = readFileSync(join(dir, 'state', 'runs.jsonl'), 'utf8').trim().split('\n');
  assert.equal(runs.length, 2, 'every run is recorded in the job history');
});

test('failing challenger → REJECTED (terminal); later good data cannot revive it', () => {
  const dir = tmp();
  const a = run(dir, {fwd: fixture(700, 'baseline')});
  assert.equal(a.exp.status, 'REJECTED', a.report.forward[0]?.reason);
  const b = run(dir, {fwd: fixture(700, 'candidate', 9)});
  assert.equal(b.exp.status, 'REJECTED');
  assert.equal(b.report.forward.length, 0, 'rejected experiments are not re-evaluated');
});

test('stale artifact (challenger stopped predicting) → FAILED, never counted as evidence', () => {
  const dir = tmp(), r = run(dir, {fwd: fixture(700, 'candidate'), now: '2026-12-20T00:00:00Z'});
  assert.equal(r.exp.status, 'FAILED');
  assert.match(r.exp.history.at(-1).reason, /STALE_CANDIDATE/);
});

test('invalid timestamps: a challenger whose every prediction is after lock has no evidence and fails as stale', () => {
  const f = fixture(700, 'candidate');
  for (const p of f.predictions) if (p.model === SPEC.candidate) p.predictedAt = p.lockAt;
  const dir = tmp(), r = run(dir, {fwd: f});
  assert.equal(r.exp.status, 'FAILED');
  assert.equal(r.report.forward[0].details.pairs, 0);
});

test('no data → no change; failed collection → FAILED run, registry untouched, failure recorded', () => {
  const dir = tmp();
  const none = run(dir);
  assert.equal(none.code, 0);
  assert.equal(none.summary.registryChanged, false);
  assert.equal(none.exp.status, SEED_STATUS);
  const bad = run(tmp(), {fwd: '{not json'});
  assert.equal(bad.code, 1);
  assert.equal(bad.summary.status, 'FAILED');
  assert.equal(bad.summary.registryChanged, false);
  assert.equal(bad.exp.status, SEED_STATUS);
});

test('budget exhaustion stops the run before any request and changes nothing', () => {
  const dir = tmp();
  const r = run(dir, {extra: ['--sports-ledger', '--evaluate-forward'], env: {ENGINE_MAX_REQUESTS: '0',
    SPORTSEDGE_PROPS_SUPABASE_URL: 'https://vfyzbliksooljxrlfadp.supabase.co', SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY: 'sb_secret_dummy_for_test'}});
  assert.equal(r.code, 1);
  assert.equal(r.summary.failure, 'BUDGET_EXHAUSTED');
  assert.equal(r.summary.registryChanged, false);
});

test('a rejected idea is never re-proposed and the seed registry file is never modified', () => {
  const before = readFileSync(new URL(SEED, ROOT), 'utf8');
  const dir = tmp(); run(dir, {fwd: fixture(700, 'baseline')});
  assert.equal(readFileSync(new URL(SEED, ROOT), 'utf8'), before);
  assert.ok(existsSync(join(dir, 'out', 'report.json')));
});

test('forward evaluation uses the production gate unchanged and has no write, order or promotion path', () => {
  const src = readFileSync(new URL('src/lib/lab/engine/forward.ts', ROOT), 'utf8');
  assert.match(src, /evaluateChallenger,REVIEW_GATE/);
  assert.doesNotMatch(src, /fetch\(|process\.env|writeFileSync|method:|\/rpc\/|submitLimitOrder|insert\(|upsert|PROMOT/);
  const r = forwardResult(SPEC, pair(SPEC, fixture(700, 'candidate').predictions, fixture(700, 'candidate').grades), '2026-11-28T00:00:00Z');
  assert.equal(r.disposition, 'PROMISING', 'a qualifying result is only PROMISING; the lifecycle turns it into READY_FOR_REVIEW, never live');
});
