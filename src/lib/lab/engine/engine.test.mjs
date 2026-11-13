import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {validate,register,transition,blockedIdeas,EngineError,STATUSES,TRANSITIONS} from './experiments.ts';
import {sportsQuality,sportsPatterns,stockPatterns,proposeHypotheses} from './diagnostics.ts';
import {nextStatus,meetsSample} from './evaluate.ts';
import {seeded} from '../stats.ts';

const ROOT = new URL('../../../../', import.meta.url);
const seed = () => JSON.parse(readFileSync(new URL('research/engine/registry.json', ROOT), 'utf8'));
const AT = '2026-11-14T12:00:00Z';
const base = (over = {}) => ({id: 'sports-test-idea-1', domain: 'sports', hypothesisKey: 'sports:test-idea', hypothesis: 'h', dataDependencies: [],
  frozen: {features: [], parameters: {}}, dataCutoff: AT, codeFingerprint: 'x', datasetFingerprints: [], metrics: {primary: 'brier', secondary: []},
  sampleRequirements: {minObservations: 500, minDates: 14, minClusters: 50}, baseline: 'b', costAssumptions: null, decisionRule: 'r',
  status: 'PROPOSED', result: null, disposition: null, source: 'engine', registeredAt: AT, history: [], ...over});

test('the seeded registry is valid, has unique ids, and records rejected stock ideas', () => {
  const r = seed();
  for (const e of r.experiments) validate(e);
  assert.equal(new Set(r.experiments.map(e => e.id)).size, r.experiments.length);
  const {rejected, active} = blockedIdeas(r);
  assert.ok(rejected.has('stocks:daily-short-term-reversal'));
  assert.ok(active.has('sports:side-asymmetric-calibration'));
  assert.ok(active.has('sports:short-history-shrinkage'), 'alsoCovers blocks related ideas');
  assert.ok(!r.experiments.some(e => !STATUSES.includes(e.status)));
});

test('registration refuses duplicates, rejected ideas and ideas already under test', () => {
  const r = seed();
  assert.throws(() => register(r, base({id: 'daily-reversal5-v1'}), AT), e => e instanceof EngineError && e.code === 'DUPLICATE_ID');
  assert.throws(() => register(r, base({hypothesisKey: 'stocks:daily-short-term-reversal', domain: 'stocks'}), AT), {code: 'IDEA_ALREADY_REJECTED'});
  assert.throws(() => register(r, base({hypothesisKey: 'sports:line-gap-shrinkage'}), AT), {code: 'IDEA_ALREADY_UNDER_TEST'});
  assert.throws(() => register(r, base({hypothesisKey: 'stocks:x'}), AT), {code: 'DOMAIN_MISMATCH'});
  const ok = register(r, base(), AT);
  assert.equal(ok.experiments.length, r.experiments.length + 1);
  assert.equal(ok.experiments.at(-1).history[0].reason, 'registered');
});

test('lifecycle: no promotion status exists, REJECTED is terminal, illegal moves throw, the same input is processed once', () => {
  assert.ok(!STATUSES.some(s => /PROMOT|ACTIVE|LIVE/.test(s)));
  assert.deepEqual(TRANSITIONS.REJECTED, []);
  let r = register(seed(), base(), AT);
  assert.throws(() => transition(r, 'sports-test-idea-1', 'READY_FOR_REVIEW', 'x', AT, null), {code: 'ILLEGAL_TRANSITION_PROPOSED_TO_READY_FOR_REVIEW'});
  ({registry: r} = transition(r, 'sports-test-idea-1', 'RUNNING', 'start', AT, 'fp1'));
  const again = transition(r, 'sports-test-idea-1', 'REJECTED', 'dup', AT, 'fp1');
  assert.equal(again.changed, false, 'duplicate processing of the same input is a no-op');
  ({registry: r} = transition(r, 'sports-test-idea-1', 'REJECTED', 'bad', AT, 'fp2'));
  assert.throws(() => transition(r, 'sports-test-idea-1', 'RUNNING', 'retry', AT, 'fp3'), {code: 'ILLEGAL_TRANSITION_REJECTED_TO_RUNNING'});
});

test('evaluation: retrospective evidence can never reach review; forward evidence needs the registered sample', () => {
  const e = base({status: 'RUNNING'});
  const res = (over) => ({evidence: 'retrospective', disposition: 'PROMISING', observations: 50000, dates: 100, clusters: 800, decisions: 9000, reason: 'r', ...over});
  assert.equal(nextStatus(e, res()).to, 'PROMISING');
  assert.equal(nextStatus(e, res({evidence: 'forward', observations: 120, dates: 6, clusters: 20})).to, 'INSUFFICIENT_DATA');
  assert.equal(nextStatus(e, res({evidence: 'forward', observations: 600, dates: 20, clusters: 60})).to, 'READY_FOR_REVIEW');
  assert.equal(nextStatus(e, res({disposition: 'REJECTED'})).to, 'REJECTED');
  assert.equal(nextStatus(e, res({disposition: 'ERROR'})).to, 'FAILED');
  assert.equal(nextStatus({...e, status: 'READY_FOR_REVIEW'}, res({evidence: 'forward', observations: 1})).to, 'READY_FOR_REVIEW');
  assert.deepEqual(meetsSample(res({observations: 10}), e.sampleRequirements).missing, ['observations 10/500']);
});

const row = (i, over = {}) => ({key: 'k' + i, game: 'g' + (i % 40), date: '2026-11-0' + (1 + i % 9), stat: 'points', predictedAt: '2026-11-10T18:00:00Z',
  lockAt: '2026-11-11T00:00:00Z', gradedAt: '2026-11-11T10:00:00Z', pMore: 0.68, outcome: 'more', picked: 'more', modelVersion: 'm',
  lineGapRel: 0.1, minutesCv: 0.1, games: 20, booksAgree: true, ...over});

test('data quality: duplicates, predictions at/after lock, future timestamps, invalid probabilities and stale inputs are excluded, never repaired', () => {
  const rows = [row(1), row(1), row(2, {predictedAt: '2026-11-11T00:00:00Z'}), row(3, {gradedAt: '2027-01-01T00:00:00Z'}), row(4, {pMore: 1}),
    row(5, {predictedAt: '2026-11-01T00:00:00Z'}), row(6, {game: ''})];
  const q = sportsQuality(rows, '2026-11-14T00:00:00Z');
  assert.deepEqual(q.clean.map(r => r.key), ['k1']);
  assert.deepEqual(q.issues.map(i => i.code).sort(), ['DUPLICATE', 'FUTURE_TIMESTAMP', 'INVALID_PROBABILITY', 'MISSING_FIELD', 'PREDICTED_AFTER_LOCK', 'STALE_INPUT']);
});

test('patterns need a clustered interval excluding zero; hypotheses skip ideas under test and are capped, deterministically', () => {
  const r = seeded(5), rows = [];
  for (let i = 0; i < 400; i++) {
    const more = i % 2 === 0;
    rows.push(row(i, {picked: more ? 'more' : 'less', pMore: more ? 0.68 : 0.32, outcome: more ? (r() < 0.5 ? 'more' : 'less') : (r() < 0.68 ? 'less' : 'more'),
      booksAgree: null, lineGapRel: i % 4 === 0 ? 0.5 : 0.1}));
  }
  const p = sportsPatterns(rows);
  const more = p.find(x => x.id === 'picks-more'), less = p.find(x => x.id === 'picks-less');
  assert.ok(more.significant && more.lower95 > 0, 'More picks 68% stated vs ~50% realised');
  assert.ok(!less.significant, 'Less picks are calibrated');
  const reg = seed();
  const a = proposeHypotheses(p, reg, 1), b = proposeHypotheses(p, reg, 1);
  assert.deepEqual(a, b);
  assert.ok(a.skipped.some(s => s.key === 'sports:side-asymmetric-calibration' && s.why === 'already_under_test'));
  assert.ok(a.proposed.length <= 1);
  assert.ok(a.proposed.every(h => !blockedIdeas(reg).active.has(h.key) && !blockedIdeas(reg).rejected.has(h.key)));
});

test('stock patterns use 4-week blocks and need 26 weeks', () => {
  const r = seeded(9);
  const weeks = Array.from({length: 60}, (_, i) => ({week: `2025-W${String(i).padStart(2, '0')}`, strategy: 0.001 + (r() - 0.5) * 0.01, spy: 0.004 + (r() - 0.5) * 0.01, exposure: 0.5}));
  assert.deepEqual(stockPatterns(weeks.slice(0, 20)), []);
  const p = stockPatterns(weeks);
  assert.equal(p.length, 2);
  assert.equal(p[0].clusters, 15);
});

test('isolation: the engine and runner can only read; no writes, provider, broker, AI or order paths', () => {
  const files = ['src/lib/lab/engine/experiments.ts', 'src/lib/lab/engine/diagnostics.ts', 'src/lib/lab/engine/evaluate.ts', 'scripts/research-engine.ts'];
  for (const f of files) {
    const src = readFileSync(new URL(f, ROOT), 'utf8');
    assert.doesNotMatch(src, /method:'(POST|PATCH|PUT|DELETE)'|\/rpc\/|the-odds-api|ODDS_API_KEY|alpaca|ALPACA|anthropic|openai|submitLimitOrder|props_set_|insert\(|\.upsert/, f);
  }
  const runner = readFileSync(new URL('scripts/research-engine.ts', ROOT), 'utf8');
  assert.match(runner, /method:'GET'/);
  assert.match(runner, /host!=='vfyzbliksooljxrlfadp\.supabase\.co'/);
});

test('runner (offline): proposes at most 2 per domain, writes only to --out, and a rerun on the same data proposes nothing new', () => {
  const dir = mkdtempSync(join(tmpdir(), 'engine-'));
  const r = seeded(13), rows = [];
  for (let i = 0; i < 300; i++) rows.push(row(i, {booksAgree: null, picked: 'less', pMore: 0.3, outcome: r() < 0.55 ? 'less' : 'more'}));
  writeFileSync(join(dir, 'rows.json'), JSON.stringify(rows));
  const run = (reg, out) => JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/research-engine.ts', '--registry', reg,
    '--out', out, '--sports-rows', join(dir, 'rows.json'), '--now', '2026-11-14T00:00:00Z'], {cwd: ROOT, encoding: 'utf8'}).trim().split('\n').at(-1));
  const first = run('research/engine/registry.json', join(dir, 'a'));
  assert.ok(first.proposed.sports.length <= 2);
  assert.ok(first.proposed.sports.includes('sports:market-anchor-when-books-missing') === false, 'covered by the market experiment');
  const second = run(join(dir, 'a', 'registry.json'), join(dir, 'b'));
  assert.deepEqual(second.proposed.sports, [], 'ideas proposed once are under test and never proposed again');
  assert.deepEqual(JSON.parse(readFileSync(new URL('research/engine/registry.json', ROOT), 'utf8')), seed(), 'the input registry file is never modified');
});
