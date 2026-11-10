"""Forward ledger for mq-buffer-v1. Synthetic TEST-ONLY calendar, bars and members; no network."""
from __future__ import annotations
import copy
from datetime import date, datetime, timedelta, timezone
import json
import tempfile
import unittest
from pathlib import Path

from analytics.research import forward_ledger as fl

HOLIDAYS = {'2026-11-26', '2026-12-25', '2027-01-01', '2026-09-07', '2026-07-03', '2026-05-25', '2026-01-19',
            '2026-02-16', '2026-04-03', '2026-06-19', '2025-11-27', '2025-12-25'}


def calendar(start=date(2025, 6, 2), end=date(2027, 3, 1)):
    d, out = start, []
    while d <= end:
        if d.weekday() < 5 and d.isoformat() not in HOLIDAYS:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


CAL = calendar()
MEMBERS = [{'symbol': f'S{i:02d}', 'sector': f'X{i % 6}'} for i in range(12)] + [{'symbol': 'PRICEY', 'sector': 'X9'}]


def series_for(sessions, bump=None):
    se = {}
    for i, m in enumerate(MEMBERS):
        base = 500.0 if m['symbol'] == 'PRICEY' else 20.0 + i
        drift = 0.0012 if m['symbol'] == 'PRICEY' else 0.0003 * (i + 1)
        px = [base * (1 + drift) ** k * (1 + 0.008 * ((k * (i + 3)) % 5 - 2)) for k in range(len(sessions))]
        se[m['symbol']] = {'o': px[:], 'c': px[:], 'ao': px[:], 'ac': px[:], 'v': [5_000_000] * len(sessions)}
    spy = [400.0 * 1.0003 ** k for k in range(len(sessions))]
    se['SPY'] = {'o': spy[:], 'c': spy[:], 'ao': spy[:], 'ac': spy[:], 'v': [1e8] * len(sessions)}
    if bump:
        bump(se, sessions)
    return se


def market_factory(bump=None, drop_signal_bars=None):
    """Bars up to the New York date of end_time; a session's bar exists only once 16:20 New York has passed."""
    def market(end_time):
        end = fl.utc(end_time)
        sessions = [d for d in CAL if fl.utc(fl.cand.close_utc(d)) + fl.CLOSE_SETTLE <= end]
        se = series_for(sessions, bump)
        if drop_signal_bars:
            for sym in drop_signal_bars:
                for f in ('o', 'c', 'ao', 'ac', 'v'):
                    se[sym][f][-1] = None
        return sessions, se
    return market


def at(s):
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ledger = fl.Ledger(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def predict(self, when, market=None):
        return fl.predict(self.ledger, now=at(when), calendar=CAL, market=market or market_factory(), members=MEMBERS,
                          code_commit='test')


class MonthEnd(Base):
    def test_month_end_detection_with_weekends_and_holidays(self):
        self.assertTrue(fl.is_month_end(CAL, '2026-11-30'))      # Monday
        self.assertFalse(fl.is_month_end(CAL, '2026-11-27'))
        self.assertTrue(fl.is_month_end(CAL, '2026-12-31'))      # Thursday; 2027-01-01 is a holiday
        self.assertTrue(fl.is_month_end(CAL, '2027-01-29'))      # 30-31 January is a weekend
        self.assertTrue(fl.is_month_end(CAL, '2026-07-31'))
        self.assertFalse(fl.is_month_end(CAL, '2026-11-26'))     # Thanksgiving is not a session
        with self.assertRaises(fl.LedgerError):
            fl.is_month_end(['2026-11-30'], '2026-11-30')
        self.assertEqual(fl.next_open_utc(CAL, '2026-11-30'), '2026-12-01T14:30:00Z')   # EST
        self.assertEqual(fl.next_open_utc(CAL, '2026-07-31'), '2026-08-03T13:30:00Z')   # EDT

    def test_no_signal_before_the_first_registered_month_end(self):
        self.assertEqual(self.predict('2026-11-10T22:00:00')['kind'], 'NOT_A_SIGNAL_SESSION')
        self.assertEqual(self.ledger.predictions(), {})


class Predict(Base):
    def test_recorded_after_close_before_next_open_and_frozen(self):
        self.assertEqual(self.predict('2026-11-30T20:30:00')['kind'], 'BEFORE_CLOSE_DATA')    # 15:30 New York
        ev = self.predict('2026-11-30T21:30:00')
        self.assertEqual(ev['kind'], 'RECORDED')
        rec = self.ledger.prediction('2026-11-30')
        self.assertLess(fl.utc(rec['created_at']), fl.utc(rec['next_open_utc']))
        self.assertEqual(rec['execution_session'], '2026-12-01')
        for sid in (fl.BUFFER, fl.BASELINE):
            self.assertTrue(rec['strategies'][sid]['targets'])
        self.assertEqual(rec['strategies'][fl.BUFFER]['held_before'], [])
        self.assertEqual(len(rec['input_fingerprint']), 64)
        self.assertEqual(fl.verify_chain(self.ledger), {'2026-11-30': 'VALID'})

    def test_duplicate_runs_never_change_the_record(self):
        self.predict('2026-11-30T21:30:00')
        raw = (self.ledger.root / 'predictions' / '2026-11-30.json').read_bytes()
        ev = self.predict('2026-11-30T23:00:00')
        self.assertEqual((ev['kind'], ev['recompute_matches']), ('DUPLICATE_RUN', True))

        def revise(se, sessions):
            se['S03']['c'][-2] *= 1.05
        ev = self.predict('2026-12-01T03:00:00', market_factory(bump=revise))
        self.assertEqual((ev['kind'], ev.get('kind_detail')), ('DUPLICATE_RUN', 'RECOMPUTE_DIFFERS'))
        self.assertEqual((self.ledger.root / 'predictions' / '2026-11-30.json').read_bytes(), raw)
        self.assertEqual(len(self.ledger.chain()), 1)

    def test_late_data_is_not_ready_and_never_guessed(self):
        late = market_factory(drop_signal_bars=[m['symbol'] for m in MEMBERS[:3]])
        ev = self.predict('2026-11-30T21:30:00', late)
        self.assertEqual(ev['kind'], 'DATA_NOT_READY')
        self.assertIn('S00', ev['missing'])
        self.assertEqual(self.ledger.predictions(), {})
        self.assertEqual(self.predict('2026-11-30T22:30:00')['kind'], 'RECORDED')   # complete data later, before the open

    def test_missed_schedule_is_permanent_and_never_reconstructed(self):
        ev = self.predict('2026-12-01T14:31:00')            # one minute after the next open
        self.assertEqual(ev['kind'], 'MISSED')
        self.assertEqual(self.ledger.predictions(), {})
        self.assertIn('2026-11-30', self.ledger.missed())
        self.predict('2026-12-02T22:00:00')                  # any later run: still nothing for November
        self.assertIsNone(self.ledger.prediction('2026-11-30'))
        self.predict('2026-12-31T21:30:00')
        self.assertEqual(sorted(self.ledger.predictions()), ['2026-12-31'])
        st = fl.month_statuses(self.ledger, CAL, '2027-01-05')
        self.assertEqual(st, {'2026-11-30': 'MISSED', '2026-12-31': 'VALID'})

    def test_buffer_state_comes_from_the_last_valid_prediction(self):
        self.predict('2026-11-30T21:30:00')
        self.predict('2026-12-31T21:30:00')
        nov = self.ledger.prediction('2026-11-30')['strategies'][fl.BUFFER]['targets']
        dec = self.ledger.prediction('2026-12-31')['strategies'][fl.BUFFER]
        self.assertEqual(dec['held_before'], sorted(nov))
        self.assertEqual([c['previous_record_sha'] for c in self.ledger.chain()],
                         [None, self.ledger.prediction('2026-11-30')['record_sha']])


class Integrity(Base):
    def test_tampered_or_after_open_records_are_invalid(self):
        self.predict('2026-11-30T21:30:00')
        p = self.ledger.root / 'predictions' / '2026-11-30.json'
        rec = json.loads(p.read_text())
        rec['strategies'][fl.BUFFER]['targets'] = {'S00': 1.0}
        p.chmod(0o644)
        p.write_text(json.dumps(rec))
        self.assertEqual(fl.verify_chain(self.ledger)['2026-11-30'], 'INVALID_HASH_MISMATCH')

    def test_a_record_created_after_the_open_is_invalid_even_if_written(self):
        body = {'signal_session': '2026-12-31', 'created_at': '2027-01-04T15:00:00Z', 'next_open_utc': '2027-01-04T14:30:00Z',
                'strategies': {fl.BUFFER: {'targets': {}}, fl.BASELINE: {'targets': {}}}, 'input_fingerprint': 'x'}
        self.ledger.write_prediction(body)
        self.assertEqual(fl.verify_chain(self.ledger)['2026-12-31'], 'INVALID_AFTER_OPEN')

    def test_a_record_committed_after_the_open_is_invalid(self):
        self.predict('2026-11-30T21:30:00')
        self.assertEqual(fl.verify_chain(self.ledger, {'2026-11-30': '2026-11-30T21:31:05Z'})['2026-11-30'], 'VALID')
        self.assertEqual(fl.verify_chain(self.ledger, {'2026-11-30': '2026-12-01T14:30:00Z'})['2026-11-30'],
                         'INVALID_COMMITTED_AFTER_OPEN')

    def test_files_are_create_once(self):
        self.predict('2026-11-30T21:30:00')
        with self.assertRaises(FileExistsError):
            self.ledger._create('predictions/2026-11-30.json', {})

    def test_fingerprint_ignores_uniform_dividend_rescaling_but_not_revised_prices(self):
        sessions, se = market_factory()('2026-12-01T00:00:00Z')
        k = len(sessions) - 1
        syms = {m['symbol'] for m in MEMBERS} | {'SPY'}
        fp = fl.input_fingerprint(sessions, se, syms, k)
        rescaled = copy.deepcopy(se)
        rescaled['S01']['ac'] = [x * 0.98 for x in rescaled['S01']['ac']]
        rescaled['S01']['ao'] = [x * 0.98 for x in rescaled['S01']['ao']]
        self.assertEqual(fl.input_fingerprint(sessions, rescaled, syms, k), fp)
        revised = copy.deepcopy(se)
        revised['S01']['c'][k - 3] += 0.01
        self.assertNotEqual(fl.input_fingerprint(sessions, revised, syms, k), fp)


class Evaluate(Base):
    def test_outcomes_use_frozen_targets_flag_revisions_and_show_small_account_limits(self):
        self.predict('2026-11-30T21:30:00')
        self.predict('2026-12-31T21:30:00')
        frozen = self.ledger.prediction('2026-11-30')['strategies'][fl.BUFFER]['targets']

        def revise(se, sessions):
            k = sessions.index('2026-11-27')
            for f in ('c', 'ac'):
                se['S05'][f][k] *= 1.10
        sessions, se = market_factory(bump=revise)('2027-02-01T00:00:00Z')
        out = fl.evaluate(self.ledger, now=at('2027-02-01T03:00:00'), calendar=CAL, sessions=sessions, series=se, actions=[],
                          members=MEMBERS, data_fingerprint='synthetic', code_commit='test')
        # 2027-01-29's next open (1 February) has not happened yet: pending, not MISSED.
        self.assertEqual(out['month_statuses'], {'2026-11-30': 'VALID', '2026-12-31': 'VALID'})
        self.assertEqual(out['revisions']['2026-11-30'], 'INPUT_DATA_REVISED')
        self.assertEqual(out['status'], 'INSUFFICIENT FORWARD SAMPLE')
        self.assertEqual(out['first_execution'], '2026-12-01')
        d = fl.frozen_decisions(self.ledger, out['month_statuses'], sessions, fl.BUFFER)
        self.assertEqual(d[0]['targets'], frozen)                         # never recomputed from revised data
        names = set(out['tracks'])
        for n in (f'{fl.BUFFER}|continuous|10bps', f'{fl.BUFFER}|halt10|10bps', f'{fl.BASELINE}|continuous|10bps', 'SPY|hold'):
            self.assertIn(n, names)
        small = out['tracks'][f'{fl.BUFFER}|continuous|10bps']['capital_1000']
        self.assertIn('zero_share_targets', small)
        self.assertEqual(len(list((self.ledger.root / 'outcomes').glob('*.json'))), 1)
        self.assertEqual(self.ledger.prediction('2026-11-30')['strategies'][fl.BUFFER]['targets'], frozen)

    def test_not_started_before_any_valid_prediction(self):
        sessions, se = market_factory()('2026-11-20T00:00:00Z')
        out = fl.evaluate(self.ledger, now=at('2026-11-20T03:00:00'), calendar=CAL, sessions=sessions, series=se, actions=[],
                          members=MEMBERS, data_fingerprint='x', code_commit='test')
        self.assertEqual(out['status'], 'NOT STARTED')


class SmallAccount(unittest.TestCase):
    def test_a_share_too_expensive_for_its_slot_is_counted_not_hidden(self):
        from analytics.research import engine
        sessions = CAL[:30]
        se = series_for(sessions)
        r = engine.simulate(sessions, se, [], [{'signal_index': 2, 'targets': {'PRICEY': 0.2, 'S00': 0.2}}], start_index=1,
                            end_index=10, capital=1_000.0, cost_bps=10, halt=False)
        self.assertEqual(r['zero_share_targets'], 1)
        self.assertEqual(r['zero_share_log'][0]['symbol'], 'PRICEY')
        self.assertEqual(r['filled'], 1)


if __name__ == '__main__':
    unittest.main()


class AuditHelpers(unittest.TestCase):
    def test_cost_decomposition_adds_up_and_finds_divergence(self):
        from analytics.research import engine, forward_cli
        sessions = CAL[:40]
        se = series_for(sessions)
        decs = [{'signal_index': 2, 'targets': {'S00': 0.5, 'S01': 0.49}}, {'signal_index': 20, 'targets': {'S02': 0.5, 'S01': 0.49}}]
        r0 = engine.simulate(sessions, se, [], decs, start_index=1, end_index=39, capital=10_000.0, cost_bps=0, halt=False)
        r50 = engine.simulate(sessions, se, [], decs, start_index=1, end_index=39, capital=10_000.0, cost_bps=50, halt=False)
        d = forward_cli.cost_decomposition(r0, r50, 50)
        self.assertAlmostEqual(d['end_value_gap'], d['first_order_cost_drag'] + d['path_effect'])
        self.assertGreater(d['first_order_cost_drag'], 0)
        self.assertEqual(forward_cli.cost_decomposition(r0, r0, 0)['first_divergence'], None)
        same = forward_cli.cost_decomposition(r0, r0, 0)
        from analytics.research import evaluate as ev
        base = ev.summarize(r0['curve'], r0['curve'][1][0], r0['curve'][-1][0])['full']
        self.assertAlmostEqual(same['fixed_path_cagr'], base['cagr'])        # zero cost: the same path exactly
        self.assertLess(d['fixed_path_cagr'], base['cagr'])

    def test_engine_setting_is_restored(self):
        from analytics.research import engine, forward_cli
        before = engine.BAND
        with forward_cli.engine_setting('BAND', 0.0):
            self.assertEqual(engine.BAND, 0.0)
        self.assertEqual(engine.BAND, before)
