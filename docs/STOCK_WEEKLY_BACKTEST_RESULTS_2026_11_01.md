# Weekly strategy backtest: results (run 2026-11-01)

The plan, the code and the variant list were committed before this run, in
`docs/STOCK_WEEKLY_BACKTEST_PLAN_2026_11_01.md` (PR #95, merged as `af90e60`).

| | |
|---|---|
| Run | GitHub Actions `stock-weekly-backtest.yml`, run 41259087271, end date 2026-10-30 |
| Data | 2,723 sessions from 2016-01-04 to 2026-10-30; all 136 members and SPY; 77 read-only requests |
| Costs | 10 bps per side, plus a 25 bps run for the live strategies |
| Shares | Fractional-share approximation |
| Survivorship | **Not survivorship-free**: today's universe, mapped backwards |

**Exploratory only.** These numbers are not evidence for the frozen research model. They are not
a prediction either: they come from one historical path, with no confidence intervals.

## Results (growth of $1,000)

### Full period, 2017-01-01 to 2026-10-30

| Strategy | Total | CAGR | Volatility | Sharpe | Max drawdown |
|---|---|---|---|---|---|
| momentum (live) | +86.2% | +6.5% | 13.1% | 0.55 | -24.4% |
| steady (live) | +45.1% | +3.9% | 7.6% | 0.54 | -14.6% |
| combined (live, 50/50) | +65.6% | +5.3% | 9.1% | 0.61 | -16.5% |
| momentum-buffer10 | +112.0% | +8.0% | 13.0% | 0.65 | -19.9% |
| steady-buffer10 | +68.8% | +5.5% | 7.7% | 0.73 | -14.9% |
| momentum-monthly | +96.6% | +7.1% | 13.1% | 0.59 | -18.1% |
| steady-monthly | +40.1% | +3.5% | 8.0% | 0.47 | -19.6% |
| momentum-6m | +138.2% | +9.3% | 12.1% | 0.79 | -18.7% |
| steady-6m | +39.1% | +3.4% | 7.4% | 0.49 | -14.7% |
| **SPY 50% + cash 50%** (fair benchmark) | **+104.0%** | +7.5% | 8.9% | **0.86** | -18.3% |
| SPY 100% | +286.6% | +14.8% | 17.8% | 0.86 | -33.8% |

### Development period (2017–2022) and holdout period (2023 to 2026-10-30)

| Strategy | Development total | Development Sharpe | Holdout total | Holdout Sharpe | Holdout max drawdown |
|---|---|---|---|---|---|
| momentum | +45.8% | 0.52 | +27.7% | 0.61 | -11.2% |
| steady | +21.1% | 0.44 | +19.9% | 0.74 | -7.9% |
| combined | +33.4% | 0.54 | +24.1% | 0.77 | -6.7% |
| momentum-buffer10 | +57.4% | 0.62 | +34.7% | 0.71 | -11.8% |
| steady-buffer10 | +41.7% | 0.75 | +19.1% | 0.70 | -7.3% |
| momentum-monthly | +73.1% | 0.71 | +13.6% | 0.36 | -11.7% |
| steady-monthly | +15.5% | 0.32 | +21.3% | 0.78 | -7.7% |
| momentum-6m | +85.6% | 0.85 | +28.4% | 0.69 | -8.7% |
| steady-6m | +16.5% | 0.37 | +19.4% | 0.74 | -5.9% |
| SPY 50% + cash 50% | +40.1% | 0.63 | +45.6% | 1.36 | -9.7% |
| SPY 100% | +86.6% | 0.63 | +107.2% | 1.36 | -18.8% |

### Operations, full period

| Strategy | Decisions | Rejected weeks | Turnover per year | Average invested | Full total at 25 bps |
|---|---|---|---|---|---|
| momentum | 512 | 0 | 12.0× | 53% | +73.4% |
| steady | 512 | 0 | 9.3× | 52% | +29.1% |
| momentum-buffer10 | 512 | 0 | 4.8× | 54% | not run |
| steady-buffer10 | 512 | 0 | 4.5× | 53% | not run |
| momentum-monthly | 117 | 0 | 5.5× | 53% | not run |
| steady-monthly | 117 | 0 | 3.8× | 52% | not run |
| momentum-6m | 512 | 0 | 17.4× | 51% | not run |
| steady-6m | 512 | 0 | 9.5× | 52% | not run |

## Pre-registered verdicts

The rule: Sharpe above the baseline's in both periods, and holdout drawdown no more than 5
points worse.

| Variant | Verdict | Why |
|---|---|---|
| momentum-buffer10 | **PROMISING** | Sharpe 0.62 vs 0.52 in development and 0.71 vs 0.61 in holdout; turnover cut from 12× to 4.8× a year |
| momentum-6m | **PROMISING** | Sharpe 0.85 vs 0.52 in development and 0.69 vs 0.61 in holdout; turnover rises to 17× a year |
| steady-buffer10 | NOT_BETTER | Better in development (0.75), slightly worse in holdout (0.70 vs 0.74) |
| steady-6m | NOT_BETTER | Worse in development |
| momentum-monthly | NOT_BETTER | Better in development, much worse in holdout (0.36) |
| steady-monthly | NOT_BETTER | Worse in development |

## What this says

1. **Neither live strategy beat the fair benchmark.**
   - Over the full period, momentum returned +86%, steady +45% and the combination +66%,
     against +104% for 50% SPY plus 50% cash. Their Sharpe ratios were 0.55, 0.54 and 0.61,
     against 0.86.
   - In the holdout years (2023–2026) the gap is wide: the combination made +24% against
     +46%.
   - This is despite survivorship bias, which favours the strategies.
2. **Combining helps a little.** The 50/50 mix has a higher Sharpe ratio (0.61) than either
   strategy alone, and the smallest holdout drawdown (-6.7%).
3. **Two momentum changes passed the pre-registered rule.**
   - The top-10 hold buffer is the cleaner result: better in both periods, with 60% less
     trading.
   - 6-month momentum is also better in both periods, but it trades more and its advantage
     shrank in the holdout.
   - Neither beat the fair benchmark in the holdout.
4. **The structure likely matters more than the ranking rule.** This was not tested in this
   round:
   - At most 50% is invested, and the rest sits in cash earning nothing.
   - The $95 price cap excludes most mega-caps, which drove the index in 2023–2026.
   - Both constraints come from the $1,000 account and the whole-share planner. Testing them
     would need a new pre-registered round, and the holdout above has now been seen.
5. **Costs matter.** At 25 bps per side, momentum drops from +86% to +73% and steady from
   +45% to +29%.

No running strategy is changed by these results. The live paper accounts remain the real test.
