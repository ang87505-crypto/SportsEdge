"""Monthly, long-only prior-data momentum targets. Pure research, never orders.

Depends on PR #16's raw daily-bar contract. Call generate with parsed provider
payload plus externally verified exchange calendar, point-in-time universe and
complete corporate-action coverage. Declarations are NOT authenticated here.
"""
from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal, ROUND_CEILING, localcontext
import hashlib
import json
from zoneinfo import ZoneInfo
try:
    from .stock_data_contract import parse_daily_bars, visible_at, _stamp
except ImportError:
    from stock_data_contract import parse_daily_bars, visible_at, _stamp

VERSION = 'stock-mom252-skip21-trend200-v1'
D = Decimal
NY = ZoneInfo('America/New_York')


def number(value, name, *, positive=False):
    if not isinstance(value,str):raise ValueError(name+': decimal text required')
    try:x=D(value)
    except Exception as e:raise ValueError(name+': invalid decimal') from e
    if not x.is_finite() or x < 0 or (positive and x == 0):raise ValueError(name+': invalid amount')
    return x


def integer(x,name,minimum=0):
    if type(x) is not int or x < minimum:raise ValueError(name+': invalid integer')
    return x


def label(x,name):
    if not isinstance(x,str) or not x.strip() or x!=x.strip():raise ValueError(name+': nonempty text required')
    return x


def digest(x):
    return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def sized_shares(budget_cents, price_text, *, slippage_bps, fee_cents):
    """Conservative whole-share BUY size at supplied reference price, not a fill.

    Explicit security-specific cost assumption is mandatory. Round total
    notional+slippage upward to cents. Caller must recheck cash, exposure,
    quote freshness and liquidity at execution. This is not PR #15 accounting.
    """
    integer(budget_cents,'budget_cents'); integer(fee_cents,'fee_cents')
    price=number(price_text,'price',positive=True); bps=number(slippage_bps,'slippage_bps')
    if bps>10000:raise ValueError('slippage exceeds 100%')
    with localcontext() as ctx:
        ctx.prec=50
        unit=price*100*(1+bps/10000)
        n=max(0,int(D(max(0,budget_cents-fee_cents))//unit))
        cost=int((n*unit).to_integral_value(rounding=ROUND_CEILING))+fee_cents if n else 0
        if cost>budget_cents:raise ArithmeticError('sizing exceeds budget')
    return {'shares':n,'estimated_debit_cents':cost,'unspent_cents':budget_cents-cost}


def total_return_index(closes, splits, dividends):
    """Cash dividends per ONE prior-session share; split = new/old shares.

    Wealth_t / Wealth_(t-1) = (split_t * raw_close_t + cash_per_old_share_t)
                               / raw_close_(t-1).
    Dividends reinvested at ex-date close solely for signal construction.
    First observation anchors 1; supplied actions start at second observation.
    """
    if len(closes)<2 or len(splits)!=len(closes)-1 or len(dividends)!=len(splits):raise ValueError('unaligned action series')
    if any(not isinstance(x,D) or not x.is_finite() or x<=0 for x in closes+splits):raise ValueError('invalid prices/splits')
    if any(not isinstance(x,D) or not x.is_finite() or x<0 for x in dividends):raise ValueError('invalid dividends')
    with localcontext() as ctx:
        ctx.prec=50; wealth=[D(1)]
        for prev,cur,split,div in zip(closes,closes[1:],splits,dividends):
            wealth.append(wealth[-1]*(split*cur+div)/prev)
    return wealth


def generate(payload, context, *, decision_at, equity_cents=100000, held_symbols=()):
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
    if dates[last].strftime('%Y-%m')==dates[nxt].strftime('%Y-%m'):raise ValueError('monthly rebalance only')
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
    inputs={'version':VERSION,'decision_at':at.isoformat(),'equity_cents':equity_cents,
            'held_symbols':sorted(held),'bars':evidence,'universe':sorted(universe,key=lambda u:u['symbol']),
            'actions':sorted(action_evidence,key=lambda a:(a['symbol'],a['session_date'])),
            'calendar':calendar_window,'provider':data.provider,
            'provenance':{k:context[k] for k in ('calendar_revision','universe_revision','actions_revision','calendar_available_at','universe_available_at','actions_available_at','actions_coverage_start','actions_coverage_end')}}
    signal_id=digest(inputs)
    return {'strategy_version':VERSION,'signal_id':signal_id,'input_digest':signal_id,
            'decision_at':at.isoformat(),'earliest_execution_at':opens[nxt].isoformat(),
            'source_revision':data.source_revision,'targets':targets,'scores':scores,
            'cash_target_cents':equity_cents-budget*len(chosen),'max_gross_target_bps':5000,
            'status':'research_targets_only','source_independently_verified':False,
            'performance_measured':False,'fills':[]}


def main():
    import argparse
    from pathlib import Path
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',required=True,type=Path,help='JSON with payload, context, decision_at, optional equity_cents/held_symbols')
    p.add_argument('--output',required=True,type=Path)
    a=p.parse_args(); args=json.loads(a.input.read_text()); result=generate(**args)
    with a.output.open('x') as f:json.dump(result,f,indent=2,allow_nan=False);f.write('\n')

if __name__=='__main__':main()
