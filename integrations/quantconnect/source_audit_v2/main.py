"""Standalone LEAN raw-history coverage diagnostic. Paste as main.py.
No orders, source exports, selection, or portfolio performance. All vendor
observations stay in cloud memory. Never treats supplied universe as complete.
"""
from AlgorithmImports import *
from datetime import datetime, timedelta
from decimal import Decimal

EXPECTED = {(y, m) for y in range(2000, 2012) for m in range(1, 13)}
BATCH_SIZE = 32  # Memory bound, NOT a universe-size limit.


def inspect_rows(rows, expected_days, cutoff):
    """Input rows: (session date, end time, close, volume, fill-forward).
    Presence is not proof of vendor publication time or corporate-action fitness.
    Short history is unresolved, never assumed to be an IPO.
    """
    expected = set(expected_days)
    seen = set()
    bad = 0
    for day, ended, close, volume, filled in rows:
        try:
            p, v = Decimal(str(close)), Decimal(str(volume))
            valid = (day in expected and day not in seen and ended < cutoff
                     and not filled and p.is_finite() and p > 0
                     and v.is_finite() and v >= 0 and v == v.to_integral_value())
        except (ValueError, TypeError, ArithmeticError):
            valid = False
        if not valid:
            bad += 1
        seen.add(day)
    return {'missing': len(expected - seen), 'invalid': bad,
            'structural_pass': len(expected) == 253 and not bad and seen == expected}


class SportsEdgeRawHistoryAudit(QCAlgorithm):
    def initialize(self):
        self.set_start_date(2000, 1, 1)
        self.set_end_date(2011, 12, 31)
        self.set_time_zone(TimeZones.NEW_YORK)
        self.set_cash(1000)
        self.spy = self.add_equity('SPY', Resolution.DAILY,
            data_normalization_mode=DataNormalizationMode.RAW).symbol
        self.universe_settings.asynchronous = False
        self.universe_settings.schedule.on(self.date_rules.month_start(self.spy))
        self._members = None
        self._universe_day = None
        self._audits = {}
        self._fatal = False
        self.add_universe(self.capture)
        self.schedule.on(self.date_rules.month_start(self.spy),
                         self.time_rules.at(8, 0), self.audit)
        self.debug('SPORTSEDGE: RAW HISTORY DIAGNOSTIC; NO STRATEGY PERFORMANCE')

    def capture(self, fundamentals):
        # Keep every supplied member, even absent fundamental fields. No filters.
        self._members = [f.symbol for f in fundamentals]
        self._universe_day = self.time.date()
        return []

    def history_rows(self, symbols, cutoff):
        # Date-range request prevents reaching farther back to conceal gaps.
        return self.history[TradeBar](symbols, cutoff - timedelta(days=550), cutoff,
            Resolution.DAILY, fill_forward=False, extended_market_hours=False,
            data_normalization_mode=DataNormalizationMode.RAW)

    @staticmethod
    def row(bar):
        return (bar.time.date(), bar.end_time, bar.close, bar.volume,
                bar.is_fill_forward)

    def audit(self):
        key = (self.time.year, self.time.month)
        if key not in EXPECTED or key in self._audits or self._fatal:
            return
        report = {'completed': False, 'members': 0, 'inspected': 0,
                  'structural_failures': 0, 'source_admitted': False}
        self._audits[key] = report
        try:
            if (self.time.hour, self.time.minute) != (8, 0):
                raise ValueError('cutoff')
            if self._universe_day != self.time.date() or not self._members:
                raise ValueError('missing universe callback')
            ids = [str(s.id) for s in self._members]
            if any(not s for s in ids) or len(ids) != len(set(ids)):
                raise ValueError('identity')
            report['members'] = len(ids)
            cutoff = datetime(self.time.year, self.time.month, self.time.day, 8)
            calendar = []
            for packet in self.history_rows([self.spy], cutoff):
                for bar in packet.values():
                    if bar.end_time < cutoff and bar.time.date() < cutoff.date():
                        calendar.append(bar.time.date())
            if len(calendar) != len(set(calendar)):
                raise ValueError('duplicate calendar')
            days = sorted(calendar)[-253:]
            if len(days) != 253:
                raise ValueError('calendar warmup')
            # SPY observations are a calendar PROXY, not exchange-calendar proof.
            for offset in range(0, len(self._members), BATCH_SIZE):
                batch = self._members[offset:offset + BATCH_SIZE]
                buffers = {str(s.id): [] for s in batch}
                for packet in self.history_rows(batch, cutoff):
                    for bar in packet.values():
                        sid = str(bar.symbol.id)
                        if sid not in buffers:
                            raise ValueError('unrequested identity')
                        if bar.time.date() >= days[0]:
                            buffers[sid].append(self.row(bar))
                for symbol in batch:
                    result = inspect_rows(buffers[str(symbol.id)], days, cutoff)
                    report['inspected'] += 1
                    report['structural_failures'] += not result['structural_pass']
            report['completed'] = report['inspected'] == report['members']
        except Exception:
            # Vendor errors may embed source values. Retain no external traceback.
            self._fatal = True
            self.debug('SPORTSEDGE: DIAGNOSTIC STOPPED; INSPECT ERROR IN CLOUD')
            self.quit()

    def on_end_of_algorithm(self):
        self._coverage_completed = (not self._fatal and set(self._audits) == EXPECTED
            and all(x['completed'] for x in self._audits.values()))
        self._source_admitted = False
        # Fixed text only: no counts, identifiers, bar values, or derived exports.
        self.debug('SPORTSEDGE: SOURCE_NOT_ADMITTED; PERFORMANCE_NOT_MEASURED; DATA_EXPORT_DISABLED')
