# Idle-cash portfolio policy and core-satellite forward design: analysis plan (2026-11-20)

**Committed before any computation in this milestone.** It fixes:
- the research verdict on whether a new challenger exists;
- the descriptive comparison and its metrics;
- the prospective shadow-test protocol.

Results go in `docs/STOCK_IDLE_CASH_POLICY_RESULTS_2026_11_20.md` whatever they are.

**Research only. Nothing below changes:**
- `stock-v2-weekly-1`, its planner, `GROSS_CAP`, risk limits, bankroll or release flags;
- PR #102, #187, the Nov 23 supervised Alpaca PAPER session, the Kalshi platform (#193/#194/#197);
- the open PRs #195 (NBA) and #196 (stock sizing).

No order is sent, and no strategy is activated.

## 1. What already exists (preserved as recorded)

| Registry entry | Rule | Gross exposure | Verdict (run 43488863136, PR #165, unmerged) |
|---|---|---|---|
| `lab-stock-v3-core-satellite` (`stocks:exposure-core-satellite`) | 50% SPY buy-and-hold + 50% momentum sleeve at 20% per pick, fractional | ≈ 99% | NO_CLEAR_EFFECT / RUNNING: beats the live rules (Holm p 0.0075) **only by adding SPY exposure**; holdout 17.3% vs exposure-matched SPY 21.1% |
| `lab-stock-v3-riskadj` (`stocks:risk-adjusted-momentum`) | rank by momentum ÷ volatility | ≈ 50% | REJECTED: below exposure-matched SPY in dev (5.9% vs 6.1%) and holdout (9.6% vs 10.9%) |
| core-satellite-riskadj | the two combined | ≈ 99% | REJECTED: below exposure-matched SPY in both periods |
| `lab-stock-holdrank10-wholeshare` | top-10 hold buffer, whole shares | ≈ 38% | BEATS_CURRENT_BELOW_MATCHED_SPY / RUNNING forward only |
| `cashaware` (PR #196, proposal) | nearest-share sizing + 5–15% band | ≈ 46% | FAILS (proposed REJECTED) |

The v3 audit decomposed the live rules' holdout gap to SPY into two parts:
- **exposure drag:** −10.0 points a year;
- **selection gap:** −4.5 points a year.

## 2. Three different things, kept apart

| Change | What it is | Gross exposure vs the 50% cap | Classification |
|---|---|---|---|
| **A. Replace idle cash within the cap** | Hold SPY in the gap between the sleeve's actual value and 50% of equity | Gross stays ≤ 50% | Uses headroom the current risk policy already allows |
| **B. Increase gross exposure** | e.g. the registered 50% SPY core + 50% fully invested sleeve | ≈ 99% | **Risk-policy change.** Calling the SPY part a separate "core" sleeve does not exempt it from the 50% cap: an owner decision with new limits |
| **C. Change the risk policy itself** | e.g. a volatility target, a different cap, or leverage | any | Owner decision; out of scope |

No analysis below may relabel B as A.

## 3. Research verdict on a new challenger (decided now, before computation)

**`NO_NEW_CHALLENGER`.** Policy A is not a genuinely distinct hypothesis under the existing promotion gates.

**A is algebraically fixed by measured components.** Let:
- `s` = the sleeve's weight;
- `f` = the SPY fill weight, with `s + f ≤ 0.5`;
- `R_S` = the momentum sleeve's return; `R_SPY` = SPY's return.

Ignoring weekly-rebalancing and cost terms:
- **Fill policy − current** = `f × R_SPY`. It beats the current rules only by adding SPY exposure. That is exactly the
  recorded disposition of `stocks:exposure-core-satellite`, so it would duplicate that hypothesis inside the cap.
- **Fill policy − SPY at matched exposure** = `s × (R_S − R_SPY)`, the selection gap scaled by `s`. It was negative in
  every inspected period:
  - v3: −4.5 points a year;
  - round 3: holdrank10 0.49 vs 1.27 holdout Sharpe;
  - round 4: cashaware 0.48 vs 1.27.

  The existing R3 gate ("beats SPY at its own exposure") therefore cannot be passed by adding SPY. The outcome is
  determined by the selection gap already measured.

**B is already registered** (`lab-stock-v3-core-satellite`, RUNNING forward only). Re-registering it would duplicate it,
and it is a risk-policy change in any case.

**No independent confirmation data exists.** Rounds 1–4 and v3 inspected every historical period, 2017-01-01 to
2026-11-18. The only untouched evidence is forward.

**A is not implementable as specified at $1,000:**
- **Whole shares:** one SPY share costs several hundred dollars (the exact 2026-11-18 open is recorded from the run's data), while the headroom under the cap is about $110–200.
  The live controller refuses fractional quantities (`FRACTIONAL_QUANTITY`).
- **Alternatives:** a lower-priced S&P 500 ETF, or fractional/notional orders. Either needs a universe and controller
  change: an owner and Codex decision, not research.

Consequently, nothing is pre-registered as a challenger in this milestone. The computation below is **descriptive**. It
quantifies the components and cannot create a challenger after the fact. If it contradicts the algebra (for example, A
beating SPY at matched exposure), that is reported as an anomaly to investigate, not as a discovery.

## 4. Descriptive total-account comparison (fixed before computation)

**Data:**
- the same source as rounds 3–4: Alpaca SIP daily bars from 2016-01-01, raw and all-adjusted, read-only, universe
  `large-cap-v1-2026-11-09`;
- end **2026-11-18**;
- run through `stock-weekly-backtest.yml` with round `5`, which calls `analytics/stock_idle_cash_v1.py`;
- every period is **inspected** (exploratory).

**Account and execution:**
- $1,000 start; weekly decisions at the first session of each ISO week; fills at the open;
- valuation on the all-adjusted close;
- **10 bps per side on every trade, SPY included**; 25 bps sensitivity;
- cash at 0%.

| Row | Definition | Category |
|---|---|---|
| `current` | live momentum rules, whole shares (round 3 `current`, unchanged) | baseline, idle cash at 0% |
| `holdrank10` | round 3 challenger, unchanged | tested alternative, idle cash at 0% |
| `current+spy-fill` | `current`, plus SPY held at `max(0, 50% of equity − sleeve value)` after the sleeve trades. Fractional SPY (idealized; not implementable today). SPY is re-targeted at each weekly decision, and sleeve buys are funded from SPY before cash. | A: idle cash replaced within the cap |
| `current+spy-fill-whole` | the same with whole SPY shares (`floor(target / SPY open)`) | A, as implementable today (shows the whole-share constraint) |
| `holdrank10+spy-fill` | `holdrank10` plus the same fractional fill | A |
| `core-satellite-v3` | the registered recipe recomputed: `mix(SPY 100%, momentum sleeve at 20% per pick fractional, 0.5)` | B: gross ≈ 99%, risk-policy change |

**Benchmarks:**
- SPY at 50% plus cash: the total-account benchmark for the 50% policy;
- SPY 100%: the benchmark for policy B;
- SPY at each row's own realized exposure (matched).

**Metrics, per period (development 2017–2022, holdout 2023 → 2026-11-18, full):**
- CAGR, volatility, Sharpe, Sortino, maximum drawdown;
- average and minimum gross invested;
- turnover per average equity, costs paid, and metrics at 25 bps.

**Uncertainty.** Paired weekly circular block bootstrap (8-week blocks, 2,000 replicates, seed 20261120), 95% intervals
on the Sharpe difference and the mean weekly difference for:
- `current+spy-fill` − `current`;
- `current+spy-fill` − SPY at its exposure;
- `current+spy-fill` − SPY 50%;
- `holdrank10+spy-fill` − `holdrank10`;
- `core-satellite-v3` − SPY at its exposure;
- `core-satellite-v3` − SPY 100%.

**Integrity checks:**
- `current` and `holdrank10` must reproduce round 3 exactly;
- `core-satellite-v3` must be consistent with v3's recorded direction: below exposure-matched SPY in the holdout. Exact
  numbers differ because the data end and universe revision differ from v3's.

## 5. Survivorship and point-in-time limitations (recorded before results)

**Universe survivorship.**
- `universe-large-cap-v1` is a 2026 list of 135 survivors. `first_traded_on` is a declared lower bound (2015-01-02 for
  every member), not an IPO or index-entry date.
- Companies that were large in 2017–2025 but were acquired, delisted or shrank are absent. For example, EA was removed
  after its 2026-08-04 cash merger and so is absent from every historical week, including the years it traded.
- Sector labels are current maintainer assignments.

**What the bias affects.** It inflates every **stock-selection** sleeve. It does not inflate SPY, which is a
point-in-time index fund, so comparisons that add SPY are biased in the sleeve's favour on the selection side only.
Correcting this needs point-in-time constituents, which are not collected (a paid source and an owner decision).

**Missing point-in-time data:** no fundamentals, no point-in-time membership, no historical borrow or spread data.

**Fill assumptions:** fills at the open, not live limit orders, and no SPY dividend withholding.

## 6. Prospective shadow-testing protocol (measurement only)

**Purpose.** Measure, from the live PAPER account's own records, how much capital sits idle and what each idle-cash
policy would have returned. This informs an owner portfolio-policy decision. It is **not** a challenger, never promotes,
and sends no order.

**Start.** The first ISO week after the Nov 23 supervised session in which the account holds filled positions, i.e. no
earlier than the week of 2026-11-30. It never runs during, or interferes with, a supervised session.

**Inputs per week.** Codex already records these at each decision and reconcile:
- after-close equity, cash and sleeve market value from the reconcile snapshot;
- SPY's adjusted close for the same session, from a public read-only bar.

**Computed per week** (`analytics/stock_idle_cash_v1.py`, `shadow_week` / `summarize_shadow`, pure functions):

| Measure | Definition |
|---|---|
| Actual account | the account's own return; idle cash at 0% |
| Gross used | sleeve value ÷ equity |
| Idle within the cap | `max(0, 50% − gross used)` |
| Idle beyond the cap | 50% |
| Shadow A | the actual return plus `idle within the cap × SPY return`, minus 10 bps on the weekly change in the fill, notional (fractional) |
| Shadow A at 25 bps | the same at 25 bps |
| SPY at actual gross | SPY return × gross used |
| SPY at 50% | 0.5 × SPY return |
| SPY at 100% | context only; that would be a risk-policy change |

**Reporting.** Cumulative and weekly, with 95% block-bootstrap intervals once there are at least 26 weeks:
- actual vs SPY at actual gross: the live selection gap;
- shadow A vs actual: the value of filling idle cash within the cap;
- shadow A vs SPY at 50%: the 50% policy benchmark.

**Gates.**
- **Minimum before any statement:** 26 weekly observations (the registry `minWeeks`).
- **No recommendation to adopt A is possible from the shadow alone.** By construction, A beats the actual account
  exactly when SPY's return is positive, and it can only match SPY at matched exposure if the live selection gap is zero.
- **What the shadow measures:**
  1. how large the idle cash really is under whole shares at today's prices;
  2. whether the live selection gap seen historically persists forward, measured against SPY at actual gross.

**Owner decisions that would be required** (none are taken here):
1. whether a passive core is acceptable at all (policy B is a risk-policy change);
2. if so, its instrument: whole-share SPY is infeasible at $1,000, so a lower-priced S&P 500 ETF or fractional orders;
3. new limits, under a separate PAPER registration, implemented by Codex.
