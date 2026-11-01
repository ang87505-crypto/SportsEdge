# Weekly strategy backtest: plan, written before any result

Date: 2026-11-01. The owner asked to "improve the algorithm or do more back testing".
This plan, the code (`analytics/stock_weekly_backtest_v1.py`) and the variant list were committed
**before any historical result existed**. Nothing will be added to or removed from the list
after results are seen. Results will be recorded in a separate results document.

## What is tested

The two live weekly PAPER strategies, on the live universe and with the live rules:
- **momentum**: `stock-v2-weekly-1`, model `stock-mom252-skip21-trend200-v1`;
- **steady**: `stock-v3-steady-weekly-1`, model `stock-lowvol252-trend200-v1`;
- **combined**: the two accounts added together.

There are also six pre-registered variants, one change each, all implementable with the frozen
planner (10% of equity per pick):

| Variant | Change |
|---|---|
| `momentum-buffer10`, `steady-buffer10` | Keep a holding while it ranks in the top 10, to cut trading (the existing hold-buffer idea) |
| `momentum-monthly`, `steady-monthly` | Rebalance on the first session of each month instead of each week |
| `momentum-6m` | 6-month momentum (126 sessions, still skipping the latest 21) |
| `steady-6m` | 126-session volatility |

## Rules mirrored from live

These rules are described in the module docstring:
- the 253-session window;
- the total-return index from Alpaca all-adjusted closes;
- raw close and raw volume for the $5 floor, the $20M dollar-volume floor and the $95 cap;
- the trend filter;
- at most 5 picks, at most 2 per sector, 10% each, cash otherwise;
- stocks that aren't picked are sold;
- a held stock that can't be scored freezes that week, as the live decision would be rejected.

Trades are at the decision session's open. Costs are 10 bps per side, with 25 bps reported for
the live strategies. A continuing pick is not rebalanced for less than one whole share.

## Data

Alpaca market data, SIP feed, daily bars, raw and all-adjusted, from 2016-01-01, symbols mapped
as of the end date. The data is downloaded inside the GitHub workflow
`stock-weekly-backtest.yml`, which runs manually and makes read-only GETs. Raw data is not
committed.

## Periods and rule

- Development: 2017-01-01 to 2022-12-31.
- Holdout: 2023-01-01 to the end date.
- A variant is **PROMISING** only if:
  - its Sharpe ratio beats its own baseline in **both** periods; and
  - its holdout maximum drawdown is no more than 5 percentage points worse.
- Otherwise it is **NOT_BETTER**.
- A promising variant can become a new, separately registered paper strategy. It never replaces
  a running one.

Comparisons are against SPY total return, and against **50% SPY + 50% cash**. That second one
is the fair benchmark, because the strategies hold at most 50% in stocks.

## Known limits, stated before the results

- **Survivorship bias.** The universe is today's large caps mapped backwards. This flatters
  every strategy, so these results are not research evidence for the frozen model.
- **Fractional shares.** The test buys fractional shares, while the $1,000 live accounts buy
  whole shares; this changes small-account results.
- **Fills.** They use the session open, not the live 09:50 limit orders.
- **Cash.** Cash earns nothing.
- **One path.** There is one historical path, with no confidence intervals. A few years can
  dominate the result.
