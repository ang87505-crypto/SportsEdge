"""SportsEdge frozen monthly equity selector: provider-neutral, research only.

Uses strict, independently-normalized PIT source inputs. A LEAN/QuantConnect
adapter must verify the source mapping, membership, event economics and
historical timestamps. This module performs NO data acquisition, fills,
orders, NAV accounting, or risk/performance measurement.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, localcontext
from zoneinfo import ZoneInfo

BASELINE = "stock-mom252-skip21-trend200-v1"
CANDIDATE = "stock-mom252-skip21-trend200-holdrank10-v1"
NY = ZoneInfo("America/New_York")
D = Decimal


class SourceNotReady(ValueError):
    """A single missing/ambiguous record invalidates the entire decision."""


def _check(ok, reason):
    if not ok:
        raise SourceNotReady(reason)


def _dec(x, name, *, positive=False):
    _check(isinstance(x, str), name + " must be exact decimal text")
    try:
        val = D(x)
    except Exception as exc:
        raise SourceNotReady(name + " invalid") from exc
    _check(val.is_finite() and val >= 0 and (not positive or val > 0), name + " negative/nonfinite")
    return val


def _timestamp(x, name):
    _check(isinstance(x, str) and "T" in x, name + " must be ISO timestamp")
    try:
        v = datetime.fromisoformat(x.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SourceNotReady(name + " invalid") from exc
    _check(v.tzinfo is not None and v.utcoffset() is not None, name + " must contain timezone")
    return v


def _date(x, name):
    _check(isinstance(x, str), name + " must be a date string")
    try:
        val = date.fromisoformat(x)
    except ValueError as exc:
        raise SourceNotReady(name + " invalid") from exc
    _check(val.isoformat() == x, name + " must be YYYY-MM-DD")
    return val


def _label(value, name):
    _check(isinstance(value, str) and bool(value.strip()) and value == value.strip(), name + " required")
    return value


def total_return(closes, split_factors, dividends):
    """Exactly matches analytics.stock_momentum_v1.total_return_index.

    split_t is new shares per one old share effective on t; dividend_t is
    cash per *old* share on t. Source must not supply already-adjusted prices.
    """
    _check(len(closes) >= 2 and len(split_factors) == len(closes)-1
           and len(dividends) == len(closes)-1, "Unaligned total-return evidence")
    for p in closes:
        _check(isinstance(p, D) and p.is_finite() and p > 0, "Invalid raw close")
    for s in split_factors:
        _check(isinstance(s, D) and s.is_finite() and s > 0, "Invalid split factor")
    for dv in dividends:
        _check(isinstance(dv, D) and dv.is_finite() and dv >= 0, "Invalid dividend")
    with localcontext() as ctx:
        ctx.prec = 50
        index = [D(1)]
        for i in range(1, len(closes)):
            index.append(index[-1] * (split_factors[i-1]*closes[i]+dividends[i-1])/closes[i-1])
        return index


def _rank(scores):
    return sorted((s for s in scores if s["eligible"] and s["trend_positive"]
                   and D(s["momentum"]) > 0),
                  key=lambda s: (-D(s["momentum"]), s["symbol"]))


def choose(scores, incumbent_ids, strategy_version):
    """Frozen top-five, two-per-sector, rank-ten retention selection only."""
    _check(strategy_version in (BASELINE, CANDIDATE), "Unregistered strategy version")
    _check(isinstance(incumbent_ids, (list, tuple, set)), "Incumbents required")
    incumbent = set(incumbent_ids)
    _check(len(incumbent) == len(incumbent_ids), "Repeated incumbent ID")
    known = {s["security_id"] for s in scores}
    _check(incumbent <= known, "Unknown/delisted position requires separate lifecycle accounting")
    ranked = _rank(scores)
    retained = ([s for s in ranked[:10] if s["security_id"] in incumbent]
                if strategy_version == CANDIDATE else [])
    selected = []
    sector_counts = {}
    selected_ids = set()
    for s in retained + ranked:
        sid = s["security_id"]
        if sid in selected_ids or sector_counts.get(s["sector"], 0) >= 2:
            continue
        selected.append(s)
        selected_ids.add(sid)
        sector_counts[s["sector"]] = sector_counts.get(s["sector"], 0) + 1
        if len(selected) == 5:
            break
    return selected


def evaluate_month(*, universe, sessions, next_session, decision_at,
                   incumbent_ids=(), equity_cents=100000, strategy_version=BASELINE,
                   source_complete=False):
    """Fail-closed *signal* computation for a full dated US stock universe.

    sessions: last 253 completed exchange sessions, each {date, close_at}.
    next_session: {date, open_at}; decision exactly 08:00 NY on that date.
    universe: one per full PIT security, with keys security_id, symbol,
      exchange, type, sector, first_traded_on, first_trade_available_at,
      bars=[{date,close,volume,split_ratio,cash_dividend_per_old_share,
             completed_at,available_at}] for all required post-IPO sessions.
    The normalized split_ratio and cash_dividend_per_old_share are EX-DATE
    actions for each session, with 1/0 on ordinary days, even if no action.

    This validates *declarations* of complete source coverage, not provenance.
    Do NOT pass invented membership, dates, event timestamps or prices. For
    unsupported terminations, refuse rather than omit a losing security.
    """
    _check(source_complete is True, "Complete PIT source data has not been independently declared")
    _check(type(equity_cents) is int and 0 < equity_cents <= 10**12, "Positive integer cents required")
    at = _timestamp(decision_at, "decision_at").astimezone(NY)
    _check((at.hour, at.minute, at.second, at.microsecond) == (8, 0, 0, 0), "Decision not at 08:00 New York")
    _check(isinstance(sessions, list) and len(sessions) == 253, "Exactly 253 completed sessions required")
    days = [_date(s["date"], "session date") for s in sessions]
    _check(days == sorted(set(days)) and all(day.weekday() < 5 for day in days), "Calendar duplicate/out of order")
    closes = [_timestamp(s["close_at"], "calendar close") for s in sessions]
    _check(all(t.astimezone(NY).date() == d and t < at for d, t in zip(days, closes)), "Calendar last close is not prior to decision")
    next_date = _date(next_session["date"], "next date")
    next_open = _timestamp(next_session["open_at"], "next open")
    _check(next_date == at.date() and next_date > days[-1]
           and next_date.strftime("%Y-%m") != days[-1].strftime("%Y-%m")
           and at < next_open.astimezone(NY), "Next monthly session and decision mismatch")
    _check(isinstance(universe, list) and len(universe) > 0, "Full PIT universe required")
    ids = set(); symbols = set(); scores = []; short_history = []
    with localcontext() as ctx:
        ctx.prec = 50
        for member in universe:
            sid = _label(member["security_id"], "Permanent ID")
            sym = _label(member["symbol"], "Symbol")
            sector = _label(member["sector"], "Historical sector")
            _check(sid not in ids and sym not in symbols, "Duplicate identity or ticker")
            ids.add(sid); symbols.add(sym)
            _check(member["type"] == "common_stock" and member["exchange"] in ("NYSE", "NASDAQ", "AMEX"),
                   "Unmapped exchange/security category")
            first = _date(member["first_traded_on"], "first public trading date")
            _check(_timestamp(member["first_trade_available_at"], "listing available") < at,
                   "Listing evidence future-dated")
            _check(first <= days[-1], "Future-listed universe member")
            expected = [d for d in days if d >= first]
            _check(expected, "No post-listing sessions")
            bars = member["bars"]
            _check(isinstance(bars, list) and len(bars) == len(expected),
                   "Missing or extra post-listing observations for " + sid)
            close_values = []; volumes=[]; ratios=[]; divs=[]
            for i, (day, bar) in enumerate(zip(expected, bars)):
                _check(_date(bar["date"], "bar date") == day, "Missing/out-of-order session for " + sid)
                completed = _timestamp(bar["completed_at"], "bar completion")
                available = _timestamp(bar["available_at"], "bar available")
                session_idx = days.index(day)
                _check(completed >= closes[session_idx] and completed <= available and available < at,
                       "Premature/stale/late bar for " + sid)
                close_values.append(_dec(bar["close"], "raw close", positive=True))
                volume = bar["volume"]
                _check(type(volume) is int and 0 <= volume <= 10**15, "Invalid raw consolidated volume")
                volumes.append(volume)
                ratios.append(_dec(bar["split_ratio"], "split ratio", positive=True))
                divs.append(_dec(bar["cash_dividend_per_old_share"], "dividend"))
            if len(expected) < 253:
                short_history.append(sid)
                continue
            tri = total_return(close_values, ratios[1:], divs[1:])
            momentum = tri[-22] / tri[-253] - D(1)
            trend = tri[-1] > sum(tri[-200:]) / D(200)
            liquidity = sum((close_values[i] * D(volumes[i]) for i in range(-20, 0)), D(0)) / D(20)
            score = dict(symbol=sym, security_id=sid, sector=sector, momentum=str(momentum),
                         trend_positive=trend, eligible=close_values[-1] >= D(5) and liquidity >= D(20_000_000),
                         mean_dollar_volume_20=str(liquidity), last_raw_close=str(close_values[-1]))
            scores.append(score)
        selected = choose(scores, incumbent_ids, strategy_version)
        chosen = {s["security_id"] for s in selected}
        budget = equity_cents // 10
        targets = [{"security_id": sid,
                    "action": "TARGET" if sid in chosen else "EXIT",
                    "target_budget_cents": budget if sid in chosen else 0}
                   for sid in sorted(chosen | set(incumbent_ids))]
        return dict(strategy_version=strategy_version, decision_at=at.isoformat(),
                    cash_target_cents=equity_cents-len(selected)*budget,
                    scores=sorted(scores, key=lambda s: s["symbol"]), targets=targets,
                    known_short_history=sorted(short_history), declared_members=len(universe),
                    status="RESEARCH_TARGETS_ONLY_NOT_EXECUTABLE", performance=None,
                    source_independently_verified=False, historical_study_ready=False)
