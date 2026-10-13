"""Offline adapter for the ORIGINAL frozen rank-buffer strategy; never orders.

The original baseline adapter is used as a common evidence/account validator.
Its signal is not relabeled or executed here. generate_buffer recomputes the
candidate from the validated actual account's holdings and equity.
"""
from copy import deepcopy
from .stock_momentum_v1 import VERSION as BASELINE, digest
from .stock_rank_buffer_candidate import VERSION as CANDIDATE, generate_buffer
from .stock_baseline_replay_v2 import signal_from_account as validate_evidence
from .stock_accounting_v2 import VERSION, exact, require, stamp, plan_open, close_session, NY

ADAPTER_VERSION = 'stock-holdrank10-account-adapter-v1'


@exact
def signal_from_account(account, model, calendar):
    require(set(model) == {'strategy_version', 'payload', 'context', 'decision_at'},
            'Only model evidence allowed; no signal, equity or holdings overrides')
    require(model['strategy_version'] == CANDIDATE, 'Only frozen hold-rank-ten candidate admitted')
    # A separate baseline calculation validates identical source/account rules.
    # No incoming or generated signal ever has its strategy identity overwritten.
    validation_model = dict(strategy_version=BASELINE, payload=model['payload'],
                            context=model['context'], decision_at=model['decision_at'])
    validated = validate_evidence(account, validation_model, calendar)
    held = sorted(validated['symbols'][sid] for sid in validated['holdings'])
    signal = generate_buffer(model['payload'], model['context'],
                             decision_at=model['decision_at'],
                             equity_cents=validated['equity_cents'], held_symbols=held)
    require(signal['strategy_version'] == CANDIDATE
            and signal['parent_signal_id'] == validated['signal']['signal_id'],
            'Candidate recomputation/evidence mismatch')
    by_symbol = {u['symbol']: u['security_id'] for u in model['context']['universe']}
    targets = {by_symbol[t['symbol']]: t['target_budget_cents'] for t in signal['targets']}
    return dict(adapter_version=ADAPTER_VERSION, signal=signal, targets=targets,
                account_state_digest=digest(account), equity_cents=validated['equity_cents'],
                holdings=deepcopy(validated['holdings']), symbols=deepcopy(validated['symbols']),
                prior_adv20_shares=deepcopy(validated['prior_adv20_shares']),
                decision_id=digest([ADAPTER_VERSION, account, signal]))


@exact
def plan_buffer(account, model, session, *, calendar, settlement, costs):
    require('close_marks' not in session, 'Open planner must not receive future close marks')
    a = signal_from_account(account, model, calendar)
    require(stamp(a['signal']['earliest_execution_at']) == stamp(session['open_at']),
            'Wrong next execution session')
    for q in session['quotes']:
        if q['security_id'] in a['targets']:
            require(q['prior_adv20_shares'] == a['prior_adv20_shares'][q['security_id']],
                    'Execution liquidity disagrees with prior model bars')
    state = deepcopy(account)
    state['symbols'] = a['symbols']
    result = plan_open(state, session, a['targets'], decision_id=a['decision_id'],
                       calendar=calendar, settlement=settlement, costs=costs)
    return {**result, 'candidate_adapter': a}


@exact
def replay(initial_account, rows, *, calendar, settlement, costs):
    """All-or-error accounting scenario; source truth is an external data gate.

    This callable does not authenticate a historical dataset. Use the restricted
    comparison runner for this milestone. No accounting-only monthly bypass.
    """
    require(isinstance(rows, list) and bool(rows), 'Nonempty chronological replay required')
    state = deepcopy(initial_account)
    outputs = []
    for row in rows:
        require(set(row) <= {'session', 'model'} and 'session' in row, 'Unexpected replay fields')
        session = deepcopy(row['session'])
        if stamp(state['as_of']).astimezone(NY).strftime('%Y-%m') != session['date'][:7]:
            require(row.get('model') is not None, 'Monthly candidate decision cannot be omitted')
        session.pop('close_marks')
        if row.get('model') is not None:
            planned = plan_buffer(state, row['model'], session, calendar=calendar,
                                  settlement=settlement, costs=costs)
        else:
            planned = plan_open(state, session, None, decision_id=None,
                                calendar=calendar, settlement=settlement, costs=costs)
        result = close_session(planned, row['session'])
        state = result['state']
        outputs.append(result)
    return dict(engine_version=VERSION, adapter_version=ADAPTER_VERSION,
                strategy_version=CANDIDATE, state=state, sessions=outputs,
                status='OFFLINE_ACCOUNTING_SCENARIO', historical_performance_measured=False,
                source_independently_verified=False)
