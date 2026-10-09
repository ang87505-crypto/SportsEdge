# $1,000 forward stock paper-trading experiment
**Registration:** 2026-10-09. **Study ID:** `stock-model-paper-1000-v1`.

## Scope and current factual status

The user requested **$1,000 worth of stock paper testing** alongside (not instead of) the separate proposed **100 × $10 NBA paper-betting experiment**. These virtual funds are **not connected**, are **not real money**, and are not a transfer from the existing stock page or sports accounts.

The production Stocks page (`/stocks`) already has a manually entered, browser-local `$10,000` virtual journal. Its storage key is `sportsedge-stock-journal-v1`. That account has **not been reset, funded, altered or imported**. There is no automated stock-selection strategy, provider-verified live stock feed, broker simulation, or independent market-price ledger in the deployed SportsEdge stock module. A GitHub PR advertising access to Alpaca's external paper website is not a connected Alpaca account.

This independent study instead reserves **$1,000 in a new, currently empty research fixture** with immutable simulation assumptions, rigorous source/timestamp checking and deterministic cash accounting. **Recorded trades: 0. Unrealized P&L and return: not measured.** No claim of a buy, sell, profitability or execution is made.

## Frozen experiment settings

- Initial virtual cash: **100,000 cents ($1,000)**. No leverage, short sales, deposits or withdrawals.
- Stock test order count is not preselected: this is a **$1,000 starting-capital study**, not a promise of 100 × $10 stock orders. A whole-share stock may cost more than $10.
- Simulated long-only, whole-share buy/sell event ledger. Preserve `event_id`, ticker, side, shares, reference quote (integer cents/share), quote ID, HTTPS provider source, quote observation time, strategy version, signal ID, signal publication time and order recording time.
- Only events after study registration, at most 60 seconds after the referenced price observation, before the evaluation `as_of`, and never before the strategy signal. Events must be strictly chronological and IDs unique.
- Deterministic **10 basis points (0.10%) of assumed slippage per transaction**, rounded half-up to whole cents on the total notional. This is **a stress-test assumption**, not measured stock-market execution quality or guaranteed available prices. Explicit provider fees, spread impact, dividends, borrowing, splits, corporate actions and taxes are not modeled, and performance estimates must disclose these omissions.
- Cash must be sufficient for the entire paper purchase including assumed slippage; partial sales use first-in-first-out (FIFO) cost-basis accounting with integer-cents allocation. No dividend, stop, split or mark-to-market claims are generated automatically.
- Distinguish `cash_cents`, `open_cost_cents`, `realized_pnl_cents` from **unrealized P&L**, **portfolio market value**, and **portfolio return**, all of which remain `null` without independently verified market observations.
- Do not treat source-shaped JSON fields as authentic stock quotations: external price/signal provenance is **not independently verified by this offline evaluator**. Test fixtures in unit tests are synthetic and never part of the study record.

## New files; nothing overwritten

- `analytics/stock_paper_study.py` — audit-only, no database/network access, deterministic FIFO accounting and quote/time validation
- `analytics/test_stock_paper_study.py` — synthetic test vectors, no real orders; includes zero-observation integrity checks
- `src/data/research/stock_1000_forward_study.json` — **empty** research account with 100,000 cents and zero events
- This document — research protocol, limitations, and next steps

Run (requires no API quota, secrets, provider account, payment or network):

```bash
python -m unittest discover -s analytics -p "test_*.py" -v
python analytics/stock_paper_study.py src/data/research/stock_1000_forward_study.json
```

Expected empty study: `cash_cents=100000`, `recorded_events=0`, `open_cost_cents=0`, `realized_pnl_cents=0`, `portfolio_return=null`.

## Next independent milestone, not implemented

1. Design a **separate protected** equities data/strategy signal store. Obtain an official or licensed stock data source and validate quote delay, coverage, symbol adjustments, rates, and data display rights before paid calls. Secrets remain server-only.
2. Implement a small, prospective, reproducible **baseline stock strategy**, or import versioned signals from a separately audited model, with proper timestamped input. Define eligible stocks, liquidity, rebalance schedule, risk limits, market hours, and stop rules **before** observing outcomes.
3. Build a **server-side** simulated execution service with a real immutable quote ID linked to a provider response, idempotence, and an authoritative fixed-$1,000 cash ledger; independently evaluate slippage, fills and corporate actions. Do not create orders just to fill a numerical sample count.
4. Add source-verifiable market valuation and benchmark comparison, with time-weighted returns, drawdown, actual simulated P&L, exposure, trading costs and out-of-sample diagnostics. No real-money trading.
5. Once tested on a separate branch and approved, connect the new read-only study dashboard to the existing `/stocks` UI without resetting or replacing the browser-local `$10,000` practice journal.

## Isolation

Do not rewrite `src/lib/stocks/journal.ts`, `src/app/stocks/page.tsx`, any NBA/EPL model/position/RPC, or Astra's other branches without prior review. Do not merge a study as a claim that an automated strategy or stock broker has been deployed. The user requested a test, not fictitious filled orders.
