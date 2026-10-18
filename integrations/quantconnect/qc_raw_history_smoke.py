"""Optional SportsEdge QUANTCONNECT main.py for ONE read-only History API smoke test.

For the user's existing SportsEdge-Stock-Research QC project ONLY. Back up its
current main.py first. Upload lean_history_source_v1.py as a second root file.
This does not run a SportsEdge strategy or claim verified source availability.
No orders, private price logs, market-data export, or subscriptions to a universe.
"""
from AlgorithmImports import *
from datetime import datetime

from lean_history_source_v1 import read_raw_window


class SportsEdgeRawHistorySmoke(QCAlgorithm):
    def initialize(self):
        self.set_start_date(2001, 2, 2)
        self.set_end_date(2001, 2, 6)
        self.set_cash(1000)
        self.spy = self.add_equity(
            "SPY", Resolution.DAILY,
            data_normalization_mode=DataNormalizationMode.RAW,
            fill_forward=False).symbol
        self._checked = False
        self.debug("SPORTSEDGE_QC_RAW_HISTORY_SMOKE_STARTED; NO_ORDERS")

    def on_data(self, data: Slice):
        if self._checked or self.is_warming_up:
            return
        # Callback occurs after the chosen 08:00 decision timestamp; this
        # probe only requests days BEFORE Feb 1, so it cannot rely on the
        # later/current data Slice as model input.
        self._checked = True
        self._phase = "INPUT"
        def mark_phase(value):
            # Fixed phase codes only. Never expose vendor data or exception text.
            if value in ("REQUEST", "FRAME", "INDEX", "OHLCV", "FINAL"):
                self._phase = value
        try:
            result = read_raw_window(
                self, self.spy,
                start=datetime(2001, 1, 2),
                end=datetime(2001, 2, 1),
                decision_at=datetime(2001, 2, 2, 8),
                phase_callback=mark_phase)
            if result["historical_source_admitted"] or result["performance"] is not None:
                raise ValueError("Unexpected historical source promotion")
        except Exception:
            # QC data source values and exception contents must remain in-cloud.
            self.debug("SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED_" + self._phase + "; NO_ORDERS; NO_PNL")
            return
        self.debug("SPORTSEDGE_QC_RAW_HISTORY_SMOKE_PASSED; SOURCE_NOT_ADMITTED; NO_ORDERS; NO_PNL")
