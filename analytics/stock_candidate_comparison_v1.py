"""Prepare paired, independent account paths on shared SYNTHETIC evidence only.

No historical mode, provider requests, sealed-test access or performance metrics.
This tests the evaluation plumbing, not investment performance. Source labels
are declarations, not proof that a caller supplied synthetic/real observations.
"""
from copy import deepcopy
from .stock_momentum_v1 import VERSION as BASELINE, digest
from .stock_rank_buffer_candidate import VERSION as CANDIDATE
from .stock_baseline_replay_v2 import replay as replay_baseline
from .stock_buffer_replay_v1 import replay as replay_candidate
from .stock_accounting_v2 import require, exact

VERSION = 'stock-baseline-buffer-synthetic-comparison-v1'


@exact
def compare_synthetic(initial_account, rows, *, calendar, settlement, costs):
    require(isinstance(rows, list) and bool(rows), 'Nonempty paired evidence required')
    for row in rows:
        require(set(row) <= {'session', 'model_evidence'} and 'session' in row,
                'Only shared session and model_evidence allowed')
        require(row['session']['kind'] == 'synthetic_fixture',
                'Historical comparison blocked: unresolved data and event gates')
        if row.get('model_evidence') is not None:
            require(set(row['model_evidence']) == {'payload', 'context', 'decision_at'},
                    'Shared model evidence only; no versions, signals or account overrides')
    def typed_rows(version):
        return [dict(session=deepcopy(r['session']), **(
            {'model': dict(strategy_version=version, **deepcopy(r['model_evidence']))}
            if r.get('model_evidence') is not None else {})) for r in rows]
    options = dict(calendar=calendar, settlement=settlement, costs=costs)
    # Each replay evolves its own account; never reuse baseline holdings for the candidate.
    baseline = replay_baseline(deepcopy(initial_account), typed_rows(BASELINE), **options)
    candidate = replay_candidate(deepcopy(initial_account), typed_rows(CANDIDATE), **options)
    return dict(version=VERSION, kind='SYNTHETIC_ENGINEERING_CHECK_NOT_BACKTEST',
                input_digest=digest([initial_account, rows, calendar, settlement, costs]),
                baseline=baseline, candidate=candidate, performance=None,
                conclusion='not_testable_yet', historical_performance_measured=False)


def main():
    import argparse
    import json
    from pathlib import Path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require(not args.output.exists(), 'Choose a new output path; prior results are preserved')
    data = json.loads(args.input.read_text())
    require(set(data) == {'initial_account', 'rows', 'calendar', 'settlement', 'costs'},
            'Only shared paired scenario inputs allowed')
    result = compare_synthetic(**data)
    with args.output.open('x') as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write('\n')


if __name__ == '__main__':
    main()
