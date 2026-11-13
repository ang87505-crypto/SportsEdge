# SportsEdge stock research report

Research only. No candidate is active and broker writes stay off. Pre-registration: `docs/STOCK_STRATEGY_RESEARCH_PREREG_2026_11_09.md`.

## Source collection health

| Source | Attempts | Last status | Last success | Failures |
|---|---|---|---|---|
| openfigi-cusip | 6 | OK | 2026-11-09T22:37:39Z | 0 |
| qmom-holdings | 16 | OK | 2026-11-13T04:43:42Z | 2 |
| sec-company-tickers | 1 | OK | 2026-11-10T17:34:55Z | 0 |
| sec-edgar-13f | 371 | OK | 2026-11-13T04:43:42Z | 156 |
| sec-form345-dataset | 43 | FETCH_FAILED | 2026-11-10T17:34:55Z | 2 |
| sec-xbrl-companyfacts | 134 | OK | 2026-11-10T17:34:55Z | 0 |

## Historical evaluation (2017-02-01 to 2026-11-06, $30,000)

**Overall: NONE QUALIFIES**

Dataset SHA-256 `db7b70db76fb0f2f8b40efacd9edc7d9b0e0a38a96874d17e474ab4c22a0b938`; code `8fcc6bf867bd877e157000ab4355709a5bb32040`; registry `498d9977c9672387…`. The 2017–2026 history was already inspected and the 136-stock universe is survivorship-biased: this is exploratory research data, not an untouched validation set.

- qmom-disclosure-follower-v1: not evaluated historically (no reliable historical holdings snapshots; forward only).

| Comparison (same dates) | Cost/side | End value | CAGR | Sharpe | Max DD |
|---|---|---|---|---|---|
| SPY buy-and-hold (dividends) | none | $112,002 | 14.5% | 0.84 | -33.8% |
| Berkshire BRK.B | none | $103,956 | 13.6% | 0.75 | -29.6% |
| QMOM (market price, distributions) | none | $81,187 | 10.8% | 0.51 | -40.5% |
| Weekly strategy ($1,000, ~half invested) | 5 bps | $1,845 | 6.5% | 0.54 | -23.8% |
| Weekly strategy ($1,000, ~half invested) | 10 bps | $1,777 | 6.1% | 0.52 | -24.8% |
| Weekly strategy ($1,000, ~half invested) | 25 bps | $1,585 | 4.8% | 0.42 | -28.0% |

### berkshire-13f-top5-paper-v1: FAILS

Exposure-matched SPY (continuous, 10 bps exposure): CAGR 13.9%, Sharpe 0.83.

| berkshire-13f-top5-paper-v1 | Series | Cost/side | End value | Total | CAGR | Sharpe | Max DD | Turnover/yr | Exposure | End cash | Costs paid | Halted |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | continuous | 0 bps | $84,452 | 181.5% | 11.2% | 0.63 | -41.8% | 0.4x | 97% | $7,366 | $0 | no |
| | as-live | 0 bps | $31,432 | 4.8% | 0.5% | 0.16 | -10.2% | 0.3x | 10% | $31,432 | $0 | 2018-02-08 |
| | continuous | 5 bps | $84,886 | 183.0% | 11.3% | 0.63 | -42.0% | 0.3x | 97% | $4,444 | $80 | no |
| | as-live | 5 bps | $31,390 | 4.6% | 0.5% | 0.15 | -10.2% | 0.3x | 10% | $31,390 | $42 | 2018-02-08 |
| | continuous | 10 bps | $84,817 | 182.7% | 11.3% | 0.63 | -42.0% | 0.3x | 98% | $4,374 | $160 | no |
| | as-live | 10 bps | $31,348 | 4.5% | 0.5% | 0.15 | -10.2% | 0.3x | 10% | $31,348 | $84 | 2018-02-08 |
| | continuous | 25 bps | $84,310 | 181.0% | 11.2% | 0.63 | -41.2% | 0.3x | 98% | $3,323 | $403 | no |
| | as-live | 25 bps | $31,218 | 4.1% | 0.4% | 0.14 | -10.2% | 0.3x | 10% | $31,218 | $209 | 2018-02-08 |

| Check (pre-registered) | Result |
|---|---|
| at_least_6_positive_years | pass |
| both_halves_positive | pass |
| cagr_above_exposure_matched_spy | FAIL |
| cagr_positive_at_10_and_25bps | pass |
| halt_exit_loss_within_15pct | pass |
| max_drawdown_within_35pct | FAIL |
| no_unresolved_at_any_cost | pass |
| sharpe_above_spy_buy_and_hold | FAIL |
| sharpe_above_weekly | pass |

Decisions 41; orders 26, filled 25, unfilled (gap 1, no bar 0, cash 0), reduced for cash 11, unavailable targets 0; dividends $9,967; unresolved 0; integrity mismatches 0.

| Year (continuous, 10 bps) | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| | -15.8% | 40.4% | -1.0% | 28.5% | -5.7% | 11.5% | 27.0% | 17.9% | 9.0% |

### momentum-quality-paper-v1: FAILS

Exposure-matched SPY (continuous, 10 bps exposure): CAGR 13.9%, Sharpe 0.83.

| momentum-quality-paper-v1 | Series | Cost/side | End value | Total | CAGR | Sharpe | Max DD | Turnover/yr | Exposure | End cash | Costs paid | Halted |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | continuous | 0 bps | $145,837 | 386.1% | 17.6% | 0.78 | -35.0% | 9.8x | 97% | $2,842 | $0 | no |
| | as-live | 0 bps | $44,892 | 49.6% | 4.2% | 0.56 | -11.9% | 1.7x | 17% | $44,892 | $0 | 2018-10-10 |
| | continuous | 5 bps | $138,322 | 361.1% | 17.0% | 0.75 | -35.3% | 9.8x | 97% | $2,863 | $4,199 | no |
| | as-live | 5 bps | $41,612 | 38.7% | 3.4% | 0.58 | -10.0% | 1.0x | 10% | $41,612 | $191 | 2018-02-08 |
| | continuous | 10 bps | $131,662 | 338.9% | 16.4% | 0.73 | -35.1% | 9.8x | 97% | $2,306 | $8,127 | no |
| | as-live | 10 bps | $41,417 | 38.1% | 3.4% | 0.58 | -10.1% | 1.0x | 10% | $41,417 | $382 | 2018-02-08 |
| | continuous | 25 bps | $114,101 | 280.3% | 14.7% | 0.68 | -35.4% | 9.8x | 97% | $2,147 | $18,439 | no |
| | as-live | 25 bps | $42,754 | 42.5% | 3.7% | 0.49 | -12.5% | 1.7x | 17% | $42,754 | $1,746 | 2018-10-10 |

| Check (pre-registered) | Result |
|---|---|
| at_least_6_positive_years | pass |
| both_halves_positive | pass |
| cagr_above_exposure_matched_spy | pass |
| cagr_positive_at_10_and_25bps | pass |
| halt_exit_loss_within_15pct | pass |
| max_drawdown_within_35pct | FAIL |
| no_unresolved_at_any_cost | pass |
| sharpe_above_spy_buy_and_hold | FAIL |
| sharpe_above_weekly | pass |

Decisions 118; orders 252, filled 247, unfilled (gap 5, no bar 0, cash 0), reduced for cash 26, unavailable targets 0; dividends $10,248; unresolved 0; integrity mismatches 0.

| Year (continuous, 10 bps) | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| | 4.0% | 29.8% | 60.3% | 13.4% | -11.7% | 21.4% | 13.6% | 6.5% | 4.0% |

## Forward paper ledgers (latest session 2026-11-12)

- **berkshire-13f-top5-paper-v1**: INSUFFICIENT FORWARD SAMPLE. Since 2026-11-10 (3 sessions, 1 rebalances): total 0.3% at 10 bps vs SPY 1.2%.
- **momentum-quality-paper-v1**: NOT STARTED (no decision yet).
- **qmom-disclosure-follower-v1**: INSUFFICIENT FORWARD SAMPLE. Since 2026-11-10 (3 sessions, 1 rebalances): total 0.9% at 10 bps vs SPY 1.2%.
