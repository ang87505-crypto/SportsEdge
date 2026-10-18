"""SYNTHETIC ONLY: fake LEAN universe rows; fictional IDs and sector codes.

Covers the streaming audit and the optional QC entrypoint with fake
AlgorithmImports. No QuantConnect access, orders or vendor data.
"""
from datetime import datetime
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace as NS
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo
from integrations.quantconnect import qc_pit_bias_audit_v1 as audit_module
from integrations.quantconnect.qc_pit_bias_audit_v1 import PitBiasAudit

NY = ZoneInfo('America/New_York')
MONTHS = [(y, m) for y in range(2000, 2012) for m in range(1, 13)]


def panel(members_for, months=MONTHS):
    """Feed one snapshot per month; members_for(index) -> {sid: sector}."""
    audit = PitBiasAudit(MONTHS)
    for i, (y, m) in enumerate(months):
        audit.observe(asof_at=datetime(y, m, 2, 16, tzinfo=NY), observed_at=datetime(y, m, 3, tzinfo=NY),
                      decision_at=datetime(y, m, 3, 8, tzinfo=NY), members=members_for(i))
    return audit


def stable(i, n=120):
    members = {f'SYN-{k}': 1 for k in range(n)}
    if i >= 60:
        members['SYN-0'] = 2  # one genuine reclassification
    return members


class AuditTests(unittest.TestCase):
    def test_clean_panel_has_no_listed_anomaly_and_is_never_admission(self):
        result = panel(stable).finish(explained_exits=[])
        self.assertEqual(result['status'], 'NO_LISTED_ANOMALY')
        self.assertEqual((result['source_admitted'], result['performance']), (False, None))

    def test_static_classification_flagged_only_for_large_long_panel(self):
        self.assertIn('CLASSIFICATION_NEVER_CHANGES_POSSIBLE_BACKFILL',
                      panel(lambda i: {f'SYN-{k}': 1 for k in range(120)}).finish([])['codes'])
        small = panel(lambda i: {f'SYN-{k}': 1 for k in range(10)}).finish([])
        self.assertNotIn('CLASSIFICATION_NEVER_CHANGES_POSSIBLE_BACKFILL', small['codes'])

    def test_exits_must_be_explained_by_lean_delisting(self):
        def members(i):
            m = stable(i)
            if i >= 30:
                m.pop('SYN-5')
            return m
        audit = panel(members)
        self.assertEqual(audit.exits(), ['SYN-5'])
        self.assertEqual(audit.finish(['SYN-5'])['status'], 'NO_LISTED_ANOMALY')
        self.assertIn('UNEXPLAINED_EXIT', panel(members).finish([])['codes'])
        self.assertIn('EXIT_EXPLANATION_UNAVAILABLE', panel(members).finish(None)['codes'])

    def test_gap_missing_month_empty_and_missing_sector(self):
        def gap(i):
            m = stable(i)
            if i == 40:
                m.pop('SYN-7')
            return m
        self.assertIn('REAPPEARED_AFTER_GAP', panel(gap).finish([])['codes'])
        self.assertIn('MISSING_DECISION_MONTH', panel(stable, MONTHS[:-1]).finish([])['codes'])
        self.assertIn('EMPTY_SNAPSHOT', panel(lambda i: {} if i == 3 else stable(i)).finish([])['codes'])
        self.assertIn('CLASSIFICATION_MISSING', panel(lambda i: dict(stable(i), **{'SYN-X': None})).finish([])['codes'])
        self.assertIn('EMPTY_SNAPSHOT', PitBiasAudit(MONTHS).finish([])['codes'])

    def test_snapshot_timing_and_order(self):
        audit = PitBiasAudit([(2000, 1)])
        audit.observe(asof_at='2000-01-03T09:00:00-05:00', observed_at='2000-01-03T00:00:00-05:00',
                      decision_at='2000-01-03T08:00:00-05:00', members={'SYN-1': 1})
        audit.observe(asof_at='2000-01-03T09:00:00-05:00', observed_at='2000-01-03T09:00:00-05:00',
                      decision_at='2000-01-03T08:00:00-05:00', members={'SYN-1': 1})
        codes = audit.finish([])['codes']
        self.assertIn('SNAPSHOT_NOT_BEFORE_DECISION', codes)
        self.assertIn('SNAPSHOT_ORDER', codes)
        with self.assertRaises(ValueError):
            audit.observe(asof_at=datetime(2000, 1, 2), observed_at=datetime(2000, 1, 3),
                          decision_at=datetime(2000, 1, 3, 8), members={})


class Algorithm:
    def __init__(self):
        self.messages = []; self.time = None; self.callback = None; self.delisted = None
        self.universe_settings = NS(asynchronous=True, schedule=NS(on=lambda rule: None))
        self.date_rules = NS(month_start=lambda symbol: 'MONTH_START')

    def set_start_date(self, *args): pass
    def set_end_date(self, *args): pass
    def set_cash(self, *args): pass
    def add_equity(self, *args, **kwargs):
        assert kwargs['data_normalization_mode'] == 'RAW'
        return NS(symbol=NS(id='QC-SPY', value='SPY'))
    def add_universe(self, callback): self.callback = callback
    def debug(self, message): self.messages.append(message)

    def history(self, kind, symbols, start, end):
        if self.delisted is None:
            raise RuntimeError('PRIVATE_LICENSED_SOURCE_DATA')
        hits = [s for s in symbols if str(s.id) in self.delisted]
        return NS(index=NS(get_level_values=lambda level: hits))


def row(sid, sector, y, m, *, end_day=2, fundamentals=True):
    return NS(symbol=NS(id=sid, value='T' + sid[-1]), has_fundamental_data=fundamentals,
              end_time=datetime(y, m, end_day, 16),
              asset_classification=NS(morningstar_sector_code=sector))


class EntrypointTests(unittest.TestCase):
    def setUp(self):
        imports = ModuleType('AlgorithmImports')
        imports.QCAlgorithm = Algorithm
        imports.Slice = type('Slice', (), {})
        imports.Delisting = type('Delisting', (), {})
        imports.Resolution = NS(DAILY='DAILY')
        imports.DataNormalizationMode = NS(RAW='RAW')
        with patch.dict(sys.modules, {'AlgorithmImports': imports, 'qc_pit_bias_audit_v1': audit_module}):
            spec = importlib.util.spec_from_file_location(
                'qc_pit_audit_main', Path(__file__).with_name('qc_pit_audit_main.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        self.cls = module.SportsEdgePitBiasAudit

    def run_months(self, rows_for, delisted=None):
        algo = self.cls(); algo.initialize(); algo.delisted = delisted
        for i, (y, m) in enumerate(MONTHS):
            algo.time = datetime(y, m, 3)
            self.assertEqual(algo.callback(rows_for(i, y, m)), [])
        algo.on_end_of_algorithm()
        return algo.messages[-1]

    def test_clean_run_emits_fixed_codes_only(self):
        def rows(i, y, m):
            out = [row(f'SYN-ID-{k}', 101 if (k or i < 60) else 102, y, m) for k in range(120)]
            if i < 30:
                out.append(row('SYN-ID-EXIT', 101, y, m))
            return out + [row('SYN-ETF', None, y, m, fundamentals=False)]
        message = self.run_months(rows, delisted={'SYN-ID-EXIT'})
        self.assertTrue(message.startswith('SPORTSEDGE_QC_PIT_AUDIT_NO_LISTED_ANOMALY; NONE;'))
        self.assertNotIn('SYN', message)

    def test_unavailable_delisting_lookup_and_lookahead_are_reported(self):
        def rows(i, y, m):
            out = [row(f'SYN-ID-{k}', 101, y, m, end_day=3 if i == 5 else 2) for k in range(3)]
            return out if i < 50 else out[:2]
        message = self.run_months(rows, delisted=None)
        self.assertIn('EXIT_EXPLANATION_UNAVAILABLE', message)
        self.assertIn('SNAPSHOT_NOT_BEFORE_DECISION', message)
        self.assertTrue(all('PRIVATE_LICENSED_SOURCE_DATA' not in s and 'SYN' not in s
                            for s in self.cls().messages + [message]))

    def test_read_failure_blocks_without_exception_text(self):
        algo = self.cls(); algo.initialize(); algo.time = datetime(2000, 1, 3)
        algo.callback([NS(symbol=NS(id='SYN-ID-1'), has_fundamental_data=True,
                          end_time='PRIVATE_LICENSED_SOURCE_DATA', asset_classification=None)])
        algo.time = None
        algo.callback([row('SYN-ID-1', 101, 2000, 2)])
        algo.on_end_of_algorithm()
        self.assertTrue(algo.messages[-1].startswith('SPORTSEDGE_QC_PIT_AUDIT_BLOCKED_READ'))
        self.assertTrue(all('PRIVATE' not in s for s in algo.messages))

    def test_no_order_subscription_or_export_endpoints(self):
        src = Path(__file__).with_name('qc_pit_audit_main.py').read_text()
        for forbidden in ('market_order(', 'set_holdings(', 'liquidate(', 'object_store.',
                          'download(', 'requests.', 'urlopen(', 'log(', 'print('):
            self.assertNotIn(forbidden, src)


if __name__ == '__main__':
    unittest.main()
