# SportsEdge independent stock research milestone — 2026-10-12

## Decision

**The existing momentum model is a defensible research baseline, not a validated investment strategy. No stock profitability, return, alpha or drawdown improvement has been measured.**

Complete one additive milestone: independently audit the current stock stack, reproduce concrete cross-module weaknesses with fictional inputs, add a stricter consistency guard, implement one frozen rank-buffer candidate, and register a future historical evaluation plan. Fix accounting/data gates before evaluating either strategy on real history. Do not add more predictors or buy a subscription yet.

Recommended experimental candidate: retain a still-eligible existing holding while it remains among the top ten qualifying momentum ranks. The portfolio still holds at most five stocks, at most two per sector, each targeted at 10% of equity. This tests a trading-cost mitigation hypothesis while keeping the original momentum calculation and filters unchanged. It is not a recommendation to trade, nor an established improvement.

## Inspected state and preservation

Latest inspected `main`: `261b03ccc78e0fb3f62fdfa85effcb1e4e9f2f72`. All seven requested PRs were open, draft and unmerged at inspection. Read source, tests and relevant documentation at immutable heads; inventoried current branches.

| PR | Role | Inspected head |
|---|---|---|
| #15 | Separate $1,000 forward study/FIFO ledger | `eff4274825a92efee698f1ae62966927f7ba56fa` |
| #16 | Daily raw-price/as-of contract | `46d7de25827fef0618a8287405d3af5611f96f0a` |
| #18 | Frozen stock momentum model | `1db25c4dbce44c065bc67e69e1a354ebc1bd962c` |
| #19 | Paper execution planner | `267c59a21e673dc875be044a110589942167dcb1` |
| #27 | Historical cash/position ledger | `df24e4edac92ba7c9b3eca425da72cfb5954bf8d` |
| #29 | Alpaca historical-data archiver | `f3d79edabbb275925f3718ed794211f82c139170` |
| #30 | Recomputed-signal integration checks | `d62e509421a0929fe5c4bcf8456eb1dcc3e7a952` |

The additive files target #30, which inherits #16 → #18 → #19 → #27 → #29. #15 is separate and is **not** silently merged into that chain. All inherited files are preserved. No NBA model development, site work, database access, trading-account access, authenticated market-data request, purchase, automatic trade, remote push, merge or deployment occurred. Delivery is an isolated additive patch rather than a remote branch push that could trigger hosting automation.

## Baseline mathematics and assumptions

The model consumes 253 completed session closes, plus the next exchange session. It constructs a total-return index:

`TR[t] / TR[t-1] = (split_new_per_old[t] * raw_close[t] + cash_dividend_per_old_share[t]) / raw_close[t-1]`.

The cash dividend must be normalized to one **pre-split** share. Ex-date reinvestment at the close is a signal-index convention, not immediately spendable account cash. Inputs must be raw; already adjusted closes plus separate actions double-count adjustments.

Momentum is `TR[T-21] / TR[T-252] - 1`, using 231 intervening daily returns. This is a trading-session approximation to excluding the latest month from a one-year lookback, not an exact calendar-month replication of an academic factor. Trend is `TR[T] > mean(TR[T-199:T])`, a 200-observation average. Eligibility also requires latest raw close ≥$5 and the prior 20-session mean of raw close × share volume ≥$20 million. Rank positive momentum candidates, retain at most two per sector, select at most five, target `floor(equity_cents/10)` per name, leave the rest as cash.

Decisions occur between the month-end close and the next open. Strictly earlier availability timestamps gate bars and context declarations. Earlier data update later decisions; no fitted coefficients exist. The next-open minimum is correctly separate from the signal calculation. However, timestamps and revision labels are declarations until independently authenticated.

With a $1,000 account each name receives at most $100. Whole-share sizing and costs can turn an intended position into zero shares. Five equal positions are 20% each **of the risky sleeve**; two in one sector can be 40% of that sleeve. A 50% gross target is a cash policy, not a guaranteed 50% exposure or loss ceiling between monthly rebalances.

## Audit findings

Severity here describes historical-research integrity, not an observed production exploit. No adverse market performance is inferred from synthetic examples.

| Finding | Evidence | Consequence and disposition |
|---|---|---|
| **High: signal equity is not linked to account equity** | Recompute a legitimate signal with 90,000 cents while the actual account has 100,000; #30 accepts it | Permits arbitrary sizing/cash exposure under a valid recomputed signal. New guard requires exact prior-close account equity. |
| **High: held-symbol input is not linked to actual holdings** | Declare AAA held in an empty account and regenerate; #30 accepts it | Especially material to any retention rule. New guard binds the held-symbol set to the prior account state. |
| **High: model and ledger prices can disagree** | Change prior ledger close to 999.00 while model sees 45.20; #30 accepts it | Signal calculations and portfolio marks can describe different markets. New guard compares prior closes and security IDs. |
| **High: calendar labels can disagree with timestamps** | Label the October 1 session October 2 without changing timestamps; #30 accepts it | Corrupts month/day accounting and omissions. New guard validates New York dates, supplied calendar times and consecutive sessions. |
| **High: ticker/security IDs are not bound across modules** | Change the ledger's identity consistently while leaving the model universe unchanged; #30 accepts it | A ticker can refer to a different security. New guard cross-checks identities; permanent-ID history is still required. |
| **High: dividend entitlement/pay-date cash are conflated** | Ledger `_actions` credits current holdings before trading on the supplied action date; there is no separate entitlement or receivable | On ex-date this makes cash available early; on payment date it may pay the wrong owner after a sale. New guard rejects cash dividends until a receivable ledger is implemented. This is a blocker, not an assumption that dividends are zero. |
| **High: incomplete action response passes archive validation** | Mock response with no `corporate_actions` key is accepted through a default empty dictionary | New archive-structure check rejects a missing field and altered page hashes. Empty genuine payloads still do not prove complete coverage. |
| **High: membership/history requirements cannot represent a full PIT market yet** | One short-history security fails the entire batch; 100,000-bar cap fits at most 395 complete 253-bar securities, fewer with future bars | An IPO should be ineligible on known age, not stop all trading. Do not fix by selecting only eventual survivors or truncating the universe. Need explicit PIT eligibility/exclusion and complete-universe scoring. |
| **High: event lifecycle is incomplete** | Ledger lacks delisting recovery, merger consideration, spin-offs, payable-date cash, robust ticker transitions; fractional splits stop | Good to stop rather than invent a result, but a study cannot discard such securities or failed dates. Reconcile events before a complete historical test. |
| **High: raw precision differs** | #16 accepts six decimal places; #27 rejects `30.000001` | Do not silently round source prices to satisfy the ledger. Specify a common Decimal/subcent calculation policy, rounding cash once per fill. |
| **Material: adverse gaps can abort rebalancing** | #27/#19 reject prior equity-based budgets when current NAV falls even slightly; positive targets are often exactly 10% of prior equity | Skipping rejected loss days creates bias. Preserve rejection, invalidate the run, and implement a shared deterministic gap policy before research. |
| **Material: risk policies are not identical** | Planner checks post-cost midpoint exposure; historical ledger checks pre-trade/open budgets only | New guard adds the post-cost open check. Existing parity tests use restricted equal bid/ask fixtures, not all market states or spread conditions. No complete live/backtest parity claim. |
| **Material: open-dependent sizing is idealized** | Shares are chosen using the realized open and filled at that same open | This is a price-contingent proxy, not proof that a pre-open whole-share MOO order was executable. Specify order type, pre-known quantity or actual later quote before claiming executable fills. |
| **Material: total cash is not a settlement ledger** | Sells precede buys and proceeds are immediately reused | No settled-cash, receivable or settlement-date policy is modeled. Audit cash-account constraints; monthly frequency does not prove every event is valid. |
| **Material: liquidity feed dependence** | Frozen threshold uses close × volume; free IEX is one exchange | IEX volume is not consolidated dollar volume. Using it changes eligibility. No unvalidated multiplier can turn IEX into full-market volume. |
| **Material: source hashes are not original transport evidence** | Archiver hashes reserialized decoded JSON; JSON numbers pass through Python floats | It is a decoded-page hash, not a SHA of original HTTP bytes. Preserve raw bytes and exact decimals in a future archive adapter if original-response reproducibility is claimed. |
| **Material: snapshot provenance is declarative** | Universe, historical sectors, actions and availability are caller supplied; bars key by ticker | Current constituents/sectors and historical ticker mapping do not prove what was known then. Require dated security master and membership evidence. |

Additional observations: holding five names entails idiosyncratic and correlated risks; sector counts do not measure covariance. Monthly trend filtering offers no intramonth stop or protection against overnight gaps. Rank changes and resizing both generate turnover. The ledger reports closing drawdown, not intraday drawdown. The baseline's 200-day trend and positive-momentum conditions are sensible hypotheses but have no verified performance evidence in this repository.

PR #15 uses frozen 10-bps half-up slippage, whole-share FIFO cost accounting, no fee/spread/corporate-action model and no verified mark-to-market return. #19/#27 use explicit costs and conservative debit/proceeds rounding. They must not be wired together as equivalent ledgers. Keep the $1,000 stock study separate from the site journal and sports accounts.

## Candidate choice and research basis

The momentum family has a primary-research basis: Jegadeesh–Titman (1993) studies past winners/losers; the French momentum construction explicitly excludes the latest month [R1–R2]. These are diversified long-short constructions. They do **not** establish alpha for a five-name, long-only, trend-filtered, at-least-half-cash account.

| Investigated change | Decision for this milestone |
|---|---|
| Alternate 6/9/12-month rankings or ensembles | Defer: creates extra model-selection trials without new verified evidence; keep the existing approximate 12-minus-1 signal. |
| Volatility-adjusted momentum or exposure | Plausible later hypothesis. Moreira–Muir [R3] concerns volatility management of factor portfolios; it is not proof that dividing individual-stock momentum by volatility improves this strategy. No volatility window/target search here. |
| Market-regime filter | Defer. Momentum-crash research [R4] is relevant, but much of its mechanism involves the short-loser leg absent here. Avoid copying a crash classifier into this long-only account. |
| Optimized/covariance-based weights | Defer. Estimation error can overwhelm theoretical gains [R5]. Preserve simple weights and cash until a larger justified portfolio is feasible. |
| Rank buffer for incumbent holdings | **Select one candidate.** Buy/hold spreads are a directly relevant, simple cost-mitigation mechanism in Novy-Marx–Velikov [R6]. Test one fixed rule, no search. |
| Stop-loss/downside triggers | Defer. Their value is process- and strategy-dependent [R7]. A stop level is not a guaranteed execution price and adds turnover/gap assumptions. |

Candidate definition: rank all names that pass the unchanged eligibility, positive momentum and trend filters. First retain current holdings ranked 1–10 in rank order, respecting five-name and two-per-sector caps. Fill remaining slots from the same ranking. Exit a held name if it fails any filter, falls below rank 10 or cannot fit a cap. Keep identical 10% nominal budgets and monthly timing. The **10** cutoff is a frozen design choice, not a literature-estimated optimum. It can retain a weaker name and harm returns; no superiority is claimed.

Only one candidate is implemented, version `stock-mom252-skip21-trend200-holdrank10-v1`. It has its own content hash and status. Inherited planners/replayers reject its version rather than silently treating it as approved baseline. The original model output is preserved as the parent signal and its scores are unchanged. A future versioned adapter must recompute this candidate itself before replay; changing the version string alone is prohibited.

## Synthetic verification

All companies, market values, dates/calendars and quotes in added fixtures are **fictional**. These tests are mathematical/accounting behavior checks, not historical stock returns.

- 162 inherited Python tests pass on the #30 stack.
- 18 new tests pass; combined suite is **180 passing tests**.
- The separate #15 snapshot has **8 passing tests**; it is not included in the 180 or silently integrated.
- Six problematic bundles pass the inherited wrapper but are rejected by the new guard: wrong equity, wrong holdings, conflicting close, false session date, mismatched security ID, and cash dividend without entitlement/payment semantics.
- A valid synthetic bundle returns exactly the same portfolio scenario under the new guard; inputs remain unchanged.
- Archive tests use an injected mock response function only. No credentials or network request are used.
- Candidate tests cover no-holding equality to baseline targets, rank-six/rank-ten retention, rank-eleven exits, filter/sector/count caps, future-bar and input-order invariance, Decimal-context stability, nonmutation, and rejection by unapproved downstream interfaces.

| Synthetic membership example | Selection |
|---|---|
| Existing holdings | AAA, BBB, CCC, DDD, FFF |
| Unchanged baseline | AAA, BBB, CCC, DDD, EEE |
| Buffered candidate | AAA, BBB, CCC, DDD, FFF |

FFF is rank six in this fixture. The candidate avoids this particular replacement, while scores and target gross allocation stay equal. This does not measure actual traded turnover: resizing can still trade shares, and other sequences may increase turnover.

`synthetic_results.json` contains case acceptance/rejection reasons and selected symbols only; its financial-performance field is null. No genuine-price dataset was available in the inspected research artifacts, and none was obtained here. Direct source availability and permissions remain unverified.

No test failure remains. The new tests deliberately **expect** the inherited weaknesses to reproduce; a passing forensic test does not mean the old behavior is safe. Node, Next.js and deployment CI were not run: this change contains only additive Python research/docs and makes no release-readiness claim.

## Data feasibility before spending

Official pages checked on 2026-10-12; prices/access may change. No purchase, trial signup, credential access or provider execution occurred.

| Route | Useful next step | Limits |
|---|---|---|
| **UNM WRDS/CRSP** | UNM's finance guide lists WRDS registration and CRSP access [D1]. Check your eligibility and academic-use rights first; potentially no extra individual subscription. | The guide does not authenticate your account entitlement or permit commercial/site redistribution. Confirm open-price, delisting, sector and event coverage in the actual licensed product. |
| French Data Library | Free published factor/portfolio series and methods support conceptual comparisons [R2]. | Aggregated factor returns cannot reconstruct this stock-selection strategy, its $1,000 positions or PIT universe. |
| Alpaca Basic | Free plan, IEX real-time coverage and history since 2016; useful only for later authorized API/normalization smoke tests [D2]. | Does not establish a survivorship-free universe, consolidated liquidity or complete events. Historical feed entitlements require confirmation; do not assume paid SIP solely from a table about real-time coverage. No request made. |
| Norgate trial | Official trial offers three weeks with two years of history [D3]. Could inspect schemas/events before committing. | Insufficient for the frozen long-history protocol. Trial/license must permit intended use; not activated. |
| Norgate US Platinum | Listed at $346.50/6 months or $630/year, with delisted securities and historical constituents back to 1990 [D4]. Conditional option if academic access is unavailable. | Vendor coverage does not automatically prove original as-of publication times, historical sectors, entitlements or delisting recoveries; check platform/export/display restrictions. Not recommended for purchase before an adapter/coverage review. |
| CRSP institutional license | Permanent identifiers, active/inactive securities, returns/actions and delisting information address key research requirements [D5]. | Costs and access depend on institution/license; original historical revision timestamps and exact field coverage still need audit. |

**Preferred sequence:** check UNM access → inspect a legally supplied small sample with a split, dividend, rename and delisting → resolve source/ledger incompatibilities → obtain and seal a complete research dataset. Do not buy Alpaca Plus merely to fix survivorship: better exchange coverage alone does not supply a PIT security master. No verified free, complete stock-level package meeting every required gate was established here.

Alpaca corporate-action queries use `process_date`, not a guaranteed event-effective range, and the documentation warns of creation/processing delays [D6]. Querying the same date range as price bars can therefore miss relevant events processed outside it. `asof` controls symbol mapping [D7]; it is not an archive of contemporaneous universe membership or publication time.

## Frozen future historical protocol

The machine-readable authority is `research/stock_audit_20261012/protocol.json`, written before candidate evaluation on any genuine prices. No historical performance was examined or selected here.

- Warmup 1999 plus extra prior sessions if needed; development 2000–2011; validation 2012–2016; sealed test 2017–2025. Obtain an independent prior-exposure attestation before calling that test untouched. Inadequate coverage stops the study; amend the plan before viewing returns rather than moving dates to improve results.
- PIT NYSE/NASDAQ/AMEX common stocks with permanent security IDs, dated sector/type/exchange state, all removals/delistings. Distinguish a known-age IPO exclusion from an unexplained missing bar. Never condition eligibility on surviving to the end.
- Reconcile raw prices and corporate actions against total returns. Entitlement receivables enter NAV on ex-date; cash becomes spendable on the supported payment/settlement date. Handle splits, cash-in-lieu, mergers, delistings and ticker changes with independent event evidence. Never forward-fill a vanished security indefinitely or drop its loss.
- Month-end inputs available strictly before 08:00 New York on the first next session; execute using the next regular-session open only as an explicitly idealized proxy. A genuine executable-return claim additionally needs a feasible order/quantity rule and quotes/fills. No signal-day close fills.
- $1,000 starting cash, whole shares, no borrowing/shorting/external funding. Primary cost scenario: 5-bps half-spread + 10-bps additional slippage each side, $0 fixed fee; stress total 25/50 bps and $1 per order. These are assumptions, not measured costs. With actual bid/ask, remove assumed half-spread to avoid double counting. Require a shared settlement/gap/cap/precision policy first.
- Order ≤1% of prior 20-session consolidated mean volume; halted/unavailable executions require a frozen defer/reject policy, never an attractive invented price. Any unresolved rejection invalidates the study, not only that unfavorable day.
- Benchmark against a licensed US broad-market **total-return** index, 50% of that index plus 50% cash rebalanced monthly, and the unchanged baseline under identical execution. Primary cash earns zero; any dated accessible cash-rate sensitivity applies consistently. An index is a benchmark, not a guaranteed tradable fill.
- Record net wealth/CAGR, monthly risk/Sharpe where a risk-free series exists, drawdown/recovery, exposure, cost components, trades/rejections, and turnover. One-way turnover is `(buy notional + sell notional)/(2 * pretrade NAV)`; also retain both gross sides, avoiding convention confusion.
- One candidate only. Validate net return and turnover improvements without worse max drawdown; freeze before test. Primary test is candidate-minus-baseline monthly net return with paired calendar-year-block bootstrap, 10,000 replicates, seed 20261012. Improvement requires matching directional gates and a positive lower 95% bound. Few year blocks and regime dependence limit precision. Report inconclusive/failure without retuning.
- Reserve 2027 prospectively only after separate approved pre-start freeze; nothing is collecting or trading now. Test results remain null. Repeated test inspection or any strategy change consumes the original holdout.

## Engineering handoff — exact next integration order

1. **Read-only audit gate first.** Review `guarded_replay` and `audit_archive_structure`; add their rejection cases to the ingestion/replay review path. Existing modules are untouched. The guard intentionally rejects dividend scenarios and incomplete calendars; do not interpret rejection as permission to remove those observations.
2. **Repair the shared accounting/execution contract under a separate approved milestone.** Bind model equity and holdings to account state; reconcile stable IDs and prior marks; add receivables/payment dates, settlement and corporate-event lifecycle; preserve subcent source precision; unify current/post-cost risk caps and adverse-gap behavior. Prove baseline planner/replayer parity with spreads, held positions, sells, gaps, corporate events and stale/missing data. #15 remains a distinct frozen study.
3. **Normalize an independently verified sample.** Preserve original source bytes and revisions, map permanent IDs, obtain calendar/universe/sector timing, and verify consolidated volume. Handle known IPO ineligibility explicitly and score the complete universe without the current row-limit truncation. No full return study until coverage and rights pass.
4. **Add a version-aware candidate adapter later.** Baseline stays unchanged. Candidate recomputation must use `generate_buffer`, actual holdings and equity; store its new version/input hash. Never relabel its output as the baseline to bypass the existing version gate. There is intentionally no approved candidate execution adapter in this milestone.
5. **Run the registered historical protocol only after gates pass.** Keep validation and test access separate; save complete failure logs, source hashes and cost assumptions. Do not integrate performance numbers into the website until they are genuinely measured and qualified.

## Files and reproduction

New files: `analytics/stock_rank_buffer_candidate.py`, `analytics/stock_replay_integrity_audit.py`, `analytics/test_stock_independent_audit.py`, this report, and `research/stock_audit_20261012/{protocol.json,reproduce.py,synthetic_results.json,verification.json}`.

Apply the additive patch to PR #30's pinned commit in an isolated local research branch. It modifies no existing path. Then:

```bash
python -m unittest discover -s analytics -p 'test_*.py' -q
python research/stock_audit_20261012/reproduce.py --output /path/to/NEW-synthetic-results.json
```

Python 3.12, standard library only. The runner executes the inherited suite and synthetic probes; it has no provider network operation and refuses to overwrite an existing report. The separate PR #15 suite can be run on its own pinned checkout with the same unittest command. The packaged report is reproducible byte-for-byte; verification records the pinned file hashes and test results.

## Primary references

R1. Jegadeesh & Titman (1993), *Returns to Buying Winners and Selling Losers*: https://doi.org/10.1111/j.1540-6261.1993.tb04702.x

R2. Kenneth French, momentum construction: https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_mom_factor.html and https://mba.tuck.dartmouth.edu/pages/Faculty/ken.french/Data_Library/det_mom_factor_daily.html

R3. Moreira & Muir, *Volatility Managed Portfolios*: https://www.nber.org/papers/w22208

R4. Daniel & Moskowitz, *Momentum Crashes*: https://www.nber.org/papers/w20439

R5. DeMiguel, Garlappi & Uppal, *Optimal Versus Naive Diversification*: https://doi.org/10.1093/rfs/hhm075

R6. Novy-Marx & Velikov, *A Taxonomy of Anomalies and their Trading Costs*: https://www.nber.org/papers/w20721 . The buy/hold-spread result motivates a test; neither this paper nor this audit validates a five/top-ten cutoff.

R7. Kaminski & Lo, *When do stop-loss rules stop losses?*: https://dspace.mit.edu/entities/publication/bb69ca4b-0cdc-487f-831d-63b2e84fafee

D1. UNM finance guide / WRDS: https://libguides.unm.edu/finance/WRDS

D2. Alpaca plans: https://docs.alpaca.markets/us/docs/about-market-data-api ; feeds: https://docs.alpaca.markets/us/docs/historical-stock-data-1

D3. Norgate trial: https://norgatedata.com/freetrial.php

D4. Norgate packages: https://norgatedata.com/stockmarketpackages.php ; coverage: https://norgatedata.com/data-content-tables.php ; licensing: https://norgatedata.com/faq.php

D5. CRSP stock database: https://www.crsp.org/research__trashed/crsp-us-stock-databases/?activetab=docs ; delisting fields: https://www.crsp.org/wp-content/uploads/2023/08/CRSP10-User-Guide.pdf . Audit current format definitions before combining regular and delisting returns; do not double-count an event already included by the provider.

D6. Alpaca corporate actions: https://docs.alpaca.markets/us/reference/corporateactions-1

D7. Alpaca symbol mapping: https://docs.alpaca.markets/us/docs/market-data-faq
