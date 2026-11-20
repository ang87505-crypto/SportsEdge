# Stock challenger `stock-mom252-skip21-trend200-cashaware-v1`: results (2026-11-20)

**Verdict: `FAILS`.** In the learning registry this proposes `REJECTED` (proposal only; the registry is not edited
here).

The challenger did what it was built to do: holdout capital utilization rose from **39.0% to 46.5%** (R0 passes). The
extra money behaved like more of the same strategy, not a better one.
- **Return:** CAGR rose about 0.6 points.
- **Risk-adjusted return:** Sharpe was flat (0.45 → 0.45 over the full period).
- **Downside:** the worst drawdown deepened by 3.3 points.
- **Trading and costs:** turnover and costs rose, and at 25 bps the challenger was clearly worse.
- **Against SPY:** it stayed far below SPY held at the same exposure.

Nothing is activated, and nothing that trades changed.

## Run and provenance

| Item | Value |
|---|---|
| Rules | `docs/STOCK_CHALLENGER_CASHAWARE_PREREG_2026_11_20.md`, commit `1241c0f` at 21:39:45 UTC, before the run |
| Code | `a22581e` (implementation and tests, no results), 21:39:46 UTC |
| Run | [44822315095](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44822315095): `stock-weekly-backtest.yml`, round 4, end 2026-11-18, on `a22581e`, started 21:39:55 UTC. Read-only market data; no orders, no account data. |
| Data | SIP daily bars 2016-01-04 to 2026-11-18 (2,736 sessions, 77 GETs); 135 members with data plus SPY; universe `large-cap-v1-2026-11-09` |
| Result file | `research/stock_challenger_cashaware_20261120/results.json`, the run's printed `RESULTS_JSON` |
| Reproduction | `bt.markdown(results)` re-renders the run log's tables exactly, and `verdicts_round4(results)` returns the recorded verdict (locked by a regression test) |
| Integrity | The `current` and `holdrank10` rows reproduce round 3 exactly: 4.3% / 0.45 / −19.7% and 6.0% / 0.62 / −14.9% in development; 8.9× and 3.9× turnover; 0.40 and 0.57 full Sharpe at 25 bps |
| Evidence class | **Exploratory.** Rounds 1–3 inspected every historical period, and the data cannot provide an untouched one. |

## Results: whole shares from $1,000, 10 bps per side

| Period | Row | CAGR | Vol | Sharpe | Sortino | Max DD | Avg invested |
|---|---|---:|---:|---:|---:|---:|---:|
| Dev 2017–2022 | current | 4.3% | 10.5% | 0.45 | 0.61 | −19.7% | 39.0% |
| | **cashaware** | 4.8% | 12.3% | **0.44** | 0.60 | **−23.0%** | 46.0% |
| | holdrank10 (tested before) | 6.0% | 10.1% | 0.62 | 0.85 | −14.9% | 38.1% |
| | SPY at cashaware exposure (46%) | 5.3% | 8.9% | 0.63 | — | −16.9% | 46% |
| Holdout 2023 → 2026-11-18 | current | 3.5% | 8.0% | 0.47 | 0.67 | −8.7% | 39.0% |
| | **cashaware** | 4.2% | 9.6% | **0.48** | 0.68 | −10.1% | **46.5%** |
| | holdrank10 | 3.8% | 8.2% | 0.49 | 0.70 | −8.9% | 38.7% |
| | SPY at cashaware exposure (46%) | 9.0% | 7.0% | 1.27 | — | −9.0% | 46% |
| Full | current | 4.0% | 9.6% | 0.45 | 0.62 | −19.7% | 39.0% |
| | **cashaware** | 4.6% | 11.3% | 0.45 | 0.62 | −23.0% | 46.2% |
| | holdrank10 | 5.1% | 9.4% | 0.57 | 0.79 | −14.9% | 38.4% |
| | SPY at cashaware exposure | 6.8% | 8.2% | 0.84 | — | −17.0% | 46% |
| | SPY 100% | 14.3% | 17.9% | 0.84 | — | −33.8% | 100% |

**Trading, costs and capital** (whole run, $1,000 start):

| Row | Turnover per avg equity / yr | Costs paid (10 bps) | Costs % of avg equity / yr | Full Sharpe at 25 bps | Full CAGR at 25 bps | Holdout Sharpe at 25 bps |
|---|---:|---:|---:|---:|---:|---:|
| current | 7.2× | $87.82 | 0.7% | 0.40 | 3.4% | 0.38 |
| **cashaware** | **8.6×** | **$106.06** | 0.9% | **0.30** | 2.8% | 0.34 |
| holdrank10 | 3.0× | $38.27 | 0.3% | 0.57 | 5.1% | 0.56 |

**Cash drag** (SPY 100% CAGR minus SPY at the row's exposure):
- full period: current 8.6 points, cashaware 7.5 points;
- holdout: current 12.1 points, cashaware 10.6 points.

The challenger reclaimed about 1.1–1.5 points of the drag. It earned less on that capital than SPY would have.

**Uncertainty.** Paired weekly circular block bootstrap (8-week blocks, 2,000 replicates, seed 20261120):

| Period | Comparison | Weeks | Sharpe difference [95%] | Mean weekly difference [95%] |
|---|---|---:|---|---|
| Dev | cashaware − current | 312 | −0.00 [−0.14, +0.14] | +0.013% [−0.027%, +0.050%] |
| Holdout | cashaware − current | 203 | +0.01 [−0.36, +0.34] | +0.015% [−0.055%, +0.083%] |
| Holdout | cashaware − SPY at its exposure | 203 | −0.85 [−1.76, +0.02] | −0.082% [−0.224%, +0.066%] |
| Full | cashaware − current | 515 | +0.00 [−0.16, +0.15] | +0.014% [−0.023%, +0.050%] |
| Full | cashaware − holdrank10 | 515 | −0.12 [−0.36, +0.10] | −0.007% [−0.057%, +0.042%] |
| Full | cashaware − SPY at its exposure | 515 | −0.40 [−0.91, +0.04] | −0.034% [−0.121%, +0.054%] |

Against the current rules, the challenger's risk-adjusted difference is indistinguishable from zero in every period.

## Pre-registered rules

| Rule | Result | Why |
|---|---|---|
| R0: holdout invested ≥ current + 5 pts | **pass** | 46.5% vs 39.0% (+7.5 pts) |
| R1: beats current | **fail** | Development Sharpe 0.443 vs 0.449 (lower), and turnover per average equity 8.6× vs 7.2× (higher). Holdout Sharpe 0.478 vs 0.473 and holdout drawdown −10.1% vs −8.7% (within 5 points) were not enough. |
| R2: full Sharpe at 25 bps above current | **fail** | 0.30 vs 0.40 |
| R3: beats SPY at its own exposure, dev and holdout | **fail** | Development 0.44 vs 0.63; holdout 0.48 vs 1.27 |

## Allocation and turnover analysis

1. **Why about 30% was invested on Nov 16.**
   - **Design ceiling:** five picks × `floor(equity/10)` under `GROSS_CAP = equity/2` cap the plan at 50%.
   - **Floor rounding:** whole-share floor rounding of $50–79 stocks then buys exactly 1 share each, so about $300 is
     invested. Under the challenger's rule, any pick below $66.67 would have bought 2 shares; CSX, for example, opened
     at $52.43.
   - **Not the cause:** a cash shortage, the sector cap or missing quotes (0 cash-blocked decisions in every row).
   - **Historical average:** over 2017–2026, whole shares averaged 39% invested against 53% fractional.
2. **Investing the idle cash in the same picks does not improve risk-adjusted return.**
   - CAGR rises roughly in proportion to exposure (+0.6 points full period), and volatility rises with it (+1.7 points).
   - Sharpe stays the same: a sizing rule cannot add selection skill.
   - The same extra capital in SPY earns far more. At the challenger's 46% exposure, SPY returned 6.8% a year against
     4.6% over the full period, and 9.0% against 4.2% in the holdout.
3. **Nearest-share rounding raises turnover.**
   - Bigger positions sit closer to share boundaries, so the share count changes more often: the nearest-only ablation
     traded 9.5× against 7.2×.
   - The 5–15% band removed part of that (cashaware 8.6×), but not enough to get below current.
   - The band alone (`cashaware-band-only`) cut turnover to 6.7× but lowered Sharpe (0.43). The ±1-share churn of
     continuing picks is real but small next to rank-change turnover.
4. **Rank stability matters more than sizing.**
   - The previously tested hold buffer (holdrank10) cut turnover to 3.0× and had the best full-period Sharpe among the
     whole-share rows (0.57).
   - Even so, it stays below SPY at matched exposure (0.84).
5. **The combination row is descriptive only.**
   - `holdrank10-cashaware` had the best holdout row: 6.3% CAGR, Sharpe 0.63, turnover 3.2×.
   - In development it was worse than holdrank10 alone (0.50 vs 0.62), and it is far below matched SPY (0.63 vs 1.27
     in the holdout).
   - It was not the pre-registered challenger, and it was picked from seven rows after seeing results. It is **not**
     an independent discovery. Testing it would need its own pre-registration and new forward data.
6. **Fractional shares are excluded.** They would invest the planned 50%, but the live controller refuses fractional
   quantities and the release is whole-share only. The fractional reference row (full Sharpe 0.53, drawdown −25.2%)
   shows the same exposure-scaling pattern.

## What this says

- **We can raise capital utilization by about 7 points without new limits.** It does not improve risk-adjusted returns:
  - drawdown and costs get worse;
  - it does not survive 25 bps.
- **The binding problem is selection, not allocation.** Every whole-share row stays below SPY at matched exposure, in both
  periods. This confirms rounds 2 and 3.
- **No new forward test is established.** The pre-registered rule says a `FAILS` verdict is `REJECTED`, so no forward
  registration is proposed for this challenger. The forward window code stays in place for any re-run.

## Registry proposal (not applied)

`research/stock_challenger_cashaware_20261120/registry-proposal.json` holds a `lab-stock-cashaware-wholeshare` entry
(hypothesis key `stocks:cash-aware-whole-share-sizing`) with status `REJECTED` and this result. The shared registry is
Codex's and is not edited here.

## Recommendations for Codex and the owner

**Change nothing that trades:**
- `stock-v2-weekly-1`, its planner sizing, `GROSS_CAP`, risk limits, bankroll and the Nov 23 supervised session stay
  as they are;
- do not switch the planner to nearest-share sizing.

**Record the Nov 16 utilization finding:** the plan was at most 50% by design and about 30% in practice. Any live
comparison against SPY should use SPY at the account's **actual** invested share, not 50%.

**Keep holdrank10 forward-only as registered.** It is the only allocation/turnover change that improved on the live
rules, and it still has not beaten matched SPY.

**Possible next research, owner decision, separate pre-registration.** Every stock variant to date loses to SPY at
matched exposure, so the question worth testing is *how idle capital should be held*:
- for example, putting the unused budget in SPY;
- `lab-stock-v3-core-satellite`, already registered and RUNNING.

That is not a new stock-selection rule, and it is not part of this PR.

## Limits

- **Universe:** survivorship-biased (today's large-cap list), which flatters every row and the SPY comparison.
- **Fills and cash:** at the open, not at live limit prices; cash earns 0%.
- **Not modelled:** the daily-notional and order-count caps.
- **One path:** there is one historical path, and every historical period has already been inspected.

A historical result is not evidence of future profit. Everything here is paper and research only.
