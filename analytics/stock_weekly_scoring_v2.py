"""Weekly variant of the frozen momentum scoring, for a separately registered PAPER experiment.

The mathematics are byte-for-byte those of stock_momentum_v1.generate and
stock_universe_scoring_v1.score_universe: 252-session momentum skipping the latest
21, a 200-session trend filter, the $5 price and $20M dollar-volume eligibility,
top five with at most two per sector, 10% of equity per target. Only the calendar
rule differs: a decision is taken at 08:00 New York on the first exchange session of
an ISO week (or once, on the experiment's first session, when `initial` is set)
instead of the first session of a month. The frozen modules are imported, never
edited; test_stock_weekly_v2 proves both produce identical scores on a session that
starts both a week and a month.

This is NOT the frozen research model and inherits none of its evidence.
"""
from copy import deepcopy
from datetime import date
from decimal import Decimal as D, localcontext
from .stock_data_contract import parse_daily_bars, visible_at, _stamp
from .stock_momentum_v1 import (VERSION as BASELINE, number, integer, label, digest,
                                total_return_index, NY)
from .stock_universe_scoring_v1 import VERSION as FROZEN_SCORING
from .stock_accounting_v2 import exact, require, stamp, validate_calendar

VERSION = 'stock-weekly-universe-scoring-v2'
VERSION_FROZEN_REFERENCE = FROZEN_SCORING


def _week(day):
    """ISO (year, week) of an exchange session date."""
    return day.isocalendar()[:2]


def rebalance_rule(initial):
    return 'weekly-initial-session' if initial else 'weekly-first-session-of-iso-week'


def generate_weekly(payload, context, *, decision_at, equity_cents=100000, held_symbols=(), initial=False):
    """Emit immutable-content-hashed targets; do not infer fills or returns.

    Context fields documented in STOCK_MOMENTUM_BASELINE_2026_10_09.md.
    Missing bars/actions/point-in-time universe fail the WHOLE batch closed.
    No fabricated prices, forward fill, forced stale liquidation, or provider IO.
    """
    integer(equity_cents,'equity_cents',1)
    data=parse_daily_bars(payload); at=_stamp(decision_at,'decision_at')
    bars=visible_at(data,decision_at)
    for k in ('calendar_revision','universe_revision','actions_revision'):
        label(context[k],k)
    for k in ('calendar_available_at','universe_available_at','actions_available_at'):
        if _stamp(context[k],k)>=at:raise ValueError(k+': unavailable at decision')
    if context.get('actions_complete') is not True:raise ValueError('explicit audited action coverage required')
    calendar=context['sessions']
    if not isinstance(calendar,list) or len(calendar)<254:raise ValueError('253 historical sessions plus next session required')
    dates=[]; closes=[]; opens=[]
    for s in calendar:
        day=date.fromisoformat(s['date']); op=_stamp(s['open_at'],'open_at');cl=_stamp(s['close_at'],'close_at')
        if day.weekday()>4 or op>=cl or op.astimezone(NY).date()!=day or cl.astimezone(NY).date()!=day:raise ValueError('invalid exchange session')
        dates.append(day);opens.append(op);closes.append(cl)
    if dates!=sorted(set(dates)) or any(a>=b for a,b in zip(closes,opens[1:])):raise ValueError('duplicate/unordered calendar')
    before=[i for i,t in enumerate(closes) if t<at]
    if len(before)<253:raise ValueError('insufficient completed history')
    last=before[-1]; nxt=last+1
    if nxt>=len(calendar) or not closes[last]<at<opens[nxt]:raise ValueError('decision must precede next open')
    if not initial and _week(dates[last])==_week(dates[nxt]):raise ValueError('weekly rebalance only')
    window=dates[last-252:last+1]; calendar_window=calendar[last-252:nxt+1]
    if context['universe_session']!=dates[last].isoformat():raise ValueError('stale universe snapshot')
    if date.fromisoformat(context['actions_coverage_start'])>window[0] or date.fromisoformat(context['actions_coverage_end'])<window[-1]:raise ValueError('incomplete action coverage')
    universe=context['universe']
    if not isinstance(universe,list) or not universe:raise ValueError('empty universe')
    securities={}; ids=set()
    for u in universe:
        sym=label(u['symbol'],'symbol');sid=label(u['security_id'],'security_id')
        if sym in securities or sid in ids:raise ValueError('duplicate point-in-time security')
        if u.get('type')!='common_stock' or u.get('exchange') not in ('NYSE','NASDAQ','AMEX'):raise ValueError('only listed US common stocks admitted')
        label(u['sector'],'sector');securities[sym]=u;ids.add(sid)
    held=set(held_symbols)
    if len(held)!=len(held_symbols) or any(s not in securities for s in held):raise ValueError('holdings require coverage; delistings need separate event handling')
    index={(b.symbol,b.session_date):b for b in bars}
    actions={}; action_evidence=[]
    for a in context['actions']:
        sym=a['symbol'];day=date.fromisoformat(a['session_date'])
        # Only facts effective inside the decision window may influence targets.
        if sym not in securities or not window[0]<day<=window[-1]:continue
        if (sym,day) in actions:raise ValueError('duplicate action; aggregate explicitly')
        if day not in window:raise ValueError('action on non-session')
        if _stamp(a['available_at'],'action available')>=at:raise ValueError('action not yet available')
        split=number(a['split_ratio'],'split_ratio',positive=True)
        dividend=number(a['cash_dividend_per_old_share'],'cash_dividend_per_old_share')
        label(a['source_id'],'action source_id');actions[(sym,day)]=(split,dividend);action_evidence.append(a)
    scores=[]; evidence=[]
    with localcontext() as ctx:
        ctx.prec=50
        for sym,u in sorted(securities.items()):
            seq=[]
            for day in window:
                b=index.get((sym,day))
                if b is None:raise ValueError('missing/unavailable bar: '+sym+' '+str(day))
                calendar_close=closes[dates.index(day)]
                if b.completed_at<calendar_close:raise ValueError('bar marked complete before exchange close')
                seq.append(b)
            splits,divs=zip(*(actions.get((sym,day),(D(1),D(0))) for day in window[1:]))
            tr=total_return_index([b.close for b in seq],list(splits),list(divs))
            momentum=tr[-22]/tr[-253]-1  # T-21 / T-252; omit most recent 21 sessions
            trend=tr[-1]>sum(tr[-200:])/200
            liquidity=sum(b.close*b.volume for b in seq[-20:])/20
            eligible=seq[-1].close>=5 and liquidity>=20000000
            scores.append({'symbol':sym,'security_id':u['security_id'],'sector':u['sector'],
                           'momentum':str(momentum),'trend_positive':trend,'eligible':eligible,
                           'mean_dollar_volume_20':str(liquidity),'last_raw_close':str(seq[-1].close)})
            evidence.extend([[b.symbol,str(b.session_date),b.completed_at.isoformat(),b.available_at.isoformat(),str(b.close),b.volume] for b in seq])
        ranked=sorted((r for r in scores if r['eligible'] and r['trend_positive'] and D(r['momentum'])>0),key=lambda r:(-D(r['momentum']),r['symbol']))
        selected=[]; sector_counts={}
        for r in ranked:
            if sector_counts.get(r['sector'],0)>=2:continue
            selected.append(r);sector_counts[r['sector']]=sector_counts.get(r['sector'],0)+1
            if len(selected)==5:break
    chosen={r['symbol'] for r in selected};budget=equity_cents//10
    targets=[{'symbol':s,'action':'TARGET' if s in chosen else 'EXIT',
              'target_budget_cents':budget if s in chosen else 0} for s in sorted(chosen|held)]
    inputs={'version':BASELINE,'rebalance':rebalance_rule(initial),'decision_at':at.isoformat(),'equity_cents':equity_cents,
            'held_symbols':sorted(held),'bars':evidence,'universe':sorted(universe,key=lambda u:u['symbol']),
            'actions':sorted(action_evidence,key=lambda a:(a['symbol'],a['session_date'])),
            'calendar':calendar_window,'provider':data.provider,
            'provenance':{k:context[k] for k in ('calendar_revision','universe_revision','actions_revision','calendar_available_at','universe_available_at','actions_available_at','actions_coverage_start','actions_coverage_end')}}
    signal_id=digest(inputs)
    return {'strategy_version':BASELINE,'signal_id':signal_id,'input_digest':signal_id,
            'decision_at':at.isoformat(),'earliest_execution_at':opens[nxt].isoformat(),
            'source_revision':data.source_revision,'targets':targets,'scores':scores,
            'cash_target_cents':equity_cents-budget*len(chosen),'max_gross_target_bps':5000,
            'status':'research_targets_only','source_independently_verified':False,
            'performance_measured':False,'fills':[]}


def _context(context, decision_at, initial):
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
            and (initial or _week(date.fromisoformat(last)) != _week(date.fromisoformat(days[nxt]))),
            'Week-start next-session decision required')
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
def score_universe_weekly(shards, context, listings, *, decision_at, initial=False):
    """Score every mature member; explicitly report known insufficient history.

    shards is an iterable of {security_id, payload}; each payload contains only
    that permanent ID's current normalized symbol and obeys the original 100k
    row parser bound. There is no aggregate market row cap. Shards must cover
    every member exactly once. No continuation after any malformed member.

    listings maps permanent IDs to first_traded_on, available_at and source_id.
    first_traded_on means earliest public trading of this economic security,
    NOT the first row received or its latest exchange/ticker change.
    """
    at, sessions, window, members = _context(context, decision_at, initial)
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
        calculated = generate_weekly(shard['payload'], single, decision_at=decision_at, initial=initial)
        scores.extend(calculated['scores'])
        statuses[sid] = dict(symbol=sym, status='SCORED', completed_sessions=253)
    require(seen == set(members), 'Omitted universe members invalidate the entire batch')
    scores.sort(key=lambda s: s['symbol'])
    statuses = dict(sorted(statuses.items()))
    bound_context = {k: v for k, v in context.items() if k not in ('universe', 'actions')}
    bound_context['universe'] = sorted(members.values(), key=lambda u: u['security_id'])
    bound_context['actions'] = sorted((a for a in context['actions']
        if window[0] < a['session_date'] <= window[-1]), key=lambda a: (a['symbol'], a['session_date']))
    rid = digest(dict(version=VERSION, rebalance=rebalance_rule(initial), context=bound_context,
                      decision_at=at.isoformat(),
                      evidence=sorted(evidence, key=lambda e: e['security_id'])))
    return dict(adapter_version=VERSION, baseline_formula_reference=BASELINE, rebalance=rebalance_rule(initial),
                report_id=rid, decision_at=at.isoformat(), scores=scores, members=statuses,
                prior_inputs=dict(sorted(prior_inputs.items())),
                declared_members=len(members), processed_members=len(seen),
                status='SCORING_ONLY_NOT_EXECUTABLE', performance=None,
                source_independently_verified=False, historical_study_ready=False)
