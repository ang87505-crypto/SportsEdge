# Alpaca archive → historical research evidence bridge (2026-10-17)

## What is implemented

The merged `analytics/alpaca_history_archive.py` stores immutable source pages,
per-page hashes, the request plan, and a combined revision hash. This research
branch adds `analytics/alpaca_archive_bridge_v1.py`, an **offline-only** bridge
that validates those archived pages and extracts raw per-symbol daily OHLCV
observations into a deterministic, explicitly unadmitted evidence file.

The bridge:

- Rechecks the original archive identity, request plan, page hashes and entire
  archived source digest. Absent source pages and unfinished pagination fail.
- Reuses the original archive bar validator to check daily OHLCV, bounds,
  timestamps and duplicates; records exact page hashes per observation.
- Reports the observed-date union and apparent symbol gaps for review, not
  assumed exchange closures or proof that a security did not exist.
- Counts source corporate-action categories without declaring the events
  complete, historically known, or correctly settled.
- **Does not invent `available_at`, `completed_at`, stable security IDs,
  as-of universe membership, exchange calendars, action dates or returns.**
- Makes no Alpaca API calls, does not require keys, does not touch Supabase,
  never places broker orders, and does not alter the frozen strategy.
- Refuses to overwrite a prior result file.

The result deliberately has `historical_backtest_ready=false`,
`research_signal_admitted=false`, and `performance=null`. Archive-page
consistency **does not independently authenticate** Alpaca's response, rights,
historical availability, point-in-time classification or corporate action
coverage.

## Reproduce (no credentials, no network)

From repository root:

```bash
python -m unittest analytics.test_alpaca_archive_bridge_v1 -v
python -m unittest analytics.test_alpaca_history_archive -v
python -m analytics.alpaca_archive_bridge_v1 --archive /private/alpaca-source.json --output /private/alpaca-evidence-new.json
```

For an authorized provider data collection, first use the existing
`analytics/alpaca_history_archive.py` documented in
`docs/STOCK_ALPACA_HISTORICAL_ARCHIVE_2026_10_11.md`. Do not paste keys into
ChatGPT, embed credentials in GitHub, or commit licensed raw market data.
The existing archiver has explicit bounded-request network opt-in.
Run this bridge against its local JSON archive; the bridge itself is offline.

## What Opus and Astra are NOT asked to rewrite

- Existing Alpaca owner, one-order broker, and staging code.
- The baseline `stock-mom252-skip21-trend200-v1` mathematics.
- Astra's forward-paper code on PR #67.
- The frozen development, validation and sealed research protocol of PRs #43,
  #50 and #53.

This is deliberately a separate research PR based on `main`, with no PR
dependency on Opus's recurring PAPER executor.

## Exact remaining blockers to honest strategy backtesting

1. Independently reviewed historical source rights/retention and data feed.
2. Actual exchange calendar, bar completion/publication availability mapping.
3. Complete PIT universe, security master, listings, sectors and ticker reuse.
4. Source action coverage, split/dividend payable timing, delistings and mergers.
5. Review of execution price/volume proxy, settlement and trading costs.
6. A benchmark and an admitted strategy replay using the **unchanged** frozen
   selection rules, reporting after-cost results and a separate holdout phase.

The original 2000–2011 protocol is not satisfied by Alpaca's recent data range;
a recent-data exploratory study must be separately registered and labeled. The
bridge is a real engineering step toward that study, **not a completed backtest**
and not permission to activate paper orders.

## Suggested cross-review by Claude Opus

Review source-page provenance assumptions, missing-page/duplicate behavior,
possible false inclusion of revised action records, and whether the existing
archive accurately captures all provider pagination. Add failing regression
tests before suggesting minimal corrections. Never loosen the source-admission
gates merely to display performance.
