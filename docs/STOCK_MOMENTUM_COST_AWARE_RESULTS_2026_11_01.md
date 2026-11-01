# Cost-aware momentum: recorded results

Study run: [41261968306](https://github.com/ang87505-crypto/SportsEdge/actions/runs/41261968306),
completed successfully on 2026-11-01 UTC. Plan and source were committed first at
`efe443514b8ad0df25c512de937daddd17098cbc`.
The adjacent JSON file retains the full-precision aggregate output; the workflow artifact
ZIP SHA256 is `070fbb14d512bf7eb76f25211089217ec4d1b265d576f359b58c940919b9f37a`.

## What improved and what did not

- **Affordability filter:** at 10 bps, uncapped momentum produced $3,925 from $1,000,
  against $1,862 for current momentum, with a 21.0% rather than 24.4% historical drawdown.
  This repeats the round-2 observation; it does not prove the effect will persist.
- **Turnover policy:** one-way turnover fell from 5.29 to 2.14 times equity per year
  (about 60%). At 10 bps, cost-aware actually earned less than uncapped momentum
  ($3,785 vs $3,925). At 25 bps it earned $3,560 vs $3,360; at 50 bps, $3,212 vs $2,617.
  This is a cost-dependent tradeoff, not a universally better strategy.
- **Risk-adjusted ranking:** at 10 bps it lowered drawdown to 17.2%, at the price of
  lower CAGR (13.8% vs 15.0% for uncapped). It is a risk/return alternative, not the
  maximum-return winner. Its apparent resilience also depends on the selected universe.
- **More exposure:** full-cost-aware produced $8,452 at 10 bps, but drew down 38.0%.
  This exceeds the current account's 25% stop threshold. That stop is not simulated and
  is not a guarantee of a maximum loss. The full variant is a new policy, not an exact
  rerun of round 2's fully invested variant.
- **Recent risk-adjusted performance still trails SPY:** 2023+ Sharpe at 10 bps was
  1.09 for uncapped, 0.94 for cost-aware, 0.93 for risk-adjusted and 1.00 for full-cost-aware,
  versus 1.36 for SPY. Full-cost-aware's recent CAGR was higher (28.1% vs 21.0%), with a
  deeper recent drawdown (28.0% vs 18.8%). Higher return alone does not settle the choice.
- **Accounting:** every cash invariant passed. The fully invested policy needed cash-limited
  buy reductions on 109 rebalances at 10 bps; no borrowing was silently introduced.

## Interpretation and next experiment

The strongest supported engineering finding is to remove the small-account price filter
in a separately specified experiment and make trading-cost sensitivity explicit. Choose
between uncapped, cost-aware and risk-adjusted using actual execution costs and a risk
budget, rather than picking the largest in-sample ending balance.

These are biased, already-seen, fractional-share research simulations. The same historical
universe is not an independent confirmation. The 50% variants targeted 50% but averaged
53–56% exposure because of drift and trade thresholds; the SPY-50 benchmark rebalances
fractionally to 50%. Comparisons therefore match the **target budget**, not identical
realized exposure or market risk. The inherited one-raw-share threshold also means that
scaling these $1,000 fractional simulations to a $10,000 whole-share account is not exact.
All data dates, periods and assumptions are recorded below and in the JSON output.

No new candidate is automatically promoted. Before registering one for forward paper use,
match its share-sizing and fill rules to an actual account, freeze its version, measure
realistic spreads and fills, and compare new observations with the appropriate SPY control.
The existing experiment can continue to test execution independently of this research.
No paper-account limits, gates, schedules, or real-money settings were changed.

The archive was downloaded and its ZIP digest checked. All four source blobs were verified
against the locally tested bytes. Local analytics: **320 tests passed**, including 16 new
cash-ledger, selection and information-boundary regressions. Remote CI is recorded on PR #97.

---

# Cost-aware momentum research

**EXPLORATORY ONLY — no clean holdout or verified edge.**

Source: `efe443514b8ad0df25c512de937daddd17098cbc`
Data SHA256: `9aa3f84831ac05374840705694432a6f838feecc09bc6edaa5c349d0e88cbc21`
Universe SHA256: `acc83f665c3ac4128523522781ae8d86fe8e5fbba6f4add7325e8d61460a89ed`

All values start with $1,000. Drawdown is from a prior peak. Targets are not exposure guarantees.

## 10 bps per side

| Strategy | End value | CAGR | Drawdown | Sharpe (rf=0) | Costs | Turnover/year | Avg invested | Cash-limited |
|---|---|---|---|---|---|---|---|---|
| current | $1,861.69 | 6.5% | -24.4% | 0.55 | $117.40 | 4.49 | 53.0% | 0 |
| uncapped | $3,925.11 | 15.0% | -21.0% | 0.87 | $201.87 | 5.29 | 54.8% | 0 |
| cost-aware | $3,784.74 | 14.5% | -21.4% | 0.84 | $87.85 | 2.14 | 56.2% | 0 |
| risk-adjusted | $3,565.57 | 13.8% | -17.2% | 0.90 | $97.64 | 2.61 | 54.2% | 0 |
| full-cost-aware | $8,451.69 | 24.3% | -38.0% | 0.89 | $288.33 | 4.03 | 98.3% | 109 |
| SPY-50 | $2,039.18 | 7.5% | -18.3% | 0.86 | $3.54 | 0.13 | 50.0% | 0 |
| SPY-100 | $3,878.18 | 14.8% | -33.8% | 0.87 | $1.00 | 0.05 | 100.0% | 1 |

| Strategy | 2017–2022 CAGR | Seen 2023+ CAGR | Seen 2023+ drawdown | Above 25% full drawdown? | Rejected | Cash invariant |
|---|---|---|---|---|---|---|
| current | 6.5% | 6.6% | -11.2% | no | 0 | PASS |
| uncapped | 11.6% | 20.5% | -19.9% | no | 0 | PASS |
| cost-aware | 12.6% | 17.6% | -20.8% | no | 0 | PASS |
| risk-adjusted | 13.6% | 14.3% | -17.2% | no | 0 | PASS |
| full-cost-aware | 22.0% | 28.1% | -28.0% | YES | 0 | PASS |
| SPY-50 | 5.8% | 10.3% | -9.7% | no | 0 | PASS |
| SPY-100 | 11.0% | 21.0% | -18.8% | YES | 0 | PASS |

| Year | current | uncapped | cost-aware | risk-adjusted | full-cost-aware | SPY-50 | SPY-100 |
|---|---|---|---|---|---|---|---|
| 2017 | 14.2% | 11.8% | 9.9% | 19.8% | 17.5% | 9.8% | 20.5% |
| 2018 | -11.8% | -4.7% | 5.9% | 4.8% | 6.2% | -2.1% | -5.0% |
| 2019 | 9.4% | 20.6% | 19.8% | 5.0% | 37.5% | 14.7% | 31.1% |
| 2020 | 5.4% | 51.2% | 50.1% | 58.0% | 84.0% | 10.0% | 18.5% |
| 2021 | 18.1% | -0.8% | -1.5% | -1.0% | 2.8% | 13.6% | 28.6% |
| 2022 | 6.3% | -0.1% | -1.1% | 3.8% | 1.2% | -9.0% | -18.2% |
| 2023 | 4.3% | 13.7% | 11.6% | 2.4% | 23.0% | 12.6% | 26.2% |
| 2024 | 10.5% | 42.6% | 37.2% | 36.7% | 63.4% | 12.0% | 24.9% |
| 2025 | 6.0% | -4.9% | -2.2% | -0.6% | -6.7% | 9.1% | 17.7% |
| 2026 | 4.4% | 32.2% | 24.0% | 19.7% | 37.0% | 5.8% | 11.7% |

## 25 bps per side

| Strategy | End value | CAGR | Drawdown | Sharpe (rf=0) | Costs | Turnover/year | Avg invested | Cash-limited |
|---|---|---|---|---|---|---|---|---|
| current | $1,734.27 | 5.8% | -27.2% | 0.49 | $274.17 | 4.49 | 53.3% | 0 |
| uncapped | $3,359.64 | 13.2% | -21.2% | 0.77 | $460.85 | 5.29 | 55.1% | 0 |
| cost-aware | $3,560.42 | 13.8% | -21.5% | 0.80 | $211.98 | 2.14 | 56.3% | 0 |
| risk-adjusted | $3,309.07 | 13.0% | -17.9% | 0.85 | $233.71 | 2.61 | 54.3% | 0 |
| full-cost-aware | $7,686.53 | 23.1% | -38.3% | 0.85 | $661.58 | 4.01 | 98.4% | 108 |
| SPY-50 | $2,031.13 | 7.5% | -18.3% | 0.86 | $8.82 | 0.13 | 50.0% | 0 |
| SPY-100 | $3,872.38 | 14.8% | -33.8% | 0.87 | $2.49 | 0.05 | 100.0% | 1 |

| Strategy | 2017–2022 CAGR | Seen 2023+ CAGR | Seen 2023+ drawdown | Above 25% full drawdown? | Rejected | Cash invariant |
|---|---|---|---|---|---|---|
| current | 4.9% | 7.2% | -10.8% | YES | 0 | PASS |
| uncapped | 9.8% | 18.7% | -20.0% | no | 0 | PASS |
| cost-aware | 11.9% | 16.9% | -20.9% | no | 0 | PASS |
| risk-adjusted | 12.6% | 13.7% | -17.3% | no | 0 | PASS |
| full-cost-aware | 20.0% | 28.1% | -28.0% | YES | 0 | PASS |
| SPY-50 | 5.7% | 10.3% | -9.7% | no | 0 | PASS |
| SPY-100 | 11.0% | 21.0% | -18.8% | YES | 0 | PASS |

| Year | current | uncapped | cost-aware | risk-adjusted | full-cost-aware | SPY-50 | SPY-100 |
|---|---|---|---|---|---|---|---|
| 2017 | 13.1% | 10.3% | 9.4% | 18.6% | 16.5% | 9.7% | 20.3% |
| 2018 | -13.4% | -6.5% | 5.2% | 3.9% | 5.0% | -2.2% | -5.0% |
| 2019 | 7.7% | 18.9% | 19.4% | 4.3% | 36.5% | 14.7% | 31.1% |
| 2020 | 3.7% | 49.5% | 49.2% | 57.0% | 80.9% | 9.9% | 18.5% |
| 2021 | 16.3% | -2.6% | -2.2% | -2.1% | 0.5% | 13.6% | 28.6% |
| 2022 | 4.4% | -2.0% | -2.1% | 2.7% | -1.6% | -9.1% | -18.2% |
| 2023 | 3.1% | 12.2% | 11.0% | 1.7% | 21.0% | 12.5% | 26.2% |
| 2024 | 8.1% | 40.8% | 36.4% | 36.1% | 65.9% | 12.0% | 24.9% |
| 2025 | 8.3% | -6.8% | -3.0% | -1.3% | -7.0% | 9.1% | 17.7% |
| 2026 | 8.1% | 30.6% | 23.6% | 19.3% | 37.9% | 5.8% | 11.7% |

## 50 bps per side

| Strategy | End value | CAGR | Drawdown | Sharpe (rf=0) | Costs | Turnover/year | Avg invested | Cash-limited |
|---|---|---|---|---|---|---|---|---|
| current | $1,337.32 | 3.0% | -32.2% | 0.29 | $482.03 | 4.49 | 53.9% | 0 |
| uncapped | $2,616.74 | 10.3% | -22.9% | 0.63 | $798.10 | 5.29 | 55.4% | 0 |
| cost-aware | $3,212.40 | 12.6% | -21.8% | 0.74 | $399.60 | 2.14 | 56.5% | 0 |
| risk-adjusted | $2,891.58 | 11.4% | -22.1% | 0.76 | $432.98 | 2.61 | 54.6% | 0 |
| full-cost-aware | $6,361.72 | 20.8% | -38.8% | 0.78 | $1,146.96 | 3.98 | 98.5% | 118 |
| SPY-50 | $2,017.77 | 7.4% | -18.3% | 0.85 | $17.59 | 0.13 | 50.0% | 0 |
| SPY-100 | $3,862.74 | 14.8% | -33.8% | 0.86 | $4.98 | 0.05 | 100.0% | 1 |

| Strategy | 2017–2022 CAGR | Seen 2023+ CAGR | Seen 2023+ drawdown | Above 25% full drawdown? | Rejected | Cash invariant |
|---|---|---|---|---|---|---|
| current | 2.2% | 4.3% | -11.3% | YES | 0 | PASS |
| uncapped | 6.9% | 16.0% | -20.2% | no | 0 | PASS |
| cost-aware | 10.7% | 15.7% | -21.0% | no | 0 | PASS |
| risk-adjusted | 10.8% | 12.5% | -17.5% | no | 0 | PASS |
| full-cost-aware | 17.6% | 25.9% | -28.8% | YES | 0 | PASS |
| SPY-50 | 5.7% | 10.3% | -9.7% | no | 0 | PASS |
| SPY-100 | 11.0% | 21.0% | -18.8% | YES | 0 | PASS |

| Year | current | uncapped | cost-aware | risk-adjusted | full-cost-aware | SPY-50 | SPY-100 |
|---|---|---|---|---|---|---|---|
| 2017 | 11.0% | 7.8% | 8.5% | 16.6% | 14.7% | 9.6% | 20.0% |
| 2018 | -16.6% | -9.6% | 4.1% | 2.5% | 2.9% | -2.2% | -5.0% |
| 2019 | 4.9% | 16.1% | 18.6% | 3.2% | 34.8% | 14.6% | 31.1% |
| 2020 | 0.8% | 46.6% | 47.9% | 55.3% | 77.4% | 9.8% | 18.5% |
| 2021 | 13.8% | -5.5% | -3.4% | -4.4% | -1.7% | 13.5% | 28.6% |
| 2022 | 2.0% | -5.1% | -3.8% | 0.9% | -4.9% | -9.1% | -18.2% |
| 2023 | 1.2% | 9.6% | 9.9% | 0.5% | 18.9% | 12.5% | 26.2% |
| 2024 | 5.2% | 37.9% | 35.0% | 35.2% | 62.7% | 11.9% | 24.9% |
| 2025 | 3.6% | -9.8% | -4.4% | -2.6% | -9.4% | 9.0% | 17.7% |
| 2026 | 6.6% | 29.0% | 22.9% | 18.2% | 37.5% | 5.7% | 11.7% |

## Limitations

- present-day survivor-selected universe and static sectors
- all historical years already inspected
- fractional total-return units
- open-price fills instead of live 09:50 limit orders
- same-day sale proceeds assumed reusable; settlement not modeled
- zero cash interest and zero Sharpe risk-free rate
- no execution of the paper account drawdown stop

