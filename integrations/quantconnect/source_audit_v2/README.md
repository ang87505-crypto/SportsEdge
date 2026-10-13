# Raw-history coverage diagnostic v2

**DIAGNOSTIC ONLY. No genuine portfolio backtest or strategy performance.**

In the existing **SportsEdge-Stock-Research** project, back up the current file,
then paste this directory's `main.py` as the project's `main.py`. No supporting
imports are needed beyond LEAN's AlgorithmImports and Python's standard library.
Run Backtest once. Record engine version/branch, dataset generation and run ID.
Do not enable live trading. No QuantConnect API token is necessary for manual runs.

The algorithm requests raw, unfilled regular-hours daily bars for **every**
member supplied by each monthly fundamental callback, in batches of 32, at
08:00 New York. The range is 2000–2011 with preceding history. No price,
liquidity or current-index-membership shortcut removes securities. The batch
size controls temporary memory, not the universe. It checks missing, duplicated,
nonfinite, late and filled-forward rows against a 253-session SPY calendar proxy.
It distinguishes completion from source admission: neither zero gaps nor a
completed traversal admits the source. Unknown short history is unresolved;
it is not automatically classified as an IPO. Only one explicit subscription,
SPY, is added; no stock order function exists.

Cloud runtime has NOT been executed. Offline mocks check traversal and error
behavior, not Python.NET overload resolution, callback scheduling or vendor
semantics. A same-day universe callback must precede the 08:00 audit. If not,
the run stops, rather than using later data. The 550-calendar-day fetch window
is a bounded engineering buffer; insufficient 253-session warmup stops the run.
SPY history is not independent evidence of exchange holidays/halts. A daily
bar's EndTime is not independently verified publication availability. Raw mode
is requested but corporate-action reconciliation is still absent.

All source values and aggregate counts stay in cloud memory (`_audits`).
No dataset exports, screenshots, log interpolation, Object Store downloads,
HTTP transmissions, or performance output. Final log is deliberately static:
`SOURCE_NOT_ADMITTED; PERFORMANCE_NOT_MEASURED; DATA_EXPORT_DISABLED`.
A flat broker NAV is NOT a measured zero strategy return. For a stopped run,
inspect the failure within cloud; share only non-data compiler/runtime errors.

QuantConnect currently documents B-MICRO as 2 cores and 8 GB RAM. Full-universe
history over 144 months can still exceed runtime/download resources. No cloud
runtime or peak-memory measurement exists. If it fails, retain the failed run;
do not switch to today's constituents or truncate the universe. Optimization
must preserve complete traversal. Diagnostics do not solve absent event data.

Before real replay: independently reconcile dated membership/delistings,
sector/type/exchange and IPO dates; source revisions/publication times;
consolidated volume; raw split/dividend conventions; actual payable dates,
mergers, spin-offs, terminal recoveries and cash-in-lieu; opening/halts;
settlement and benchmark histories. Then connect PR #43 accounting to PR #45
selection under the frozen protocol. Do not open 2012–2025 return outcomes.

Run tests: `python -m unittest discover -s integrations/quantconnect/source_audit_v2 -v`
