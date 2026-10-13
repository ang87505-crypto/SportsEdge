# SportsEdge — Stock data contract & Astra handoff
**Date:** October 9, 2026

**Milestone:** Provider-neutral data validation only. No data collection, strategy, trade execution, database changes, or model-performance claims.

## Verified project context

The production Stocks page has a **$10,000 manual, browser-local** practice journal. Draft [PR #15](https://github.com/ang87505-crypto/SportsEdge/pull/15) contains a separate, **empty $1,000 stock testing ledger** with auditable integer-cents/FIFO accounting and assumed transaction slippage. Draft [PR #14](https://github.com/ang87505-crypto/SportsEdge/pull/14) is a separate 100 × $10 NBA sports-paper experiment. Do not combine the cohorts or treat either new test as having placed trades.

**No stock market-data feed, automated stock-selection model, verified live stock fills, or stock investment return has yet been established.**

## New stock data interface

The additive Python module **analytics/stock_data_contract.py** accepts a JSON object with:

- Header: asset_class = us_equities; timeframe = 1d; currency = USD; price_adjustment = raw; nonblank provider and source_revision; timezone-aware retrieved_at.
- bars: between 1 and 100,000 daily completed raw-price observations, each with symbol, session_date (YYYY-MM-DD), status = complete, timezone-aware completed_at and available_at, string-valued decimal open/high/low/close, nonnegative integer volume.
- No duplicate symbol/session pairs; prices must be positive finite decimal text (six places maximum) and OHLC must have a coherent high/low range.
- A valid exchange session date uses **America/New_York**, not an assumed UTC midnight. The completion timestamp must be on that local day no earlier than 9:30 a.m., the announced availability cannot precede completion, and retrieval cannot predate availability. Weekend sessions fail closed.
- **visible_at(dataset, decision_at)** exposes only bars with available_at strictly earlier than the modeled decision. At the exact publication timestamp, the bar is withheld. It refuses to simulate decisions after the retrieved snapshot.

### Contract example — entirely synthetic, NOT a genuine market observation

    {
      "asset_class":"us_equities", "timeframe":"1d", "currency":"USD",
      "price_adjustment":"raw", "provider":"synthetic-test-only",
      "source_revision":"synthetic-v1", "retrieved_at":"2026-10-10T00:00:00Z",
      "bars":[{
        "symbol":"TEST", "session_date":"2026-10-09",
        "status":"complete", "completed_at":"2026-10-09T20:00:00Z",
        "available_at":"2026-10-09T20:01:00Z",
        "open":"20.00", "high":"22.00", "low":"19.00",
        "close":"21.50", "volume":1000
      }]
    }

This is only a schema example, not a verified price and not an example trading signal. The contract does **not** independently authenticate provenance, actual as-of publication times, exchange holidays, early-close calendars, corporate actions, split/dividend handling, symbol delistings, or historical availability. Those require real data source verification. Any real importer must archive source IDs, response hashes, immutable revisions, licensing rights, adjustment methodology and provider timestamps.

### Run tests (no provider API usage or fees)

    python -m unittest discover -s analytics -p 'test_*.py' -v
    python analytics/stock_data_contract.py path/to/verified_source.json --as-of 2026-10-09T20:15:00Z

**analytics/test_stock_data_contract.py** contains **11 deterministic tests** with wholly synthetic fixtures, covering duplicates, invalid prices, missing timestamps, noncompleted sessions, USD/raw invariants, and no-lookahead visibility. Tests passing **do not** establish data-source authenticity or an economic edge.

## Avoid fake backtest fills

End-of-day OHLCV data alone is not an executable price. A model that sees a completed close cannot assume it could have bought at that very close. Backtesting must use time-safe signals, the next valid fill opportunity, independently sourced bid/ask or a conservative execution proxy, realistic costs, a reproducible eligible-universe definition, delisted securities, splits/dividends, and an appropriate market benchmark.

For future connection, the free **Alpaca Basic** equity feed uses the **IEX-only** market view rather than the complete US consolidated tape. Verify delayed/historical plan terms and permitted data displays before integration; do not buy or configure plans in this milestone. Source: https://docs.alpaca.markets/us/docs/about-market-data-api

## Handoff to Astra

1. **NBA (primary):** reproduce the existing 2,460-game retrospective NBA Elo metrics. Inspect lookahead/independent sources/calibration/out-of-sample tests. Investigate one defensible improvement. No betting ROI without matched contemporaneous sportsbook odds.
2. **Stocks (secondary):** design and implement **one understandable, deterministic baseline stock-selection strategy**, initially against synthetic unit tests for the above as-of interface. Prefer a prior-only trend/momentum benchmark or comparable simple baseline. Freeze signal timing, eligible universe, costs, rebalance policy and holdout protocol before any fit. Do not claim measured historical or forward returns unless a verified licensed price snapshot and unbiased security universe exist.
3. Stop after independent tests, a clear report and an explicit next milestone. Preserve everything already in main and open PRs; discuss old-file modifications and request user approval first.
4. Keep stock algorithm code and NBA code on **separate branches/milestones**; never conflate virtual stock positions with sportsbook wagers.

## Separate engineering follow-up (not part of Astra)

Connect a permitted stock price provider server-side, archive actual source records, verify exchange time semantics and holidays, and then wire authenticated price+signal records into the isolated $1,000 stock study (PR #15). Keep the existing manual $10,000 browser journal intact. Add an optional AI-language explanation layer only after the data/model audit; treat it as commentary, not a source of prices or a trade execution authority.

## Verification gates

- Local Python tests passed (11/11 in this standalone module); CI must independently pass Python analytics, Node, lint, Next.js build and typecheck on the review branch.
- PR stays **draft, unmerged** until reviewed. No new paid provider calls, API keys, trading accounts, Supabase writes, or production deployment are authorized.
- No model is represented as profitable merely because a retrospective winner-prediction accuracy is high.
