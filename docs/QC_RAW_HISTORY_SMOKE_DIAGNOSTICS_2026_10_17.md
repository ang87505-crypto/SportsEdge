# QuantConnect RAW History smoke: follow-up diagnostics

The first live QuantConnect LEAN 2.5.0.0.18188 run (2001-02-02) returned
`SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED`. The source adapter was not admitted,
no strategy historical P/L was measured, and no order was placed. The fixed
message did not identify where the failure occurred.

## New fixed-phase messages

The source reader now receives an optional observer that is invoked with
**literal stage names only**, never historical observations or exceptions. The
diagnostic logs exactly one of:

- `SPORTSEDGE_QC_RAW_HISTORY_SMOKE_PASSED`: the bounded raw request was parsed and
  reconciled; source remains NOT ADMITTED.
- `SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED_INPUT`: guard failed before API request.
- `SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED_REQUEST`: LEAN Python History call failed.
- `SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED_FRAME`: return object missing required
  dataframe shape or failed as iteration started.
- `SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED_INDEX`: incompatible date/symbol index,
  duplicates, missing or out-of-range observations.
- `SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED_OHLCV`: rejected raw OHLCV or volume.
- `SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED_FINAL`: empty or globally unordered observations.

A `BLOCKED` response means no result, not a claim of invalid brokerage keys.
The requested example remains a 2001 January daily SPY source probe, not a
2000–2011 full-market strategy backtest.

## Repeat the native diagnostic safely

1. In your existing SportsEdge-Stock-Research project, replace the code inside
   the existing `lean_history_source_v1.py` and `main.py` with the current
   versions from PR #78. Preserve a backup of `main.py`.
2. Save, click Build and Backtest once.
3. Send ONLY the fixed `SPORTSEDGE_QC_RAW_HISTORY_SMOKE_...` line. Never paste
   market prices, provider records, full private errors, or API credentials.
4. The subsequent engineering fix depends on the exact stage. Do not relax
   no-fill-forward, RAW normalization, cutoff, identity or historical completeness
   constraints just to obtain a PASS.

New offline fake-LEAN regression tests assert that source errors from the real
history call never appear in cloud logs; all diagnostic stage strings are bounded
constants and do not include proprietary data. Normal strategy research and
paper trading are untouched.
