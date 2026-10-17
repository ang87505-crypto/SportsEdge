"""Offline SYNTHETIC correctness reproduction; no provider calls or returns study."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from analytics.test_stock_accounting_v2 import fixture, planned, run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Choose a new output path; prior results are preserved')
    result = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'analytics', '-p', 'test_*.py', '-q'],
                            cwd=ROOT, capture_output=True, text=True)
    print(result.stdout + result.stderr, end='')
    if result.returncode:
        raise RuntimeError('Test failure: no successful report will be written')
    examples = {}
    for name, kwargs in [('spread_fee_slippage', {}), ('existing_holdings', dict(positions={'id-AAA': 10}, cash=54800)),
                         ('subcent', dict(bid='10.000001', ask='10.000001', fee=0, slip='0'))]:
        f = fixture(**kwargs); plan = planned(f); replay = run(f)
        assert plan['trades'] == replay['sessions'][0]['trades']
        examples[name] = dict(trades=plan['trades'], settled_cash_cents=replay['state']['settled_cash_cents'],
                              unsettled=replay['state']['unsettled'], positions=replay['state']['positions'])
    report = dict(kind='SYNTHETIC_CORRECTNESS_ONLY', genuine_prices_used=False, historical_performance_measured=False,
                  tests_passed=True, examples=examples,
                  protocol_amendment_sha256=hashlib.sha256((Path(__file__).parent / 'protocol_amendment.json').read_bytes()).hexdigest())
    with args.output.open('x') as stream:
        json.dump(report, stream, indent=2, allow_nan=False)
        stream.write('\n')
    print('Synthetic correctness output:', args.output)


if __name__ == '__main__':
    main()
