"""The one-day study must freeze before the open and never reconstruct missing picks."""
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import unittest
from analytics import stock_daily_shadow_v1 as m


def fixture():
    days = []
    d = date(2025, 1, 1)
    while d <= date(2026, 11, 9):
        if d.weekday() < 5:
            days.append(d.isoformat())
        d += timedelta(days=1)
    bars = {}
    for symbol in ['AAA', 'BBB', 'CCC', 'SPY']:
        prices = [100.0] * len(days)
        if symbol == 'SPY':
            prices = [100 + i / 10 for i in range(len(days))]
        else:
            prices[-1] = 90 if symbol != 'BBB' else 110
        bars[symbol] = {'d': days[:], **{f: prices[:] for f in ['o', 'c', 'ao', 'ac']}, 'v': [1000000] * len(days)}
    config = {'session': m.SESSION, 'capital': 30000,
              'securities': [{'symbol': s, 'sector': s} for s in ['AAA', 'BBB', 'CCC']]}
    session = {'date': m.SESSION, 'open': '09:30', 'close': '16:00'}
    previous = {'date': '2026-11-09', 'close': '16:00'}
    now = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)
    return {'sessions': days, 'bars': bars}, config, session, previous, now


def closing_data(plan, missing_exit=False, gap=False):
    bars = {}
    for orders in plan['orders'].values():
        for o in orders:
            entry = o['limit'] + 1 if gap else o['previous_close']
            bars[o['symbol']] = {'d': [m.SESSION], 'o': [entry], 'c': [None if missing_exit else entry + 1]}
    return {'sessions': [m.SESSION], 'bars': bars}


class ShadowTest(unittest.TestCase):
    def test_capture_is_genuine_preopen_and_excludes_future_prices(self):
        data, config, session, previous, now = fixture()
        plan = m.build_plan(data, config, session, previous, now)
        self.assertEqual(plan['last_signal_session'], '2026-11-09')
        self.assertEqual([o['symbol'] for o in plan['orders']['losers5']], ['AAA', 'CCC'])
        self.assertEqual([o['symbol'] for o in plan['orders']['gainers5']], ['BBB'])
        with self.assertRaisesRegex(ValueError, 'OUTSIDE_PREOPEN'):
            m.build_plan(data, config, session, previous, now.replace(hour=15))
        data['bars']['AAA']['d'].append(m.SESSION)
        with self.assertRaisesRegex(ValueError, 'FUTURE_BAR'):
            m.build_plan(data, config, session, previous, now)

    def test_missing_previous_session_cannot_be_used_as_fresh_data(self):
        data, config, session, previous, now = fixture()
        data['sessions'].pop()
        with self.assertRaisesRegex(ValueError, 'INCOMPLETE'):
            m.build_plan(data, config, session, previous, now)

    def test_grading_uses_frozen_orders_and_charges_both_sides(self):
        args = fixture()
        plan = m.build_plan(*args)
        result = m.grade(plan, closing_data(plan), args[-1].replace(hour=22), args[1])
        row = result['results']['losers5']
        shares = sum(o['shares'] for o in plan['orders']['losers5'])
        self.assertEqual(row['pnl']['0'], shares)
        self.assertEqual(row['pnl']['10'], round(shares - shares * 181 * .001, 2))
        self.assertEqual(result['broker_orders'], 0)
        self.assertFalse(result['activation'])
        self.assertNotIn('CAGR', m.report(result))
        self.assertIn('One session cannot qualify', m.report(result))
        with self.assertRaisesRegex(ValueError, 'FINAL_BARS_NOT_DUE'):
            m.grade(plan, closing_data(plan), args[-1].replace(hour=20), args[1])

    def test_missing_exits_are_unknown_and_gap_orders_never_fill(self):
        args = fixture()
        plan = m.build_plan(*args)
        now = args[-1].replace(hour=22)
        result = m.grade(plan, closing_data(plan, missing_exit=True), now, args[1])
        self.assertEqual(result['results']['losers5']['status'], 'UNKNOWN')
        self.assertTrue(all(v is None for v in result['results']['losers5']['pnl'].values()))
        gaps = m.grade(plan, closing_data(plan, gap=True), now, args[1])
        self.assertEqual(gaps['results']['losers5']['simulated_fills'], [])
        self.assertEqual(gaps['results']['losers5']['pnl']['10'], 0)

    def test_frozen_plan_or_config_changes_are_refused(self):
        args = fixture()
        plan = m.build_plan(*args)
        plan['orders']['losers5'][0]['shares'] += 1
        with self.assertRaisesRegex(ValueError, 'FROZEN_PLAN_MISMATCH'):
            m.grade(plan, {}, args[-1].replace(hour=22), args[1])

    def test_nonfinite_prices_cannot_create_a_profit(self):
        args = fixture()
        plan = m.build_plan(*args)
        data = closing_data(plan)
        data['bars']['AAA']['c'][0] = float('inf')
        with self.assertRaises(ValueError):
            m.grade(plan, data, args[-1].replace(hour=22), args[1])

    def test_market_fetch_includes_final_day_and_rejects_out_of_window_bars(self):
        class Source:
            def __init__(self): self.queries = []
            def fetch(self, base, path, params): return [{'date': '2026-11-09'}]
            def paged(self, base, path, params):
                self.queries.append(params)
                return [{'bars': {'AAA': [{'t': '2026-11-09T05:00:00Z', 'o': 100, 'c': 101, 'v': 1000000}]}}]
        source = Source()
        data = m.market_data(source, ['AAA'], '2026-11-09', '2026-11-09')
        self.assertEqual(data['bars']['AAA']['d'], ['2026-11-09'])
        self.assertEqual(source.queries[0]['end'], '2026-11-10T04:59:59+00:00')
        self.assertEqual(source.queries[0]['asof'], '2026-11-09')
        with self.assertRaisesRegex(ValueError, 'OUTSIDE_WINDOW'):
            m.market_data(source, ['AAA'], '2026-11-10', '2026-11-10')

    def test_signal_functions_match_the_pre_registered_source(self):
        source = Path(m.__file__).read_text()
        source = source[source.index('def _ok('):source.index('\ndef digest(')].strip()
        expected = json.loads(m.CONFIG.read_text())['selector_source_sha256']
        self.assertEqual(hashlib.sha256(source.encode()).hexdigest(), expected)
        self.assertEqual((m.MAX_POSITIONS, m.WEIGHT, m.LIMIT_GAP, m.SIZING_SLIPPAGE), (5, .2, .03, .0025))


if __name__ == '__main__':
    unittest.main()
