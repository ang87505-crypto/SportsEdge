"""Forward-only virtual ledger for mq-buffer-v1 (owner-approved preparation, 2026-11-10; not scheduled).

Two separate, append-only record kinds in their own ledger directory (the `research-forward-ledger` branch in CI):

- **Predictions** (`predictions/<signal>.json`): written once, after a month-end session's close and **before the
  next session opens**. Each holds, for mq-buffer-v1 and the unchanged baseline momentum-quality-paper-v1:
  - the decision and target portfolio;
  - a fingerprint of the exact input data;
  - the prediction time and the deadline.

  Each file is hash-chained in `chain.jsonl`. A prediction is never rewritten, never back-filled, and never rebuilt
  from later data:
  - a month-end with no record before its next open is **MISSED** for good;
  - a record that fails its chain or time checks is **INVALID**.
- **Outcomes** (`outcomes/<run>.json`): every later evaluation. Each:
  - reads the frozen predictions and today's market data;
  - flags any change in the inputs a prediction was made from (INPUT_DATA_REVISED), without touching the
    prediction;
  - reports buffer (continuous), buffer with the 10% halt, baseline and SPY side by side, at $30,000 and $1,000.

Research only: read-only market data, no orders, no activation. Pure functions here; I/O is injected.
"""
from __future__ import annotations
from bisect import bisect_left
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path

from . import candidates as cand
from . import engine
from . import evaluate as ev
from . import nextgen as ng
from .ledger_receipts import RECEIPT_MARGIN

LEDGER = 'mq-buffer-forward-v1'
BUFFER, BASELINE = 'mq-buffer-v1', 'momentum-quality-paper-v1'
FIRST_SIGNAL = '2026-11-30'
LOOKBACK_SESSIONS = 260            # fingerprinted inputs: the 252-session momentum window plus margin
DATA_DELAY = timedelta(minutes=20)  # free SIP data: requests must end at least 15 minutes in the past
CLOSE_SETTLE = timedelta(minutes=10)  # the requested data must reach 10 minutes past the close (closing auction printed)
READY_SHARE = 0.98                 # of members that traded the session before, the share that must have a signal bar
SMALL_CAPITAL = 1_000.0
APPROVAL = 'Owner approval 2026-11-10 (forward-only virtual tracking; no orders, no activation)'


class LedgerError(RuntimeError):
    pass


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), default=str).encode()


def sha(obj) -> str:
    return hashlib.sha256(canonical(obj)).hexdigest()


def utc(s: str) -> datetime:
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def stamp(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# ---------------------------------------------------------------- calendar

def is_month_end(calendar: list[str], day: str) -> bool:
    """`calendar`: sorted exchange session dates reaching past `day`. True when `day` is a session and the next
    session falls in a later month (holidays and weekends at month end are handled by the calendar)."""
    i = bisect_left(calendar, day)
    if i >= len(calendar) or calendar[i] != day:
        return False
    if i + 1 >= len(calendar):
        raise LedgerError('CALENDAR_TOO_SHORT')
    return calendar[i + 1][:7] != day[:7]


def month_end_sessions(calendar: list[str], lo: str, hi: str) -> list[str]:
    return [d for d in calendar if lo <= d <= hi and is_month_end(calendar, d)]


def next_session(calendar: list[str], day: str) -> str:
    i = bisect_left(calendar, day)
    if i + 1 >= len(calendar) or calendar[i] != day:
        raise LedgerError('CALENDAR_TOO_SHORT')
    return calendar[i + 1]


def next_open_utc(calendar: list[str], day: str) -> str:
    return cand.open_utc(next_session(calendar, day))


# ---------------------------------------------------------------- inputs

def input_fingerprint(sessions: list[str], series: dict, symbols, k: int, lookback: int = LOOKBACK_SESSIONS) -> str:
    """Raw bars exactly, adjusted closes as daily returns (8 dp). A new dividend after the signal rescales an
    adjusted history uniformly, which leaves the returns, and so the fingerprint, unchanged. A changed raw bar or
    adjusted return does change it."""
    lo = max(0, k - lookback + 1)
    out = {'sessions': sessions[lo:k + 1], 'bars': {}}
    for sym in sorted(symbols):
        s = series.get(sym)
        if s is None:
            out['bars'][sym] = None
            continue
        ac = s['ac'][lo:k + 1]
        rets = [None if a is None or b is None or not a else round(b / a - 1, 8) for a, b in zip(ac, ac[1:])]
        out['bars'][sym] = {'o': s['o'][lo:k + 1], 'c': s['c'][lo:k + 1], 'v': s['v'][lo:k + 1], 'adj_returns': rets}
    return sha(out)


def data_ready(series: dict, symbols, k: int) -> tuple[bool, list[str]]:
    """The signal session's bars are complete enough: SPY present, and >= 98% of members that traded the session
    before also have a bar for this one."""
    if series.get('SPY') is None or series['SPY']['c'][k] is None:
        return False, ['SPY']
    traded = [s for s in symbols if s in series and series[s]['c'][k - 1] is not None]
    missing = sorted(s for s in traded if series[s]['c'][k] is None)
    return (len(traded) > 0 and (len(traded) - len(missing)) / len(traded) >= READY_SHARE), missing


# ---------------------------------------------------------------- the ledger on disk

class Ledger:
    """Append-only directory. Files are created exclusively; jsonl logs are only appended to."""

    def __init__(self, root: Path):
        self.root = Path(root)
        for d in ('predictions', 'missed', 'outcomes', 'receipts'):
            (self.root / d).mkdir(parents=True, exist_ok=True)

    def _append(self, name, row):
        with open(self.root / name, 'a', encoding='utf-8') as fh:
            fh.write(json.dumps(row, sort_keys=True, default=str) + '\n')

    def event(self, row):
        self._append('events.jsonl', row)

    def _create(self, rel, obj):
        p = self.root / rel
        with open(p, 'x', encoding='utf-8') as fh:     # never overwrites
            fh.write(json.dumps(obj, indent=1, sort_keys=True, default=str))
        return p

    def chain(self) -> list[dict]:
        p = self.root / 'chain.jsonl'
        return [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []

    def prediction(self, signal: str) -> dict | None:
        p = self.root / 'predictions' / f'{signal}.json'
        return json.loads(p.read_text()) if p.exists() else None

    def predictions(self) -> dict:
        return {p.stem: json.loads(p.read_text()) for p in sorted((self.root / 'predictions').glob('*.json'))}

    def missed(self) -> set:
        return {p.stem for p in (self.root / 'missed').glob('*.json')}

    def write_prediction(self, record: dict):
        prev = self.chain()
        record = dict(record, previous_record_sha=prev[-1]['record_sha'] if prev else None)
        record['record_sha'] = sha({k: v for k, v in record.items() if k != 'record_sha'})
        self._create(f"predictions/{record['signal_session']}.json", record)
        self._append('chain.jsonl', {'signal_session': record['signal_session'], 'record_sha': record['record_sha'],
                                     'previous_record_sha': record['previous_record_sha'], 'created_at': record['created_at']})
        return record

    def write_missed(self, signal: str, detail: dict):
        try:
            self._create(f'missed/{signal}.json', detail)
        except FileExistsError:
            pass

    def write_receipt(self, signal: str, obj: dict):
        try:
            self._create(f'receipts/{signal}.json', obj)
        except FileExistsError:
            pass

    def write_outcome(self, name: str, obj: dict):
        return self._create(f'outcomes/{name}.json', obj)


def verify_chain(ledger: Ledger, receipts: dict | None) -> dict:
    """signal -> 'VALID' or an INVALID reason. Fails closed.

    A prediction is VALID only when all of these hold:
    - its file hash and chain entry match;
    - its own creation time is before the next open;
    - an independent server-side receipt (ledger_receipts) binds this exact record hash, at the commit that added it,
      with a GitHub-assigned time before the next open;
    - its recorded buffer holdings equal the targets of the previous VALID prediction.

    No receipt, an unverifiable receipt, or a late one is never VALID. Git commit dates are not used at all."""
    receipts = receipts or {}
    chain, preds, out, prev = ledger.chain(), ledger.predictions(), {}, None
    by_signal = {c['signal_session']: c for c in chain}
    for c in chain:
        if c['previous_record_sha'] != prev:
            out[c['signal_session']] = 'INVALID_CHAIN_ORDER'
        prev = c['record_sha']
    for signal, rec in preds.items():
        if out.get(signal):
            continue
        body = {k: v for k, v in rec.items() if k != 'record_sha'}
        r = receipts.get(signal) or {'state': 'MISSING'}
        if signal not in by_signal:
            out[signal] = 'INVALID_NOT_IN_CHAIN'
        elif sha(body) != rec.get('record_sha') or rec['record_sha'] != by_signal[signal]['record_sha']:
            out[signal] = 'INVALID_HASH_MISMATCH'
        elif rec.get('signal_session') != signal:
            out[signal] = 'INVALID_SIGNAL_MISMATCH'
        elif not utc(rec['created_at']) < utc(rec['next_open_utc']):
            out[signal] = 'INVALID_AFTER_OPEN'
        elif r.get('state') == 'UNAVAILABLE':
            out[signal] = 'INVALID_RECEIPT_UNVERIFIABLE'
        elif r.get('state') != 'FOUND':
            out[signal] = 'INVALID_NO_RECEIPT'
        elif r.get('content_record_sha') != rec['record_sha']:
            out[signal] = 'INVALID_RECEIPT_MISMATCH'
        elif not utc(r['created_at']) < utc(rec['next_open_utc']):
            out[signal] = 'INVALID_RECEIPT_LATE'
        else:
            out[signal] = 'VALID'
    # The buffer's retained holdings must come from the previous VALID prediction (same rule as at prediction time).
    held = []
    for signal in sorted(out):
        if out[signal] != 'VALID':
            continue
        b = preds[signal]['strategies'][BUFFER]
        if sorted(b.get('held_before', [])) != held:
            out[signal] = 'INVALID_HELD_STATE_MISMATCH'
            continue
        held = sorted(b['targets'])
    return out


# ---------------------------------------------------------------- predict

def _held_before(ledger: Ledger, signal: str, valid: dict) -> list[str]:
    """Buffer state: the targets of the latest VALID prediction before this signal (a MISSED month changed nothing)."""
    earlier = [s for s in sorted(ledger.predictions()) if s < signal and valid.get(s) == 'VALID']
    if not earlier:
        return []
    return sorted(ledger.prediction(earlier[-1])['strategies'][BUFFER]['targets'])


def buffer_targets(series, members, k, held):
    ranked = ng.ranked_top20(series, members, k)
    in_top = {x['symbol'] for x in ranked[:ng.BUFFER_RANK]}
    keep = [s for s in held if s in in_top]
    picks = ng.pick(ranked, keep=keep)
    return {s: cand.WEIGHT for s in picks}, {'kept': keep, 'ranked_top20': [x['symbol'] for x in ranked]}


def predict(ledger: Ledger, *, now: datetime, calendar: list[str], market, members: list[dict], code_commit: str,
            receipts: dict | None, first_signal: str = FIRST_SIGNAL, label: str = 'FORWARD',
            margin: timedelta = RECEIPT_MARGIN) -> dict:
    """One prediction run.
    - **Market data:** `market(end_time)` returns (sessions, series) with bars up to `end_time` (read-only).
    - **Prior receipts:** `receipts` is the server-side receipt evidence for the earlier predictions. It decides which
      earlier ones are VALID, and so which holdings the buffer retains.
    - **Returns** the event recorded.
    - **Never creates a record:**
      - within `margin` of the next open, so the receipt cannot land after it;
      - while any earlier receipt is unverifiable."""
    symbols = sorted({m['symbol'] for m in members})
    today = now.astimezone(cand.NY).date().isoformat()
    # Every month-end from the first signal whose next open has passed without a record is MISSED, permanently.
    preds = ledger.predictions()
    for s in month_end_sessions(calendar, first_signal, today):
        if s not in preds and now >= utc(next_open_utc(calendar, s)):
            ledger.write_missed(s, {'signal_session': s, 'next_open_utc': next_open_utc(calendar, s),
                                    'declared_at': stamp(now), 'status': 'MISSED', 'reconstructed': False})
    ends = month_end_sessions(calendar, first_signal, today)
    if not ends:
        ev = {'at': stamp(now), 'kind': 'NOT_A_SIGNAL_SESSION', 'today': today}
        ledger.event(ev)
        return ev
    signal = ends[-1]
    deadline = next_open_utc(calendar, signal)
    if now >= utc(deadline):
        ev = {'at': stamp(now), 'kind': 'MISSED' if signal not in preds else 'NOTHING_TO_DO', 'signal_session': signal,
              'next_open_utc': deadline}
        ledger.event(ev)
        return ev
    if signal in ledger.missed() and signal not in preds:
        # Declared MISSED once (e.g. by a run after the open): never recorded afterwards, whatever a runner's clock says.
        ev = {'at': stamp(now), 'kind': 'MISSED', 'signal_session': signal, 'next_open_utc': deadline, 'detail': 'ALREADY_DECLARED'}
        ledger.event(ev)
        return ev
    if signal not in preds and now >= utc(deadline) - margin:
        ev = {'at': stamp(now), 'kind': 'TOO_CLOSE_TO_DEADLINE', 'signal_session': signal, 'next_open_utc': deadline,
              'margin_minutes': margin.total_seconds() / 60}
        ledger.event(ev)
        return ev
    if now - DATA_DELAY < utc(cand.close_utc(signal)) + CLOSE_SETTLE:
        ev = {'at': stamp(now), 'kind': 'BEFORE_CLOSE_DATA', 'signal_session': signal}
        ledger.event(ev)
        return ev
    end_time = stamp(now - DATA_DELAY)
    sessions, series = market(end_time)
    if signal not in sessions:
        ev = {'at': stamp(now), 'kind': 'DATA_NOT_READY', 'signal_session': signal, 'reason': 'signal session absent'}
        ledger.event(ev)
        return ev
    k = sessions.index(signal)
    ready, missing = data_ready(series, symbols, k)
    if not ready:
        ev = {'at': stamp(now), 'kind': 'DATA_NOT_READY', 'signal_session': signal, 'missing': missing[:20]}
        ledger.event(ev)
        return ev
    earlier = {x for x in preds if x < signal}
    unavailable = sorted(x for x in earlier if (receipts or {}).get(x, {}).get('state') == 'UNAVAILABLE')
    if unavailable:
        # The buffer state depends on which earlier predictions are VALID; without that evidence, do not guess.
        ev = {'at': stamp(now), 'kind': 'RECEIPT_CHECK_UNAVAILABLE', 'signal_session': signal, 'earlier': unavailable}
        ledger.event(ev)
        return ev
    valid = verify_chain(ledger, receipts)
    fp = input_fingerprint(sessions, series, set(symbols) | {'SPY'}, k)
    held = _held_before(ledger, signal, valid)
    b_targets, b_meta = buffer_targets(series, members, k, held)
    base_targets = cand.momentum_quality_targets(series, members, k)

    def small_account(targets):
        # Whole shares only: at $1,000 a 20% slot cannot hold a share priced above about $199.50.
        bad = sorted(s_ for s_, w in targets.items() if series[s_]['c'][k] * (1 + 0.0025) > w * SMALL_CAPITAL)
        return {'capital': SMALL_CAPITAL, 'targets_without_a_whole_share': bad,
                'prices_at_signal_close': {s_: series[s_]['c'][k] for s_ in bad}}
    body = {'ledger': LEDGER, 'label': label, 'approval': APPROVAL, 'prereg': ng.PREREG, 'signal_session': signal,
            'decision_at_utc': cand.close_utc(signal), 'next_open_utc': deadline, 'execution_session': next_session(calendar, signal),
            'created_at': stamp(now), 'data_end_time': end_time, 'input_fingerprint': fp, 'members_missing_signal_bar': missing,
            'code_commit': code_commit, 'strategies': {
                BUFFER: {'targets': b_targets, 'held_before': held, 'meta': b_meta, 'small_account': small_account(b_targets)},
                BASELINE: {'targets': base_targets, 'small_account': small_account(base_targets)}}}
    existing = ledger.prediction(signal)
    if existing is not None:
        same = existing['strategies'] == body['strategies'] and existing['input_fingerprint'] == fp
        ev = {'at': stamp(now), 'kind': 'DUPLICATE_RUN', 'signal_session': signal, 'recompute_matches': same,
              'original_record_sha': existing['record_sha']}
        if not same:
            ev['kind_detail'] = 'RECOMPUTE_DIFFERS'
            ev['recomputed_fingerprint'] = fp
        ledger.event(ev)
        return ev
    rec = ledger.write_prediction(body)
    ev = {'at': stamp(now), 'kind': 'RECORDED', 'signal_session': signal, 'record_sha': rec['record_sha'],
          'next_open_utc': deadline}
    ledger.event(ev)
    return ev


# ---------------------------------------------------------------- evaluate (outcomes; never edits a prediction)

def month_statuses(ledger: Ledger, calendar: list[str], latest_session: str, receipts: dict | None) -> dict:
    """Every month-end from FIRST_SIGNAL whose next open has passed: VALID, MISSED or INVALID_*."""
    valid = verify_chain(ledger, receipts)
    out = {}
    for s in month_end_sessions(calendar, FIRST_SIGNAL, latest_session):
        if next_session(calendar, s) > latest_session:
            continue
        out[s] = valid.get(s, 'MISSED')
    return out


def frozen_decisions(ledger: Ledger, statuses: dict, sessions: list[str], strategy: str) -> list[dict]:
    """Engine decisions straight from the frozen records (VALID only). Targets are never recomputed."""
    out = []
    for s, st in sorted(statuses.items()):
        if st != 'VALID' or s not in sessions:
            continue
        rec = ledger.prediction(s)
        out.append({'signal_index': sessions.index(s), 'targets': rec['strategies'][strategy]['targets'],
                    'label': 'forward ' + s, 'meta': {'record_sha': rec['record_sha']}})
    return out


def revisions(ledger: Ledger, statuses: dict, sessions, series, symbols) -> dict:
    """Prediction inputs re-fingerprinted from today's data. A difference is reported, never applied."""
    out = {}
    for s, st in statuses.items():
        if st == 'VALID' and s in sessions:
            rec = ledger.prediction(s)
            now_fp = input_fingerprint(sessions, series, set(symbols) | {'SPY'}, sessions.index(s))
            out[s] = 'UNCHANGED' if now_fp == rec['input_fingerprint'] else 'INPUT_DATA_REVISED'
    return out


FORWARD_MIN_SESSIONS, FORWARD_MIN_REBALANCES = 252, 12
COSTS = (10, 25)


def _run(sessions, series, actions, decisions, first, end_k, *, capital, cost, halt):
    r = engine.simulate(sessions, series, actions, decisions, start_index=first, end_index=end_k, capital=capital,
                        cost_bps=cost, halt=halt)
    lo, hi = sessions[first], sessions[end_k]
    return {'summary': ev.summarize(r['curve'], lo, hi)['full'], 'end_value': r['curve'][-1][1],
            'avg_exposure': r['avg_exposure'], 'turnover_per_year': r['turnover_per_year'], 'costs': r['costs'],
            'halted_on': r['halted_on'], 'orders': r['orders'], 'filled': r['filled'], 'unfilled_gap': r['unfilled_gap'],
            'unfilled_cash': r['unfilled_cash'], 'reduced_for_cash': r['reduced_for_cash'],
            'zero_share_targets': r['zero_share_targets'], 'zero_share_examples': r['zero_share_log'][:20],
            'open_unresolved_at_end': r['open_unresolved_at_end'], 'unresolved': r['unresolved']}


def evaluate(ledger: Ledger, *, now: datetime, calendar, sessions, series, actions, members, data_fingerprint: str,
             code_commit: str, receipts: dict | None) -> dict:
    """Side-by-side forward outcome from the frozen predictions. Writes one new outcome file; edits nothing."""
    symbols = [m['symbol'] for m in members]
    latest = sessions[-1]
    statuses = month_statuses(ledger, calendar, latest, receipts)
    out = {'ledger': LEDGER, 'kind': 'outcome', 'evaluated_at': stamp(now), 'latest_session': latest,
           'month_statuses': statuses, 'receipts': {s: {k: v for k, v in (receipts or {}).get(s, {'state': 'MISSING'}).items()
                                                     if k in ('state', 'created_at', 'status_id', 'commit', 'reason')}
                                                 for s in statuses}, 'data_fingerprint': data_fingerprint, 'code_commit': code_commit,
           'note': 'Outcomes use current market data; predictions are frozen and never edited.'}
    decs = {s: frozen_decisions(ledger, statuses, sessions, s) for s in (BUFFER, BASELINE)}
    if not decs[BUFFER]:
        out['status'] = 'NOT STARTED'
    else:
        first, end_k = decs[BUFFER][0]['signal_index'] + 1, len(sessions) - 1
        if first > end_k:
            out['status'] = 'NOT STARTED'
        else:
            out['revisions'] = revisions(ledger, statuses, sessions, series, symbols)
            tracks = {}
            for sid, d in decs.items():
                for cost in COSTS:
                    for halt in (False, True):
                        name = f"{sid}|{'halt10' if halt else 'continuous'}|{cost}bps"
                        tracks[name] = {'capital_30000': _run(sessions, series, actions, d, first, end_k, capital=ev.CAPITAL, cost=cost, halt=halt),
                                        'capital_1000': _run(sessions, series, actions, d, first, end_k, capital=SMALL_CAPITAL, cost=cost, halt=halt)}
            spy = ev.hold_curve(sessions, series['SPY'], first, end_k)
            tracks['SPY|hold'] = {'capital_30000': {'summary': ev.summarize(spy, sessions[first], latest)['full'], 'end_value': spy[-1][1]}}
            n, rebal = end_k - first + 1, len(decs[BUFFER])
            out.update({'status': 'READY FOR PRE-REGISTERED FORWARD REVIEW' if n >= FORWARD_MIN_SESSIONS and rebal >= FORWARD_MIN_REBALANCES
                        else 'INSUFFICIENT FORWARD SAMPLE', 'first_execution': sessions[first], 'sessions': n,
                        'rebalances': rebal, 'tracks': tracks})
    ledger.write_outcome(stamp(now).replace(':', ''), out)
    return out
