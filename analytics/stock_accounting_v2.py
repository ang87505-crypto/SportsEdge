"""Offline USD accounting kernel v2. No broker, IO, source authentication or orders.

Public strategy entry points live in stock_baseline_replay_v2. This kernel accepts
validated permanent-ID targets; it does not authorize a strategy by itself.
"""
from copy import deepcopy
from datetime import date
from decimal import Context, Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, ROUND_HALF_EVEN, localcontext
from functools import wraps
from zoneinfo import ZoneInfo
from .stock_momentum_v1 import digest
from .stock_data_contract import _stamp

VERSION = 'stock-accounting-execution-v2'
D = Decimal
NY = ZoneInfo('America/New_York')
CENT = D('0.01')


def exact(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        with localcontext(Context(prec=60, rounding=ROUND_HALF_EVEN)):
            return fn(*args, **kwargs)
    return wrapped


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def integer(x, name, minimum=0):
    require(type(x) is int and minimum <= x <= 10**12, name + ': bounded integer required')
    return x


def label(x):
    require(isinstance(x, str) and 0 < len(x) <= 160 and x == x.strip(), 'Invalid label')
    return x


def amount(x, positive=False):
    require(isinstance(x, str) and len(x) <= 40, 'Decimal text required')
    try:
        n = D(x)
    except Exception as exc:
        raise ValueError('Invalid decimal') from exc
    require(n.is_finite() and 0 <= n <= D('1000000000') and n.as_tuple().exponent >= -6,
            'Invalid amount or unsupported source precision')
    require(not positive or n > 0, 'Positive price required')
    return n


def stamp(x):
    return _stamp(x, 'timestamp')


def iso_day(value):
    require(isinstance(value, str), 'ISO date text required')
    parsed = date.fromisoformat(value)
    require(parsed.isoformat() == value, 'Canonical YYYY-MM-DD required')
    return parsed


def cents(x, rounding):
    return int((x * 100).to_integral_value(rounding=rounding))


def validate_calendar(calendar):
    require(calendar['coverage_complete'] is True, 'Complete exchange calendar required')
    label(calendar['revision'])
    days = []
    for row in calendar['sessions']:
        day = iso_day(row['date'])
        op, cl = stamp(row['open_at']), stamp(row['close_at'])
        require(day.weekday() < 5 and op < cl and op.astimezone(NY).date() == day
                and cl.astimezone(NY).date() == day, 'Invalid exchange session')
        days.append(row['date'])
    require(days and days == sorted(set(days)), 'Duplicate/unordered exchange calendar')
    return {r['date']: r for r in calendar['sessions']}


def settlement_date(trade_date, policy):
    """Regular-way US stock trades only; explicitly supplied settlement calendar."""
    require(policy['version'] == 'us-regular-way-settled-only-v1'
            and policy['coverage_complete'] is True, 'Settlement policy/coverage required')
    label(policy['revision'])
    days = policy['business_dates']
    require(days == sorted(set(days)) and bool(days), 'Unordered settlement calendar')
    for day in days:
        require(iso_day(day).weekday() < 5, 'Invalid settlement business date')
    iso_day(trade_date); iso_day(policy['coverage_start']); iso_day(policy['coverage_end'])
    require(policy['coverage_start'] <= trade_date <= policy['coverage_end'], 'Settlement coverage missing')
    require(days[0] >= policy['coverage_start'] and days[-1] <= policy['coverage_end'], 'Settlement range mismatch')
    require(trade_date >= '2000-01-01', 'Pre-registered historical range unsupported')
    lag = 1 if trade_date >= '2024-05-28' else 2 if trade_date >= '2017-09-05' else 3
    following = [d for d in days if d > trade_date]
    require(len(following) >= lag, 'Settlement calendar lacks future dates')
    return following[lag - 1]


@exact
def validate_state(s):
    require(s['version'] == VERSION, 'Account version mismatch')
    require(stamp(s['origin_at']) <= stamp(s['as_of']), 'Invalid account origin')
    integer(s['revision'], 'revision')
    integer(s['settled_cash_cents'], 'settled cash')
    require(isinstance(s['positions'], dict) and isinstance(s['symbols'], dict), 'Invalid positions/identities')
    require(len(set(s['symbols'].values())) == len(s['symbols']), 'Symbol alias collision')
    for sid, sym in s['symbols'].items():
        label(sid); label(sym)
    for sid, n in s['positions'].items():
        require(sid in s['symbols'], 'Position lacks permanent identity')
        integer(n, 'quantity', 1)
    for key in ('processed_events', 'executed_decisions'):
        require(len(s[key]) == len(set(s[key])), 'Repeated state receipt')
        for identity in s[key]:
            label(identity)
    require({e['event_id'] for e in s['action_history']} == set(s['processed_events'])
            and len(s['action_history']) == len(s['processed_events']), 'Event history/receipt mismatch')
    ids = []
    for r in s['unsettled']:
        ids.append(label(r['id']))
        integer(r['amount_cents'], 'unsettled proceeds')
        require(iso_day(r['due_date']) > stamp(s['as_of']).astimezone(NY).date(), 'Overdue unsettled balance')
    for r in s['receivables']:
        ids.append(label(r['event_id']))
        require(r['event_id'] in s['processed_events'] and r['security_id'] in s['symbols'], 'Unknown entitlement')
        integer(r['entitled_shares'], 'entitled shares', 1)
        amount(r['per_share'], positive=True)
        require(D(r['amount']) == r['entitled_shares'] * amount(r['per_share']), 'Receivable value mismatch')
        require(stamp(r['pay_at']) > stamp(s['as_of']), 'Overdue receivable')
    require(len(ids) == len(set(ids)), 'Duplicate monetary claim')
    require(set(s['marks']) >= set(s['positions']), 'Missing prior holding mark')
    for sid, m in s['marks'].items():
        require(sid in s['symbols'] and m['symbol'] == s['symbols'][sid], 'Mark identity mismatch')
        amount(m['price'], positive=True)
        require(stamp(m['completed_at']) == stamp(s['as_of'])
                and stamp(m['available_at']) >= stamp(m['completed_at']), 'Invalid prior close mark')


@exact
def new_account(*, as_of, settled_cash_cents, symbols, positions, marks):
    s = dict(version=VERSION, as_of=as_of, revision=0, settled_cash_cents=settled_cash_cents,
             symbols=deepcopy(symbols), positions=deepcopy(positions), marks=deepcopy(marks), origin_at=as_of, action_history=[],
             unsettled=[], receivables=[], processed_events=[], executed_decisions=[])
    validate_state(s)
    return s


@exact
def nav(s, prices):
    """Unrounded USD economic NAV; pending proceeds/entitlements count exactly once."""
    return (D(s['settled_cash_cents'] + sum(r['amount_cents'] for r in s['unsettled'])) / 100
            + sum((D(r['amount']) for r in s['receivables']), D(0))
            + sum((n * prices[sid] for sid, n in s['positions'].items()), D(0)))


def _cash_due(s, at, journal):
    day = stamp(at).astimezone(NY).date().isoformat()
    pending = []
    for r in s['unsettled']:
        if r['due_date'] <= day:
            s['settled_cash_cents'] += r['amount_cents']
            journal.append(dict(kind='sale_settlement', **r))
        else:
            pending.append(r)
    s['unsettled'] = pending
    pending = []
    for r in s['receivables']:
        if stamp(r['pay_at']) <= stamp(at):
            paid = cents(D(r['amount']), ROUND_HALF_UP)
            s['settled_cash_cents'] += paid
            journal.append(dict(kind='dividend_payment', event_id=r['event_id'], amount_cents=paid,
                                rounding_dollars=str(D(paid) / 100 - D(r['amount'])), at=at))
        else:
            pending.append(r)
    s['receivables'] = pending


def _events(s, events, session, journal):
    seen_ids = set(s['processed_events'])
    seen_securities = set()
    for e in sorted(events, key=lambda x: x['event_id']):
        eid, sid = label(e['event_id']), label(e['security_id'])
        require(eid not in seen_ids, 'Duplicate corporate event')
        require(sid not in seen_securities, 'Combined same-session events need separate reconciliation')
        seen_ids.add(eid); seen_securities.add(sid)
        require(sid in s['symbols'], 'Unknown event security')
        require(stamp(e['effective_at']) == stamp(session['open_at'])
                and stamp(e['available_at']) < stamp(session['open_at']), 'Late/future/event timing mismatch')
        old = s['positions'].get(sid, 0)
        if e['type'] == 'ordinary_cash_dividend':
            require(e['currency'] == 'USD' and e['due_bill'] is False, 'Unsupported dividend convention')
            per_share = amount(e['per_old_share'], positive=True)
            require(sid in s['marks'] and per_share < amount(s['marks'][sid]['price']) / 4,
                    'Special/large distribution unsupported')
            require(stamp(e['pay_at']) >= stamp(e['effective_at']), 'Payment precedes ordinary ex-date')
            if old:
                s['receivables'].append(dict(event_id=eid, security_id=sid, entitled_shares=old,
                                            per_share=str(per_share), amount=str(old * per_share), pay_at=e['pay_at']))
            journal.append(dict(kind='dividend_entitlement', event_id=eid, shares=old,
                                amount=str(old * per_share)))
        elif e['type'] == 'split':
            num = integer(e['numerator'], 'split numerator', 1)
            den = integer(e['denominator'], 'split denominator', 1)
            require(num <= 1000 and den <= 1000, 'Unsupported split ratio')
            require((old * num) % den == 0, 'Fractional entitlement/cash-in-lieu unsupported')
            if old:
                s['positions'][sid] = old * num // den
            journal.append(dict(kind='split', event_id=eid, old_shares=old, new_shares=old * num // den))
        elif e['type'] == 'rename':
            require(e['old_symbol'] == s['symbols'][sid], 'Rename old identity mismatch')
            new = label(e['new_symbol'])
            require(new not in s['symbols'].values(), 'Rename collision')
            s['symbols'][sid] = new
            journal.append(dict(kind='rename', event_id=eid, security_id=sid, symbol=new))
        else:
            raise ValueError('Unsupported corporate event: ' + str(e['type']))
        s['processed_events'].append(eid)
        s['action_history'].append(deepcopy(e))


def _quotes(s, session, costs):
    require(set(costs) == {'version', 'assumption_id', 'fee_cents_per_order', 'slippage_bps'},
            'Unknown cost setting; bid/ask already includes spread')
    require(costs['version'] == 'explicit-usd-costs-v2', 'Explicit versioned costs required')
    label(costs['assumption_id'])
    fee = integer(costs['fee_cents_per_order'], 'fee')
    bps = amount(costs['slippage_bps'])
    require(bps <= 5000, 'Slippage above supported bound')
    result = {}
    for q in session['quotes']:
        sid = label(q['security_id'])
        require(sid not in result and s['symbols'].get(sid) == q['symbol'], 'Quote identity mismatch/duplicate')
        require(q['tradable'] is True, 'Unavailable execution invalidates entire session')
        op = stamp(session['open_at']); observed = stamp(q['observed_at']); available = stamp(q['available_at'])
        require(observed <= available <= op and (op - observed).total_seconds() <= 60,
                'Stale/future/unavailable execution quote')
        bid, ask = amount(q['bid'], True), amount(q['ask'], True)
        require(bid <= ask, 'Crossed quote')
        integer(q['bid_size'], 'bid size'); integer(q['ask_size'], 'ask size')
        integer(q['prior_adv20_shares'], 'prior consolidated volume')
        require(stamp(q['volume_available_at']) < op and q['volume_last_session'] == stamp(s['as_of']).astimezone(NY).date().isoformat(),
                'Future/stale liquidity evidence')
        split_scale = D(1)
        for event in session['events']:
            if event['security_id'] == sid and event['type'] == 'split':
                split_scale = D(event['numerator']) / event['denominator']
        result[sid] = dict(split_scale=split_scale, mid=(bid + ask) / 2, buy=ask * (1 + bps / 10000),
                           sell=bid * (1 - bps / 10000), fee=fee, source=q)
    require(set(s['positions']) <= set(result), 'Missing held-security open')
    return result


def _trade_amount(q, n, side):
    gross = cents(n * q[side], ROUND_CEILING if side == 'buy' else ROUND_FLOOR)
    net = gross + q['fee'] if side == 'buy' else gross - q['fee']
    require(net >= 0, 'Fee exceeds sale proceeds')
    return net


@exact
def plan_open(account, session, targets, *, decision_id, calendar, settlement, costs):
    """Pure kernel. All-or-error. targets=None holds; {} explicitly liquidates.

    Targets are USD integer-cent budgets by permanent ID from the baseline adapter.
    Price-contingent quantities at the supplied open are an idealized scenario.
    Returned trades are simulated only; no account is persisted or broker called.
    """
    validate_state(account)
    s = deepcopy(account); session = deepcopy(session)
    sessions = validate_calendar(calendar)
    day = session['date']
    require(day in sessions and all(stamp(session[k]) == stamp(sessions[day][k]) for k in ('open_at', 'close_at')),
            'Execution session differs from calendar')
    days = list(sessions)
    prior_day = stamp(s['as_of']).astimezone(NY).date().isoformat()
    require(prior_day in sessions and days.index(day) == days.index(prior_day) + 1
            and stamp(s['as_of']) == stamp(sessions[prior_day]['close_at']), 'Missing/repeated exchange session')
    require(stamp(calendar['available_at']) < stamp(session['open_at'])
            and stamp(settlement['available_at']) < stamp(session['open_at']), 'Calendar not yet available')
    require(session['actions_complete'] is True and stamp(session['actions_available_at']) < stamp(session['open_at']),
            'Corporate event coverage unavailable')
    require(session['price_adjustment'] == 'raw' and session['currency'] == 'USD', 'Raw USD execution prices required')
    require(session['kind'] in ('synthetic_fixture', 'historical_price_proxy'), 'Explicit scenario kind required')
    require(all(stamp(m['available_at']) < stamp(session['open_at']) for m in s['marks'].values()),
            'Prior close information unavailable at open')
    journal = []; trades = []; decisions = []
    _cash_due(s, session['open_at'], journal)
    _events(s, session['events'], session, journal)
    _cash_due(s, session['open_at'], journal)
    quotes = _quotes(s, session, costs)
    prices = {sid: q['mid'] for sid, q in quotes.items()}
    before = nav(s, prices)
    require(before > 0, 'Nonpositive NAV')
    if targets is not None:
        label(decision_id)
        require(decision_id not in s['executed_decisions'], 'Decision executed twice')
        require(set(s['positions']) <= set(targets) <= set(quotes), 'Target/holding/quote coverage mismatch')
        require(sum(b > 0 for b in targets.values()) <= 5, 'Too many targets')
        for budget in targets.values():
            integer(budget, 'target budget')
        # Worst-case liquidation PLUS repurchase costs form a conservative NAV lower
        # bound. It may undersize by a share, but avoids circular post-cost cap sizing.
        upper = {sid: int(min(D(b) / 100, before / 10) // quotes[sid]['mid']) for sid, b in targets.items()}
        reserve = D(0)
        for sid, n in s['positions'].items():
            q = quotes[sid]
            reserve += n * prices[sid] - D(cents(n * q['sell'], ROUND_FLOOR) - q['fee']) / 100
        for sid, n in upper.items():
            if n:
                reserve += D(_trade_amount(quotes[sid], n, 'buy')) / 100 - n * prices[sid]
        lower_nav = before - reserve
        require(lower_nav > 0, 'Costs exhaust NAV')
        desired = {}
        for sid, budget in targets.items():
            q = quotes[sid]
            cap = min(D(budget) / 100, lower_nav / 10)
            desired[sid] = max(0, int(max(D(0), cap - D(q['fee']) / 100) // q['buy']))
        due = settlement_date(day, settlement)
        for side in ('sell', 'buy'):
            for sid in sorted(desired):
                old = s['positions'].get(sid, 0)
                requested = max(0, old - desired[sid] if side == 'sell' else desired[sid] - old)
                if not requested:
                    continue
                q = quotes[sid]; n = requested
                if side == 'buy':
                    n = min(n, max(0, int((max(0, s['settled_cash_cents'] - q['fee']) / D(100)) // q['buy'])))
                    if n < requested:
                        decisions.append(dict(security_id=sid, reason='settled_cash_limit', requested=requested, shares=n))
                if not n:
                    continue
                require(n <= q['source']['bid_size' if side == 'sell' else 'ask_size']
                        and n * 100 <= D(q['source']['prior_adv20_shares']) * q['split_scale'], 'Insufficient executable liquidity')
                cash = _trade_amount(q, n, side)
                tid = digest([decision_id, day, sid, side])
                if side == 'buy':
                    require(cash <= s['settled_cash_cents'], 'Insufficient settled cash')
                    s['settled_cash_cents'] -= cash
                    s['positions'][sid] = old + n
                else:
                    s['unsettled'].append(dict(id=tid, amount_cents=cash, due_date=due))
                    if old == n:
                        s['positions'].pop(sid)
                    else:
                        s['positions'][sid] = old - n
                trades.append(dict(trade_id=tid, security_id=sid, symbol=s['symbols'][sid], side=side,
                                   shares=n, unit_price=str(q[side]), amount_cents=cash,
                                   fee_cents=q['fee'], settlement_date=due,
                                   reference_price=q['source']['ask' if side == 'buy' else 'bid'],
                                   spread_cost_dollars=str(n * abs(amount(q['source']['ask' if side == 'buy' else 'bid']) - q['mid'])),
                                   slippage_cost_dollars=str(n * abs(q[side] - amount(q['source']['ask' if side == 'buy' else 'bid']))),
                                   rounding_cost_dollars=str((D(cash - q['fee']) / 100 - n * q[side]) if side == 'buy' else (n * q[side] - D(cash + q['fee']) / 100)),
                                   settled_cash_delta_cents=-cash if side == 'buy' else 0,
                                   unsettled_delta_cents=cash if side == 'sell' else 0,
                                   status='SIMULATED_NOT_EXECUTED'))
        after = nav(s, prices)
        values = [n * prices[sid] for sid, n in s['positions'].items()]
        require(all(v <= after / 10 for v in values) and sum(values) <= after / 2, 'Post-cost risk cap failed')
        s['executed_decisions'].append(decision_id)
    else:
        after = before
    return dict(version=VERSION, prior_state_digest=digest(account), projected_open_state=s,
                trades=trades, cash_constraints=decisions, events=journal,
                open_nav_before=str(before), open_nav_after=str(after),
                session_date=day, open_input_digest=digest(session), status='OFFLINE_SCENARIO_ONLY', source_independently_verified=False)


@exact
def close_session(plan, session):
    """Book the later close only after planning; never used to size an open trade."""
    require(plan['version'] == VERSION and plan['session_date'] == session['date'], 'Plan/session mismatch')
    opening = {k: v for k, v in session.items() if k != 'close_marks'}
    require(digest(opening) == plan['open_input_digest'], 'Opening plan/session evidence changed')
    s = deepcopy(plan['projected_open_state']); journal = deepcopy(plan['events'])
    _cash_due(s, session['close_at'], journal)
    marks = {}
    for m in session['close_marks']:
        sid = label(m['security_id'])
        require(sid not in marks and s['symbols'].get(sid) == m['symbol'], 'Close mark identity mismatch')
        amount(m['price'], True)
        require(stamp(m['completed_at']) == stamp(session['close_at'])
                and stamp(m['available_at']) >= stamp(m['completed_at']), 'Invalid close timestamp')
        marks[sid] = {k: m[k] for k in ('symbol', 'price', 'completed_at', 'available_at')}
    require(set(s['positions']) <= set(marks), 'Missing held-security close')
    s['marks'] = marks; s['as_of'] = session['close_at']; s['revision'] += 1
    validate_state(s)
    return {**deepcopy(plan), 'state': s, 'events': journal,
            'close_nav': str(nav(s, {sid: amount(m['price']) for sid, m in marks.items()}))}
