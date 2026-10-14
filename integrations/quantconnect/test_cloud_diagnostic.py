"""Offline synthetic checks of standalone QuantConnect data-audit script.

No QuantConnect service, account, historical data, or proprietary SDK needed.
"""
import importlib.util
import sys
import types
import unittest
from datetime import datetime
from pathlib import Path


module = types.ModuleType('AlgorithmImports')
module.QCAlgorithm = type('QCAlgorithm', (), {})
module.Slice = type('Slice', (), {})
previous = sys.modules.get('AlgorithmImports')
sys.modules['AlgorithmImports'] = module
try:
    spec = importlib.util.spec_from_file_location(
        'sportsedge_qc_readiness', Path(__file__).with_name('main.py'))
    qc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(qc)
finally:
    if previous is None:
        del sys.modules['AlgorithmImports']
    else:
        sys.modules['AlgorithmImports'] = previous


def entry(name, *, sector=101, fundamentals=True, price='10', volume='20000000'):
    return types.SimpleNamespace(
        symbol=types.SimpleNamespace(id=name),
        has_fundamental_data=fundamentals,
        asset_classification=types.SimpleNamespace(morningstar_sector_code=sector),
        price=price, dollar_volume=volume)


class CloudDiagnosticTests(unittest.TestCase):
    def test_clean_metadata_never_approves_source(self):
        result = qc.audit_fundamentals([entry('ID-1'), entry('ID-2')])
        self.assertEqual(result['observed'], 2)
        self.assertEqual(result['metadata_present'], 2)
        self.assertEqual(result['structural_gaps'], 0)
        self.assertFalse(result['source_admitted'])
        self.assertFalse(result['performance_measured'])

    def test_null_sector_nonfinite_price_invalid_volume(self):
        result = qc.audit_fundamentals([
            entry('A', sector=None),
            entry('B', price='NaN'),
            entry('C', volume='Infinity'),
        ])
        self.assertEqual(result['missing_sector'], 1)
        self.assertEqual(result['invalid_price'], 1)
        self.assertEqual(result['invalid_dollar_volume'], 1)
        self.assertEqual(result['metadata_present'], 0)

    def test_missing_and_duplicate_security_identity(self):
        data = [entry('A'), entry('A'), entry('B')]
        data[-1].symbol = None
        report = qc.audit_fundamentals(data)
        self.assertEqual(report['duplicate_identity'], 1)
        self.assertEqual(report['missing_identity'], 1)
        self.assertFalse(report['source_admitted'])

    def test_missing_fundamentals_is_not_silently_removed(self):
        r = qc.audit_fundamentals([entry('A', fundamentals=False), entry('B')])
        self.assertEqual(r['observed'], 2)
        self.assertEqual(r['missing_fundamental_data'], 1)
        self.assertEqual(r['metadata_present'], 1)

    def test_empty_universe_is_blocked(self):
        r = qc.audit_fundamentals([])
        self.assertEqual(r['observed'], 0)
        self.assertFalse(r['source_admitted'])

    def test_monthly_audit_deduplicates_and_subscribes_to_no_stocks(self):
        instance = qc.SportsEdgeUniverseReadiness()
        instance._audits = {}
        instance.is_warming_up = False
        instance.time = datetime(2000, 1, 3)
        messages = []
        instance.debug = messages.append
        self.assertEqual(instance._inspect_universe([entry('A')]), [])
        self.assertEqual(instance._inspect_universe([entry('B')]), [])
        self.assertEqual(len(instance._audits), 1)
        self.assertEqual(instance._audits[(2000,1)]['observed'], 1)
        self.assertIn('internal audit step completed', messages[0])
        self.assertNotIn('ID-1', messages[0])
        self.assertNotIn('rows=', messages[0])

    def test_end_report_catches_skipped_months_without_fake_returns(self):
        instance = qc.SportsEdgeUniverseReadiness()
        instance._audits = {(2000, 1): qc.audit_fundamentals([entry('A')])}
        messages = []
        instance.debug = messages.append
        instance.on_end_of_algorithm()
        self.assertFalse(instance._internal_source_ready)
        self.assertFalse(instance._historical_source_admitted)
        self.assertIn('DATA_EXPORT_DISABLED', messages[0])
        self.assertNotIn('months_seen', messages[0])
        self.assertNotIn('missing_months', messages[0])

    def test_script_forbids_orders_and_export_code(self):
        source = Path(__file__).with_name('main.py').read_text()
        for forbidden in ('self.market_order(', 'self.set_holdings(',
                          'self.liquidate(', 'self.stop_market_order(',
                          'self.object_store.save(', 'requests.post(',
                          'self.download('):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
