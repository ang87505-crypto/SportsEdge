"""Server-side receipt regression tests: backdated git dates, missing receipts, late uploads, invalid prior
predictions. A real git repository and a fake GitHub status server; TEST-ONLY data, no network."""
from __future__ import annotations
from datetime import timedelta
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from analytics.research import forward_ledger as fl
from analytics.research import ledger_receipts as lr
from analytics.research.test_forward_ledger import CAL, MEMBERS, at, market_factory, series_for

BOT = 'github-actions[bot]'


class FakeStatuses:
    """GitHub's commit-status store: the server sets created_at (here, the test's `server_time`)."""

    def __init__(self):
        self.rows, self.fail, self.server_time = {}, False, None

    def create(self, commit, signal, record_sha, target_url=None, creator=BOT, description=None):
        row = {'id': len(self.rows) + 1, 'context': lr.context(signal), 'description': description or lr.description(record_sha),
               'created_at': self.server_time, 'creator': {'login': creator}}
        self.rows.setdefault(commit, []).append(row)
        return row

    def list(self, commit):
        if self.fail:
            raise lr.ReceiptUnavailable('NETWORK:TimeoutError')
        return list(self.rows.get(commit, []))


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.ledger = fl.Ledger(self.dir)
        self.git('init', '-q')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'user.name', 'test')
        self.server = FakeStatuses()

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args, date=None):
        env = dict(os.environ)
        if date:
            env.update(GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date)
        return subprocess.run(['git', '-C', str(self.dir), *args], check=True, capture_output=True, text=True, env=env).stdout

    def commit(self, message, date=None):
        self.git('add', '-A')
        self.git('commit', '-q', '-m', message, date=date)
        return self.git('rev-parse', 'HEAD').strip()

    def receipts(self):
        return lr.lookup(self.dir, self.ledger.predictions(), self.server, fl.sha)

    def predict(self, when):
        return fl.predict(self.ledger, now=at(when), calendar=CAL, market=market_factory(), members=MEMBERS,
                          code_commit='test', receipts=self.receipts())

    def receipt(self, signal, server_time, **kw):
        self.server.server_time = server_time
        commit = lr.adding_commit(self.dir, signal)
        return self.server.create(commit, signal, self.ledger.prediction(signal)['record_sha'], **kw)


class BackdatedGit(Base):
    def test_a_backdated_git_commit_is_never_timing_evidence(self):
        self.predict('2026-11-30T21:30:00')
        # The commit claims 21:31 on the signal day, before the 2026-12-01 14:30 UTC open.
        self.commit('prediction', date='2026-11-30T21:31:00+00:00')
        self.assertIn('2026-11-30T21:31:00', self.git('log', '-1', '--format=%cI'))
        self.assertEqual(fl.verify_chain(self.ledger, self.receipts())['2026-11-30'], 'INVALID_NO_RECEIPT')
        # The server receipt arrived after the open: the early git date does not rescue it.
        self.receipt('2026-11-30', '2026-12-01T15:02:11Z')
        self.assertEqual(fl.verify_chain(self.ledger, self.receipts())['2026-11-30'], 'INVALID_RECEIPT_LATE')

    def test_a_server_receipt_before_the_open_is_valid_whatever_the_git_date(self):
        self.predict('2026-11-30T21:30:00')
        self.commit('prediction', date='2031-01-01T00:00:00+00:00')          # absurd future git date: irrelevant
        self.receipt('2026-11-30', '2026-11-30T21:32:40Z')
        r = self.receipts()['2026-11-30']
        self.assertEqual((r['state'], r['created_at']), ('FOUND', '2026-11-30T21:32:40Z'))
        self.assertEqual(fl.verify_chain(self.ledger, self.receipts())['2026-11-30'], 'VALID')


class MissingAndUnverifiable(Base):
    def test_missing_receipt_or_no_evidence_at_all_fails_closed(self):
        self.predict('2026-11-30T21:30:00')
        self.assertEqual(fl.verify_chain(self.ledger, None)['2026-11-30'], 'INVALID_NO_RECEIPT')
        self.assertEqual(fl.verify_chain(self.ledger, {})['2026-11-30'], 'INVALID_NO_RECEIPT')
        # Not even committed: no ledger commit to receipt.
        self.assertEqual(self.receipts()['2026-11-30'], {'state': 'MISSING', 'reason': 'NO_LEDGER_COMMIT'})
        self.commit('prediction')
        self.assertEqual(self.receipts()['2026-11-30']['reason'], 'NO_TRUSTED_STATUS_FOR_THIS_HASH')

    def test_an_unreachable_receipt_server_is_never_valid(self):
        self.predict('2026-11-30T21:30:00')
        self.commit('prediction')
        self.receipt('2026-11-30', '2026-11-30T21:32:40Z')
        self.server.fail = True
        r = self.receipts()
        self.assertEqual(r['2026-11-30']['state'], 'UNAVAILABLE')
        self.assertEqual(fl.verify_chain(self.ledger, r)['2026-11-30'], 'INVALID_RECEIPT_UNVERIFIABLE')
        with self.assertRaises(lr.ReceiptUnavailable):
            lr.GitHubStatuses('', '')

    def test_untrusted_creator_wrong_hash_and_later_duplicates(self):
        self.predict('2026-11-30T21:30:00')
        self.commit('prediction')
        self.receipt('2026-11-30', '2026-11-30T21:32:00Z', creator='someone-else')
        self.receipt('2026-11-30', '2026-11-30T21:32:01Z', description=lr.description('0' * 64))
        self.assertEqual(fl.verify_chain(self.ledger, self.receipts())['2026-11-30'], 'INVALID_NO_RECEIPT')
        self.receipt('2026-11-30', '2026-11-30T21:33:00Z')
        self.receipt('2026-11-30', '2026-12-02T09:00:00Z')              # a later duplicate cannot replace the first
        self.assertEqual(self.receipts()['2026-11-30']['created_at'], '2026-11-30T21:33:00Z')
        self.assertEqual(fl.verify_chain(self.ledger, self.receipts())['2026-11-30'], 'VALID')

    def test_receipt_must_bind_the_file_exactly_as_committed(self):
        self.predict('2026-11-30T21:30:00')
        self.commit('prediction')
        self.receipt('2026-11-30', '2026-11-30T21:33:00Z')
        r = self.receipts()
        r['2026-11-30']['content_record_sha'] = None                   # file at that commit did not hash to the record
        self.assertEqual(fl.verify_chain(self.ledger, r)['2026-11-30'], 'INVALID_RECEIPT_MISMATCH')


class LateUpload(Base):
    def test_record_made_in_time_but_receipted_after_the_open_is_late(self):
        self.predict('2026-11-30T21:30:00')
        self.commit('prediction')
        self.receipt('2026-11-30', '2026-12-01T14:30:00Z')              # exactly at the open: late
        self.assertEqual(fl.verify_chain(self.ledger, self.receipts())['2026-11-30'], 'INVALID_RECEIPT_LATE')

    def test_no_prediction_is_started_inside_the_receipt_margin(self):
        ev = self.predict('2026-12-01T14:11:00')                       # 19 minutes before the open
        self.assertEqual(ev['kind'], 'TOO_CLOSE_TO_DEADLINE')
        self.assertEqual(self.ledger.predictions(), {})
        self.assertEqual(self.predict('2026-12-01T14:31:00')['kind'], 'MISSED')
        self.assertIn('2026-11-30', self.ledger.missed())
        self.assertEqual(self.predict('2026-12-01T14:09:00')['kind'], 'MISSED')   # never reopened once missed


class InvalidPriorPredictions(Base):
    def test_an_invalid_prior_prediction_never_sets_buffer_holdings(self):
        self.predict('2026-11-30T21:30:00')
        self.commit('november', date='2026-11-30T21:31:00+00:00')
        self.receipt('2026-11-30', '2026-12-01T16:00:00Z')              # November receipted late: INVALID
        self.predict('2026-12-31T21:30:00')
        dec = self.ledger.prediction('2026-12-31')['strategies'][fl.BUFFER]
        self.assertEqual(dec['held_before'], [])                       # not November's targets

    def test_valid_prior_prediction_sets_holdings_and_later_invalidation_cascades(self):
        self.predict('2026-11-30T21:30:00')
        self.commit('november')
        self.receipt('2026-11-30', '2026-11-30T21:33:00Z')
        self.predict('2026-12-31T21:30:00')
        self.commit('december')
        self.receipt('2026-12-31', '2026-12-31T21:33:00Z')
        nov = sorted(self.ledger.prediction('2026-11-30')['strategies'][fl.BUFFER]['targets'])
        self.assertEqual(self.ledger.prediction('2026-12-31')['strategies'][fl.BUFFER]['held_before'], nov)
        self.assertEqual(set(fl.verify_chain(self.ledger, self.receipts()).values()), {'VALID'})
        # Without November's receipt, December's recorded holdings no longer follow a VALID prediction.
        r = self.receipts()
        del r['2026-11-30']
        v = fl.verify_chain(self.ledger, r)
        self.assertEqual((v['2026-11-30'], v['2026-12-31']), ('INVALID_NO_RECEIPT', 'INVALID_HELD_STATE_MISMATCH'))

    def test_prediction_waits_when_an_earlier_receipt_cannot_be_checked(self):
        self.predict('2026-11-30T21:30:00')
        self.commit('november')
        self.receipt('2026-11-30', '2026-11-30T21:33:00Z')
        self.server.fail = True
        ev = self.predict('2026-12-31T21:30:00')
        self.assertEqual(ev['kind'], 'RECEIPT_CHECK_UNAVAILABLE')
        self.assertIsNone(self.ledger.prediction('2026-12-31'))

    def test_invalid_predictions_never_enter_forward_performance(self):
        self.predict('2026-11-30T21:30:00')
        self.commit('november')
        self.receipt('2026-11-30', '2026-11-30T21:33:00Z')
        self.predict('2026-12-31T21:30:00')
        self.commit('december')                                          # never receipted
        sessions, se = market_factory()('2027-02-01T00:00:00Z')
        out = fl.evaluate(self.ledger, now=at('2027-02-01T03:00:00'), calendar=CAL, sessions=sessions, series=se, actions=[],
                          members=MEMBERS, data_fingerprint='x', code_commit='test', receipts=self.receipts())
        self.assertEqual(out['month_statuses'], {'2026-11-30': 'VALID', '2026-12-31': 'INVALID_NO_RECEIPT'})
        self.assertEqual(out['rebalances'], 1)
        self.assertEqual([d['label'] for d in fl.frozen_decisions(self.ledger, out['month_statuses'], sessions, fl.BUFFER)],
                         ['forward 2026-11-30'])


class ScheduleBudget(unittest.TestCase):
    """Requirement: a delayed scheduled run must still record, push and obtain its receipt before the open."""

    def test_every_month_end_shape_survives_the_longest_observed_github_delay(self):
        for signal, opens_at in (('2026-11-30', '2026-12-01T14:30:00Z'),     # EST, weekday
                                 ('2026-07-31', '2026-08-03T13:30:00Z'),     # EDT, Friday: window spans the weekend
                                 ('2026-12-31', '2027-01-04T14:30:00Z'),     # holiday next day, then a weekend
                                 ('2027-01-29', '2027-02-01T14:30:00Z')):    # Friday, weekend month-end
            self.assertEqual(fl.next_open_utc(CAL, signal), opens_at)
            budget = fl.attempt_budget(CAL, signal)
            self.assertGreaterEqual(len(budget), 5, signal)
            # The first attempt can start more than the longest delay measured here (634 min) late and still finish.
            self.assertGreater(budget[0]['max_start_delay_minutes'], fl.OBSERVED_MAX_GITHUB_DELAY.total_seconds() / 60, signal)
            latest = fl.utc(opens_at) - fl.RECEIPT_MARGIN - fl.PIPELINE_ALLOWANCE
            self.assertTrue(all(fl.utc(b['attempt']) <= latest for b in budget))
            # No attempt before the closing bar is final.
            self.assertTrue(all(fl.utc(b['attempt']) >= fl.utc(fl.cand.close_utc(signal)) + fl.CLOSE_SETTLE + fl.DATA_DELAY
                                for b in budget))

    def test_the_pipeline_allowance_fits_inside_the_receipt_margin_logic(self):
        # A run that starts at the last allowed moment finishes its receipt before the open even if every step
        # uses its full time limit.
        self.assertLessEqual(fl.PIPELINE_ALLOWANCE, timedelta(minutes=20))
        self.assertGreaterEqual(fl.RECEIPT_MARGIN, timedelta(minutes=20))


class GitHubClient(unittest.TestCase):
    def test_create_and_list_use_the_status_api_and_fail_closed(self):
        calls = []

        def transport(method, url, headers, body):
            calls.append((method, url, json.loads(body) if body else None, headers['Authorization']))
            if method == 'POST':
                return 201, b'{"id": 1}'
            return 200, json.dumps([{'context': 'x'}] * (100 if url.endswith('&page=1') else 3)).encode()
        c = lr.GitHubStatuses('o/r', 'tok', transport)
        c.create('abc', '2026-11-30', 'f' * 64, 'https://run')
        self.assertEqual(calls[0][:3], ('POST', 'https://api.github.com/repos/o/r/statuses/abc',
                                        {'state': 'success', 'context': 'forward-ledger/receipt/2026-11-30',
                                         'description': 'record_sha=' + 'f' * 64, 'target_url': 'https://run'}))
        self.assertEqual(len(c.list('abc')), 103)
        self.assertEqual(len(lr.description('f' * 64)), 75)        # within GitHub's 140-character limit
        for bad in ((500, b''), (401, b''), (404, b'')):
            with self.assertRaises(lr.ReceiptUnavailable):
                lr.GitHubStatuses('o/r', 'tok', lambda *a, b=bad: b).list('abc')

        def boom(*a):
            raise TimeoutError()
        with self.assertRaises(lr.ReceiptUnavailable):
            lr.GitHubStatuses('o/r', 'tok', boom).list('abc')


if __name__ == '__main__':
    unittest.main()
