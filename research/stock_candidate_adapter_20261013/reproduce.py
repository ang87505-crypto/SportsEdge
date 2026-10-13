"""Reproduce engineering checks only; exclusive output and no return metrics."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from analytics.test_stock_candidate_adapter_v1 import two_month_input
from analytics.stock_candidate_comparison_v1 import compare_synthetic


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Choose a new output path')
    freeze_path = Path(__file__).with_name('freeze.json')
    freeze = json.loads(freeze_path.read_text())
    for name, expected in freeze['protected_sha256'].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Frozen dependency changed: ' + name)
    result = compare_synthetic(**two_month_input())
    repeated = compare_synthetic(**two_month_input())
    if result != repeated:
        raise AssertionError('Non-deterministic comparison')
    summary = dict(kind='SYNTHETIC_ENGINEERING_CHECK_NOT_BACKTEST',
        performance=None, conclusion='not_testable_yet', genuine_prices_used=False,
        freeze_sha256=hashlib.sha256(freeze_path.read_bytes()).hexdigest(),
        protected_dependencies_unchanged=True, repeated_outputs_identical=True,
        input_digest=result['input_digest'], checks={})
    for name, adapter in [('baseline', 'baseline_adapter'), ('candidate', 'candidate_adapter')]:
        sessions = result[name]['sessions']
        decisions = [s[adapter] for s in sessions if adapter in s]
        summary['checks'][name] = dict(strategy_version=decisions[-1]['signal']['strategy_version'],
            decisions=len(decisions), own_prior_holdings_used=(decisions[-1]['holdings'] == sessions[-2]['state']['positions']),
            selected_per_decision=[[sid for sid, budget in sorted(d['targets'].items()) if budget]
                                   for d in decisions])
    with args.output.open('x') as stream:
        json.dump(summary, stream, indent=2, allow_nan=False)
        stream.write('\n')


if __name__ == '__main__':
    main()
