# Weekly strategy backtest, round 2: the account-size limits (plan, written before the run)

Date: 2026-11-01. In round 1 (`docs/STOCK_WEEKLY_BACKTEST_RESULTS_2026_11_01.md`), neither live
strategy beat a benchmark of 50% SPY plus 50% cash. Two structural limits come from the $1,000
account, not from the stock-picking rule:
- **10% per pick**, which caps the stock exposure at 50%;
- the **$95 price cap**, which exists so that whole shares fit in about $100.

The owner approved testing what happens without them. The variant list and both rules below
were committed before this run. Nothing will be added or removed after it.

## Variants

All variants are weekly, with the live ranking, filters, sector cap and costs (10 bps per side).

| Variant | Price cap | Per pick | Most invested |
|---|---|---|---|
| `momentum`, `steady` (live, repeated as baselines) | $95 | 10% | 50% |
| `momentum-nocap`, `steady-nocap` | none | 10% | 50% |
| `momentum-full`, `steady-full` | $95 | 20% | 100% |
| `momentum-nocap-full`, `steady-nocap-full` | none | 20% | 100% |
| `momentum-buffer10-nocap-full` | none | 20% | 100% (round 1's top-10 hold buffer) |
| `momentum-6m-nocap-full` | none | 20% | 100% (round 1's 6-month momentum) |
| `combined`, `combined-nocap-full` | | | The two accounts summed, 50/50 |

## Rules

- **vs_live:** the round-1 rule, against the live strategy of the same model. The variant's
  Sharpe must be higher in both the development period (2017–2022) and the holdout period
  (2023 to the end date), and its holdout drawdown no more than 5 points worse.
- **vs_spy:** the variant's Sharpe must be above the benchmark with the same exposure, in
  **both** periods. Variants with 10% per pick compare with 50% SPY plus 50% cash; variants
  with 20% per pick compare with 100% SPY.

## Honesty notes, stated before the run

- **The holdout has already been seen.** Round 1 already reported 2023–2026, so this round
  has no untouched period: a pass is weaker evidence than in round 1. Alpaca's data begins
  in 2016, so no earlier period exists. The only clean test from here is forward paper
  trading.
- **The live system can't trade these as they stand:**
  - Dropping the cap needs a larger paper balance, because whole shares of a $400 stock don't
    fit in $100.
  - Fully invested needs a new planner version (it allows 10% per target and at most 50% in
    total) and new risk limits for a new registration.
  - Both are owner decisions. Nothing running changes.
- **The round-1 limits still apply:** survivorship bias, fractional shares, fills at the open,
  and cash earning nothing.
