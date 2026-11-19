import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseTickerMap,validatePointInTime,qualityReport,datasetVersion,diffManifest} from './collect.ts';
import {parseCompanyFacts} from './sec-companyfacts.ts';

// SYNTHETIC companyfacts body (shape of data.sec.gov/api/xbrl/companyfacts) — labelled fixture, not real data.
const fact = (end, filed, val, accn = '0000320193-24-000001', form = '10-Q') => ({end, val, form, fp: 'Q1', accn, filed});
const body = {cik: 320193, facts: {'us-gaap': {
  NetIncomeLoss: {units: {USD: [fact('2023-12-30', '2024-02-02', 100), fact('2023-12-30', '2024-05-03', 101, '0000320193-24-000002', '10-Q/A'), fact('2024-03-30', '2024-05-03', 90)]}},
  Assets: {units: {USD: [fact('2024-03-30', '2024-05-03', 5000), fact('2024-06-29', '2024-06-01', 1)]}}}}};

test('ticker map: SEC company_tickers.json shape, malformed entries ignored, CIK zero-padded', () => {
  const m = parseTickerMap({0: {cik_str: 320193, ticker: 'AAPL', title: 'Apple'}, 1: {cik_str: 'x', ticker: 'BAD'}, 2: {cik_str: 789019, ticker: 'msft'}});
  assert.equal(m.get('AAPL'), '0000320193');
  assert.equal(m.size, 1);
});

test('point-in-time: no filing is used before it was public; filed-before-period rows are dropped by the parser', () => {
  const {facts, dropped} = parseCompanyFacts(body);
  assert.equal(dropped, 1, 'filed before its period ended → dropped, never repaired');
  const pit = validatePointInTime(facts, '2026-11-13', ['2024-02-02', '2024-02-03', '2024-05-03', '2024-05-04']);
  assert.equal(pit.ok, true);
  assert.equal(pit.asOfLeaks, 0);
  const future = validatePointInTime(facts, '2024-03-01', []);
  assert.equal(future.filedAfterRetrieval, 3, 'a fact filed after retrieval is impossible and flagged');
});

test('quality report flags restatements, missing core tags and staleness', () => {
  const {facts, dropped} = parseCompanyFacts(body);
  const q = qualityReport(facts, dropped, '2026-11-13');
  assert.equal(q.periodsWithMultipleFilings, 1);
  assert.deepEqual(q.missingCoreTags, ['StockholdersEquity', 'Revenue (either tag)']);
  assert.equal(q.stale, true);
});

test('dataset version and duplicate detection', () => {
  const a = [{id: 'CIK1', checksum: 'x'}, {id: 'CIK2', checksum: 'y'}];
  assert.equal(datasetVersion(a), datasetVersion([...a].reverse()));
  assert.equal(diffManifest(a, a).duplicateDataset, true);
  const d = diffManifest(a, [{id: 'CIK1', checksum: 'z'}, {id: 'CIK2', checksum: 'y'}, {id: 'CIK3', checksum: 'w'}]);
  assert.deepEqual([d.added, d.changed, d.unchanged, d.duplicateDataset], [['CIK3'], ['CIK1'], ['CIK2'], false]);
});

test('collector isolation: GET only, host allowlist, budget, no database/order/model paths, literature hypothesis-only', () => {
  const src = readFileSync(new URL('../../../scripts/research-intake-collect.ts', import.meta.url), 'utf8');
  assert.match(src, /method:'GET'/);
  assert.match(src, /ALLOWED=new Set\(\['www\.sec\.gov','data\.sec\.gov','api\.openalex\.org','export\.arxiv\.org'\]\)/);
  assert.match(src, /BUDGET_EXHAUSTED/);
  assert.match(src, /intendedUse:'hypothesis-only'/);
  assert.doesNotMatch(src, /method:'(POST|PUT|PATCH|DELETE)'|supabase|\/rpc\/|ALPACA|submitLimitOrder|ODDS_API|insert\(|upsert/i);
});
