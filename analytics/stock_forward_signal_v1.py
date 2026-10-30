"""Recompute forward targets with the frozen full-universe selection code.

No hand-entered scores or target baskets are accepted. This is an integration
component, not an authenticated source collector or permission to place orders.
The separately frozen historical and 2027 reserve protocols remain unchanged.
"""
from copy import deepcopy
import argparse
import json
from pathlib import Path
from .stock_accounting_v2 import require, stamp
from .stock_momentum_v1 import VERSION as BASELINE, digest
from .stock_rank_buffer_candidate import VERSION as CANDIDATE, choose
from .stock_universe_scoring_v1 import score_universe


def forward_signal(bundle):
    require(isinstance(bundle, dict) and set(bundle) == {
        'experiment_id', 'registered_at', 'observed_at', 'model_version',
        'held_security_ids', 'evidence'}, 'Exact forward source envelope required')
    experiment = bundle['experiment_id']
    require(isinstance(experiment, str) and 0 < len(experiment) <= 160
            and experiment.strip() == experiment, 'Invalid experiment identity')
    model = bundle['model_version']
    require(model in (BASELINE, CANDIDATE), 'Unregistered model')
    evidence = deepcopy(bundle['evidence'])
    require(isinstance(evidence, dict) and set(evidence) == {
        'shards', 'context', 'listings', 'decision_at'}, 'Source evidence only')
    decision = stamp(evidence['decision_at'])
    require(decision.year == 2026, 'Separate 2026 engineering experiment only; reserved periods excluded')
    require(stamp(bundle['registered_at']) < decision <= stamp(bundle['observed_at'])
            and (stamp(bundle['observed_at']) - decision).total_seconds() <= 60,
            'Pre-register experiment; capture decision within sixty seconds')
    require(isinstance(evidence['shards'], list), 'Reusable source shards required')
    for shard in evidence['shards']:
        require(stamp(shard['payload']['retrieved_at']) <= stamp(bundle['observed_at']),
                'Payload retrieved after declared capture')
    scored = score_universe(**evidence)
    held = bundle['held_security_ids']
    require(isinstance(held, list) and all(isinstance(v, str) for v in held)
            and len(set(held)) == len(held), 'Invalid held identities')
    require(set(held) <= set(scored['members']), 'Held security missing; reconcile event first')
    held_symbols = {scored['members'][sid]['symbol'] for sid in held}
    selected = choose(scored['scores'], held_symbols if model == CANDIDATE else set())
    result = {
        'version': 'stock-forward-signal-v1', 'experimentId': experiment,
        'modelVersion': model, 'decisionAt': decision.isoformat(),
        'scoringReportId': scored['report_id'],
        'targets': [{'securityId': r['security_id'], 'symbol': r['symbol'],
                     'sector': r['sector']} for r in selected],
        'heldSecurityIds': sorted(held), 'members': scored['members'],
        'priorInputs': scored['prior_inputs'],
        'observedAt': bundle['observed_at'], 'registeredAt': bundle['registered_at'],
        'sourceIndependentlyVerified': False, 'executionPermitted': False,
        'performance': None,
    }
    result['decisionId'] = digest(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = forward_signal(json.loads(args.input.read_text()))
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write('\n')


if __name__ == '__main__':
    main()
