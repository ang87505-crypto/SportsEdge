# First deterministic stock selection baseline — 2026-10-09

Status: **working mathematical/decision module with synthetic tests; historical and forward performance UNMEASURED; no orders or fills.**

Version: `stock-mom252-skip21-trend200-v1`.
Branch: `research/stock-momentum-baseline-20261009`, based on PR #16 head `46d7de25827fef0618a8287405d3af5611f96f0a`, not merged into main. The draft PR targets #16's branch so its diff contains only three NEW files. Review dependency #16 first; retarget onto main only after that dependency is accepted. PR #15 is inspected but not imported or changed. NBA audit PR #17 is separate.

## New code and commands

- `analytics/stock_momentum_v1.py`: pure, deterministic total-return signal construction, monthly target selection, content-hashed signal IDs and explicit-cost whole-share sizing. No network, DB, brokerage or automatic trade writes.
- `analytics/test_stock_momentum_v1.py`: 17 synthetic tests (fixture securities/prices/calendars are fictional, never performance data).
- This document.

```sh
python -m unittest discover -s analytics -p 'test_*.py' -q
python analytics/stock_momentum_v1.py --input /path/to/verified-input-envelope.json --output /tmp/new-signals.json
```

Local full suite: **111 tests passed** (83 main + 11 PR #16 + 17 new). The first split test compared equivalent Decimal strings `1.155` and `1.1550`; corrected the new test to compare exact numeric Decimal values. No source data or old files were modified. Command-line output uses exclusive creation to refuse overwrites.

## Frozen strategy specification

The baseline uses momentum rather than a fit-heavy model because it is interpretable and has no trained coefficients. Prior 2–12 month return is a documented research construction in Kenneth French's data library; this daily-session approximation is NOT a replication of that factor or evidence of an investable edge.

Eligible universe supplied to the model: a **point-in-time, complete snapshot** of US-listed NYSE/NASDAQ/AMEX common stocks with at least 253 completed trading sessions, stable security IDs and as-of sector classifications. Exclude ETFs, preferred stock, ADRs, OTC, warrants, funds and leveraged products in the upstream audited classification. The code admits only `type=common_stock` and the listed exchange labels; those labels must be independently verified. Do not populate this universe with today's survivors, a hand-picked list of winners or current index constituents. IPO seasoning must be determined using information available then. Symbols must be mapped to stable IDs across changes; ticker changes inside a window require a verified continuous mapping, not silent omission. Halt on unsupported delisting/corporate restructuring of an existing holding.

At the first exchange session of each new month, after the prior month's final close has become available and **strictly before** the next open:

1. Take exactly 253 consecutive completed exchange sessions T-252 through T, using PR #16 `visible_at` (availability strictly less than decision time). Require a real exchange calendar, not a weekday approximation. Missing bars fail the batch closed, with no forward filling, stale liquidation or selective dropping.
2. Construct total-return wealth index W from raw closes C, split ratio s (new shares per old share), and cash dividend d **per one prior-session share**: W_t / W_(t-1) = (s_t*C_t + d_t) / C_(t-1). d=0 and s=1 are permitted ONLY under explicit complete corporate-action coverage. On simultaneous splits/dividends the provider must normalize dividends to old-share units. Reinvestment at ex-date close is a signal convention, not cash available for a real fill.
3. Momentum = W_(T-21) / W_(T-252) - 1. This deliberately excludes the most recent 21 sessions. Require momentum > 0 and W_T > mean of last 200 W observations.
4. Require latest raw close >= $5 and mean(raw close * daily volume) over last 20 sessions >= $20 million. These are frozen research liquidity screens, not execution guarantees. Raw close*volume is an approximate daily turnover statistic. Use a consistent feed; partial-exchange volume needs separate validation.
5. Rank descending momentum, break ties alphabetically by symbol. Select at most five, with at most two per as-of sector.
6. Each chosen name targets floor(equity_cents/10) cents, i.e. at most 10%. Maximum intended gross stock exposure is 50%; the remaining 50% or more is cash. Fewer passing names means more cash. No leverage, shorts or redistribution of missing slots.
7. Existing holdings not selected emit EXIT targets (budget zero). Chosen holdings emit TARGET budgets for rebalancing, so overweights are reduced and underweights increased at the next approved execution opportunity. No intramonth discretionary stops or lookahead high/low triggers. Trend failure or exclusion causes exit at the next monthly decision. There is no guarantee on loss or drawdown between rebalances.

For the proposed $1,000 study this means up to five $100 budgets, leaving at least $500 cash before execution. Whole-share constraints may leave additional cash or prevent buying an expensive name. These caps apply at rebalance; prices may drift beyond them during the month. Execution must recheck current equity/exposure and available cash.

## Inputs / corporate actions / no-lookahead

`generate(payload, context, *, decision_at, equity_cents=100000, held_symbols=())` returns a JSON-compatible object. The CLI takes an envelope with those argument names.

`payload` is the unchanged PR #16 `parse_daily_bars` input (raw USD daily bars with provider, source_revision, retrieved_at, completed_at and available_at). Adjusted vendor prices are not accepted as raw. The stock model neither authenticates a provider nor treats a timestamp string as proof of historical knowledge.

Required `context`:

| Field | Meaning |
|---|---|
| calendar_revision, calendar_available_at | Pinned exchange calendar provenance, known before decision |
| sessions | Ordered complete list of at least 253 past sessions plus next session: date, open_at, close_at; timestamps with timezone |
| universe_revision, universe_available_at | Pinned point-in-time security-master snapshot and availability |
| universe_session | Prior month-end final session, must match last completed session |
| universe | List of symbol, security_id, sector, type=common_stock, exchange; unique tickers and IDs |
| actions_revision, actions_available_at | Pinned corporate-action snapshot and its availability |
| actions_complete | Must explicitly be true after external coverage audit; not a substitute for that audit |
| actions_coverage_start/end | Coverage encloses the entire 253-session lookback |
| actions | List: symbol, session_date (effective ex-date), available_at, split_ratio (decimal text), cash_dividend_per_old_share (decimal text), source_id |

At most one aggregated action record per symbol/effective session. Future effective actions are excluded. Relevant action records unavailable at the cutoff cause rejection. Every historical bar must be available and cannot be marked complete before the supplied session close. Holidays, early closes, exchange halts and actual publication times depend on independently correct provider/calendar records. Coverage declarations can be false: synthetic tests validate semantics, not truth. Store original files/hashes, licenses and revision history separately. Later corrections to old data can alter signals; preserve the originally generated signal and its source snapshot rather than rewriting it.

`signal_id` and `input_digest` hash the mathematical inputs, as-of context, exact relevant closes/volume/times, calendar window, positions, equity and version. Appending valid unseen future bars cannot change decisions or their IDs. `source_revision` is preserved separately for provenance. `decision_at` is a modeled cutoff, NOT proof of publication. The production adapter must persist a separate server-authenticated `signal_published_at` before execution. No stock results, prices or trades are bundled by this PR.

## Execution and PR #15 integration boundary

Signals are targets, not fills. Earliest execution is the **next supplied exchange open**, strictly after the signal. Do not buy at the close used to calculate it. A future adapter should sell reductions first, reconcile actual available virtual cash, then size buys using fresh source quotes and fees. A missing/untradable quote defers the affected order; never substitute an invented open or stale closing price. Do not partially consume a failed signal batch without a reviewed policy.

`sized_shares(budget_cents, price_text, *, slippage_bps, fee_cents)` uses Decimal with fixed precision and conservatively rounds total debit upward. It has **no default cost assumption**. It is a proposed BUY sizing helper only; it is not a portfolio ledger or fill model. No price staleness/source verification is implied by passing a numeric price. Caller must recheck cash, mark-to-market equity, security eligibility and execution price limits.

PR #15 separately supplies integer-cents FIFO accounting and freezes 10 bps slippage. That is a scenario assumption, not proven execution. Its whole-share, cents-only quote format, 60-second freshness rule and post-registration timestamp requirements remain intact. It has no dividend/split/fee event support and cannot yet account for this model's full historical return path. **Do not feed unadjusted splits/dividends through its buy/sell ledger as fabricated trades.** Separate approval is needed for a new ledger version or additive corporate-action/fee adapter. Do not change the frozen study or reinterpret past events. Current synthetic sizing deliberately does not claim parity with #15's 10-bps half-up fill arithmetic.

## Chronological historical evaluation protocol (NOT yet executed)

Freeze version and this protocol before fetching strategy returns. Do not tune the 252/21/200 lookbacks, 10% caps or liquidity rule on the final test.

- Proposed data span: 2010–2025. Use 2010 only for warmup; 2011–2018 development/data QA; 2019–2021 validation and cost-model feasibility; 2022–2025 sealed test. These are proposed windows, not loaded observations. If complete licensed point-in-time coverage is unavailable, choose and document replacement windows BEFORE examining strategy returns. Dates alone do not make a previously inspected dataset untouched.
- No fitted strategy coefficients. Any later parameter or cost-model selection must use development/validation only and receive a NEW version. Open the sealed test once after code, provider corrections policy and costs are frozen. Results remain simulated historical results, not forward orders.
- Monthly walk-forward universe including delisted stocks, listing dates, ticker/security-ID changes, historical sectors, true delisting returns and point-in-time price/action availability. Include dividends, splits, spin-offs and other distributions correctly; unsupported events halt the evaluation rather than quietly removing losses. Delay dividend spendability to payment date in the ACCOUNT ledger; ex-date wealth is only a SIGNAL/benchmark convention.
- Next-session execution with a verifiable executable quote or explicitly labeled next-open proxy. Price gaps enter through actual next-period data. Next-open price availability belongs to execution, never signal construction. Avoid assuming every opening auction fills the requested size.
- Costs must be security/date-sensitive where spread and liquidity data exist: observed half-spread plus modeled market impact, commissions and applicable fees. If only daily data exist, report labeled scenarios at 10/25/50/100 bps per side PLUS explicit fees, and reject illiquid cases instead of treating these as validated upper bounds. Examine participation as order notional / trailing turnover; cap at 0.1% for any future larger account adapter. Do not imply 10 bps suffices. Handle nonfills/halts, turnover and opportunity cost.
- Benchmarks on identical dates/cashflows and corporate-action conventions: verified broad US equity total-return buy-and-hold (e.g. an appropriate investable ETF with actual inception/fees) and a risk-matched 50% market / 50% cash monthly-rebalanced benchmark. Also report all-cash. Use sourced cash yield or explicitly zero, consistently across strategy and benchmarks.
- Daily marked-to-market equity; total return, CAGR, daily volatility, excess-return Sharpe (sourced risk-free series or explicitly zero), worst drawdown max(1-equity_t / running_peak_t), drawdown duration, turnover, exposure, trade count, sector exposure, cost totals and annual results. Include residual positions and liquidation costs at endpoint or disclose mark-to-market convention. Never compute ROI from realized trades alone while excluding unrealized losses.
- Paired strategy-minus-benchmark returns with month/block resampling for uncertainty; sensitivity across market regimes and cost scenarios. No shuffled folds, repeated holdout tuning or cherry-picked start dates. Confidence intervals do not remove survivorship or execution bias.

Historical performance remains **unmeasured** because the inspected repository/DB contain no usable licensed stock-price + corporate-action + historical-universe dataset. Synthetic unit tests establish calculations and timing only. No subscriptions or paid API calls were made. No claim of future profit is justified.

## Routine development next milestone

Review #16 and this additive module. Acquire a permitted, immutable provider snapshot with a real calendar, security master including delistings, point-in-time action coverage and price-availability semantics. Validate one historical month end-to-end without changing the study ledger. Then implement the separate chronological execution/equity simulator and benchmark adapter from the frozen protocol; inspect source completeness before opening the holdout. Forward integration follows review of authenticated signal publication and PR #15 corporate-action/fee limitations. Keep the manual $10,000 journal, separate $1,000 study and NBA records independent.

Primary methodological reference inspected: Kenneth R. French, “10 Portfolios Formed Monthly on Momentum,” https://mba.tuck.dartmouth.edu/pages/Faculty/ken.french/Data_Library/det_10_port_form_pr_12_2.html (prior 2–12 month construction). SportsEdge's daily approximation, screens, weights and results are separate. Time-ordering reference: https://scikit-learn.org/stable/modules/cross_validation.html#time-series-split.
