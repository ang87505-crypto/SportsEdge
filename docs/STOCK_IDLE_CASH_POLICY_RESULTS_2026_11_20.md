# Idle-cash portfolio policy and core-satellite forward design: results (2026-11-20)

**Research verdict: `NO_NEW_CHALLENGER`.** This was decided in the plan before any computation, and the descriptive
numbers below confirm it. A prospective, measurement-only shadow protocol is delivered instead. Nothing is registered,
promoted or activated. No order was sent, and no limit, bankroll or strategy changed.

Plan: `docs/STOCK_IDLE_CASH_POLICY_PLAN_2026_11_20.md` (commit `accdebc`, 22:11:50 UTC, before any run).

## Runs and provenance

| Item | Value |
|---|---|
| Code | `analytics/stock_idle_cash_v1.py` (round 5), called by the manual read-only `stock-weekly-backtest.yml` |
| **Valid run** | [44828158320](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44828158320) on `e83286d`, 22:20:38–22:22:38 UTC |
| Invalid run (kept on record) | [44827627293](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44827627293) on `23454f7`. A cash double count in the SPY fill (see below) produced impossible fill rows: development CAGR +99%, Sharpe 3.7. |
| Data | SIP daily bars 2016-01-04 to 2026-11-18 (2,736 sessions, 77 read-only GETs), 135 members plus SPY, universe `large-cap-v1-2026-11-09` |
| Result file | `research/stock_idle_cash_20261120/results.json`, the valid run's printed `RESULTS_JSON`. `markdown(results)` re-renders the run log exactly, and a regression test locks the findings. |
| Integrity | `current` and `holdrank10` reproduce round 3 exactly (development Sharpe 0.45; holdrank10 full Sharpe at 25 bps 0.57). `core-satellite-v3` matches v3's direction: below SPY at matched exposure. |
| Evidence class | **Exploratory.** Rounds 1–4 and v3 had already inspected every period. |

**The bug and its fix.**
- **Cause:** `replay_fill` funded sleeve buys from cash plus the SPY holding, then charged only the *change* in SPY rather
  than the full new holding. That credited the old SPY value as free cash every week.
- **How it was caught:** the plan's algebra flagged the impossible rows before any write-up.
- **Fix:** commit `e83286d`. A new conservation test (flat prices and zero costs must keep equity at $1,000) fails on the
  old code ($1,500) and passes now.
- **Rows not affected:** the current and holdrank10 rows, the whole-share fill (which never held SPY) and core-satellite
  do not use that path. They are identical in both runs.

## Results: total account from $1,000, whole-share sleeve, 10 bps per side including SPY

| Period | Row | Category | CAGR | Vol | Sharpe | Sortino | Max DD | Avg gross |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Dev 2017–22 | current | baseline, idle cash | 4.3% | 10.5% | 0.45 | 0.61 | −19.7% | 39.0% |
| | holdrank10 | tested, idle cash | 6.0% | 10.1% | 0.62 | 0.85 | −14.9% | 38.1% |
| | current + SPY fill | A, within the cap | 6.1% | 12.3% | 0.54 | 0.74 | −21.1% | 49.9% |
| | holdrank10 + SPY fill | A, within the cap | 7.2% | 12.0% | 0.64 | 0.87 | −18.8% | 49.9% |
| | core-satellite-v3 | B, gross ≈ 100% | 11.2% | 21.0% | 0.61 | 0.82 | −33.7% | 100.7% |
| | **SPY 50%** | 50%-policy benchmark | 5.8% | 9.7% | **0.63** | 0.86 | −18.3% | 50% |
| | SPY 100% | B's benchmark | 11.0% | 19.5% | 0.63 | 0.87 | −33.8% | 100% |
| Holdout 2023 → 2026-11-18 | current | | 3.5% | 8.0% | 0.47 | 0.67 | −8.7% | 39.0% |
| | holdrank10 | | 3.8% | 8.2% | 0.49 | 0.70 | −8.9% | 38.7% |
| | current + SPY fill | A | 5.0% | 9.1% | 0.59 | 0.83 | −9.0% | 50.0% |
| | holdrank10 + SPY fill | A | 7.8% | 9.5% | 0.84 | 1.21 | −9.0% | 50.0% |
| | core-satellite-v3 | B | 16.3% | 16.1% | 1.02 | 1.47 | −16.3% | 101.0% |
| | **SPY 50%** | | 9.7% | 7.5% | **1.27** | 1.88 | −9.7% | 50% |
| | SPY 100% | | 19.7% | 15.1% | 1.27 | 1.88 | −18.8% | 100% |
| Full | current | | 4.0% | 9.6% | 0.45 | 0.62 | −19.7% | 39.0% |
| | holdrank10 | | 5.1% | 9.4% | 0.57 | 0.79 | −14.9% | 38.4% |
| | current + SPY fill | A | 5.7% | 11.1% | 0.55 | 0.76 | −21.1% | 50.0% |
| | holdrank10 + SPY fill | A | 7.5% | 11.1% | 0.70 | 0.97 | −18.8% | 50.0% |
| | core-satellite-v3 | B | 13.2% | 19.2% | 0.74 | 1.01 | −33.7% | 100.8% |
| | **SPY 50%** | | 7.3% | 8.9% | **0.84** | 1.17 | −18.3% | 50% |
| | SPY 100% | | 14.3% | 17.9% | 0.84 | 1.18 | −33.8% | 100% |

**Costs, turnover and implementability** (whole run):

| Row | Turnover per avg equity / yr (SPY part) | Costs paid | Full CAGR / Sharpe at 25 bps |
|---|---|---:|---|
| current | 7.2× (0) | $87.82 | 3.4% / 0.40 |
| holdrank10 | 3.0× (0) | $38.27 | 5.1% / 0.57 |
| current + SPY fill (fractional) | 8.4× (1.0×) | $111.70 | 4.0% / 0.41 |
| current + SPY fill, **whole shares** | 7.2× (0): **never held SPY** | $87.82 | identical to current |
| holdrank10 + SPY fill (fractional) | 4.3× (1.0×) | $61.53 | 6.8% / 0.65 |
| core-satellite-v3 | 8.0× (0) | $152.22 | 12.0% / 0.69 |

**Whole-share check.**
- SPY opened at **$733.37** on 2026-11-18.
- The current account ended at $1,467.36 with 32.8% gross. That leaves $252.33 of headroom under the cap, which buys
  **0 SPY shares**.
- In whole shares, the fill held SPY on **0 of 2,483 sessions** since 2017.
- The fractional fill averaged 11.4% of equity.

**Uncertainty.** Paired weekly circular block bootstrap (8-week blocks, 2,000 replicates), 95%:

| Comparison | Holdout Sharpe diff | Full Sharpe diff | Full mean weekly diff |
|---|---|---|---|
| current + fill − current | +0.11 [−0.12, +0.37] | +0.11 [−0.03, +0.25] | +0.034% [+0.004%, +0.065%] |
| current + fill − SPY 50% (= matched) | **−0.74 [−1.45, −0.05]** | −0.30 [−0.71, +0.06] | −0.025% [−0.094%, +0.045%] |
| holdrank10 + fill − holdrank10 | +0.36 [+0.15, +0.62] | +0.13 [+0.01, +0.27] | +0.045% [+0.019%, +0.072%] |
| core-satellite-v3 − SPY at matched exposure (≈ SPY 100%) | −0.29 [−0.80, +0.20] | −0.11 [−0.38, +0.14] | −0.016% [−0.104%, +0.071%] |

## What this says

1. **Replacing idle cash within the cap (A) behaves exactly as the algebra says.**
   - It adds SPY exposure. Against the current rules it raises full-period CAGR from 4.0% to 5.7% and Sharpe from 0.45 to
     0.55, but the Sharpe interval crosses zero.
   - It deepens the worst drawdown from −19.7% to −21.1%.
   - It stays **below SPY 50%**, the right total-account benchmark for a 50% gross policy, in every period. In the
     holdout the interval excludes zero (Sharpe −0.74 [−1.45, −0.05]).
   - The remaining gap is the momentum sleeve's selection gap. Filling around it does not remove it.
2. **The SPY fill costs more than it looks.**
   - Re-targeting the fill every week adds 1.0× a year of SPY turnover.
   - At 25 bps, the current + fill row falls to Sharpe 0.41, essentially the current rules' 0.40.
   - Any real version would need a no-trade band. That would be a new parameter, and it is not proposed on inspected
     data.
3. **Holdrank10 + fill is the best row inside the 50% policy** (full Sharpe 0.70, holdout 0.84).
   - It is marginally **above** SPY 50% in development (0.640 vs 0.628).
   - It is clearly below in the holdout (0.84 vs 1.27) and over the full period (0.70 vs 0.84). The existing gate needs
     both development and holdout, so it would not pass.
   - It combines a previously tested selection change with SPY exposure, selected after the fact on inspected data, so
     it is not a discovery.
4. **The registered core-satellite (B) is a risk-policy change, not a use of idle cash.**
   - It runs about 100% gross, with a −33.7% worst drawdown against −19.7% for current.
   - It tracks SPY 100% closely and slightly below it (full −0.11 [−0.38, +0.14]).
   - Its recorded v3 disposition (RUNNING forward only, below matched SPY) stands. It is not duplicated here.
5. **None of A can be implemented as specified on the $1,000 account.** One SPY share costs more than the whole cap
   headroom, and the controller refuses fractional quantities.

## Survivorship and point-in-time findings

- **Selection rows are biased upward.** The universe is a 2026 list of 135 survivors, and every member carries the same
  declared `first_traded_on` lower bound (2015-01-02), not a membership date. Names acquired or delisted during
  2017–2026 never appear. EA is absent from every week, including the years it traded. Sector labels are current.
- **SPY is not biased** in this way, since it is a point-in-time index fund. The bias therefore *favours* the sleeve in
  every comparison with SPY, which makes "below SPY 50%" a conservative finding.
- **Correction needs data that is not collected:** point-in-time constituents (a paid source, owner decision) and
  point-in-time fundamentals.
- **Fill assumptions:** fills at the open with bps costs only. No spread, partial-fill or limit-order model; cash earns 0%.

## Prospective shadow-testing protocol (measurement only)

Fixed in plan section 6 and implemented as pure functions: `shadow_week` / `summarize_shadow` in
`analytics/stock_idle_cash_v1.py`, with 6 tests.

**Timing.** It starts with the first ISO week after the Nov 23 supervised session that holds filled positions, no
earlier than the week of 2026-11-30.

**Inputs.** Codex's existing after-close reconcile snapshots (equity, cash, sleeve value), plus SPY's adjusted close.
A week with deposits or withdrawals is refused (`SHADOW_EXTERNAL_FLOW`).

**Output, per week:**
- the actual return;
- the gross used;
- idle cash within the cap and beyond it;
- the shadow fill at 10 and 25 bps;
- SPY at actual gross, SPY 50% and SPY 100%.

**Reporting.** Cumulative results; intervals only after 26 weeks.

**What the shadow can and cannot do.**
- It can measure the real idle cash under whole shares at today's prices, and whether the live selection gap persists,
  against SPY at actual gross.
- It **cannot** justify adopting A: the shadow fill beats the actual account whenever SPY rises, by construction.

## Recommendations requiring owner approval (none are taken here)

1. **Keep the current policy unchanged** for the Nov 23 session and afterwards: `stock-v2-weekly-1`, 10% per pick,
   `GROSS_CAP` 50%, $1,000. Nothing in this evidence supports a change.
2. **Measure, do not trade.** If you want the idle-cash question tracked, ask Codex to wire the shadow ledger to the
   existing reconcile snapshots. It is read-only and outside the order path.
3. **The real decision is policy, not modelling.** Every stock-selection variant to date is below SPY at matched
   exposure. If the goal is total-account return per unit of risk, the evidence points to the index itself.
   - Choosing between "a stock-selection research sleeve held for learning" and "a passive core" is a portfolio-policy
     decision for you.
   - Raising gross above 50% (policy B) needs new limits under a separate PAPER registration.
   - A passive core at $1,000 would need a lower-priced S&P 500 instrument or fractional orders, both
     universe/controller changes for Codex.
4. **Better data before more variants.** Point-in-time constituents and fundamentals are the only route to genuinely
   new historical evidence. Today the only untouched evidence is forward.

## For Codex

- **Activation and production:** nothing to activate. Leave the production allocation, risk limits and the Nov 23
  session untouched.
- **Optional, on owner approval:** call `shadow_week` weekly with the reconcile snapshot and SPY close, and persist the
  rows in a research ledger that is never read by the planner.
- **Merge note:** this branch adds round `5` to `stock-weekly-backtest.yml`, and PR #196 adds round `4` to the same
  input lines. Merging both needs a trivial resolution that keeps both rounds (`['1','2','3','4','5']`, `^[12345]$`).
