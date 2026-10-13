"""Pure paper-only execution planning for the frozen stock momentum strategy.

No broker requests, no persistence, no market-data authentication. Produces
reviewable simulated fill intents; a trusted transactional runner must commit
receipts exactly once and apply them through an approved accounting adapter.
"""
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP, ROUND_CEILING, ROUND_FLOOR, localcontext
try:
    from .stock_momentum_v1 import VERSION, digest, integer, label, number
    from .stock_data_contract import _stamp
except ImportError:
    from stock_momentum_v1 import VERSION, digest, integer, label, number
    from stock_data_contract import _stamp

EXECUTION_VERSION='stock-paper-bidask-plan-v1'
D=Decimal


def quote_at(q, at):
    label(q['quote_id'],'quote_id');label(q['provider'],'provider')
    observed=_stamp(q['observed_at'],'observed_at');received=_stamp(q['received_at'],'received_at')
    if not observed<=received<=at or (at-observed).total_seconds()>60 or (at-received).total_seconds()>60:
        raise ValueError('quote stale or future')
    bid=number(q['bid'],'bid',positive=True);ask=number(q['ask'],'ask',positive=True)
    if ask<bid:raise ValueError('crossed quote')
    if q.get('tradable') is not True:raise ValueError('security is not tradable')
    for k in ('bid_size','ask_size'):integer(q[k],k)
    return bid,ask


def mark_account(account, quotes, *, as_of):
    """Value at quoted midpoint; also show conservative bid liquidation mark.

    Unrealized/realized P&L and returns require ledger cost/cashflow history,
    which this snapshot intentionally does not invent.
    """
    at=_stamp(as_of,'as_of');cash=integer(account['cash_cents'],'cash_cents')
    integer(account['revision'],'revision');label(account['account_id'],'account_id')
    positions=account['positions']
    if not isinstance(positions,dict):raise ValueError('positions mapping required')
    marks={}
    with localcontext() as ctx:
        ctx.prec=50
        for symbol,shares in sorted(positions.items()):
            label(symbol,'symbol');integer(shares,'shares',1)
            if quotes[symbol]['symbol']!=symbol:raise ValueError('quote identity mismatch')
            bid,ask=quote_at(quotes[symbol],at)
            marks[symbol]={'shares':shares,'midpoint_value_cents':int((shares*(bid+ask)/2*100).to_integral_value(rounding=ROUND_HALF_UP)),
                           'bid_value_cents':int((shares*bid*100).to_integral_value(rounding=ROUND_FLOOR))}
    return {'cash_cents':cash,'equity_cents':cash+sum(m['midpoint_value_cents'] for m in marks.values()),
            'bid_equity_before_costs_cents':cash+sum(m['bid_value_cents'] for m in marks.values()),
            'marks':marks,'as_of':at.isoformat(),'valuation':'quote midpoint, not realized P&L'}


def plan_run(signal, account, quotes, costs, *, authorization, now, session_open, session_close):
    """Authorize ONE model-selected rebalance; unchanged inputs give same plan.

    Authorization fields are assertions from a trusted server, not credentials.
    Authorize this exact signal/account/revision, expiration, and a spend cap.
    Caller must regenerate stale signals; completed signal IDs block reruns.
    """
    at=_stamp(now,'now');opened=_stamp(session_open,'session_open');closed=_stamp(session_close,'session_close')
    if not opened<=at<closed:raise ValueError('market session closed')
    if signal.get('strategy_version')!=VERSION:raise ValueError('unapproved strategy version')
    sid=label(signal['signal_id'],'signal_id');aid=label(account['account_id'],'account_id')
    revision=integer(account['revision'],'revision')
    integer(authorization['account_revision'],'authorized revision')
    decision=_stamp(signal['decision_at'],'decision_at');earliest=_stamp(signal['earliest_execution_at'],'earliest_execution_at')
    published=_stamp(authorization['signal_published_at'],'signal_published_at')
    consent=_stamp(authorization['authorized_at'],'authorized_at');expires=_stamp(authorization['expires_at'],'expires_at')
    if not decision<=published<=consent<=at<expires or earliest!=opened or not decision<earliest:
        raise ValueError('invalid signal/publication/authorization/session timing')
    if (expires-consent).total_seconds()>86400:raise ValueError('one-run permission cannot exceed 24 hours')
    if authorization.get('mode')!='paper' or authorization.get('action')!='run_once':raise ValueError('explicit paper run permission required')
    label(authorization['actor_id'],'actor_id');label(authorization['run_id'],'run_id')
    if authorization['signal_digest']!=digest(signal):raise ValueError('authorized signal content changed')
    if authorization['signal_id']!=sid or authorization['account_id']!=aid or authorization['account_revision']!=revision:
        raise ValueError('authorization scope mismatch')
    if sid in account['completed_signal_ids']:raise ValueError('signal already completed')
    max_spend=integer(authorization['max_buy_debit_cents'],'max_buy_debit_cents')
    targets={}
    for target in signal['targets']:
        s=label(target['symbol'],'symbol');budget=integer(target['target_budget_cents'],'target budget')
        if s in targets or target['action'] not in ('TARGET','EXIT') or (target['action']=='EXIT' and budget!=0):raise ValueError('invalid target')
        targets[s]=budget
    if not set(account['positions'])<=set(targets):raise ValueError('signal omitted an existing holding')
    if sum(b>0 for b in targets.values())>5:raise ValueError('too many targets')
    with localcontext() as ctx:
        ctx.prec=50
        valuation=mark_account(account,quotes,as_of=now);nav=valuation['equity_cents']
        # Recheck strategy exposure using CURRENT marks, not stale signal equity.
        if any(b>nav//10 for b in targets.values()) or sum(targets.values())>nav//2:
            raise ValueError('signal budgets exceed current exposure limits; regenerate')
        prices={};quantities={};evidence={}
        for s,budget in sorted(targets.items()):
            if quotes[s]['symbol']!=s:raise ValueError('quote identity mismatch')
            bid,ask=quote_at(quotes[s],at)
            c=costs[s];bps=number(c['slippage_bps'],'slippage_bps');fee=integer(c['fee_cents'],'fee_cents')
            if bps>=10000:raise ValueError('slippage must be below 100%')
            label(c['assumption_id'],'cost assumption_id')
            buy=ask*(1+bps/10000)*100;sell=bid*(1-bps/10000)*100
            prices[s]=(buy,sell,fee)
            quantities[s]=max(0,int(D(max(0,budget-fee))//buy)) if budget else 0
            evidence[s]={'quote':quotes[s],'cost':c}
        cash=account['cash_cents'];positions=dict(account['positions']);intents=[];buy_debit=0
        for side in ('sell','buy'):
            for s in sorted(targets):
                current=positions.get(s,0);target=quantities[s];qty=current-target if side=='sell' else target-current
                if qty<=0:continue
                buy,sell,fee=prices[s];q=quotes[s]
                available=q['bid_size' if side=='sell' else 'ask_size']
                if qty>available:raise ValueError('insufficient displayed size; defer entire run')
                cost=int((qty*(buy if side=='buy' else sell)).to_integral_value(rounding=ROUND_CEILING if side=='buy' else ROUND_FLOOR))
                debit=cost+fee if side=='buy' else -(cost-fee)
                if side=='sell' and cost<fee:raise ValueError('fees exceed sale proceeds')
                if side=='buy':
                    buy_debit+=debit
                    if buy_debit>max_spend or debit>cash:raise ValueError('buy authorization/cash limit exceeded')
                cash-=debit;positions[s]=current+(qty if side=='buy' else -qty)
                intents.append({'symbol':s,'side':side,'shares':qty,'cash_delta_cents':-debit,'fee_cents':fee,
                                'quote_id':q['quote_id'],'cost_assumption_id':costs[s]['assumption_id'],
                                'reference_price':q['ask' if side=='buy' else 'bid'],
                                'label':'SIMULATED_FILL_INTENT_NOT_EXECUTED'})
        # Guard against concentration/risk creep even after spread/fees reduce NAV.
        remaining={s:n for s,n in positions.items() if n}
        projected=mark_account(dict(account,cash_cents=cash,positions=remaining),quotes,as_of=now)
        if any(m['midpoint_value_cents']>projected['equity_cents']//10 for m in projected['marks'].values()) or sum(m['midpoint_value_cents'] for m in projected['marks'].values())>projected['equity_cents']//2:
            raise ValueError('projected risk caps exceeded; reduce budgets and reauthorize')
        envelope={'execution_version':EXECUTION_VERSION,'authorization':authorization,'signal':signal,
                  'account':account,'market':evidence,'at':at.isoformat(),'session':[session_open,session_close]}
        result={'plan_id':digest(envelope),'execution_version':EXECUTION_VERSION,'run_id':authorization['run_id'],
                'signal_id':sid,'account_id':aid,'expected_account_revision':revision,
                'status':'planned_not_executed','simulated_intents':intents,'buy_debit_cents':buy_debit,
                'before':valuation,'projected_after':projected,'projected_positions':remaining,
                'next_step':'Trusted server revalidates inputs and atomically records intents/receipts with revision lock; do not treat this plan as fills.'}
    return deepcopy(result)
