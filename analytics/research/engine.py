"""Multi-session PAPER portfolio engine for the research candidates (research only; places nothing).

Inputs are sessions, per-symbol daily bars aligned to them ({'o','c','v','ao','ac'}: raw open/close/volume,
split- and dividend-adjusted open/close; None when missing), normalized corporate actions, and decisions
({'signal_index', 'targets': {symbol: weight}}) made from information available at that session's close.

Rules (frozen in docs/STOCK_STRATEGY_RESEARCH_PREREG_2026_11_09.md):
- A decision made at session k's close executes at session k+1's open, never earlier.
- Equity for sizing = cash + holdings at session k's raw closes. Desired shares = floor(w * E / (close * 1.0025)).
- A continuing holding is resized only if the change exceeds BAND (20%) of its target value.
- Sells first, market-on-open at the raw open; a sell with no bar stays pending (unresolved) and retries.
- Buys are limit-on-open at round(close_k * 1.03, 2): filled at the raw open if it is at or below the
  limit, reduced to the whole shares cash can pay for; otherwise unfilled, and the slot stays cash.
- Costs: slippage per side on traded notional (buy at open*(1+c), sell at price*(1-c)). Cash earns 0%.
- Corporate actions on their effective session, before the open: cash dividends credited on the
  ex-date (shares held at the prior close); splits and stock dividends adjust share counts, fractions
  paid in cash at the session's raw open; cash mergers convert to cash; stock mergers, spin-offs and name
  changes carry into the new symbol when it has prices; anything else makes the position unresolved.
- Unresolved positions block every new buy until resolved; they are counted and listed.
- Halt (as-live series only): the peak starts at the starting equity; a close at or below 90% of the
  peak halts. Every holding is then sold at the next available open (gaps can make the realized loss
  larger than 10%), and nothing is bought again without an explicit owner authorization, which a
  replay never has. The continuous series runs the same rules without the halt.
"""
from __future__ import annotations
import math
from statistics import fmean

BAND = 0.20
LIMIT_GAP = 0.03
SIZING_SLIPPAGE = 0.0025
HALT_DRAWDOWN = 0.10
STALE_LIMIT = 5
INTEGRITY_TOLERANCE = 0.02
INTEGRITY_UNRESOLVED = 0.25


def _px(series, sym, field, k):
    s = series.get(sym)
    return None if s is None else s[field][k]


def simulate(sessions: list[str], series: dict, actions: list[dict], decisions: list[dict], *, start_index: int,
             end_index: int, capital: float, cost_bps: float, halt: bool = True, recovery: dict | None = None) -> dict:
    """`recovery` (research proposal V1, docs/STOCK_STRATEGY_NEXTGEN_PREREG_2026_11_10.md; requires halt=True):
    {'cooldown': completed sessions in cash after a halt's liquidation, 'regime': per-session bool (re-entry
    allowed at that signal close), 'scale': weight multiplier while partial, 'full_after': partial decisions
    before full weights}. Without it the behaviour is exactly the original halt-and-stay-in-cash rule."""
    cost = cost_bps / 1e4
    by_day: dict = {}
    for a in actions:
        by_day.setdefault(a['date'], []).append(a)
    dec_at = {d['signal_index'] + 1: d for d in decisions}
    cash = capital
    pos: dict[str, int] = {}
    last_close: dict[str, float] = {}
    stale: dict[str, int] = {}
    unresolved: dict[str, dict] = {}
    unresolved_log, trades, executions, integrity = [], [], [], []
    pending_sell: set = set()
    peak, halted, halted_on, liquidating, halt_equity_after = capital, False, None, False, None
    # recovery state machine (V1 only): normal -> cooldown -> waiting -> partial -> normal
    state, cooldown_left, partial_count = 'normal', None, 0
    halts, reentries, cash_sessions = [], [], 0
    open_exposure = []
    curve = [(sessions[start_index - 1], capital)]
    exposure, traded, costs, dividends = [], 0.0, 0.0, 0.0
    counts = dict(orders=0, filled=0, unfilled_gap=0, unfilled_missing=0, unfilled_cash=0, reduced_for_cash=0,
                  unavailable=0, blocked_by_unresolved=0, sells_pending=0, stale_marks=0, zero_share_targets=0)
    zero_share_log = []

    def mark_unresolved(sym, k, reason):
        if sym not in unresolved:
            rec = {'symbol': sym, 'date': sessions[k], 'reason': reason, 'resolved': None}
            unresolved[sym] = rec
            unresolved_log.append(rec)

    def resolve(sym, k):
        rec = unresolved.pop(sym, None)
        if rec:
            rec['resolved'] = sessions[k]

    def sell(sym, qty, k, price, why):
        nonlocal cash, traded, costs
        cash += qty * price * (1 - cost)
        traded += qty * price
        costs += qty * price * cost
        pos[sym] -= qty
        if pos[sym] == 0:
            del pos[sym]
        trades.append({'date': sessions[k], 'symbol': sym, 'side': 'sell', 'shares': qty, 'price': price, 'why': why})

    for k in range(start_index, end_index + 1):
        day = sessions[k]
        # 1. corporate actions before the open
        for a in by_day.get(day, []):
            sym = a.get('symbol')
            if sym not in pos:
                continue
            sh = pos[sym]
            kind = a['kind']
            if kind == 'cash_dividend':
                cash += sh * a['rate']
                dividends += sh * a['rate']
            elif kind in ('split', 'stock_dividend'):
                new = sh * a['ratio']
                whole = math.floor(new + 1e-9)
                ref = _px(series, sym, 'o', k) or ((_px(series, sym, 'c', k - 1) or last_close.get(sym, 0)) / a['ratio'])
                cash += (new - whole) * ref
                pos[sym] = whole
                if whole == 0:
                    del pos[sym]
                if sym in last_close:
                    last_close[sym] /= a['ratio']
            elif kind == 'cash_merger':
                cash += sh * a['rate']
                del pos[sym]
                resolve(sym, k)
            elif kind in ('stock_merger', 'spin_off', 'name_change'):
                new_sym, ratio = a['new_symbol'], a.get('ratio', 1.0)
                ref = _px(series, new_sym, 'o', k) or _px(series, new_sym, 'c', k)
                if ref is None:
                    mark_unresolved(sym, k, kind.upper() + '_TARGET_UNPRICED')
                    continue
                got = sh * ratio
                whole = math.floor(got + 1e-9)
                cash += (got - whole) * ref + sh * a.get('cash_rate', 0.0)
                if kind != 'spin_off':
                    del pos[sym]
                    resolve(sym, k)
                if whole:
                    pos[new_sym] = pos.get(new_sym, 0) + whole
            elif kind == 'worthless':
                del pos[sym]
                resolve(sym, k)
            else:
                mark_unresolved(sym, k, 'UNSUPPORTED_ACTION:' + kind)
        # 2. pending sells and halt liquidation at the open
        if liquidating:
            pending_sell |= set(pos)
        for sym in sorted(pending_sell):
            if sym not in pos:
                pending_sell.discard(sym)
                continue
            o = _px(series, sym, 'o', k)
            if o is None:
                counts['sells_pending'] += 1
                mark_unresolved(sym, k, 'NO_BAR_FOR_EXIT')
                continue
            sell(sym, pos[sym], k, o, 'halt' if liquidating else 'retry')
            pending_sell.discard(sym)
            resolve(sym, k)
        if liquidating and not pos:
            liquidating = False
        # 3. a decision from the previous close
        d = dec_at.get(k)
        if d is not None and recovery is not None and halted:
            if state == 'waiting' and recovery['regime'][k - 1]:
                state, partial_count, halted = 'partial', 1, False
                peak = cash + sum(n * (_px(series, s_, 'c', k - 1) or last_close.get(s_, 0)) for s_, n in pos.items())
                reentries.append({'date': day, 'equity': peak})
            else:
                d = None
        elif d is not None and recovery is not None and state == 'partial':
            if not recovery['regime'][k - 1]:
                state, halted, cooldown_left = 'waiting', True, None
                d = dict(d, targets={})          # to cash; waits for the regime again
                reentries.append({'date': day, 'equity': None, 'exit': 'regime'})
            else:
                partial_count += 1
                if partial_count > recovery['full_after']:
                    state = 'normal'
        if d is not None and recovery is not None and state == 'partial' and d['targets']:
            d = dict(d, targets={s_: w * recovery['scale'] for s_, w in d['targets'].items()})
        if d is not None and (not halted or (recovery is not None and state == 'waiting' and not d['targets'])):
            sig = k - 1
            equity = cash + sum(n * (_px(series, s, 'c', sig) or last_close.get(s, 0)) for s, n in pos.items())
            desired, prices, unavailable = {}, {}, []
            for sym, w in d['targets'].items():
                c = _px(series, sym, 'c', sig)
                if c is None or c <= 0:
                    unavailable.append(sym)
                    continue
                prices[sym] = c
                desired[sym] = math.floor(w * equity / (c * (1 + SIZING_SLIPPAGE)))
                if w > 0 and desired[sym] == 0 and pos.get(sym, 0) == 0:
                    # A target too small for one whole share: no order is placed, the slot stays cash.
                    counts['zero_share_targets'] += 1
                    zero_share_log.append({'date': day, 'symbol': sym, 'weight': w, 'price': c})
            counts['unavailable'] += len(unavailable)
            sells, buys = [], []
            for sym, n in list(pos.items()):
                tgt = desired.get(sym)
                if sym not in d['targets']:
                    sells.append((sym, n))
                elif tgt is not None and n > tgt and (n - tgt) * prices[sym] > BAND * d['targets'][sym] * equity:
                    sells.append((sym, n - tgt))
            for sym in d['targets']:
                if sym not in desired:
                    continue
                cur = pos.get(sym, 0)
                want = desired[sym] - cur
                if want > 0 and (cur == 0 or want * prices[sym] > BAND * d['targets'][sym] * equity):
                    buys.append((sym, want))
            for sym, qty in sells:
                o = _px(series, sym, 'o', k)
                if o is None:
                    pending_sell.add(sym)
                    mark_unresolved(sym, k, 'NO_BAR_FOR_EXIT')
                    counts['sells_pending'] += 1
                    continue
                sell(sym, qty, k, o, 'rebalance')
            filled, unfilled = [], []
            if buys and unresolved:
                counts['blocked_by_unresolved'] += 1
                unfilled = [s for s, _ in buys]
                buys = []
            for sym, qty in buys:
                counts['orders'] += 1
                limit = round(prices[sym] * (1 + LIMIT_GAP), 2)
                o = _px(series, sym, 'o', k)
                if o is None:
                    counts['unfilled_missing'] += 1
                    unfilled.append(sym)
                    continue
                if o > limit:
                    counts['unfilled_gap'] += 1
                    unfilled.append(sym)
                    continue
                afford = math.floor(cash / (o * (1 + cost)))
                if afford <= 0:
                    counts['unfilled_cash'] += 1
                    unfilled.append(sym)
                    continue
                if afford < qty:
                    counts['reduced_for_cash'] += 1
                    qty = afford
                cash -= qty * o * (1 + cost)
                traded += qty * o
                costs += qty * o * cost
                pos[sym] = pos.get(sym, 0) + qty
                counts['filled'] += 1
                filled.append(sym)
                trades.append({'date': day, 'symbol': sym, 'side': 'buy', 'shares': qty, 'price': o, 'why': 'rebalance'})
            executions.append({'date': day, 'label': d.get('label'), 'targets': d['targets'], 'filled': filled,
                               'unfilled': unfilled, 'unavailable': unavailable})
        # exposure right after the opening trades, priced at the open (known before the open-to-close return)
        inv_o = sum(n * (_px(series, s_, 'o', k) or last_close.get(s_, 0.0)) for s_, n in pos.items())
        open_exposure.append(inv_o / (cash + inv_o) if cash + inv_o > 0 else 0.0)
        # 4. close: mark to market, integrity checks, halt
        invested = 0.0
        for sym, n in pos.items():
            c = _px(series, sym, 'c', k)
            if c is None:
                counts['stale_marks'] += 1
                stale[sym] = stale.get(sym, 0) + 1
                if stale[sym] > STALE_LIMIT:
                    mark_unresolved(sym, k, 'NO_BARS')
                c = last_close.get(sym, 0.0)
            else:
                stale[sym] = 0
                prev, ac, ac0 = _px(series, sym, 'c', k - 1), _px(series, sym, 'ac', k), _px(series, sym, 'ac', k - 1)
                acted = any(a.get('symbol') == sym for a in by_day.get(day, []))
                if prev and ac and ac0 and sym in last_close and not acted:
                    implied, adjusted = c / prev, ac / ac0
                    gap = abs(implied / adjusted - 1)
                    if gap > INTEGRITY_TOLERANCE:
                        integrity.append({'date': day, 'symbol': sym, 'raw': implied, 'adjusted': adjusted})
                        if gap > INTEGRITY_UNRESOLVED:
                            mark_unresolved(sym, k, 'UNEXPLAINED_PRICE_ADJUSTMENT')
                if sym in unresolved and unresolved[sym]['reason'] == 'NO_BARS':
                    resolve(sym, k)
                last_close[sym] = c
            invested += n * c
        equity = cash + invested
        curve.append((day, equity))
        exposure.append(invested / equity if equity > 0 else 0.0)
        if halt and not halted:
            peak = max(peak, equity)
            if equity <= (1 - HALT_DRAWDOWN) * peak:
                halted, liquidating = True, bool(pos)
                halted_on = halted_on or day
                halts.append({'date': day, 'peak': peak, 'exit_equity': None})
                state, cooldown_left = 'cooldown', None
        elif halted and halt_equity_after is None and not liquidating:
            halt_equity_after = equity
        if halts and halts[-1]['exit_equity'] is None and halted and not liquidating and state == 'cooldown':
            halts[-1]['exit_equity'] = equity
        if recovery is not None and halted and not liquidating:
            if state == 'cooldown':
                cooldown_left = recovery['cooldown'] if cooldown_left is None else cooldown_left - 1
                if cooldown_left <= 0:
                    state = 'waiting'
        if invested == 0:
            cash_sessions += 1
    years = (len(curve) - 1) / 252
    avg_equity = fmean(v for _, v in curve) if curve else capital
    return {'curve': curve, 'trades': trades, 'executions': executions, 'unresolved': unresolved_log,
            'open_unresolved_at_end': sum(1 for u in unresolved_log if u['resolved'] is None),
            'integrity_mismatches': integrity, 'costs': costs, 'dividends': dividends, 'traded': traded,
            'turnover_per_year': traded / avg_equity / years if years and avg_equity else 0.0,
            'avg_exposure': fmean(exposure) if exposure else 0.0, 'exposure': exposure,
            'cash_end': cash, 'halted_on': halted_on, 'halt_peak': peak if halted else None,
            'equity_after_halt_exit': halt_equity_after, 'halts': halts, 'reentries': reentries,
            'cash_sessions': cash_sessions, 'open_exposure': open_exposure, 'zero_share_log': zero_share_log, **counts}
