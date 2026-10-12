# SportsEdge stock research — Astra readiness and integration audit

Date: 2026-10-12. Status: **offline code-ready for a focused research review, NOT ready to claim investable stock returns**.

## First inspect: existing work and dependency chain

This milestone was based on PR #29, which inherits:

- PR #16: `analytics/stock_data_contract.py` — rigorous completed-bar schema and strict historical as-of visibility.
- PR #18: `analytics/stock_momentum_v1.py` — frozen 252-session, skip-21-session, positive 200-day trend, monthly 5-stock/2-per-sector/10%-per-stock/50%-gross strategy.
- PR #19: `analytics/stock_execution_planner.py` — pure paper-only bid/ask execution intents, owner-controlled scope and cents math. Does not persist or place orders.
- PR #27: `analytics/stock_historical_ledger.py` — monthly next-open scenario fills, shares, dividends/splits and daily virtual equity curve. Does not authenticate source data or recompute historical signals.
- PR #29: `analytics/alpaca_history_archive.py` — private optional, bounded read-only Alpaca history ARCHIVER, default zero-network plan. No authenticated real data has yet been downloaded.
- Separate PR #15: proposed $1,000 study/account, not merged into an active live trading account.
- Current production site: separate browser-local $10,000 manual practice journal. No broker trading is enabled.

Do **not** merge these stacked branches without reviewing dependencies, conflicts, and the two virtual-account accounting systems.

## What this PR adds

Only new files, with no changes to models, provider code, accounts, production or archived data:

- `analytics/stock_verified_signal_replay.py`: offline entry point that checks EACH historical frozen model decision by recomputing the entire original stock-momentum output from its provided as-of input envelope, **before** delegating to the historical portfolio ledger. This closes a correctness gap where edited target allocations could otherwise be supplied to the ledger while retaining the original signal ID. Its report always labels price availability, investability, universe and historical executions as **not independently verified**.
- `analytics/test_stock_verified_signal_replay.py`: genuine cross-module SYNTHETIC execution test: `stock_momentum_v1.generate` -> `stock_execution_planner.plan_run` -> `stock_verified_signal_replay.checked_replay` -> `stock_historical_ledger.replay`. Same synthetic open prices, bid=ask, same slippage and fees, so whole-share choices, debits, cash, projected account equity and final positions must be identical. Tests also reject tampered targets, source fields, future knowledge, missing evidence and backdated publication.
- This document.

All simulated companies AAA/BBB, dates, values and quote prices are **fictional unit fixtures**. Any resulting cash change (positive or negative) is a calculator test, **not a stock backtest return from historical markets**. No model performance is asserted.

## Data purchase decision

Official Alpaca primary sources:

- Market data subscription: https://docs.alpaca.markets/us/docs/about-market-data-api — the Basic plan is currently advertised as **free**, with IEX-only real-time US equities coverage, a 15-minute limitation, 200 historical calls/minute and historical data starting 2016; paid Algo Trader Plus offers consolidated US market coverage (verify price and entitlements before spending).
- Stock bars: https://docs.alpaca.markets/us/reference/stockbars — Alpaca's historical daily bars can return raw data and symbol mapping `asof`, but neither of these constitutes proof of what a particular trade could have known and accessed then.
- Stock symbol mapping FAQ: https://docs.alpaca.markets/us/docs/market-data-faq — a present-day surviving ticker may map earlier tickers, **not** automatically include delisted firms or the contemporaneous investable universe.

**No payment is required to run code tests or to prepare Astra's review.** Free Alpaca Basic may permit later small IEX-only smoke tests with the owner's own credentials after the owner opts in, but cannot by itself establish a full-market, survivorship-free trading ROI test. Not all research requires immediate paid SIP; verify the utility and licensing of any paid data FIRST.

## Trust boundaries that still matter

1. Authentic point-in-time **eligible stock universe**, including firms removed or delisted; exchange/sector/security ID snapshots known before each decision.
2. Historical raw OHLCV with a verified source, calendar and publication timing, separate from the market-data acquisition date and tickers currently surviving.
3. Historical dividends, splits, mergers, renames, delisting returns, cash in lieu and event timing. No invented settlement or forward fill.
4. Genuine historical bid/ask or a conservative preregistered NEXT-open fill proxy with explicit slippage, fees and liquidity limits. The scenario fill is not proof of executable brokerage orders.
5. Separate prospective stock account with integer cents, immutable receipts, double-run prevention, owner authorization and an independent total-return benchmark; do not mix with the browser-local practice journal or NBA wagers.
6. Freeze strategy/cost choices on development periods, then use validation and untouched test periods; compare drawdown, total-return benchmark and uncertainty.
7. Authentic source license and approved access to display or retain provider data in SportsEdge.

A result cannot be promoted as profitable based on an after-the-fact ticker list, claimed availability fields, or synthetic marks. Original `stock_momentum_v1.generate` marks all emitted signals as not independently verified, and the wrapper retains this distinction.

## How to test locally

    python -m unittest analytics.test_stock_verified_signal_replay -v
    python -m unittest discover -s analytics -p 'test_*.py' -q

The offline CLI accepts a JSON envelope with exactly `replay_input` (the existing ledger contract) and `signal_evidence` (one record per decision: `signal_id` plus the original `generate_args`). Output is new-file-only, refuses overwrites:

    python analytics/stock_verified_signal_replay.py --input existing-reviewed-envelope.json --output NEW-audit-report.json

It does not fetch historical prices, trade shares, or alter a Supabase account.

## Astra Work handoff

**Next appropriate focused Work mission:**

> Inspect SportsEdge PRs #16, #18, #19, #27, #29 and the latest stock cross-module integration work. Independently audit the frozen momentum model's mathematics and implementation, no-lookahead assertions, action handling, account risk limits and selection biases. Identify one defensible candidate improvement if justified. Verify the full synthetic model -> planner -> historical ledger pipeline. Do not claim stock ROI yet: no authentic point-in-time data or historical universe is connected. Produce a no-cost source feasibility and cost-benefit plan for valid historical stocks and eventual untouched evaluation. Preserve every earlier study, and do not buy data, deploy, merge or place real or paper orders without explicit authorization. Deliver one tested isolated milestone and a written handoff.

Astra can start this **structural/model audit without paid datasets**; a numerical historical trading ROI study must wait until independently verified data becomes available.

## Release gates

PR remains draft. CI Python, Node, lint, build and provider-contract tests must pass; no existing files are overwritten. All research changes remain staged, not deployed on production. A final independent as-of source and eventual preview/owner verification are still necessary before stock paper trading.
