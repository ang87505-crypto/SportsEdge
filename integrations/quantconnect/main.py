"""QuantConnect LEAN read-only US equity PIT universe feasibility check.

Paste this as main.py in SportsEdge-Stock-Research (only after separately
reviewing the documented universe behavior). It DOES NOT run a SportsEdge
strategy backtest and deliberately never calls set_holdings/market_order.

The production selection math is separately parity-tested in selection.py.
A full source bridge and actual corporate-event/execution reconciliation
must be completed before enabling portfolio simulation.
"""
from AlgorithmImports import *


class SportsEdgeUniverseReadiness(QCAlgorithm):
    def initialize(self):
        self.set_start_date(2000, 1, 1)
        self.set_end_date(2011, 12, 31)
        self.set_cash(1000)
        self.spy = self.add_equity(
            "SPY", Resolution.DAILY,
            data_normalization_mode=DataNormalizationMode.RAW
        ).symbol
        self.set_warm_up(253, Resolution.DAILY)
        # Universe filtering is synchronous and *monthly* for bounded
        # source-coverage diagnostics. NO selected universe subscriptions.
        self.universe_settings.asynchronous = False
        self.universe_settings.schedule.on(self.date_rules.month_start(self.spy))
        self._audited = set()
        self._missing_sector_months = 0
        self._member_counts = []
        self.add_universe(self._inspect_universe)
        self.debug("SportsEdge: research-only PIT universe preflight; NO ORDERS")

    def _inspect_universe(self, fundamentals):
        if self.is_warming_up:
            return []
        key = (self.time.year, self.time.month)
        if key in self._audited:
            return []
        self._audited.add(key)
        rows = list(fundamentals)
        # Do not discard records to make a backtest look complete.
        missing = 0
        eligible_metadata = 0
        for entry in rows:
            if not entry.has_fundamental_data:
                missing += 1
                continue
            try:
                code = entry.asset_classification.morningstar_sector_code
                if code is None or int(code) <= 0:
                    missing += 1
                    continue
            except (AttributeError, TypeError, ValueError):
                missing += 1
                continue
            eligible_metadata += 1
        self._member_counts.append(len(rows))
        if missing:
            self._missing_sector_months += 1
        self.debug(
            f"QC PIT {key[0]}-{key[1]:02d}: seen={len(rows)} "
            f"metadata={eligible_metadata} missing/unknown={missing} "
            "NOT VERIFIED FOR SPORTSEDGE"
        )
        # Critical: return empty. Subscribing to every stock can exhaust
        # free-node memory, and partial selection changes the frozen universe.
        return []

    def on_data(self, data: Slice):
        # Research-only. No trading API invocation allowed in this script.
        pass

    def on_end_of_algorithm(self):
        self.debug(
            "SPORTSEDGE READINESS ONLY: historical strategy returns NOT MEASURED; "
            f"months={len(self._audited)} "
            f"months_with_missing_metadata={self._missing_sector_months}. "
            "Next: independently reconcile complete PIT membership, raw bars, "
            "actions, sector timing and fill mechanics."
        )
