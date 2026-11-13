import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyse,buildRows,latestResults,wilson,expectedVsRealised} from './props-calibration-audit-lib.mjs';

// Synthetic TEST-ONLY ledger rows.
const obs=(id,ev,player,line,platform='prizepicks')=>({id,platform,provider_event_id:ev,home_team:'H',away_team:'A',lock_at:'2026-11-10T00:00:00Z',player_name:player,stat:'points',line});
const pred=(id,obsId,pMore,model='m1')=>({id,observation_id:obsId,model_version:model,status:'scored',p_more:pMore,p_less:1-pMore-0.02,p_tie:0.02});

test('the audit script only reads: GET requests, no RPC, no provider, no writes', () => {
  const src = readFileSync(new URL('./props-calibration-audit.mjs', import.meta.url), 'utf8');
  assert.match(src, /method:'GET'/);
  assert.doesNotMatch(src, /method:'(POST|PATCH|PUT|DELETE)'|rest\/v1\/rpc|the-odds-api|ODDS_API_KEY/);
});

test('the same line on two platforms counts once; other models and unscored rows are ignored', () => {
  const r = buildRows({observations: [obs(1, 'e', 'P', 20.5), obs(2, 'e', 'p', 20.5, 'pick6'), obs(3, 'e', 'Q', 10.5)],
    predictions: [pred(10, 1, 0.7), pred(11, 2, 0.7), pred(12, 3, 0.4, 'other'), {...pred(13, 3, 0.4), status: 'unscorable'}],
    picks: [], results: [], views: [], model: 'm1', selection: 's1'});
  assert.equal(r.rows.length, 1);
  assert.equal(r.duplicates, 1);
});

test('latest revision wins and corrections are counted', () => {
  const {by, corrected, changed} = latestResults([{observation_id: 1, revision: 2, outcome: 'less'}, {observation_id: 1, revision: 1, outcome: 'more'}]);
  assert.equal(by.get(1).outcome, 'less');
  assert.equal(corrected, 1);
  assert.equal(changed, 1);
});

test('picks: confidence vs hit rate, buckets, ties/voids/pending kept apart, small samples called indistinguishable', () => {
  const observations = [], predictions = [], picks = [], results = [];
  for (let i = 1; i <= 12; i++) {
    observations.push(obs(i, 'e' + (i % 3), 'P' + i, 10.5));
    predictions.push(pred(100 + i, i, 0.70));
    picks.push({id: 200 + i, prediction_id: 100 + i, status: 'recorded', side: 'more', selection_version: 's1'});
    if (i <= 10) results.push({observation_id: i, revision: 1, outcome: i <= 6 ? 'more' : 'less', actual: 0});
  }
  results.push({observation_id: 11, revision: 1, outcome: 'void_dnp', actual: null});
  const a = analyse({observations, predictions, picks, results, views: [], model: 'm1', selection: 's1'});
  assert.equal(a.picks.n, 10);
  assert.equal(a.picks.hits, 6);
  assert.equal(a.picks.pending, 1);
  assert.equal(a.picks.voided, 1);
  assert.ok(Math.abs(a.picks.meanConf - 0.7143) < 1e-3);
  assert.match(a.picks.overconfidence.verdict, /not distinguishable/);
  assert.equal(a.pickBuckets.length, 1);
  assert.ok(a.allLines.brier > 0 && a.allLines.logLoss > 0);
  assert.equal(a.byBookConsensus[0].key, 'no book quote at the same line');
});

test('a large, clearly overconfident sample is called overconfident', () => {
  const observations = [], predictions = [], picks = [], results = [];
  for (let i = 1; i <= 400; i++) {
    observations.push(obs(i, 'e' + i, 'P' + i, 10.5));
    predictions.push(pred(1000 + i, i, 0.75));
    picks.push({id: 2000 + i, prediction_id: 1000 + i, status: 'recorded', side: 'more', selection_version: 's1'});
    results.push({observation_id: i, revision: 1, outcome: i % 2 ? 'more' : 'less', actual: 0});
  }
  const a = analyse({observations, predictions, picks, results, views: [], model: 'm1', selection: 's1'});
  assert.match(a.picks.overconfidence.verdict, /^overconfident/);
});

test('wilson interval and expected vs realised use only known payouts', () => {
  assert.deepEqual(wilson(0, 0), [null, null]);
  const [lo, hi] = wilson(6, 10);
  assert.ok(lo < 0.6 && hi > 0.6);
  const e = expectedVsRealised([{id: 1, stake_cents: 500}, {id: 2, stake_cents: 500}],
    new Map([[1, [{pick_id: 1}, {pick_id: 2}]], [2, [{pick_id: 3}, {pick_id: 4}]]]), new Map([[1, 0.7], [2, 0.7], [3, 0.6], [4, 0.6]]),
    new Map([[1, {profit_cents: 1000}], [2, {profit_cents: null}]]));
  assert.equal(e.entries, 1);
  assert.equal(e.expectedProfitCents, Math.round(500 * 3 * 0.49 - 500));
  assert.equal(e.realisedProfitCents, 1000);
});
