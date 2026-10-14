"""Reproduce synthetic integration checks; never acquire market data."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from analytics.stock_development_runner_v1 import run_bundle
from analytics.stock_readiness_pipeline_v1 import synthetic_input
from analytics.stock_momentum_v1 import digest


def main():
    data = synthetic_input(); data.pop('costs')
    data.update(benchmarks={}, risk_free=None)
    first = run_bundle(data, synthetic=True)
    second = run_bundle(data, synthetic=True)
    if first != second: raise AssertionError('Non-deterministic integration replay')
    print(json.dumps(dict(kind='SYNTHETIC_ENGINEERING_ONLY',
        genuine_historical_backtest_ran=False, performance=None,
        repeated_outputs_identical=True, output_sha256=digest(first),
        protocol_sha256=first['protocol_sha256'], scenarios=[dict(
            nominal_one_way_bps=s['nominal_one_way_bps'], fee_cents_per_order=s['fee_cents_per_order'],
            baseline_receipts_reconciled=s['baseline']['reconciliation']['all_receipts_reconciled'],
            candidate_receipts_reconciled=s['candidate']['reconciliation']['all_receipts_reconciled'])
            for s in first['engineering_scenarios']], environment=first['environment']), indent=2))


if __name__ == '__main__': main()
