# Optional QuantConnect smoke test: raw History API

This is only for confirming that our new adapter works inside your existing QuantConnect **SportsEdge-Stock-Research** project. No trades or performance calculation.

1. Save your existing QuantConnect main.py code in a local Notepad backup.
2. In the QuantConnect project, add a new file called `lean_history_source_v1.py`; copy in the complete contents of `integrations/quantconnect/lean_history_source_v1.py` from SportsEdge PR #78.
3. Replace the QuantConnect project's `main.py` with the complete contents of `integrations/quantconnect/qc_raw_history_smoke.py` from the same PR.
4. Run Build and Backtest in your existing Free workspace. This performs one read-only January 2001 SPY raw daily history request. No extra subscription required by our code.
5. Read the Logs: `SPORTSEDGE_QC_RAW_HISTORY_SMOKE_PASSED` means the reader can parse that bounded LEAN result. `SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED` means further integration fixes are needed. Neither result establishes full historical backtest readiness.
6. Restore your earlier QuantConnect `main.py` using your backup when finished.

No credentials are needed for this QuantConnect code. Do not share or export the underlying vendor price data. Report only the fixed PASS/BLOCKED message, without detailed licensed source values.

The full 2000–2011 source provider remains incomplete: we still need historically valid full eligible membership, classifications and first listing dates, reviewed event economics and actual as-of availability, benchmarks and complete ledger replay. Source admission remains disabled.
