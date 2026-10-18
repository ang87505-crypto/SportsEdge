"""SYNTHETIC ONLY: memory-probe helper and fake-LEAN entrypoint.

Fictional IDs/tickers/prices. No QuantConnect access, orders or vendor data.
The fake exchange calendar below is test scaffolding, never a reviewed one.
"""
from datetime import date, datetime, timedelta
import importlib.util
from pathlib import Path
import re
import sys
from types import ModuleType, SimpleNamespace as NS
import unittest
from unittest.mock import patch
from integrations.quantconnect import qc_memory_probe_v1 as probe
from integrations.quantconnect import qc_stream_rows_v1 as rows
from integrations.quantconnect.qc_memory_probe_v1 import ProbeBlocked

HERE = Path(__file__).parent
DECISION = date(2001, 2, 1)
HOLIDAYS = {date(2000, 7, 4), date(2000, 12, 25), date(2001, 1, 1), date(2001, 1, 15)}
LINE = re.compile(r'[A-Z0-9_; ]+\Z')


def is_open(day):
    return day.weekday() < 5 and day not in HOLIDAYS


SESSIONS = probe.probe_sessions(is_open, DECISION)
AT = datetime(2001, 2, 1, 8)


def lookback(sid, ticker, sessions=SESSIONS):
    return dict(security_id=sid, requested_ticker=ticker, requested_raw_unadjusted=True,
                requested_fill_forward=False, historical_source_admitted=False, performance=None,
                bars=[dict(session_date=d, lean_history_index_time=d + 'T16:00:00', open='10.25',
                           high='10.5', low='10', close='10.0625', volume=12345) for d in sessions])


class Clock:
    def __init__(self, step=0.0):
        self.now = 0.0; self.step = step

    def __call__(self):
        self.now += self.step
        return self.now


def run(members, reader, **kwargs):
    return probe.run_probe(members, read_lookback=reader, build_shard=rows.build_shard,
                           sessions=SESSIONS, decision_at=AT, clock=kwargs.pop('clock', Clock()),
                           process_peak=lambda: None, **kwargs)


MEMBERS = [(f'SYN-ID-{k}', f'SYN{k}') for k in range(6)]


def reader(symbol):
    return lookback('SYN-ID-' + symbol[3:], symbol)


class HelperTests(unittest.TestCase):
    def test_buckets(self):
        mb = probe.MB
        self.assertEqual([probe.memory_code(x) for x in (0, 256 * mb - 1, 256 * mb, 512 * mb)],
                         ['UNDER_256MB', 'UNDER_256MB', '256_512MB', 'OVER_512MB'])
        self.assertEqual([probe.elapsed_code(x) for x in (59, 60, 600, 3600)],
                         ['UNDER_1MIN', '1_10MIN', '10_60MIN', 'OVER_60MIN'])
        self.assertEqual([probe.process_code(x) for x in (None, 1, 600 * mb, 1500 * mb, 3000 * mb)],
                         ['UNAVAILABLE', 'UNDER_512MB', '512MB_1GB', '1_2GB', 'OVER_2GB'])

    def test_probe_calendar_comes_from_supplied_exchange_calendar(self):
        self.assertEqual(len(SESSIONS), 253)
        self.assertLess(SESSIONS[-1], DECISION.isoformat())
        self.assertNotIn('2001-01-15', SESSIONS)  # follows is_open, not weekdays
        for bad in (lambda d: d.weekday() < 5 and d != DECISION, lambda d: 1 / 0):
            with self.subTest(bad=bad), self.assertRaises(ProbeBlocked) as caught:
                probe.probe_sessions(bad, DECISION)
            self.assertEqual(str(caught.exception), 'BLOCKED_CALENDAR')
        with self.assertRaises(ProbeBlocked):
            probe.probe_sessions(is_open, date(2001, 2, 2))  # not first session of month
        with self.assertRaises(ProbeBlocked):
            probe.probe_sessions(is_open, date(2012, 2, 1))  # validation period never probed

    def test_complete_probe_reports_buckets_only(self):
        result = run(MEMBERS, reader)
        self.assertEqual((result['status'], result['memory'], result['coverage']),
                         ('COMPLETE', 'UNDER_256MB', 'ALL_MEMBERS_READ'))
        self.assertTrue(result['bundle_built'])
        self.assertEqual((result['source_admitted'], result['performance'],
                          result['scoring_measured'], result['stream_measured']), (False, None, False, False))
        line = probe.log_line(result)
        self.assertRegex(line, LINE)
        self.assertTrue(line.startswith('SPORTSEDGE_QC_MEMORY_UNDER_256MB; SPORTSEDGE_QC_ELAPSED_UNDER_1MIN;'))

    def test_unreadable_members_are_counted_never_filled(self):
        def flaky(symbol):
            if symbol == 'SYN3':
                raise ValueError('PRIVATE_LICENSED_SOURCE_DATA')
            if symbol == 'SYN4':
                return lookback('SYN-ID-4', symbol, SESSIONS[:-1])  # stale lookback
            return reader(symbol)
        result = run(MEMBERS, flaky)
        self.assertEqual((result['status'], result['coverage']), ('COMPLETE', 'SOME_MEMBERS_UNREAD'))
        self.assertNotIn('PRIVATE', probe.log_line(result))
        with self.assertRaises(ProbeBlocked) as caught:
            run(MEMBERS, lambda s: 1 / 0)
        self.assertEqual(caught.exception.code, 'BLOCKED_LOOKBACK')
        with self.assertRaises(ProbeBlocked) as caught:
            run([], reader)
        self.assertEqual(caught.exception.code, 'BLOCKED_UNIVERSE')

    def test_memory_and_time_caps_stop_early(self):
        result = run(MEMBERS, reader, bundle_cap=1)
        self.assertEqual((result['status'], result['coverage']),
                         ('STOPPED_MEMORY_CAP', 'STOPPED_BEFORE_ALL_MEMBERS'))
        calls = []
        def counted(symbol):
            calls.append(symbol)
            return reader(symbol)
        result = run(MEMBERS, counted, time_cap=10, clock=Clock(step=6))
        self.assertEqual(result['status'], 'STOPPED_TIME_CAP')
        self.assertTrue(result['memory'].startswith('PROJECTED_'))
        self.assertLess(len(calls), len(MEMBERS))

    def test_bundle_size_grows_with_members(self):
        sizes = []
        for n in (2, 4):
            with patch.object(probe, 'memory_code', side_effect=lambda b: sizes.append(b) or 'X'):
                run(MEMBERS[:n], reader)
        self.assertGreater(sizes[1], sizes[0] * 1.5)
        # The deep size covers every bar dict, not only the shard containers.
        self.assertGreater(sizes[0], 2 * 253 * 200)


class Frame:
    def __init__(self, rows):
        self.rows = rows

    def iterrows(self):
        return iter(self.rows)


class Algorithm:
    def __init__(self):
        self.messages = []; self.time = None; self.selector = None; self.scheduled = []
        self.unreadable = set(); self.history_calls = 0
        self.universe_settings = NS(asynchronous=True, schedule=NS(on=lambda rule: None))
        self.date_rules = NS(month_start=lambda symbol: 'MONTH_START', on=lambda y, m, d: ('ON', y, m, d))
        self.time_rules = NS(at=lambda h, m: ('AT', h, m))
        hours = NS(is_date_open=lambda dt: is_open(dt.date()))
        self.securities = {'QC-SPY': NS(exchange=NS(hours=hours))}
        self.schedule = NS(on=lambda d, t, fn: self.scheduled.append((d, t, fn)))

    def set_start_date(self, *args): pass
    def set_end_date(self, *args): pass
    def set_cash(self, *args): pass
    def add_universe(self, selector): self.selector = selector
    def debug(self, message): self.messages.append(message)

    def add_equity(self, ticker, resolution, **kwargs):
        assert kwargs['data_normalization_mode'] == 'RAW'
        return NS(symbol='QC-SPY')

    def history(self, symbols, start, end, **kwargs):
        self.history_calls += 1
        assert kwargs['data_normalization_mode'] == 'RAW' and kwargs['fill_forward'] is False
        ticker = symbols[0].value
        if ticker in self.unreadable:
            raise RuntimeError('PRIVATE_LICENSED_SOURCE_DATA')
        out, day = [], start.date()
        while day < end.date():
            if day.isoformat() in SESSIONS:
                out.append(((ticker, datetime.combine(day, datetime.min.time()).replace(hour=16)),
                            dict(open='10.25', high='10.5', low='10', close='10.0625', volume='12345')))
            day += timedelta(days=1)
        return Frame(out)


def universe_row(k, fundamentals=True):
    return NS(symbol=NS(id=f'SYN-ID-{k}', value=f'SYN{k}'), has_fundamental_data=fundamentals)


class EntrypointTests(unittest.TestCase):
    def load(self, bootstrap_fails=False):
        imports = ModuleType('AlgorithmImports')
        imports.QCAlgorithm = Algorithm
        imports.Slice = type('Slice', (), {})
        imports.Resolution = NS(DAILY='DAILY')
        imports.DataNormalizationMode = NS(RAW='RAW')
        boot = ModuleType('se_bootstrap')
        def install():
            if bootstrap_fails:
                raise RuntimeError('SPORTSEDGE_SOURCE_HASH_MISMATCH')
        boot.install = install
        patcher = patch.dict(sys.modules, {'AlgorithmImports': imports, 'se_bootstrap': boot,
                                           'qc_stream_rows_v1': rows, 'qc_memory_probe_v1': probe})
        patcher.start(); self.addCleanup(patcher.stop)
        spec = importlib.util.spec_from_file_location('qc_memory_probe_main', HERE / 'qc_memory_probe_main.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def run_algo(self, module, rows_at_decision, unreadable=()):
        algo = module.SportsEdgeMemoryProbe(); algo.unreadable = set(unreadable); algo.initialize()
        algo.time = datetime(2001, 1, 29)
        self.assertEqual(algo.selector([universe_row(0)]), [])  # not the decision date: ignored
        algo.time = datetime(2001, 2, 1)
        self.assertEqual(algo.selector(rows_at_decision), [])
        self.assertEqual(len(algo.scheduled), 1)
        date_rule, time_rule, callback = algo.scheduled[0]
        self.assertEqual((date_rule, time_rule), (('ON', 2001, 2, 1), ('AT', 8, 0)))
        algo.time = datetime(2001, 2, 1, 8)
        callback()
        algo.on_end_of_algorithm()
        return algo

    def assert_clean(self, algo):
        for message in algo.messages:
            self.assertRegex(message, LINE)
            for secret in ('SYN', 'PRIVATE', '2001', '10.25', '12345'):
                self.assertNotIn(secret, message)

    def test_full_universe_probe_logs_fixed_codes_only(self):
        module = self.load()
        members = [universe_row(k) for k in range(5)] + [universe_row(9, fundamentals=False), universe_row(0)]
        algo = self.run_algo(module, members, unreadable={'SYN4'})
        self.assertEqual(algo.messages[0], module.STARTED)
        final = algo.messages[-1]
        self.assertTrue(final.startswith('SPORTSEDGE_QC_MEMORY_UNDER_256MB; SPORTSEDGE_QC_ELAPSED_'), final)
        self.assertIn('COVERAGE_SOME_MEMBERS_UNREAD', final)
        self.assertGreater(algo.history_calls, 4 * 8)  # paged 253-session reads per member
        self.assertEqual(len(algo.messages), 2)
        self.assert_clean(algo)

    def test_wrong_schedule_time_blocks(self):
        module = self.load(); algo = module.SportsEdgeMemoryProbe(); algo.initialize()
        algo.time = datetime(2001, 2, 1); algo.selector([universe_row(1)])
        algo.time = datetime(2001, 2, 1, 9); algo.scheduled[0][2]()
        self.assertTrue(algo.messages[-1].startswith('SPORTSEDGE_QC_MEMORY_BLOCKED_SCHEDULE;'))
        self.assertEqual(algo.history_calls, 0)

    def test_empty_universe_and_import_failure_block_with_fixed_codes(self):
        algo = self.run_algo(self.load(), [universe_row(1, fundamentals=False)])
        self.assertTrue(algo.messages[-1].startswith('SPORTSEDGE_QC_MEMORY_BLOCKED_UNIVERSE;'))
        self.assert_clean(algo)
        module = self.load(bootstrap_fails=True)
        algo = module.SportsEdgeMemoryProbe(); algo.initialize(); algo.on_end_of_algorithm()
        self.assertEqual(algo.messages, [module.IMPORT_BLOCKED])
        self.assertIsNone(algo.selector)
        self.assert_clean(algo)

    def test_no_order_subscription_or_export_endpoints(self):
        for name in ('qc_memory_probe_main.py', 'qc_memory_probe_v1.py', 'qc_stream_rows_v1.py'):
            src = (HERE / name).read_text()
            for forbidden in ('market_order(', 'limit_order(', 'stop_market_order(', 'set_holdings(',
                              'liquidate(', 'submit_order', 'object_store', 'download(', 'requests.',
                              'urlopen(', 'socket', 'self.log(', 'print(', 'json.dump',
                              'add_equity(symbol', 'add_data('):
                with self.subTest(name=name, forbidden=forbidden):
                    self.assertNotIn(forbidden, src)
            self.assertIsNone(re.search(r'\bopen\(', src), name)  # no file I/O
        main = (HERE / 'qc_memory_probe_main.py').read_text()
        self.assertIn('NOT YET RUN IN QUANTCONNECT CLOUD', main)
        self.assertEqual(main.count('add_equity('), 1)
        calls = re.findall(r'self\.debug\((.*)\)$', main, re.M)
        self.assertEqual(len(calls), main.count('self.debug('))
        for call in calls:  # only fixed constants or the fixed-code formatters
            self.assertRegex(call, r'\A(STARTED|IMPORT_BLOCKED|probe\.(log_line|blocked_line)\(.*)\Z')


if __name__ == '__main__':
    unittest.main()
