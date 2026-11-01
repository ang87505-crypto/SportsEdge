# Weekly strategy backtest, round 2: results (run 2026-11-01)

The plan was committed before this run, as `docs/STOCK_WEEKLY_BACKTEST_ROUND2_PLAN_2026_11_01.md`
(commit `48fe1a1`).

| | |
|---|---|
| Run | GitHub Actions run 41259810976, round 2 |
| Data | The same as round 1: SIP daily bars, 2016-01-04 to 2026-10-30, 136 members plus SPY |
| Costs | 10 bps per side |

**This round is weaker evidence than round 1.** Round 1 had already shown the 2023–2026
holdout. The test is **not survivorship-free**, and that bias matters most for the no-cap
momentum variants. They can pick today's biggest winners, which are in the list *because*
they won: for example, a stock that became a mega-cap after 2023.

## Full period, 2017-01-01 to 2026-10-30 (growth of $1,000)

| Strategy | Most invested | End value | CAGR | Sharpe | Max drawdown | Turnover per year* |
|---|---|---|---|---|---|---|
| momentum (live) | 50% | $1,862 | 6.5% | 0.55 | -24.4% | 12× |
| steady (live) | 50% | $1,451 | 3.9% | 0.54 | -14.6% | 9× |
| momentum-nocap | 50% | $3,925 | 15.0% | 0.87 | -21.0% | 21× |
| steady-nocap | 50% | $1,300 | 2.7% | 0.39 | -15.0% | 10× |
| momentum-full | 100% | $3,187 | 12.6% | 0.60 | -43.5% | 31× |
| steady-full | 100% | $1,984 | 7.2% | 0.54 | -27.7% | 21× |
| momentum-nocap-full | 100% | $9,333 | 25.6% | 0.88 | -38.8% | 71× |
| steady-nocap-full | 100% | $1,625 | 5.1% | 0.41 | -28.0% | 24× |
| momentum-buffer10-nocap-full | 100% | $9,661 | 26.0% | 0.90 | -39.4% | 35× |
| momentum-6m-nocap-full | 100% | $15,918 | 32.6% | 1.07 | -47.5% | 148× |
| combined (live) | 50% | $1,656 | 5.3% | 0.61 | -16.5% | |
| combined-nocap-full | 100% | $5,479 | 19.0% | 0.85 | -33.1% | |
| SPY 50% + cash 50% | 50% | $2,040 | 7.5% | 0.86 | -18.3% | |
| SPY 100% | 100% | $3,866 | 14.8% | 0.86 | -33.8% | |

\*Turnover is traded value per year divided by the *starting* $1,000, so it grows as the
account grows.

## Development (2017–2022) and holdout (2023 to 2026-10-30) Sharpe ratios against the matching benchmark

| Strategy | Development Sharpe | Benchmark Sharpe | Holdout Sharpe | Benchmark Sharpe | Holdout max drawdown |
|---|---|---|---|---|---|
| momentum-nocap | 0.71 | SPY 50%: 0.63 | 1.09 | SPY 50%: 1.36 | -19.9% |
| momentum-nocap-full | 0.74 | SPY: 0.63 | 1.12 | SPY: 1.36 | -27.7% |
| momentum-buffer10-nocap-full | 0.84 | SPY: 0.63 | 1.01 | SPY: 1.36 | -28.4% |
| momentum-6m-nocap-full | 1.11 | SPY: 0.63 | 1.02 | SPY: 1.36 | -27.3% |
| combined-nocap-full | 0.70 | SPY: 0.63 | 1.07 | SPY: 1.36 | -23.3% |
| steady-nocap-full | 0.45 | SPY: 0.63 | 0.33 | SPY: 1.36 | -13.6% |

## Pre-registered verdicts

- **vs_spy: every variant is BELOW_SPY.** The no-cap momentum variants beat the matching
  benchmark in 2017–2022 but not in 2023–2026, when SPY's Sharpe was 1.36.
- **vs_live: every variant is NOT_BETTER.** The no-cap momentum variants had higher Sharpe
  ratios than live momentum in both periods. They still failed, because their holdout drawdown
  was more than 5 points worse; for example, -19.9% against -11.2%.
- **A flaw in this rule, recorded and not changed:** the drawdown condition compares 100%
  invested with 50% invested, so a fully invested variant could hardly pass it. For those
  variants the vs_spy rule is the meaningful one.

## What this says

1. **The $95 cap is what held momentum back.** Without it, momentum had a higher Sharpe
   ratio in both periods and finished ahead of SPY over the full period. Steady stocks got
   *worse* without the cap.
2. **Full investment scales gains and losses together.** The no-cap momentum variants made
   9–16 times the money on paper, but they fell 39–48% at their worst, against 34% for SPY.
3. **None of it passes the pre-registered bar.** In the untouched-style holdout (2023–2026),
   SPY alone was better on a risk-adjusted basis than every variant.
4. **Survivorship bias inflates exactly these winners.** Treat the $9,000–$16,000 figures as
   an upper bound, not an expectation.
5. **Using these variants would need owner decisions:**
   - a larger paper balance, for whole shares above $95;
   - a new planner version, for 20% per pick and 100% invested;
   - new risk limits, under a new registration on its own paper account.

   Nothing running changes.
