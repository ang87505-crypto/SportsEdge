# Frozen stock candidate: accounting adapter and fair-comparison preparation

**Conclusion: not testable yet.** No improvement, profitability, net return or accuracy has been demonstrated. This milestone completes an offline, independently testable adapter for the existing frozen hold-rank-ten candidate and a paired synthetic comparison runner. It adds no new selection hypothesis and changes no existing strategy, accounting implementation, protocol or result.

## Verified starting state

Inspection date: October 13, 2026 UTC (October 12 in America/Denver).

- Current inspected `main`: `ab97d6dcfb439418a64a145a1261d91bce7ac50a`, tree `501c6fef993af18527bfcf2dca38567d4f2dec90`.
- PR #34 is **merged**, merge commit `d22b40165d65ca7849bf806513a389484ed3f45a`. Its original head remains `92eaa17a4ba3147d9faa2d39785fabf5f49e9a82`, tree `d400b79cdfb57fcad2b014119f14d556b4030d35`; it inherits `d62e509421a0929fe5c4bcf8456eb1dcc3e7a952`.
- Branch inventory and the 11 open PRs were inspected. Open PRs #20–26, #32 and #35–37 do not supply a newer stock-selection/accounting implementation. Current main's inherited stock algorithm blobs equal PR #34's blobs. Main also contains PR #15's separate ledger; it remains disconnected from v2.
- Root `AGENTS.md` contains Next.js-specific instructions. No nested AGENTS file appears in the inspected complete trees. No Next.js code is changed.
- Six checks on the PR #34 head were reported successful. The inspected Actions-runs query for the current main SHA returned no runs; this is not a claim of current-main CI success. No remote CI exists for this unpushed deliverable.

Direct Git clone access failed with an authentication error. An isolated local research branch was built from **30 authenticated, Git-blob-verified stock-related files** on current main. It is a partial source snapshot, not a complete clone or an upstream commit. Its local snapshot commit must not be used as the upstream integration base. Delivery is clean additive patches against the actual upstream hashes above. No push was made, avoiding deployment hooks.

Both user-attached `(2).zip` files were inspected directly. Every archive manifest hash passed. The original audit's eight files match current GitHub bytes. Accounting v2 was absent from the inspected repository tree. The full PR #34 tree was reconstructed in a local Git index from authenticated recursive tree metadata; the reconstructed root hash exactly equals GitHub's commit tree. `git apply --cached --check` passed on that exact tree. Applying v2 to the verified stock snapshot then reproduced all eight packaged files byte-for-byte. The v2 correctness reproduction also matches its packaged output. These checks do not claim to authenticate market sources.

## Exact unchanged baseline

Version: `stock-mom252-skip21-trend200-v1`.

For 253 prior completed sessions, form a total-return signal index using raw closes and explicit corporate actions:

`TR[t]/TR[t-1] = (split_new_per_old[t] × raw_close[t] + cash_per_old_share[t]) / raw_close[t-1]`.

Rank by `TR[T-21]/TR[T-252] - 1`, a 231-return window. Require positive momentum, `TR[T] > mean(last 200 TR observations)`, latest raw close at least $5, and prior 20-session average raw close × volume at least $20 million. Eligible common stocks must have PIT NYSE/NASDAQ/AMEX and sector identities. Sort descending momentum with ticker tie-break; select at most five with at most two per sector. Each nominal budget is `equity_cents // 10`; unused capital stays cash. V2 derives that equity from actual prior-close economic NAV, flooring only at the model's integer-cent boundary.

The registered decision is 08:00 New York on the next exchange session after month end; data availability must precede that decision. Whole shares, $1,000 initial account, no leverage or shorts. At least half the nominal budget stays cash; drift may later exceed rebalance caps. Dividend reinvestment in the signal index is not spendable dividend cash in the account.

Known limitations remain: only five stocks; whole-share granularity; cash drag; sector counts do not measure covariance; monthly filters cannot prevent gaps. The 100,000-row cap cannot score a complete US market in one 253-session payload; the unchanged model rejects any short-history member instead of representing known IPO ineligibility. Original data timestamps, memberships and actions are declarations until independently authenticated. None of the underlying academic factors establishes this portfolio's after-cost performance.

## Independent research and candidate decision

The small comparison below was decided before candidate-adapter tests. No genuine validation/test outcomes were available or inspected. The machine-readable freeze identifies the original protocol and protected code hashes. No threshold, predictor or lookback search occurred.

| Hypothesis | Mechanism and assumption | Risk and decision |
|---|---|---|
| Existing buy/hold rank buffer | Novy-Marx–Velikov [R1] finds buy/hold spreads useful for mitigating anomaly trading costs. A holding can remain attractive enough to keep although it would no longer be purchased. | May retain weaker stocks; resizing still trades and can defeat intended savings. Their results do not validate top-five/top-ten rules. **Select this one previously frozen candidate; implement its missing account adapter.** |
| Volatility-adjusted cross-sectional momentum | Downweight a volatile return history relative to a calmer one. Moreira–Muir [R2] motivates attention to conditional risk, but studies volatility-managed factor exposure, not this individual-stock ranking. | Adds noisy volatility estimates and a window choice; may favor stale prices, change exposures and turnover. No verified stock-level action-adjusted history is available. **Defer; no new version or parameter chosen.** |
| Market trend or breadth filter | A declining broad market or weak breadth might justify less exposure. Time-series momentum [R3] supports studying persistence, while Daniel–Moskowitz [R4] studies momentum crash states. | Whipsaw, missed rebounds and extra cash exposure; futures trend portfolios and short-loser crash mechanisms do not transfer directly to five long-only names. No licensed PIT benchmark/breadth inputs were supplied. **Defer; no filter threshold chosen.** |

French's momentum construction [R5] uses diversified value-weighted winner-minus-loser portfolios. It supports the momentum family and latest-month exclusion, not a profitability claim for SportsEdge. Selecting additional candidates now would expand the original one-candidate experiment without resolving its binding evidence gaps. Deferral is not a finding that alternatives are inferior.

## Frozen candidate and immutable identities

Selection version remains `stock-mom252-skip21-trend200-holdrank10-v1` **byte-for-byte**. Rank all names passing the baseline's unchanged filters. Retain actual incumbents within qualifying ranks 1–10 in rank order, enforcing five-name and two-per-sector caps. Fill remaining slots from the same baseline ranking. Exit holdings that fail a filter, lie below ten or cannot fit the caps. Keep the original budgets, sector limits, positive trend/momentum conditions and timing. Rank ten is an inherited frozen choice, not an estimated optimum.

New adapter: `stock-holdrank10-account-adapter-v1`.

New paired runner: `stock-baseline-buffer-synthetic-comparison-v1`.

Accounting dependency: `stock-accounting-execution-v2` and the unmodified baseline adapter `stock-baseline-account-adapter-v2`.

`freeze.json` has SHA-256 `e4acfedc49cb706c0fc0fea07c739f8a0346197c390c5dea4c0c7da51104c8c7`. The deliverable manifest binds all final code bytes. These version labels plus hashes identify this artifact; content hashes do not authenticate input prices or authorize trading.

## Implementation boundary

New code lives in `analytics/stock_buffer_replay_v1.py` and `analytics/stock_candidate_comparison_v1.py`.

The candidate accepts only versioned model evidence, never a precomputed signal, equity, holding list or target override. It calls v2's baseline adapter as a shared validation calculation, then independently calls the unchanged `generate_buffer` with actual account-derived equity/holdings. The baseline validation signal is never relabeled or executed as the candidate. The candidate has its own signal hash, parent signal reference, adapter identity and account-bound decision ID. The old baseline entry point still rejects candidate versions.

Both use the same v2 opening and closing kernel: settled-cash funding, sale settlement claims, ordinary-dividend receivables, whole-share split/rename handling, explicit spread/slippage/fees, conservative post-cost sizing, and recomputed liquidity. No correction to v2 was required for the supported tested cases. This does **not** certify unimplemented event types or source coverage.

The paired runner takes one initial account and one shared stream of sessions/model evidence, costs and calendars. Baseline and candidate each evolve their own state and recompute at every month boundary. A missing date, missing decision, unsupported event or evidence inconsistency aborts the entire pair. Its callable and CLI admit only `synthetic_fixture` rows; no historical unlock flag exists. Standalone adapters remain pure accounting-scenario primitives, not source validators or authorized historical-study entry points.

Future closes are stripped before opening plans; they are used only for close bookkeeping. Both paths retain their own receipts and identities even when their economic actions coincide. The runner returns `performance: null`. Synthetic records are engineering fixtures, never a backtest or observed gains.

## Data availability finding

No qualified historical stock dataset, license evidence, source-availability archive or sealed test was found in the inspected repository or attachments. No provider data requests, account logins, credentials, purchases or brokerage access occurred. This finding is limited to the supplied/inspected material, not a claim that the user cannot obtain suitable data.

UNM lists WRDS/CRSP access [D1], and CRSP describes active/inactive securities, corporate actions and permanent identifiers [D2]. This is a plausible access route, **not verification of the user's entitlement, commercial-use rights, redistribution rights or exact field completeness**. Alpaca documents history since 2016 and limited Basic real-time IEX coverage [D3]; that does not establish the registered 1999 warmup/2000–2011 development coverage or PIT membership. No API was invoked. French factor series cannot reconstruct stock-level accounts.

Required evidence is still missing for every historical gate: legal use; dated membership and historical sector/type/exchange; permanent IDs, ticker histories and delisted firms; raw daily prices and consolidated volume; dividends/splits with ex-date and cash-credit semantics; delisting/merger recoveries and fractional entitlements; complete exchange and settlement calendars; original source bytes, publication/correction/availability times; and total-return benchmark data. Modern downloaded revised history is not automatically contemporaneous data.

Even with data, v2 rejects delistings, mergers, spinoffs, fractional splits and combined events. Full-market/IPO handling and historical-price-proxy normalization are also unresolved. These require additive, separately tested work before full evaluation. Do not select a survivor-only subset, omit failed dates, replace absent event outcomes with zero or interpret a boolean coverage declaration as proof.

## Fair evaluation prepared, not run

The existing `research/stock_audit_20261012/protocol.json` and v2 amendment remain authoritative and unchanged:

1. Warmup 1999 (earlier if required), development 2000–2011, validation 2012–2016, sealed test 2017–2025. An independent prior-exposure attestation is required before calling the test untouched. There was no holdout acquisition or access in this milestone.
2. Repair data/event/full-universe gates and verify a legally supplied dividend/split/rename/delisting sample before historical replay. If coverage cannot meet the dates, register an amendment **before** inspecting outcomes; never move windows to obtain favorable results.
3. Start separate equal $1,000 accounts under identical timing, settled-cash, costs and calendar rules. The new synthetic pair verifies this wiring, but does not replace a future source-audited evaluation driver.
4. Primary assumed costs remain 5-bp half-spread plus 10-bp additional slippage, zero fixed fee. Use actual bid/ask without a second assumed spread; keep 25/50-bp total one-way and $1/order stresses as registered. Cash interest is zero in the primary scenario; any dated investable cash-rate sensitivity applies to all paths.
5. Compare unchanged baseline and candidate to a licensed broad-market total-return index and a monthly 50%-index/50%-cash benchmark with the same cash convention. Show an ideal index separately from any executable benchmark implementation and its costs; do not pass a theoretical index through the stock-selector caps or invent index fills.
6. Report net wealth/CAGR, drawdown/recovery, monthly volatility, rolling returns, exposure/cash drag, trades, rejection counts, fee/spread/slippage/rounding costs, gross notional and `(buys+sells)/(2×pretrade NAV)` turnover. Sharpe is null without a dated risk-free series. Probability calibration is inapplicable: these strategies produce ranks, not probabilities.
7. Validation must improve net return and turnover without worse maximum drawdown before opening the sealed test. The sealed-test claim additionally requires a positive lower endpoint for candidate-minus-baseline mean monthly net return using the registered paired calendar-year-block bootstrap: 10,000 replicates, seed 20261012, 95% interval. Five validation years and nine test years offer limited independent blocks; interval coverage and regime representativeness remain uncertain. No retuning after either result.

The exact next-open limitation remains: the kernel observes the opening bid/ask, chooses whole-share quantity from that price and assumes an immediate fill at that quote plus costs. A daily opening print published later cannot be relabeled as an available quote. Neither assumed quotes nor displayed size establishes a feasible pre-open MOO quantity, execution latency, queue priority or actual fill. A reviewed historical proxy adapter is still missing. Equal assumptions make the comparison internally fair, not externally executable.

## Verification and handoff

See `research/stock_candidate_adapter_20261013/verification.json` and delivered logs for actual counts, commands and failure history. The milestone tests are all synthetic, including an eleven-name ranking case, two-month independent-account progression, rank-ten/rank-eleven boundary, actual-account recomputation, identity/override rejection, missing/late data, future-close invariance, monthly/date continuity, liquidity, dividend entitlement after sale, unsupported delisting rejection, Decimal isolation, and exclusive CLI output. Existing accounting and stock/archiver regression suites are preserved.

No unresolved test failure remains. A preliminary test invocation used the parent directory and failed to import `analytics`; it was corrected by running from the source root, without changing tests. An early GitHub response parser incorrectly expected JSON-encoded blobs; that retrieval error was corrected and all source bytes subsequently passed Git blob verification.

Integration sequence:

1. On a real clone, create a local research worktree at the pinned current-main hash below. Check the accounting patch before applying; if newer upstream work already contains it, compare exact bytes and do not overwrite.
2. Apply the unchanged supplied accounting-v2 patch, then the new candidate-adapter patch. The combined patch is an alternative, not a third patch to apply. No baseline, candidate, study, NBA or website file is modified.
3. Run the commands below. Review source and tests. Keep all trading and website integration disabled. No merge/deploy/push occurred here.
4. Next quantitative milestone: source/event feasibility sample and delisting/full-universe repair. Do not expand the candidate search until the original comparison can be evaluated honestly.

```bash
git worktree add -b research/stock-buffer-evaluation-20261013 ../SportsEdge-buffer ab97d6dcfb439418a64a145a1261d91bce7ac50a
cd ../SportsEdge-buffer
git apply --check /absolute/path/stock-accounting-v2-additions.patch
git apply /absolute/path/stock-accounting-v2-additions.patch
git apply --check /absolute/path/stock-candidate-adapter-additions.patch
git apply /absolute/path/stock-candidate-adapter-additions.patch
python -m unittest discover -s analytics -p 'test_stock*.py' -v
python -m unittest analytics.test_alpaca_history_archive -v
python research/stock_candidate_adapter_20261013/reproduce.py --output /absolute/path/NEW-synthetic-checks.json
```

Python 3.12 standard library only. Use a fresh output filename. Full website/NBA CI is outside this milestone; the passing stock tests are not deployment readiness. The unchanged baseline remains the reference, not a statistically established winner.

## Primary sources checked

- R1. Novy-Marx & Velikov, *A Taxonomy of Anomalies and their Trading Costs*, NBER 20721 / RFS 2016: https://www.nber.org/papers/w20721
- R2. Moreira & Muir, *Volatility Managed Portfolios*, NBER 22208 / Journal of Finance 2017: https://www.nber.org/papers/w22208
- R3. Moskowitz, Ooi & Pedersen, *Time Series Momentum*, JFE 2012, author publication page: https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum
- R4. Daniel & Moskowitz, *Momentum Crashes*, NBER 20439 / JFE 2016: https://www.nber.org/papers/w20439
- R5. Kenneth French, monthly momentum factor construction: https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_mom_factor.html
- D1. UNM Finance/WRDS guide: https://libguides.unm.edu/finance/WRDS
- D2. CRSP stock database, official current page: https://indexes.morningstar.com/research-data-products/crsp-us-stock-databases
- D3. Alpaca Market Data documentation: https://docs.alpaca.markets/us/docs/about-market-data-api

The R1 direct open returned 403; its NBER search-index abstract was available. No inaccessible full-text passage is presented as read. These sources justify hypotheses and data investigation only; none validates SportsEdge's specific portfolio.
