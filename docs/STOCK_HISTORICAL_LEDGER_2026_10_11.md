# Stock historical backtest ledger — additive research milestone

## Purpose

Add the missing **deterministic historical portfolio accounting layer** for SportsEdge's frozen stock-momentum model.

This code replays **previously generated, immutable research signals** at later historical session opens. It records virtual cash, integer share counts, simulated buy/sell fills, explicit cost assumptions, supported splits, cash dividends, closing equity and worst drawdown.

**This is NOT yet a genuine measured historical stock return.** No trustworthy as-of stock prices, historical common-stock universe, delisted symbols or audited corporate-action coverage have been connected. Regression tests use imaginary prices and must not be quoted as financial performance.

## Inspected existing project

- PR #16: strict point-in-time daily-bar contract; no source authenticated.
- PR #18: stock-mom252-skip21-trend200-v1, monthly momentum rules, maximum 5 stocks, 10% per stock and 50% gross allocation.
- PR #19: hypothetical current-quote bid/ask execution planner, no orders or fills.
- PR #15: proposed separate $1,000 virtual stock study.
- Existing $10,000 site practice journal remains separate.

The new branch is based directly on PR #19. All existing research and site files were preserved.

## New files

- analytics/stock_historical_ledger.py: strictly historical, offline integer-cent replay and exclusive-create JSON CLI.
- analytics/test_stock_historical_ledger.py: fictional fixtures and rejection tests, exercising next-open fills, fees, splits, dividends, drawdown, chronology, duplicate signals, identities and impossible conditions.
- This documentation.

No old file was modified or deleted. No API credits, real-money orders, Supabase mutations, or deployments.

## Replay contract

The caller supplies a verified source envelope: provider and revision, raw OHLC prices, initial_cash_cents (100000 for a $1000 example), explicit fees and slippage, an externally audited corporate-action coverage declaration, and two or more chronological exchange sessions.

Every session includes a date, true timezone-aware opening/closing timestamps, a source-identified open and close for each held/traded symbol, and an explicit possibly empty corporate-action list. When a month-start decision is supplied, the signal MUST be the frozen stock momentum model output with a trusted published_at wrapper. Previous close must be strictly before model decision, publication must precede the next opening, and execution must occur only at that next opening. No same-close execution or future knowledge.

Every target is checked against 10% single-name and 50% gross limits. The engine derives whole shares from OPEN prices, sells reductions before buying, rejects unknown holdings or changing security IDs, refuses overspending, and values the remaining portfolio using that session's CLOSE only for reporting.

Conservative integer-cent cost rounding: simulated buy debits round up after slippage; sell proceeds round down after slippage. Per-fill fees must be explicitly supplied. Dividends apply to pre-split shares, and supported integer splits adjust share quantities. Unsupported fractional cash-in-lieu or missing delisting events stop rather than invent results.

The report contains per-session account values, simulated fills, net profit/loss and maximum drawdown, labeled EXPLORATORY HISTORICAL PRICE SCENARIO NOT VERIFIED EXECUTABLE. Benchmark remains unavailable until sourced.

## Test commands

    python -m unittest discover -s analytics -p 'test_*.py' -q
    python -m unittest analytics.test_stock_historical_ledger -v

Run with a **real vetted envelope later**:

    python analytics/stock_historical_ledger.py --input /path/to/source-envelope.json --output /path/to/NEW-report.json

It will not replace a preexisting report file.

## Release limitations

- This module does not create signals or authenticate source availability. Reconstructed historical signals cannot be represented as forecasts originally published in the past.
- Historical daily OPEN is a **proxy**; the archive might not establish that an actual bid/ask fill was accessible at the time.
- A real test needs licensed point-in-time data, delisted companies, ticker history, correct calendar/early closes, corporate actions, trade costs, independent benchmark and a sealed later evaluation period.
- Read-only Backtesting Center integration and production paper trades are separate future changes.
- Require passing CI and explicit review before merging. No model promotion or claims of profitability.

This is the stock testing infrastructure milestone, not a finished profitable stock algorithm.
