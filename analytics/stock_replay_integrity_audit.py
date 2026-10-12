"""Additive fail-closed audit around PR #30; no broker, network or persistence.

Does not repair the inherited engine or make unsupported corporate actions
executable. Refuses inconsistent account, price, calendar or event evidence.
Checks are consistency evidence only, never authentication of historical facts.
"""
from copy import deepcopy
from datetime import date
from decimal import Decimal,localcontext
from zoneinfo import ZoneInfo
try:
    from .stock_verified_signal_replay import checked_replay
    from .stock_data_contract import _stamp,parse_daily_bars,visible_at
    from .stock_historical_ledger import cents
except ImportError:
    from stock_verified_signal_replay import checked_replay
    from stock_data_contract import _stamp,parse_daily_bars,visible_at
    from stock_historical_ledger import cents

VERSION='stock-replay-account-price-calendar-audit-v1'
NY=ZoneInfo('America/New_York')


def need(condition,message):
    if not condition:raise ValueError(message)


def guarded_replay(bundle):
    """Return a scenario only if all new audit gates pass.

    Requires complete calendar coverage from supplied model contexts for every
    replay date. No dividend cash replay is admitted: the inherited engine lacks
    entitlement/payable-date receivables. Splits need extra effective/availability
    fields. Rejections invalidate this scenario; callers must not skip bad days.
    """
    # Validate/recompute all existing signals before reading their evidence.
    report=checked_replay(deepcopy(bundle))
    timeline=bundle['replay_input'];rows=timeline['sessions']
    entries={e['signal_id']:e['generate_args'] for e in bundle['signal_evidence']}
    need(entries,'At least one verified decision is required for calendar coverage')
    calendar={};identities={}
    for args in entries.values():
        for s in args['context']['sessions']:
            key=s['date'];value=(_stamp(s['open_at'],'open'),_stamp(s['close_at'],'close'))
            need(key not in calendar or calendar[key]==value,'Conflicting calendar sources')
            calendar[key]=value
        for u in args['context']['universe']:
            # Explicitly stop on renamed/reused symbols until a security-ID adapter exists.
            key=u['symbol'];value=u['security_id']
            need(key not in identities or identities[key]==value,'Historical ticker reused across security IDs')
            identities[key]=value
    curve=report['portfolio_scenario']['equity_curve']
    event_ids=set();previous=None;decisions=0
    sorted_days=sorted(calendar)
    for i,row in enumerate(rows):
        day=date.fromisoformat(row['date']);opened=_stamp(row['open_at'],'open');closed=_stamp(row['close_at'],'close')
        need(day.weekday()<5 and opened.astimezone(NY).date()==day and closed.astimezone(NY).date()==day,
             'Session date disagrees with New York timestamps')
        need(calendar.get(row['date'])==(opened,closed),'Session not matched to supplied exchange calendar')
        if previous is not None:
            need(sorted_days.index(row['date'])==sorted_days.index(previous)+1,'Missing exchange session in ledger')
        previous=row['date']
        for m in row['market']:
            need(identities.get(m['symbol'])==m['security_id'],'Market security ID not matched to model universe')
        for a in row['actions']:
            need(a['source_id'] not in event_ids,'Corporate action source ID replayed')
            event_ids.add(a['source_id'])
            need(a['dividend_cents_per_old_share']==0,'Dividend receivable/pay-date cash not supported by inherited ledger')
            need(_stamp(a.get('effective_at'),'split effective_at')==opened,'Split effective time must match session open')
            need(_stamp(a.get('available_at'),'split available_at')<opened,'Split evidence unavailable before open')
        wrapper=row.get('decision')
        if wrapper is None:continue
        need(i>0,'Decision requires prior account state')
        decisions+=1;signal=wrapper['signal'];args=entries[signal['signal_id']]
        prior=curve[i-1]
        need(args.get('equity_cents',100000)==prior['equity_cents'],
             'Model equity differs from actual prior-close account equity')
        need(set(args.get('held_symbols',()))==set(prior['positions']),
             'Model held_symbols differs from actual prior-close holdings')
        source={(b.symbol,str(b.session_date)):b for b in visible_at(parse_daily_bars(args['payload']),args['decision_at'])}
        universe={u['symbol']:u['security_id'] for u in args['context']['universe']}
        # Tie all supplied prior-day ledger marks to the actual model input bars.
        for m in rows[i-1]['market']:
            b=source.get((m['symbol'],rows[i-1]['date']))
            need(b is not None and b.close==Decimal(m['close']),'Model and ledger prior close disagree')
            need(universe.get(m['symbol'])==m['security_id'],'Prior mark security ID differs from model')
        # The prior-day mark must exist for every held/traded symbol, even if cash-only then.
        marked={m['symbol'] for m in rows[i-1]['market']}
        need({t['symbol'] for t in signal['targets']}<=marked,'Prior marks missing for target security')
        positions=curve[i]['positions'];cash=curve[i]['cash_cents']
        opens={m['symbol']:cents(m['open']) for m in row['market']}
        values=[n*opens[s] for s,n in positions.items()];nav=cash+sum(values)
        need(all(v<=nav//10 for v in values) and sum(values)<=nav//2,
             'Post-cost open exposure differs from planner risk caps')
    return {**report,'additional_audit_version':VERSION,'account_price_calendar_decisions_checked':decisions,
            'unsupported_cash_dividends_rejected':True,'input_mutated':False,
            'scope':'Consistency guard only; no real historical source, fill, settlement or return verification'}


def audit_archive_structure(archive):
    """Reject missing action payloads and changed decoded-page evidence.

    This verifies only internal decoded JSON integrity, not original HTTP bytes,
    as-of availability, source authenticity or completeness of corporate actions.
    """
    try:
        from .alpaca_history_archive import _hash_page
    except ImportError:
        from alpaca_history_archive import _hash_page
    need(isinstance(archive,dict),'Archive object required')
    bars=archive.get('stock_bar_source_pages');actions=archive.get('corporate_action_source_pages')
    # Names are part of the inherited archive's contract, not inferred from content.
    need(isinstance(bars,list) and bars and isinstance(actions,list) and actions,'Source pages required')
    for page in bars+actions:
        need(isinstance(page,dict) and isinstance(page.get('payload'),dict),'Malformed source page')
        need(page.get('page_sha256')==_hash_page(page['payload']),'Decoded source page hash mismatch')
    for page in actions:
        need('corporate_actions' in page['payload'] and isinstance(page['payload']['corporate_actions'],dict),
             'Missing corporate_actions payload; empty default is not coverage')
    return {'archive_structure_checked':True,'corporate_actions_complete':False,
            'historical_availability_verified':False,'original_http_bytes_verified':False}
