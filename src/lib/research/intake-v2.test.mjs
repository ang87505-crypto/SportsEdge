import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SOURCE_REGISTER,registerProblems,sourceById} from './sources.ts';
import {verify,record,checksum} from './provenance.ts';
import {parseCompanyFacts,asOf,provenanceFor} from './sec-companyfacts.ts';

test('the source register is consistent: every non-connected source states its blocker; no paid source is silently connected', () => {
  assert.deepEqual(registerProblems(), []);
  assert.equal(sourceById('nba-official-injury-report').status, 'blocked');
  assert.equal(sourceById('nba-stats-lineups').status, 'blocked');
  assert.equal(sourceById('survivorship-free-constituents').status, 'proposed');
  assert.deepEqual(registerProblems([...SOURCE_REGISTER, {...SOURCE_REGISTER[0], id: 'x', status: 'proposed', blocker: null}]), ['x: non-connected source without a blocker']);
  for (const s of SOURCE_REGISTER.filter(s => s.status === 'connected')) assert.ok(s.whereInCode, s.id);
});

const item = (over = {}) => record({sourceId: 'sec-edgar-companyfacts', sourceItemId: 'CIK0000320193', originalUrl: 'https://data.sec.gov/x',
  retrievedAt: '2026-11-13T12:00:00Z', availableAt: '2026-10-31T00:00:00Z', eventDate: null, reliability: 'regulatory', intendedUse: 'point-in-time-feature',
  content: {v: 1}, ...over});

test('provenance: point-in-time use needs availability strictly before the cutoff; missing availability excludes the item', () => {
  assert.deepEqual(verify(item(), '2026-11-02T00:00:00Z'), {usable: true, pointInTime: true, reasons: []});
  assert.ok(verify(item(), '2026-10-31T00:00:00Z').reasons.includes('NOT_AVAILABLE_BEFORE_CUTOFF'), 'available on the cutoff is too late');
  const none = verify(item({availableAt: null}), '2026-12-01T00:00:00Z');
  assert.equal(none.pointInTime, false);
  assert.ok(none.reasons.includes('NO_AVAILABILITY_TIME'));
});

test('provenance: tampered content, unregistered or blocked sources and impossible timestamps are refused', () => {
  const r = item();
  assert.ok(verify({...r, content: {v: 2}}).reasons.includes('CHECKSUM_MISMATCH'));
  assert.ok(verify(item({sourceId: 'random-blog'})).reasons.includes('UNREGISTERED_SOURCE'));
  assert.ok(verify(item({sourceId: 'nba-official-injury-report', reliability: 'official'})).reasons.includes('SOURCE_NOT_APPROVED_BLOCKED'));
  assert.ok(verify(item({availableAt: '2026-12-01T00:00:00Z'})).reasons.includes('AVAILABLE_AFTER_RETRIEVAL'));
  assert.ok(verify(item({reliability: 'secondary'})).reasons.includes('RELIABILITY_MISMATCH'));
  assert.equal(checksum({b: 1, a: 2}), checksum({a: 2, b: 1}), 'key order never changes a checksum');
});

test('literature can only suggest hypotheses, never become a feature', () => {
  const lit = record({sourceId: 'openalex', sourceItemId: 'W1', originalUrl: 'https://openalex.org/W1', retrievedAt: '2026-11-13T00:00:00Z',
    availableAt: '2025-01-01T00:00:00Z', eventDate: null, reliability: 'peer-reviewed', intendedUse: 'hypothesis-only', content: {title: 't'}});
  const v = verify(lit, '2026-11-14T00:00:00Z');
  assert.equal(v.pointInTime, false);
  assert.ok(v.reasons.includes('LITERATURE_NEVER_A_FEATURE'));
});

const facts = {cik: 320193, facts: {'us-gaap': {
  NetIncomeLoss: {units: {USD: [
    {end: '2025-06-28', val: 100, form: '10-Q', fp: 'Q3', accn: '0000320193-25-000071', filed: '2025-08-01'},
    {end: '2025-09-27', val: 120, form: '10-K', fp: 'FY', accn: '0000320193-25-000079', filed: '2025-10-31'},
    {end: '2025-09-27', val: 118, form: '10-K/A', fp: 'FY', accn: '0000320193-26-000002', filed: '2026-01-15'},
    {end: 'bad', val: 1, form: '10-Q', accn: '0000320193-25-000001', filed: '2025-01-01'},
    {end: '2025-09-27', val: 5, form: '8-K', accn: '0000320193-25-000002', filed: '2025-10-01'},
    {end: '2025-09-27', val: 7, form: '10-Q', accn: '0000320193-25-000003', filed: '2025-09-01'}]}},
}}};

test('SEC company facts: values are usable only after their filing date; restatements stay separate; malformed rows are dropped', () => {
  const {facts: f, dropped} = parseCompanyFacts(facts);
  assert.equal(f.length, 3);
  assert.equal(dropped, 3, 'bad date, non-periodic form, and filed-before-period-end are dropped');
  assert.equal(asOf(f, 'NetIncomeLoss', '2025-10-31').value, 100, 'the 10-K filed on 2025-10-31 is not usable that day');
  assert.equal(asOf(f, 'NetIncomeLoss', '2025-11-01').value, 120);
  assert.equal(asOf(f, 'NetIncomeLoss', '2026-01-16').value, 118, 'the amendment applies only after it was filed');
  assert.equal(asOf(f, 'NetIncomeLoss', '2025-08-01'), null);
  assert.deepEqual(parseCompanyFacts({nope: 1}), {facts: [], dropped: 0});
  const p = provenanceFor(facts, '0000320193', '2026-11-13T00:00:00Z');
  assert.equal(p.availableAt, '2026-01-15T00:00:00Z');
  assert.equal(verify(p, '2026-02-01T00:00:00Z').pointInTime, true);
});

test('intake modules cannot fetch, write or act', () => {
  for (const f of ['sources.ts', 'provenance.ts', 'sec-companyfacts.ts']) {
    const src = readFileSync(new URL('./' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bfetch\(|process\.env|writeFileSync|\.insert\(|\/rpc\/|submitLimitOrder|new WebSocket/, f);
  }
});
