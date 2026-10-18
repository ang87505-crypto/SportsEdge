"""Optional SportsEdge QUANTCONNECT main.py: read-only PIT universe bias audit.

For the user's existing SportsEdge-Stock-Research project ONLY. Back up its
current main.py first. Upload qc_pit_bias_audit_v1.py as a second root file.
NOT YET RUN IN QUANTCONNECT CLOUD. The Delisting history call shape is
unverified on the owner's runtime; any failure reports
EXIT_EXPLANATION_UNAVAILABLE rather than a pass.

No orders, subscriptions beyond SPY, strategy, P/L or data export. Logs carry
fixed codes only: no identifiers, tickers, counts, dates or vendor values.
"""
from AlgorithmImports import *
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from qc_pit_bias_audit_v1 import PitBiasAudit

START_YEAR, END_YEAR = 2000, 2011
EXPECTED_MONTHS = frozenset((y, m) for y in range(START_YEAR, END_YEAR + 1) for m in range(1, 13))
NY = ZoneInfo('America/New_York')
CHUNK = 200


def _sector(row):
    try:
        value = row.asset_classification.morningstar_sector_code
        return int(value) if value is not None and int(value) > 0 else None
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def snapshot(fundamentals):
    """{permanent_id: sector} over rows with fundamentals, plus latest EndTime."""
    members, asof = {}, None
    for row in fundamentals:
        if getattr(row, 'has_fundamental_data', False) is not True:
            continue
        sid = str(getattr(getattr(row, 'symbol', None), 'id', '')).strip()
        if not sid:
            continue
        members[sid] = _sector(row)
        end = getattr(row, 'end_time', None)
        if isinstance(end, datetime) and (asof is None or end > asof):
            asof = end
    return members, asof


def delisted_ids(history, symbols, start, end):
    """Permanent IDs with a LEAN Delisting record, or None if unreadable."""
    found = set()
    try:
        for i in range(0, len(symbols), CHUNK):
            result = history(Delisting, symbols[i:i + CHUNK], start, end)
            index = getattr(result, 'index', None)
            if index is None or not hasattr(index, 'get_level_values'):
                return None
            for value in index.get_level_values(0):
                found.add(str(getattr(value, 'id', value)))
    except Exception:
        return None
    return found


class SportsEdgePitBiasAudit(QCAlgorithm):
    def initialize(self):
        self.set_start_date(START_YEAR, 1, 1)
        self.set_end_date(END_YEAR, 12, 31)
        self.set_cash(1000)
        self.spy = self.add_equity('SPY', Resolution.DAILY,
                                   data_normalization_mode=DataNormalizationMode.RAW).symbol
        self.universe_settings.asynchronous = False
        self.universe_settings.schedule.on(self.date_rules.month_start(self.spy))
        self._audit = PitBiasAudit(EXPECTED_MONTHS)
        self._symbols = {}
        self._failed = False
        self.add_universe(self._inspect)
        self.debug('SPORTSEDGE_QC_PIT_AUDIT_STARTED; NO_ORDERS; NO_PNL')

    def _inspect(self, fundamentals):
        if self._failed:
            return []
        try:
            rows = list(fundamentals)
            members, asof = snapshot(rows)
            for row in rows:
                sid = str(getattr(getattr(row, 'symbol', None), 'id', '')).strip()
                if sid in members:
                    self._symbols[sid] = row.symbol
            now = self.time.replace(tzinfo=NY)
            decision = now.replace(hour=8, minute=0, second=0, microsecond=0)
            asof = (asof or now).replace(tzinfo=NY)
            self._audit.observe(asof_at=asof, observed_at=now, decision_at=decision, members=members)
        except Exception:
            self._failed = True
        # Never subscribe to the universe; no orders exist in this audit.
        return []

    def on_data(self, data: Slice):
        pass

    def on_end_of_algorithm(self):
        if self._failed:
            self.debug('SPORTSEDGE_QC_PIT_AUDIT_BLOCKED_READ; SOURCE_NOT_ADMITTED; NO_ORDERS; NO_PNL')
            return
        exits = [self._symbols[sid] for sid in self._audit.exits() if sid in self._symbols]
        explained = delisted_ids(self.history, exits, datetime(START_YEAR, 1, 1),
                                 datetime(END_YEAR, 12, 31) + timedelta(days=1))
        result = self._audit.finish(explained)
        self.debug('SPORTSEDGE_QC_PIT_AUDIT_' + result['status'] + '; '
                   + ','.join(result['codes'] or ['NONE'])
                   + '; SOURCE_NOT_ADMITTED; NO_ORDERS; NO_PNL')
