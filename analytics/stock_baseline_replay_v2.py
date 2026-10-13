"""Authoritative baseline-to-v2 adapter and replay, offline only.

Recompute the unchanged baseline from actual prior-close state. No generic
precomputed signal endpoint; the frozen hold-rank-ten candidate is blocked.
"""
from copy import deepcopy
from decimal import ROUND_FLOOR
from .stock_momentum_v1 import generate, VERSION as BASELINE, digest
from .stock_data_contract import parse_daily_bars, visible_at
from .stock_accounting_v2 import (VERSION, exact, require, stamp, amount, cents,
                                 validate_state, validate_calendar, nav, plan_open, close_session, NY, D)

ADAPTER_VERSION = 'stock-baseline-account-adapter-v2'


@exact
def signal_from_account(account, model, calendar):
    require(set(model) == {'strategy_version', 'payload', 'context', 'decision_at'},
            'Only model evidence allowed; equity/holdings/signals must come from account')
    require(model['strategy_version'] == BASELINE, 'Candidate/unapproved strategy adapter blocked')
    validate_state(account)
    at = stamp(model['decision_at']); prior = stamp(account['as_of'])
    require(prior < at, 'Decision must follow account close')
    local = at.astimezone(NY)
    require((local.hour, local.minute, local.second, local.microsecond) == (8, 0, 0, 0),
            'Registered decision time is 08:00 New York')
    sessions = validate_calendar(calendar)
    require(stamp(calendar['available_at']) < at, 'Calendar unavailable at decision')
    context = model['context']
    for row in context['sessions']:
        require(row['date'] in sessions and all(stamp(row[k]) == stamp(sessions[row['date']][k])
                for k in ('open_at', 'close_at')), 'Model/replay exchange calendars disagree')
    completed = [r for r in calendar['sessions'] if stamp(r['close_at']) < at]
    require(completed and stamp(completed[-1]['close_at']) == prior, 'Stale account/model session')
    s = deepcopy(account)
    by_symbol = {}
    for u in context['universe']:
        sid, symbol = u['security_id'], u['symbol']
        require(sid not in s['symbols'] or s['symbols'][sid] == symbol, 'Unreconciled security rename')
        require(symbol not in s['symbols'].values() or s['symbols'].get(sid) == symbol, 'Security identity substitution')
        s['symbols'][sid] = symbol
        by_symbol[symbol] = sid
    require(set(s['positions']) <= set(by_symbol.values()), 'Held security absent from universe')
    bars = visible_at(parse_daily_bars(model['payload']), model['decision_at'])
    last = {(b.symbol, str(b.session_date)): b for b in bars}
    day = completed[-1]['date']
    for symbol, sid in by_symbol.items():
        b = last.get((symbol, day)); m = s['marks'].get(sid)
        require(b is not None and m is not None, 'Missing model/prior ledger mark')
        require(m['symbol'] == symbol and b.close == amount(m['price'])
                and b.completed_at == prior and stamp(m['completed_at']) == prior,
                'Model/ledger close or completion mismatch')
        require(stamp(m['available_at']) < at, 'Prior mark unavailable at decision')
    _reconcile_actions(s, context, day, at)
    equity = cents(nav(s, {sid: amount(m['price']) for sid, m in s['marks'].items()}), ROUND_FLOOR)
    held = sorted(s['symbols'][sid] for sid in s['positions'])
    generated = generate(model['payload'], context, decision_at=model['decision_at'],
                         equity_cents=equity, held_symbols=held)
    dates = [r['date'] for r in completed[-20:]]
    adv = {}
    for symbol, sid in by_symbol.items():
        total = D(0)
        for d in dates:
            adjusted = D(last[(symbol, d)].volume)
            for action in context['actions']:
                if action['symbol'] == symbol and d < action['session_date'] <= day:
                    require(stamp(action['available_at']) < at, 'Unavailable volume adjustment')
                    adjusted *= amount(action['split_ratio'], True)
            total += adjusted
        adv[sid] = int(total // 20)  # conservative floor; prior-close share basis
    targets = {by_symbol[t['symbol']]: t['target_budget_cents'] for t in generated['targets']}
    return dict(adapter_version=ADAPTER_VERSION, signal=generated, targets=targets,
                account_state_digest=digest(account), equity_cents=equity,
                holdings=deepcopy(s['positions']), symbols=deepcopy(s['symbols']), prior_adv20_shares=adv,
                decision_id=digest([ADAPTER_VERSION, account, generated]))


def _reconcile_actions(account, context, day, decision_at):
    """Require one identical economic action stream for the replayed portion.

    Pre-origin history is source evidence, not reconstructed account activity.
    Renames have no dividend/split index increment, but remain in account history.
    """
    origin = stamp(account['origin_at']).astimezone(NY).date().isoformat()
    start = max(origin, context['actions_coverage_start'])
    expected = {}
    for e in account['action_history']:
        effective = stamp(e['effective_at']).astimezone(NY).date().isoformat()
        if not start < effective <= day or e['type'] == 'rename':
            continue
        symbol = account['symbols'][e['security_id']]
        split = D(e['numerator']) / e['denominator'] if e['type'] == 'split' else D(1)
        div = amount(e['per_old_share']) if e['type'] == 'ordinary_cash_dividend' else D(0)
        expected[(symbol, effective)] = (split, div, e['event_id'])
    actual = {}
    for a in context['actions']:
        if start < a['session_date'] <= day:
            require(stamp(a['available_at']) < decision_at, 'Unavailable model action')
            key = (a['symbol'], a['session_date'])
            require(key not in actual, 'Duplicate model action')
            actual[key] = (amount(a['split_ratio'], True), amount(a['cash_dividend_per_old_share']), a['source_id'])
    require(actual == expected, 'Model and ledger corporate-action histories disagree')


@exact
def plan_baseline(account, model, session, *, calendar, settlement, costs):
    """Planner does NOT receive or read the future session close marks."""
    require('close_marks' not in session, 'Open planner must not receive future close marks')
    a = signal_from_account(account, model, calendar)
    require(stamp(a['signal']['earliest_execution_at']) == stamp(session['open_at']), 'Wrong next execution session')
    for q in session['quotes']:
        if q['security_id'] in a['targets']:
            require(q['prior_adv20_shares'] == a['prior_adv20_shares'][q['security_id']],
                    'Execution liquidity disagrees with prior model bars')
    s = deepcopy(account); s['symbols'] = a['symbols']
    result = plan_open(s, session, a['targets'], decision_id=a['decision_id'],
                       calendar=calendar, settlement=settlement, costs=costs)
    return {**result, 'baseline_adapter': a}


@exact
def replay(initial_account, rows, *, calendar, settlement, costs, mode='baseline'):
    """Replay every supplied session, raising for omissions or unsupported events.

    No catches that drop failed rows. Decisions are recomputed at each month end.
    All fills are scenarios. No performance metrics or profitability claims here.
    """
    require(isinstance(rows, list) and bool(rows), 'Nonempty chronological replay required')
    require(mode in ('baseline', 'accounting_fixture'), 'Unsupported replay mode')
    if mode == 'accounting_fixture':
        require(all(r['session']['kind'] == 'synthetic_fixture' for r in rows),
                'Accounting-only bypass restricted to synthetic fixtures')
    state = deepcopy(initial_account); outputs = []
    for row in rows:
        require(set(row) <= {'session', 'model'} and 'session' in row, 'Unexpected replay fields')
        session = deepcopy(row['session'])
        if mode == 'baseline' and stamp(state['as_of']).astimezone(NY).strftime('%Y-%m') != session['date'][:7]:
            require(row.get('model') is not None, 'Monthly baseline decision cannot be omitted')
        session.pop('close_marks')  # mandatory in replay, intentionally absent from planner
        if row.get('model') is not None:
            planned = plan_baseline(state, row['model'], session, calendar=calendar,
                                    settlement=settlement, costs=costs)
        else:
            planned = plan_open(state, session, None, decision_id=None, calendar=calendar,
                                settlement=settlement, costs=costs)
        result = close_session(planned, row['session'])
        state = result['state']; outputs.append(result)
    return dict(engine_version=VERSION, adapter_version=ADAPTER_VERSION, state=state, sessions=outputs,
                status='OFFLINE_ACCOUNTING_SCENARIO', mode=mode, historical_performance_measured=False,
                candidate_execution_supported=False, source_independently_verified=False)


def main():
    """Offline JSON runner. Never overwrites a file or returns a partial study."""
    import argparse
    import json
    from pathlib import Path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require(not args.output.exists(), 'Choose a new output path; existing results are preserved')
    payload = json.loads(args.input.read_text())
    require(set(payload) == {'initial_account', 'rows', 'calendar', 'settlement', 'costs'},
            'Runner accepts only baseline replay evidence')
    result = replay(**payload)
    with args.output.open('x') as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write('\n')


if __name__ == '__main__':
    main()
