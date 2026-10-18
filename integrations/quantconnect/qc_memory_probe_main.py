"""Optional SportsEdge QUANTCONNECT main.py: read-only Free-node memory probe.

NOT YET RUN IN QUANTCONNECT CLOUD. For the owner's existing
SportsEdge-Stock-Research project ONLY; back up its current main.py first.
Upload, as root files: the se_*.py / sportsedge_cloud_entry.py bundle from
scripts/package_stock_identity_cloud.py (supplies the native-verified RAW
reader and the frozen analytics package), qc_stream_rows_v1.py,
qc_memory_probe_v1.py, and this file as main.py. Call shapes not yet verified
on the owner's runtime: History for unsubscribed universe symbols,
exchange.hours.is_date_open, and the resource module; any failure reports a
fixed BLOCKED_<phase> code rather than a result.

For ONE first-of-month decision (08:00 New York, 2001-02-01, inside the
2000-2011 development period) it reads the 253-session RAW lookback of every
fundamental-universe member through lean_reviewed_lookback_v1, builds the
evidence shards in memory, and logs only fixed memory/elapsed bucket codes.
No orders, no universe subscriptions, no strategy, no P/L, no export. Logs
carry no identifiers, tickers, counts, prices, dates or exception text.
"""
from AlgorithmImports import *
from datetime import date, datetime
import time as _clock

try:
    from se_bootstrap import install
    install()
    from integrations.quantconnect.lean_reviewed_lookback_v1 import read_reviewed_lookback
    from qc_stream_rows_v1 import build_shard
    import qc_memory_probe_v1 as probe
    _IMPORTED = True
except Exception:
    _IMPORTED = False

DECISION = date(2001, 2, 1)
STARTED = 'SPORTSEDGE_QC_MEMORY_PROBE_STARTED; PROBE_ONLY; NO_ORDERS; NO_EXPORT'
IMPORT_BLOCKED = 'SPORTSEDGE_QC_MEMORY_BLOCKED_IMPORT; PROBE_ONLY; SOURCE_NOT_ADMITTED; NO_ORDERS; NO_EXPORT'


def capture(fundamentals):
    """[(permanent_id, symbol)] for rows with fundamentals; first ID wins."""
    members, seen = [], set()
    for row in fundamentals:
        if getattr(row, 'has_fundamental_data', False) is not True:
            continue
        symbol = getattr(row, 'symbol', None)
        sid = str(getattr(symbol, 'id', '')).strip()
        if sid and sid not in seen:
            seen.add(sid)
            members.append((sid, symbol))
    return members


class SportsEdgeMemoryProbe(QCAlgorithm):
    def initialize(self):
        self.set_start_date(2001, 1, 29)
        self.set_end_date(2001, 2, 2)
        self.set_cash(1000)
        self.spy = self.add_equity('SPY', Resolution.DAILY,
                                   data_normalization_mode=DataNormalizationMode.RAW).symbol
        self._members = None
        self._done = False
        if not _IMPORTED:
            self._done = True
            self.debug(IMPORT_BLOCKED)
            return
        self.universe_settings.asynchronous = False
        self.universe_settings.schedule.on(self.date_rules.month_start(self.spy))
        self.add_universe(self._capture)
        self.schedule.on(self.date_rules.on(DECISION.year, DECISION.month, DECISION.day),
                         self.time_rules.at(8, 0), self._probe)
        self.debug(STARTED)

    def _capture(self, fundamentals):
        try:
            if self.time.date() == DECISION and self._members is None:
                self._members = capture(fundamentals)
        except Exception:
            self._members = []
        # Never subscribe to the universe; no orders exist in this probe.
        return []

    def _probe(self):
        if self._done:
            return
        self._done = True
        try:
            decision_at = datetime.combine(DECISION, datetime.min.time()).replace(hour=8)
            if self.time != decision_at:
                raise probe.ProbeBlocked('BLOCKED_SCHEDULE')
            if not self._members:
                raise probe.ProbeBlocked('BLOCKED_UNIVERSE')
            hours = self.securities[self.spy].exchange.hours
            sessions = probe.probe_sessions(
                lambda d: hours.is_date_open(datetime.combine(d, datetime.min.time())), DECISION)

            def read(symbol):
                return read_reviewed_lookback(self, symbol, expected_sessions=sessions,
                                              decision_at=decision_at)
            result = probe.run_probe(self._members, read_lookback=read, build_shard=build_shard,
                                     sessions=sessions, decision_at=decision_at, clock=_clock.monotonic)
            self._members = None
            self.debug(probe.log_line(result))
        except probe.ProbeBlocked as blocked:
            self._members = None
            self.debug(probe.blocked_line(blocked.code))
        except Exception:
            self._members = None
            self.debug(probe.blocked_line('BLOCKED_BUNDLE'))

    def on_data(self, data: Slice):
        pass

    def on_end_of_algorithm(self):
        if not self._done:
            self.debug(probe.blocked_line('BLOCKED_SCHEDULE') if _IMPORTED else IMPORT_BLOCKED)
