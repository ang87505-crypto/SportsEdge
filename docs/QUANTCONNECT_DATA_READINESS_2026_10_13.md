# QuantConnect historical-universe diagnostic — 2026-10-13

**Research-only, no orders and no historical strategy return claims.**

This milestone extends the existing QuantConnect research-port PR #45 without changing the frozen momentum baseline, hold-rank-ten candidate, registered study periods, accounting kernels, or strategy performance artifacts.

## What was implemented

- `integrations/quantconnect/main.py` remains a **single-file LEAN research diagnostic**, not a trading algorithm.
- Monthly first-SPY-session fundamental-universe callbacks summarize historical feed coverage over January 2000 through December 2011 (144 target months). Warmup/skipped months are detected internally as missing; no dataset-derived counts are exported.
- In-cloud internal aggregates (not logged or exported) include total supplied records, missing and duplicated symbol identifiers, missing fundamental data/sector, invalid price and dollar-volume fields, and records with these core fields present.
- No market observations, tickers, security identifiers, proprietary source rows or derived coverage counts are logged or exported. Only static status strings appear in logs. The only subscription explicitly added is SPY. Universe callback always returns `[]` to avoid selecting a partial market or exceeding free-node memory. No market orders, paper orders, real orders, or automated notifications.
- `test_cloud_diagnostic.py` verifies these behaviors with synthetic mocked QuantConnect objects; Python-only tests do not prove cloud API/runtime compatibility.

## How the owner runs it (once)

1. In the existing QuantConnect project **SportsEdge-Stock-Research**, back up the current `main.py`.
2. Replace only that project file with the content of `integrations/quantconnect/main.py` from PR #45. Do not create another project, or paste API credentials.
3. Run **Backtest** once. Despite the QuantConnect UI term, the code is a *metadata coverage audit* that sends no orders.
4. The results **Logs** show only static messages such as `SPORTSEDGE QC: INTERNAL DIAGNOSTIC COMPLETED`. Keep internal source-coverage counts in QuantConnect Cloud. Do not screenshot, copy, scrape or transmit its dataset information.
5. If QuantConnect reports a compile/runtime error, report its non-dataset diagnostic text rather than modifying frozen trading rules to suppress it.

Expected final status is **SOURCE_NOT_ADMITTED / PERFORMANCE_NOT_MEASURED** even if 144 monthly callbacks are present and zero metadata gaps are observed. The historical fund universe is only one vendor dataset and is not proof of complete dated NYSE/NASDAQ/AMEX common-stock membership. Morningstar sector data, source vintage, historical availability and permanent ID semantics require independent review. The `Fundamental.dollar_volume` field is **not** the frozen 20-session consolidated dollar-volume calculation.

## What still blocks real backtesting

- Independently verify all dated listed and formerly listed securities, including first trading dates, classification and exchange history, source revisions, and historical publication times.
- Obtain license-compliant raw full-universe OHLCV and 253-session warmup, with consolidated volume and dividends/splits normalized once.
- Map LEAN's delisting, merger, spinoff and fractional entitlement handling to the full SportsEdge accounting contract before admitting any historical return path.
- Reconcile exactly two frozen strategies, identical $1,000 accounts, monthly next-open proxies, 15/25/50-bp cost scenarios, settlements, benchmarks, and dated drawdown/uncertainty metrics.
- Keep validation (2012–2016) and sealed test (2017–2025) unopened until the protocol gates permit.

The source diagnostic is **not** a QuantConnect authenticated API connection and no backtest results flow automatically to the SportsEdge website yet. QuantConnect's October 2026 data terms prohibit exporting underlying market, fundamental and reference data directly or indirectly, including via logs/screenshots/API. Ordinary backtest summary results are permissible only when not used to reconstruct source values. See https://www.quantconnect.com/terms/ and https://www.quantconnect.com/docs/v2/cloud-platform/security-and-ip.

Official documentation:
- https://www.quantconnect.com/docs/v2/writing-algorithms/universes/equity/fundamental-universes
- https://www.quantconnect.com/docs/v2/writing-algorithms/universes/settings
- https://www.quantconnect.com/docs/v2/writing-algorithms/securities/asset-classes/us-equity/corporate-actions
