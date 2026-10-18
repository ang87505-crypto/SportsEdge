"""Free-node memory feasibility probe for ONE monthly evidence bundle, in cloud.

Self-contained (stdlib only) so it deploys as one QC root file; the LEAN
reader and the shard builder are passed in by qc_memory_probe_main.py.
NOT YET RUN IN QUANTCONNECT CLOUD.

Measures, for one month-end decision, the in-memory size of the full-universe
253-session RAW lookback converted into the frozen evidence-shard shape
(qc_stream_rows_v1.build_shard). It reports FIXED bucket codes only: no IDs,
tickers, counts, prices, dates or exact byte/second values leave the cloud.

PROBE-ONLY placeholders, never evidence and never fed to scoring, the stream
or any decision: the session calendar comes from LEAN's exchange hours (not a
reviewed calendar); bar availability and the 16:00 close are placeholders;
classification fields are dummy labels. The bundle size is a deep
sys.getsizeof estimate that counts calendar-shared strings once and other
cross-shard sharing per shard, so it is conservative (may overstate).
Scoring, identity normalization and the six-account stream are NOT measured.
"""
from datetime import date, datetime, time, timedelta
import sys
from zoneinfo import ZoneInfo

VERSION = 'sportsedge-qc-memory-probe-v1'
NY = ZoneInfo('America/New_York')
REQUIRED_SESSIONS = 253
MAX_SPAN_DAYS = 430
MB = 1024 * 1024
BUNDLE_CAP_BYTES = 512 * MB      # stop early: the answer is already OVER_512MB
TIME_CAP_SECONDS = 60 * 60       # stop early and project from members read
DEVELOPMENT = (date(2000, 1, 1), date(2011, 12, 31))
PROBE_LABEL = 'PROBE_ONLY_NOT_EVIDENCE'


class ProbeBlocked(Exception):
    """Fixed phase code only; str(exc) is the code."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def memory_code(nbytes):
    if nbytes < 256 * MB:
        return 'UNDER_256MB'
    return '256_512MB' if nbytes < 512 * MB else 'OVER_512MB'


def process_code(nbytes):
    if nbytes is None:
        return 'UNAVAILABLE'
    if nbytes < 512 * MB:
        return 'UNDER_512MB'
    if nbytes < 1024 * MB:
        return '512MB_1GB'
    return '1_2GB' if nbytes < 2048 * MB else 'OVER_2GB'


def elapsed_code(seconds):
    if seconds < 60:
        return 'UNDER_1MIN'
    if seconds < 600:
        return '1_10MIN'
    return '10_60MIN' if seconds < 3600 else 'OVER_60MIN'


def process_peak_bytes():
    """Peak resident set of the whole LEAN process, or None if unreadable."""
    try:
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    except Exception:
        return None
    # Linux reports KiB; macOS reports bytes (local tests only).
    return int(peak) if sys.platform == 'darwin' else int(peak) * 1024


def probe_sessions(is_open, decision_date):
    """253 open dates strictly before a first-of-month decision, from is_open.

    is_open(date) -> bool is LEAN's exchange-hours calendar in the cloud.
    PROBE ONLY: this is neither the reviewed calendar nor weekday inference.
    """
    if not isinstance(decision_date, date) or not DEVELOPMENT[0] <= decision_date <= DEVELOPMENT[1]:
        raise ProbeBlocked('BLOCKED_CALENDAR')
    try:
        if is_open(decision_date) is not True:
            raise ProbeBlocked('BLOCKED_CALENDAR')
        days, day = [], decision_date - timedelta(days=1)
        while len(days) < REQUIRED_SESSIONS and (decision_date - day).days <= MAX_SPAN_DAYS:
            if is_open(day) is True:
                days.append(day)
            day -= timedelta(days=1)
    except ProbeBlocked:
        raise
    except Exception:
        raise ProbeBlocked('BLOCKED_CALENDAR') from None
    if len(days) != REQUIRED_SESSIONS or (days[0].year, days[0].month) == (decision_date.year, decision_date.month):
        raise ProbeBlocked('BLOCKED_CALENDAR')
    return [d.isoformat() for d in reversed(days)]


def placeholder_sessions(dates):
    """Accounting-shaped session rows with PLACEHOLDER 09:30/16:00 times."""
    out = {}
    for text in dates:
        day = date.fromisoformat(text)
        out[text] = dict(date=text,
                         open_at=datetime.combine(day, time(9, 30), NY).isoformat(),
                         close_at=datetime.combine(day, time(16, 0), NY).isoformat())
    return out


def deep_size(obj, skip=frozenset()):
    """Iterative deep sys.getsizeof; objects whose id is in skip are not counted."""
    seen, stack, total = set(), [obj], 0
    while stack:
        item = stack.pop()
        key = id(item)
        if key in seen or key in skip:
            continue
        seen.add(key)
        total += sys.getsizeof(item)
        if isinstance(item, dict):
            stack.extend(item.keys()); stack.extend(item.values())
        elif isinstance(item, (list, tuple, set, frozenset)):
            stack.extend(item)
    return total


def run_probe(members, *, read_lookback, build_shard, sessions, decision_at, clock,
              process_peak=process_peak_bytes, bundle_cap=BUNDLE_CAP_BYTES, time_cap=TIME_CAP_SECONDS):
    """Build ONE month's shard bundle for every member and size it in memory.

    members: [(permanent_id, lean_symbol)] of the full fundamental universe.
    read_lookback(symbol) -> lean_reviewed_lookback_v1 result (raises on any
    source guard). A member that cannot be read is counted as unread, never
    retried with adjusted/filled data. Nothing here is logged or returned
    except fixed codes.
    """
    start = clock()
    if not members:
        raise ProbeBlocked('BLOCKED_UNIVERSE')
    rows = placeholder_sessions(sessions)
    last = sessions[-1]
    aware = decision_at.replace(tzinfo=NY).isoformat()
    availability = {d: rows[d]['close_at'] for d in sessions}
    source = dict(provider=PROBE_LABEL, source_revision=PROBE_LABEL, retrieved_at=aware)
    shared = deep_size([rows, availability, source])
    skip = frozenset(id(x) for r in rows.values() for x in r.values()) | frozenset(
        id(x) for x in availability.values()) | frozenset(id(x) for x in source.values())
    shards, universe, listings = [], [], {}
    size, read, unread, status = shared, 0, 0, 'COMPLETE'
    for index, (sid, symbol) in enumerate(members):
        try:
            lookback = read_lookback(symbol)
            ticker = lookback['requested_ticker']
            shard = build_shard(sid, lookback, sessions=rows, last_completed=last,
                                symbol_at=lambda close_at, t=ticker: t,
                                bar_available_at=availability, source=source, decision_at=aware)
        except Exception:
            unread += 1
        else:
            del lookback
            entry = dict(symbol=ticker, security_id=sid, sector=PROBE_LABEL,
                         type='common_stock', exchange=PROBE_LABEL)
            listing = dict(first_traded_on=sessions[0], available_at=aware, source_id=PROBE_LABEL)
            shards.append(shard); universe.append(entry); listings[sid] = listing
            size += deep_size([shard, entry, listing], skip)
            read += 1
        if size >= bundle_cap:
            status = 'STOPPED_MEMORY_CAP'
            break
        if clock() - start >= time_cap and index + 1 < len(members):
            status = 'STOPPED_TIME_CAP'
            break
    elapsed = clock() - start
    if not read:
        raise ProbeBlocked('BLOCKED_LOOKBACK')
    bundle = dict(shards=shards, context=dict(sessions=list(rows.values()), universe=universe,
                                              actions=[]), listings=listings, decision_at=aware)
    if status == 'STOPPED_TIME_CAP':
        attempted = read + unread
        memory = 'PROJECTED_' + memory_code(size * len(members) // attempted)
    else:
        memory = memory_code(size)
    coverage = 'ALL_MEMBERS_READ' if status == 'COMPLETE' and not unread else (
        'SOME_MEMBERS_UNREAD' if status == 'COMPLETE' else 'STOPPED_BEFORE_ALL_MEMBERS')
    result = dict(version=VERSION, status=status, memory=memory, process=process_code(process_peak()),
                  elapsed=elapsed_code(elapsed), coverage=coverage, bundle_built=bool(bundle['shards']),
                  scoring_measured=False, stream_measured=False, source_admitted=False, performance=None)
    del bundle, shards
    return result


def log_line(result):
    """The ONLY text the probe emits for a finished run."""
    return ('SPORTSEDGE_QC_MEMORY_' + result['memory'] + '; SPORTSEDGE_QC_ELAPSED_' + result['elapsed']
            + '; PROCESS_PEAK_' + result['process'] + '; ' + result['status'] + '; COVERAGE_'
            + result['coverage'] + '; PROBE_ONLY; SOURCE_NOT_ADMITTED; NO_ORDERS; NO_EXPORT')


def blocked_line(code):
    return 'SPORTSEDGE_QC_MEMORY_' + code + '; PROBE_ONLY; SOURCE_NOT_ADMITTED; NO_ORDERS; NO_EXPORT'
