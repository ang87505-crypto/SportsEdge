"""Versioned full-universe account adapter using the frozen selection rules.

No baseline/candidate source modification. A transport/eligibility extension,
not another alpha hypothesis. No generic signal can be submitted for execution.
Historical-study admission remains blocked externally by source/event gates.
"""
from copy import deepcopy
from decimal import Decimal as D, ROUND_FLOOR
from .stock_momentum_v1 import VERSION as BASELINE, digest
from .stock_rank_buffer_candidate import VERSION as BUFFER, choose
from .stock_accounting_v2 import (exact, require, stamp, validate_state, nav,
    amount, cents, plan_open, close_session, NY)
from .stock_baseline_replay_v2 import _reconcile_actions
from .stock_universe_scoring_v1 import score_universe

VERSION = 'stock-fulluniverse-account-adapter-v1'


@exact
def decision_from_account(account, evidence, calendar, *, selection_strategy):
    require(selection_strategy in (BASELINE, BUFFER), 'Unregistered selection strategy')
    require(set(evidence) == {'shards', 'context', 'listings', 'decision_at'},
            'Only source evidence allowed; no equity, holdings, scores or targets')
    validate_state(account)
    at = stamp(evidence['decision_at']); prior = stamp(account['as_of'])
    require(prior < at and stamp(calendar['available_at']) < at, 'Stale or unavailable account/calendar')
    # Validate all members before applying any selection or account operation.
    scored = score_universe(**evidence)
    context = evidence['context']
    from .stock_accounting_v2 import validate_calendar
    sessions = validate_calendar(calendar)
    for row in context['sessions']:
        require(row['date'] in sessions and all(stamp(row[k]) == stamp(sessions[row['date']][k])
                for k in ('open_at', 'close_at')), 'Model/replay calendars disagree')
    completed = [r for r in calendar['sessions'] if stamp(r['close_at']) < at]
    require(completed and stamp(completed[-1]['close_at']) == prior, 'Stale account checkpoint')
    state = deepcopy(account)
    for sid, row in scored['prior_inputs'].items():
        symbol = row['symbol']
        require(sid not in state['symbols'] or state['symbols'][sid] == symbol, 'Unreconciled rename')
        require(symbol not in state['symbols'].values() or state['symbols'].get(sid) == symbol,
                'Security identity substitution')
        state['symbols'][sid] = symbol
        mark = state['marks'].get(sid)
        require(mark is not None and mark['symbol'] == symbol and amount(mark['price']) == D(row['price'])
                and stamp(row['completed_at']) == prior and stamp(mark['completed_at']) == prior
                and stamp(mark['available_at']) < at, 'Missing/mismatched prior model/account mark')
    require(set(state['positions']) <= set(scored['members']), 'Held member absent; event reconciliation required')
    require(all(scored['members'][sid]['status'] == 'SCORED' for sid in state['positions']),
            'Held short-history security requires separate study-origin review')
    _reconcile_actions(state, context, completed[-1]['date'], at)
    equity = cents(nav(state, {sid: amount(m['price']) for sid, m in state['marks'].items()}), ROUND_FLOOR)
    require(equity > 0, 'Nonpositive model equity')
    held = {state['symbols'][sid] for sid in state['positions']}
    # Empty retention set makes the unchanged choose() exactly the baseline
    # rank/sector/count construction. BUFFER uses actual incumbents.
    selected = choose(scored['scores'], held if selection_strategy == BUFFER else set())
    selected_ids = {s['security_id'] for s in selected}
    targets = {sid: equity // 10 if sid in selected_ids else 0
               for sid in sorted(selected_ids | set(state['positions']))}
    result = dict(adapter_version=VERSION, selection_strategy=selection_strategy,
        scoring_report_id=scored['report_id'], account_state_digest=digest(account),
        targets=targets, equity_cents=equity, holdings=deepcopy(state['positions']),
        symbols=state['symbols'], prior_inputs=scored['prior_inputs'], members=scored['members'],
        status='OFFLINE_ACCOUNT_DERIVED_DECISION', performance=None)
    result['decision_id'] = digest(result)
    return result


@exact
def plan_universe(account, evidence, session, *, selection_strategy, calendar, settlement, costs):
    require('close_marks' not in session, 'Future closes cannot enter opening planner')
    a = decision_from_account(account, evidence, calendar, selection_strategy=selection_strategy)
    at = stamp(evidence['decision_at'])
    require(at.astimezone(NY).date().isoformat() == session['date'] and at < stamp(session['open_at']),
            'Wrong next execution session')
    for quote in session['quotes']:
        sid = quote['security_id']
        if sid in a['targets']:
            require(quote['prior_adv20_shares'] == a['prior_inputs'][sid]['prior_adv20_shares'],
                    'Execution liquidity disagrees with model')
    state = deepcopy(account); state['symbols'] = a['symbols']
    planned = plan_open(state, session, a['targets'], decision_id=a['decision_id'],
                        calendar=calendar, settlement=settlement, costs=costs)
    return {**planned, 'universe_adapter': a}


@exact
def compare_synthetic(initial_account, rows, *, calendar, settlement, costs):
    """Shared-input, independent-account comparison; historical access blocked."""
    require(isinstance(rows, list) and bool(rows), 'Nonempty rows required')
    for row in rows:
        require(set(row) <= {'session', 'evidence'} and 'session' in row, 'Unexpected paired inputs')
        require(row['session']['kind'] == 'synthetic_fixture', 'Historical study remains blocked')
        if row.get('evidence') is not None:
            require(isinstance(row['evidence']['shards'], list), 'Paired replay requires reusable shard list')
    results = {}
    for name, strategy in [('baseline', BASELINE), ('candidate', BUFFER)]:
        state = deepcopy(initial_account); output = []
        for row in rows:
            session = {k: deepcopy(v) for k, v in row['session'].items() if k != 'close_marks'}
            if stamp(state['as_of']).astimezone(NY).strftime('%Y-%m') != session['date'][:7]:
                require(row.get('evidence') is not None, 'Monthly decision required')
            if row.get('evidence') is not None:
                planned = plan_universe(state, row['evidence'], session, selection_strategy=strategy,
                    calendar=calendar, settlement=settlement, costs=costs)
            else:
                planned = plan_open(state, session, None, decision_id=None,
                    calendar=calendar, settlement=settlement, costs=costs)
            closed = close_session(planned, row['session']); state = closed['state']; output.append(closed)
        results[name] = dict(state=state, sessions=output)
    return dict(version=VERSION, kind='SYNTHETIC_ONLY_NOT_BACKTEST', **results,
                performance=None, historical_study_ready=False)
