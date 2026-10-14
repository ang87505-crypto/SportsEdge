"""Bounded, permanent-ID universe scoring with unchanged baseline mathematics.

Produces a scoring report, never a signal accepted by execution adapters.
Listing and universe evidence are declarations pending independent source audit.
No provider I/O, price inference, selection-parameter changes or performance.
"""
from copy import deepcopy
from datetime import date
from .stock_data_contract import parse_daily_bars, visible_at
from .stock_momentum_v1 import generate, digest, number, label, VERSION as BASELINE
from .stock_accounting_v2 import exact, require, stamp, validate_calendar, NY

VERSION = 'stock-pit-universe-scoring-v1'


def _context(context, decision_at):
    at = stamp(decision_at)
    local = at.astimezone(NY)
    require((local.hour, local.minute, local.second, local.microsecond) == (8, 0, 0, 0),
            'Registered decision time is 08:00 New York')
    for name in ('calendar', 'universe', 'actions'):
        label(context[name + '_revision'], name)
        require(stamp(context[name + '_available_at']) < at, name + ' unavailable at decision')
    require(context['actions_complete'] is True, 'Complete action coverage declaration required')
    sessions = validate_calendar(dict(revision=context['calendar_revision'], coverage_complete=True,
                                      sessions=context['sessions']))
    days = list(sessions)
    completed = [d for d in days if stamp(sessions[d]['close_at']) < at]
    require(len(completed) >= 253, '253 completed calendar sessions required')
    last = completed[-1]
    nxt = days.index(last) + 1
    require(nxt < len(days) and at < stamp(sessions[days[nxt]]['open_at'])
            and last[:7] != days[nxt][:7], 'Month-end next-session decision required')
    require(context['universe_session'] == last, 'Stale universe snapshot')
    window = completed[-253:]
    require(date.fromisoformat(context['actions_coverage_start']) <= date.fromisoformat(window[0])
            and date.fromisoformat(context['actions_coverage_end']) >= date.fromisoformat(last),
            'Incomplete action coverage')
    universe = context['universe']
    require(isinstance(universe, list) and bool(universe), 'Complete nonempty universe required')
    members = {}; symbols = set()
    for u in universe:
        sid = label(u['security_id'], 'security_id'); sym = label(u['symbol'], 'symbol')
        require(sid not in members and sym not in symbols, 'Duplicate identity or symbol')
        require(u['type'] == 'common_stock' and u['exchange'] in ('NYSE', 'NASDAQ', 'AMEX'),
                'Only listed US common stocks admitted')
        label(u['sector'], 'sector')
        members[sid] = u; symbols.add(sym)
    seen = set(); event_ids = set()
    for action in context['actions']:
        require(action['symbol'] in symbols, 'Action security absent from PIT universe')
        day = date.fromisoformat(action['session_date']).isoformat()
        if not window[0] < day <= last:
            continue
        key = (action['symbol'], day)
        require(key not in seen and day in sessions, 'Duplicate or non-session action')
        eid = label(action['source_id'], 'source_id')
        require(eid not in event_ids, 'Duplicate action source identity')
        require(stamp(action['available_at']) < at, 'Action unavailable at decision')
        number(action['split_ratio'], 'split', positive=True)
        number(action['cash_dividend_per_old_share'], 'dividend')
        seen.add(key); event_ids.add(eid)
    return at, sessions, window, members


@exact
def score_universe(shards, context, listings, *, decision_at):
    """Score every mature member; explicitly report known insufficient history.

    shards is an iterable of {security_id, payload}; each payload contains only
    that permanent ID's current normalized symbol and obeys the original 100k
    row parser bound. There is no aggregate market row cap. Shards must cover
    every member exactly once. No continuation after any malformed member.

    listings maps permanent IDs to first_traded_on, available_at and source_id.
    first_traded_on means earliest public trading of this economic security,
    NOT the first row received or its latest exchange/ticker change.
    """
    at, sessions, window, members = _context(context, decision_at)
    require(isinstance(listings, dict) and set(listings) == set(members),
            'Listing evidence must cover exactly the full PIT universe')
    statuses = {}; scores = []; evidence = []; seen = set(); prior_inputs = {}
    for shard in shards:
        require(set(shard) == {'security_id', 'payload'}, 'Explicit security shard required')
        sid = shard['security_id']
        require(sid in members and sid not in seen, 'Unknown or duplicate security shard')
        seen.add(sid)
        u = members[sid]; sym = u['symbol']; listing = listings[sid]
        require(set(listing) == {'first_traded_on', 'available_at', 'source_id'},
                'Exact listing evidence fields required')
        first = date.fromisoformat(listing['first_traded_on']).isoformat()
        require(first == listing['first_traded_on'] and first <= window[-1], 'Invalid first trading date')
        label(listing['source_id'], 'listing source_id')
        require(stamp(listing['available_at']) < at, 'Listing unavailable at decision')
        if first >= window[0]:
            require(first in sessions, 'First trading date not an exchange session')
        data = parse_daily_bars(shard['payload'])
        require(all(b.symbol == sym for b in data.bars), 'Shard symbol/permanent-ID mismatch')
        require(all(str(b.session_date) >= first for b in data.bars),
                'Listing evidence contradicts earlier observations')
        visible = {str(b.session_date): b for b in visible_at(data, decision_at)}
        expected = [d for d in window if d >= first]
        require(bool(expected), 'No completed listing history')
        for day in expected:
            b = visible.get(day)
            require(b is not None, 'Missing/unavailable post-listing session: ' + sid + ' ' + day)
            require(b.completed_at >= stamp(sessions[day]['close_at']), 'Premature bar completion')
        # Bind source metadata and the complete required visible window; future
        # observations cannot alter scores or the as-of report identity.
        bars = [[d, str(visible[d].open), str(visible[d].high), str(visible[d].low),
                 str(visible[d].close), visible[d].volume, visible[d].completed_at.isoformat(),
                 visible[d].available_at.isoformat()] for d in expected]
        evidence.append(dict(security_id=sid, shard_digest=digest(dict(listing=listing,
            provider=data.provider, source_revision=data.source_revision, bars=bars))))
        last = visible[window[-1]]
        volume = None
        if len(expected) >= 20:
            from decimal import Decimal as D
            total = D(0)
            for day in expected[-20:]:
                adjusted = D(visible[day].volume)
                for action in context['actions']:
                    if action['symbol'] == sym and day < action['session_date'] <= window[-1]:
                        adjusted *= number(action['split_ratio'], 'split', positive=True)
                total += adjusted
            volume = int(total // 20)
        prior_inputs[sid] = dict(symbol=sym, price=str(last.close),
            completed_at=last.completed_at.isoformat(), available_at=last.available_at.isoformat(),
            prior_adv20_shares=volume)
        if len(expected) < 253:
            statuses[sid] = dict(symbol=sym, status='INELIGIBLE_KNOWN_SHORT_HISTORY',
                                 completed_sessions=len(expected), first_traded_on=first)
            continue
        single = dict(context, universe=[deepcopy(u)],
                      actions=[a for a in context['actions'] if a['symbol'] == sym])
        calculated = generate(shard['payload'], single, decision_at=decision_at)
        scores.extend(calculated['scores'])
        statuses[sid] = dict(symbol=sym, status='SCORED', completed_sessions=253)
    require(seen == set(members), 'Omitted universe members invalidate the entire batch')
    scores.sort(key=lambda s: s['symbol'])
    statuses = dict(sorted(statuses.items()))
    bound_context = {k: v for k, v in context.items() if k not in ('universe', 'actions')}
    bound_context['universe'] = sorted(members.values(), key=lambda u: u['security_id'])
    bound_context['actions'] = sorted((a for a in context['actions']
        if window[0] < a['session_date'] <= window[-1]), key=lambda a: (a['symbol'], a['session_date']))
    rid = digest(dict(version=VERSION, context=bound_context, decision_at=at.isoformat(),
                      evidence=sorted(evidence, key=lambda e: e['security_id'])))
    return dict(adapter_version=VERSION, baseline_formula_reference=BASELINE,
                report_id=rid, decision_at=at.isoformat(), scores=scores, members=statuses,
                prior_inputs=dict(sorted(prior_inputs.items())),
                declared_members=len(members), processed_members=len(seen),
                status='SCORING_ONLY_NOT_EXECUTABLE', performance=None,
                source_independently_verified=False, historical_study_ready=False)
