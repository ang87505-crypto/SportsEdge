"""Price and corporate-action inputs for research evaluations, from Alpaca market data (read-only, the
existing paper key pair held as GitHub secrets). Bars are SIP daily, raw and split/dividend adjusted.
A member whose ticker changed is joined across the change; a symbol with no bars as of the end date is
fetched again as of the date it was needed (delisted names), never filled in."""
from __future__ import annotations
import copy
import hashlib
import json

from analytics.stock_weekly_backtest_v1 import align

ACTION_DATES = ('ex_date', 'effective_date', 'process_date')


def fetch_bars(source, symbols: list[str], start: str, end: str, asof: str) -> dict:
    from analytics.stock_forward_bridge_v1 import DATA
    bars: dict = {}
    for adjustment, keys in (('raw', ('o', 'c', 'v')), ('all', ('ao', 'ac'))):
        for i in range(0, len(symbols), 40):
            group = symbols[i:i + 40]
            for page in source.paged(DATA, '/v2/stocks/bars', {'symbols': ','.join(group), 'timeframe': '1Day', 'start': start,
                                                               'end': end, 'adjustment': adjustment, 'feed': 'sip',
                                                               'asof': asof, 'limit': 10000}):
                for sym, rows in (page.get('bars') or {}).items():
                    b = bars.setdefault(sym, {})
                    for r in rows:
                        row = b.setdefault(r['t'][:10], {})
                        if adjustment == 'raw':
                            row.update(o=float(r['o']), c=float(r['c']), v=float(r['v']))
                        else:
                            row.update(ao=float(r['o']), ac=float(r['c']))
    out = {}
    for sym, rows in bars.items():
        days = sorted(d for d, r in rows.items() if len(r) == 5)
        out[sym] = {'d': days, **{k: [rows[d][k] for d in days] for k in ('o', 'c', 'v', 'ao', 'ac')}}
    return out


def fetch_calendar(source, start: str, end: str) -> list[str]:
    from analytics.stock_forward_bridge_v1 import PAPER
    return sorted(r['date'] for r in source.fetch(PAPER, '/v2/calendar', {'start': start, 'end': end}))


def fetch_actions(source, symbols: list[str], start: str, end: str) -> list:
    from analytics.stock_forward_bridge_v1 import DATA
    pages = []
    for i in range(0, len(symbols), 40):
        pages += source.paged(DATA, '/v1/corporate-actions', {'symbols': ','.join(symbols[i:i + 40]), 'start': start,
                                                              'end': end, 'limit': 1000})
    return pages


def _f(x, default=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def normalize_actions(pages: list) -> list[dict]:
    """Alpaca corporate-action groups -> engine actions. Unknown groups keep their name (unsupported)."""
    out, seen = [], set()
    for page in pages:
        for group, rows in ((page or {}).get('corporate_actions') or {}).items():
            for r in rows or []:
                day = next((r[k] for k in ACTION_DATES if r.get(k)), None)
                if not day:
                    continue
                a = None
                if group == 'cash_dividends':
                    a = {'kind': 'cash_dividend', 'symbol': r.get('symbol'), 'rate': _f(r.get('rate'), 0.0)}
                elif group in ('forward_splits', 'reverse_splits'):
                    a = {'kind': 'split', 'symbol': r.get('symbol'), 'ratio': _f(r.get('new_rate'), 1) / _f(r.get('old_rate'), 1)}
                elif group == 'stock_dividends':
                    a = {'kind': 'stock_dividend', 'symbol': r.get('symbol'), 'ratio': 1 + _f(r.get('rate'), 0.0)}
                elif group in ('cash_mergers', 'redemptions'):
                    a = {'kind': 'cash_merger', 'symbol': r.get('acquiree_symbol') or r.get('symbol'), 'rate': _f(r.get('rate'), 0.0)}
                elif group in ('stock_mergers', 'stock_and_cash_mergers'):
                    a = {'kind': 'stock_merger', 'symbol': r.get('acquiree_symbol'), 'new_symbol': r.get('acquirer_symbol'),
                         'ratio': _f(r.get('acquirer_rate'), 1) / _f(r.get('acquiree_rate'), 1), 'cash_rate': _f(r.get('rate'), 0.0)}
                elif group == 'spin_offs':
                    a = {'kind': 'spin_off', 'symbol': r.get('source_symbol'), 'new_symbol': r.get('new_symbol'),
                         'ratio': _f(r.get('new_rate'), 0) / _f(r.get('source_rate'), 1)}
                elif group == 'name_changes':
                    a = {'kind': 'name_change', 'symbol': r.get('old_symbol'), 'new_symbol': r.get('new_symbol'), 'ratio': 1.0}
                elif group == 'worthless_removals':
                    a = {'kind': 'worthless', 'symbol': r.get('symbol')}
                else:
                    a = {'kind': group.rstrip('s'), 'symbol': r.get('symbol') or r.get('target_symbol') or r.get('acquiree_symbol')}
                if not a.get('symbol'):
                    continue
                a['date'] = day
                a['source'] = 'alpaca-ca:' + group + ':' + str(r.get('id', ''))
                key = json.dumps(a, sort_keys=True)
                if key not in seen:
                    seen.add(key)
                    out.append(a)
    return sorted(out, key=lambda a: (a['date'], a['symbol'], a['kind']))


def join_renamed(bars: dict, actions: list[dict], symbols: set) -> tuple[dict, list[dict], list[dict]]:
    """Join old-symbol bars with new-symbol bars from the change date, rescaling the old adjusted prices so the
    adjusted return across the join equals the raw return. Joined name changes are removed from `actions`."""
    bars = copy.deepcopy(bars)
    joins, kept = [], []
    for a in actions:
        if a['kind'] == 'name_change' and a['symbol'] in symbols and a.get('new_symbol') in bars:
            old = bars.get(a['symbol']) or {'d': [], 'o': [], 'c': [], 'v': [], 'ao': [], 'ac': []}
            new, cut = bars[a['new_symbol']], a['date']
            keep = [i for i, d in enumerate(old['d']) if d < cut]
            take = [i for i, d in enumerate(new['d']) if d >= cut]
            scale = 1.0
            if keep and take:
                j, f = keep[-1], take[0]
                scale = (new['ac'][f] * old['c'][j]) / (new['c'][f] * old['ac'][j])
            joined = {'d': [old['d'][i] for i in keep] + [new['d'][i] for i in take]}
            for k in ('o', 'c', 'v'):
                joined[k] = [old[k][i] for i in keep] + [new[k][i] for i in take]
            for k in ('ao', 'ac'):
                joined[k] = [old[k][i] * scale for i in keep] + [new[k][i] for i in take]
            bars[a['symbol']] = joined
            joins.append({'old': a['symbol'], 'new': a['new_symbol'], 'date': cut, 'adjusted_rescale': scale})
            continue
        kept.append(a)
    return bars, kept, joins


def fingerprint(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def assemble(sessions: list[str], bars: dict) -> tuple[list[str], dict]:
    """Session-aligned series {'o','c','v','ao','ac'} (None where a bar is missing)."""
    return align({'sessions': sessions, 'bars': bars})


FOOTPRINT_KINDS = ('cash_dividend', 'split', 'stock_dividend')


def validate_actions(bars: dict, actions: list[dict]) -> tuple[list[dict], list[dict]]:
    """Keep only actions consistent with the price history of the entity actually requested.

    Alpaca keys corporate actions by ticker, and tickers are reused (in January 2022 the Roundhill
    Metaverse ETF renamed META -> METV so Meta Platforms could take META). The adjusted bars fetched
    `asof` the window end belong to one entity, so its back-adjustment factor (adjusted / raw) shows
    exactly which dividends and splits it had. Rules:
      - a name change to the same symbol, or whose old symbol keeps trading at/after the date, is dropped;
      - a cash merger whose symbol keeps trading more than 5 sessions after the date is dropped;
      - dividends and splits on a session are checked together against the factor change that session:
        expected factor ratio = prod(1 / split ratio) * (1 - sum(dividends) / previous raw close);
        a mismatch beyond 30% of the dividend yield (+0.002% rounding) or 3% for splits drops the group;
      - an action on a day the symbol has no bar cannot be checked: kept and marked unvalidated.
    """
    kept, dropped = [], []
    groups: dict = {}
    for a in actions:
        if a['kind'] in FOOTPRINT_KINDS:
            groups.setdefault((a['symbol'], a['date']), []).append(a)
            continue
        b = bars.get(a['symbol'])
        after = [d for d in b['d'] if d >= a['date']] if b else []
        if a['kind'] == 'name_change':
            if a.get('new_symbol') == a['symbol']:
                dropped.append(dict(a, why='SAME_SYMBOL'))
            elif len(after) > 1:
                dropped.append(dict(a, why='OLD_SYMBOL_STILL_TRADES'))
            else:
                kept.append(a)
        elif a['kind'] == 'cash_merger' and len([d for d in after if d > a['date']]) > 5:
            dropped.append(dict(a, why='OLD_SYMBOL_STILL_TRADES'))
        else:
            kept.append(a)
    for (sym, day), acts in groups.items():
        b = bars.get(sym)
        i = b['d'].index(day) if b and day in b['d'] else -1
        if i <= 0 or not b['c'][i - 1] or not b['c'][i] or not b['ac'][i]:
            kept += [dict(a, unvalidated=True) for a in acts]
            continue
        prev_c = b['c'][i - 1]
        actual = (b['ac'][i - 1] / b['c'][i - 1]) / (b['ac'][i] / b['c'][i])
        div = sum(a['rate'] for a in acts if a['kind'] == 'cash_dividend')
        ratio = 1.0
        for a in acts:
            if a['kind'] in ('split', 'stock_dividend'):
                ratio *= a['ratio']
        expected = (1 - div / prev_c) / ratio
        tol = 0.03 if ratio != 1.0 else 0.3 * div / prev_c + 0.00002  # yield-proportional; tiny rounding allowance
        if abs(actual / expected - 1) <= tol:
            kept += acts
        else:
            dropped += [dict(a, why='NO_ADJUSTMENT_FOOTPRINT', factor_ratio=round(actual, 6), expected=round(expected, 6)) for a in acts]
    return sorted(kept, key=lambda a: (a['date'], a['symbol'], a['kind'])), dropped
