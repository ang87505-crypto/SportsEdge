# Development replay implementation — 2026-10-14

No genuine historical backtest ran. No historical returns, improved strategy,
paper-trading signal readiness, or profitability have been established.

## Scope and dependencies

Main inspected at `1be3dd989e4ca321ff4e99e3a18658a3935d47a2`.
This focused PR is stacked on PR #43 at
`c9d569891682d8e88972c7b7a09067a7f41bd3bb`; it adds files only.
Review/merge #43 first, then retarget/review this PR. Neither is merged here.

PR #43 supplies frozen accounting, full-universe selectors, source sample checks,
reconciliation and reporting primitives. PR #45 is a separate frozen-selector
port and no-order QuantConnect universe diagnostic, not an executable strategy.
PR #44 is a workspace shortcut. PR #46 is read-only API groundwork. PR #47's
Alpaca integration is not a historical-data source and is untouched.

## What the new code actually does

- `analytics/stock_development_runner_v1.py`: offline, full development replay
  for a reviewed, locally licensed normalized source bundle. Recomputes baseline
  and the single registered hold-rank-ten candidate from each independent actual
  account; caller-provided scores, capital overrides and targets are not accepted.
- Requires every session of the reviewed calendar, all 144 months of 2000–2011,
  a pre-2000 $1,000 cash origin, and at least 253 warmup sessions. Evidence is
  required exactly on each first monthly session, never intramonth. Frozen
  selectors enforce 08:00 New York and availability strictly before decisions.
- Runs six paths: both strategies at (15bp, $0/order), (25bp, $1/order),
  (50bp, $1/order). These are the original protocol scenarios, not a new sweep.
  Assumed 5bp half-spread is applied once to unspread raw opens; remaining
  slippage compounds on bid/ask as in accounting v2. Thus nominal bp labels are
  not exact additive realized costs. Whole-share and cash rounding remain frozen.
- Uses the existing settled-cash, position-cap, prior-volume and displayed-size
  checks. Every day's receipts are independently reconciled before reporting;
  no catch-and-skip, stale marking or dropping delisted losers. Full daily receipt
  hashes and final state bind the output digest. Only compact reporting inputs
  are retained between days, avoiding daily copies of full-universe state.
- `analytics/stock_development_metrics_v1.py`: CAGR, cumulative/annual results,
  monthly annualized volatility, daily-close drawdown/recovery duration, Sharpe,
  Sortino, midpoint-notional turnover, fee/spread/slippage/rounding decomposition,
  close exposure, largest holding and equity-sleeve HHI. Drawdowns are daily-close
  measures; intraday drawdowns are not measured. Ratios are null without aligned
  dated risk-free inputs (no assumed zero). Sortino uses downside RMS across all
  months against those same monthly risk-free returns.
- Requires aligned broad-market total-return and monthly 50% market/50% cash
  benchmark wealth paths for historical mode. Their construction and costs remain
  a source-adapter/reviewer responsibility; no SPY proxy is silently substituted.
  Reports relative return/CAGR and the registered 10,000-replicate calendar-year
  paired bootstrap. No automatic validation admission or strategy promotion.
- Source reviews and input bytes are hash-bound. Review metadata is a declaration,
  not source authentication. Results say `HISTORICAL_DEVELOPMENT_PROXY_PENDING_REVIEW`,
  `source_independently_verified=false`, `historical_study_approved=false`.
  The website allowlist is untouched; these outputs cannot publish themselves.

## Reproduce now (no credentials, network, or broker)

From the branch root, with Python 3.12:

```bash
python -m unittest analytics.test_stock_development_runner_v1 -v
python -m unittest discover -s analytics -p 'test_*.py'
python research/stock_development_20261014/reproduce.py
```

The last command runs the synthetic integrated pipeline twice and emits only
engineering status, hashes and reconciliation flags, with `performance=null`.
Fixtures are fictional. Passing these tests is not historical evidence.

## Historical command, when an authorized source bundle exists

```bash
python -m analytics.stock_development_runner_v1 --manifest /authorized/development/manifest.json --root /authorized/development --output /authorized/development/development-result-v1.json
```

The manifest template in `research/stock_development_20261014/` is deliberately
pending, not a sample approval. Replace its entries with real reviewed evidence
and SHA-256 hashes. Never merely change statuses to make a run pass. Bundle schema:

| Key | Contract |
|---|---|
| `initial_account` | Fresh accounting-v2 state, $1,000 cash, no positions/claims/events, origin at last pre-development exchange close; audited permanent IDs and prior marks |
| `calendar` | Existing v2 complete exchange calendar, revision, availability; warmup through final 2011 session; no post-2011 exchange dates |
| `settlement` | Existing v2 independently reviewed settlement business calendar; may include the necessary future settlement dates, which are not market outcomes |
| `rows` | Every development session as `{session, evidence?}`; session follows v2 with `kind=historical_price_proxy`, raw unspread open proxies in bid/ask and later close marks |
| `evidence` | Only first monthly sessions: unchanged universe-adapter `{shards, context, listings, decision_at}`; all PIT members, not only winners; no future bars or actions |
| `benchmarks` | `broad_market_total_return` and `half_market_half_cash`, each `{dates, wealth, source_revision, convention}`; origin and every close align exactly |
| `risk_free` | Null or map from all 144 `YYYY-MM` values to finite monthly investable risk-free returns |

Do not invent opening displayed sizes, timestamp availability, permanent IDs,
sector membership, corporate-event proceeds, payable dates or benchmark values.
An open-price execution proxy requires a documented, reviewed mapping for these
fields. Precision beyond the unchanged accounting kernel's supported six
decimals fails; do not silently round vendor prices to force acceptance.

The loader rejects non-development manifest dates/phase and incomplete review
metadata before opening source files. It rejects duplicate JSON keys, changed
hashes and paths outside the source root. Payloads must be development-only:
no program can discover hidden post-2011 observations in a mislabeled file
without first reading it. Never provide a combined development/validation/test
archive. The JSON bundle is currently in-memory; a bounded streaming source
adapter remains necessary for a full-market cloud deployment.

## Exact blockers and the QuantConnect Free path

1. No authorized normalized historical source bundle or QuantConnect execution
   was available to this run. No licensed market-data observations were fetched.
2. The frozen v2 accounting intentionally rejects delistings, mergers, spinoffs,
   fractional entitlements and combined events. This runner preserves those
   rejections. A full source will likely encounter them: implement and review a
   separately versioned lifecycle extension with source examples before any
   complete historical study. Do not delete the affected securities or dates.
3. Historical security additions, ticker reuse and renames must have audited
   registry/mark updates consistent with the unchanged adapter. Missing identities
   or marks fail; this milestone does not supply a changing-universe data mapper.
4. Verify source timing, raw prices/actions, consolidated volume, exchange and
   settlement calendars, classification history, payable/recovery cash and both
   benchmarks. Record dataset vintage and engine revision for reproducibility.
5. QuantConnect Free supports cloud backtesting and a research node through the
   web IDE. API/CLI access is a Quant Researcher feature; **do not buy it merely
   to unblock PR #46**. Run the existing PR #45 diagnostic in the current
   SportsEdge-Stock-Research project, preserving its no-order scope. This is a
   coverage diagnostic only, not the historical strategy run.
6. Keep QuantConnect hosted data inside QuantConnect. Current terms §2.6 restrict
   export of platform data, including reconstructable transformations. This local
   loader is for separately authorized local data; it is not a cloud export path.
   A QC in-cloud normalizer and bounded bridge to these accounting contracts still
   have to be built and validated before a Free-plan strategy run is executable.
7. Documented history begins in January 1998, but Morningstar does not cover all
   US equities. Date availability alone cannot prove the registered PIT universe.
   The September 23, 2026 Morningstar feed migration revised historical data;
   record that vintage rather than promising bitwise reproduction across revisions.
8. Review complete development output, then apply the registered rules to
   validation. Freeze before any sealed 2017–2025 evaluation. This code contains
   no validation/sealed execution mode. No broker order or paper activation occurs.

Official sources checked 2026-10-14 (UTC):
- https://www.quantconnect.com/docs/v2/cloud-platform/organizations/tier-features
- https://www.quantconnect.com/docs/v2/cloud-platform/organizations/resources
- https://www.quantconnect.com/docs/v2/writing-algorithms/datasets/morningstar/us-fundamental-data
- https://www.quantconnect.com/docs/v2/writing-algorithms/universes/equity/fundamental-universes
- https://www.quantconnect.com/docs/v2/writing-algorithms/securities/asset-classes/us-equity/corporate-actions
- https://www.quantconnect.com/terms/

LEAN's default cash credits, fractional split handling and automatic delisting
liquidation are not automatically equivalent to this project's entitlement,
payable-date and recovery requirements. No provider upgrade resolves that mapping.

## Algorithm research conclusion

The sole registered candidate remains hold-rank-ten retention. It has a sensible
turnover rationale; there is **no SportsEdge historical evidence yet** that it
improves net return, turnover or drawdown. Its advantage must survive all original
development/validation gates and the frozen cost scenarios, without retuning.
At $1,000 capital, whole shares and $1/order sensitivity can materially change
the result. That is why this milestone compares actual accounts, not ideal weights.

Trading-cost research by Frazzini, Israel and Moskowitz supports measuring
implementation costs rather than equating paper anomalies with realizable returns:
https://pages.stern.nyu.edu/~afrazzin/ (author's research page).
This is motivation to test the existing candidate, not proof of its benefit.
Volatility targeting, new trend filters, sector-limit changes and rebalance
optimization remain new hypotheses requiring a separately registered experiment
after the baseline is reproducible. No parameter search or new alpha candidate
was introduced here.

## Verification in this workspace

- Python 3.12.14, Linux; standard-library-only analytics dependencies.
- All 348 available analytics tests passed, including 22 new tests.
- Synthetic reproduction ran twice with identical outputs, six reconciled paths,
  and top-level performance null. Python 3.12.14 output SHA-256:
  `d3530907f696a55bc8ffe736da2a6cc3169dcb6ffb294d2ebbc3c3a5031ccfc6`.
- Frozen original protocol SHA-256 remains
  `aa5ef6532348e8100c2c7da97a4940e86ecf5ccba5af23896ceacfb0b4b8b9d4`.
- Pending historical manifest deliberately failed with `Unreviewed source gate:
  license`, before payload read; no historical result file was created.
- Initial full-suite run lacked the inherited Elo fixture in the partial local
  checkout. Restoring that unchanged fixture resolved the setup failure. Frozen
  source bytes were restored and verified after an initial extra-newline copy
  mismatch; no frozen file changes are included in the PR.
- No local Next.js build/browser test was run for these Python-only additions.
  Existing GitHub PR workflows validate the inherited website; check their exact
  head status before review/merge. New CI tests Python 3.12 and 3.13.
