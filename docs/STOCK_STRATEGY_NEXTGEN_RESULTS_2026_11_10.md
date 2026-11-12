# Next-generation stock research: results (2026-11-10)

Pre-registration: `docs/STOCK_STRATEGY_NEXTGEN_PREREG_2026_11_10.md`, committed at `9f92785` before any result.
Amendment 1: `docs/STOCK_STRATEGY_NEXTGEN_PREREG_AMENDMENT_1_2026_11_10.md`, committed at `5254e71` before any V5
result. Evidence memo and audit: `docs/STOCK_STRATEGY_NEXTGEN_EVIDENCE_2026_11_10.md`.

**Research only.**
- Nothing was activated, merged or ordered.
- No broker permission, owner gate, schedule or release pin changed.
- These are historical simulations, not account returns.

## Bottom line

1. **Two candidates technically pass the pre-registered gates, and neither has shown it beats SPY.**
   - **The two candidates:**
     - `mq-buffer-v1`: B0 plus a top-10 hold buffer;
     - `mq-insider-tiebreak-v1`: B0 with Form 4 purchases as a tie-break, truncated window only.
   - **How narrowly they pass:** each clears "Sharpe above SPY" by **0.015** and **0.010** respectively.
   - **Uncertainty:** the 90% block-bootstrap intervals for (Sharpe − SPY) run from about **−0.37 to +0.43** and
     **−0.38 to +0.34**.
   - **Selection:** about ten variants were tried across both runs (five main-run challengers, three insider
     variants, plus the conditional integrated one), on a window this project had already inspected, with a
     survivorship-biased universe.
   - **Conclusion:** on risk-adjusted terms these are **statistically indistinguishable from SPY**. The verdict
     `QUALIFIES FOR INDEPENDENT REVIEW` means "worth watching forward", nothing more.
2. **Where `mq-buffer-v1`'s edge comes from:** it all comes from 2017–2022 (Sharpe 0.90 vs SPY 0.63). In 2023–2026
   it **trails** SPY (Sharpe 0.79 vs 1.29). Its worst month (−17.4%) is worse than SPY's (−12.6%). It is a
   higher-return, slightly higher-beta (1.03) version of the same concentrated momentum book, not a safer one.
3. **The buffer does what cost-aware buffers are meant to do.**
   - Turnover falls from 9.8x to 6.7x a year.
   - It also earns more *gross* (20.5% vs 18.0% at 0 bps), by holding winners longer: on average 3.6 of 5 names are
     kept each month.
   - PR #97 (older engine) found the opposite at 10 bps, so the earlier evidence is mixed.
4. **Recovery after a halt (V1) is a clear failure.**
   - **Outcome:** with a 10% stop it halted **10 times** in under ten years and ended at 5.0% CAGR. The COVID halt
     exited 16.4% below its peak, outside the 15% rule.
   - **Time in cash:** 631 sessions, while SPY gained about 92%.
   - **Diagnosis:** a 10% stop is inside this strategy's normal fluctuation. Re-entry rules cannot fix a stop that
     fires every year.
   - **What it shows:** if a stop is wanted, its *level* must be reconsidered (owner decision, separate
     pre-registration). Turning it off is not a fix: the continuous drawdown is −35%.
5. **The other changes did not help.**
   - **Fundamental quality (V4):** real point-in-time ROA and safety from SEC filings, 89% coverage. It was **worse**
     than B0's price-consistency rank: Sharpe 0.63 vs 0.74, drawdown −37%.
   - **Inverse-volatility weights (V3a):** Sharpe 0.66, and CAGR below exposure-matched SPY.
   - **10 names (V3b):** Sharpe 0.74, below SPY. It also fails on an unresolved GE spin-off position; the spun-off
     company is outside the universe and has no prices.
   - **Integrated challenger:** not run, because its registered condition (V4 beating B0) failed.
6. **Insider signals (V5):**
   - **Full window:** `BLOCKED_BY_POINT_IN_TIME_DATA`. SEC returned 404 for the 2026q2 and 2026q3 data sets.
   - **Truncated window (Amendment 1, through 2026-04-30):**
     - **Standalone** insider buying: 3.7% CAGR, mostly cash, and it fails.
     - **As a filter:** halves exposure (DD −16.6%, CAGR 11.4%) and fails Sharpe.
     - **As a tie-break:** passes narrowly, but its Sharpe gain over B0 (0.87 vs 0.82) has a 90% interval of −0.30
       to +0.32. That is no evidence of incremental value.
   - **Insider purchases are common:** at least one momentum top-20 name had a qualifying purchase in **103 of 111**
     months. Among large caps it is close to background noise.
7. **The practical recommendation does not change.**
   - **SPY:** for a risk-adjusted objective, SPY buy-and-hold remains the benchmark to beat and has not been beaten
     credibly.
   - **Do not promote** any of these to paper or live trading on this evidence.
   - **Next step:** a forward ledger for `mq-buffer-v1` (pre-registered; needs owner approval to schedule) is the
     only honest next test.

## Data and lineage

| Item | Value |
|---|---|
| Main run | Actions [42866348222](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42866348222), code `892176e`, dataset fingerprint `5143ba7830eae5cf` |
| Amendment 1 run | Actions [42867840667](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42867840667), code `ba14e6b`, dataset `9c3c2c45f90894cf` |
| Results (append-only) | `research-data`: `results/nextgen-historical-2026-11-10T173636Z.json`, `results/nextgen-insider-truncated-2026-11-10T174348Z.json`, reports alongside |
| Window | 2017-02-01 to 2026-11-06, exploratory (already inspected); V5 truncated to 2026-04-30 |
| Universe | 136 current large caps (survivorship-biased); 138 symbols with bars incl. SPY and the MMC→MRSH join; none missing |
| SEC fundamentals | companyfacts for 134 of 136 members by CIK (EA and MMC not in SEC's current ticker file; no guess). Each raw file's SHA-256 is stored |
| SEC Form 4 | 41 quarterly data sets 2016q1–2026q1 (raw SHA-256 stored); 2026q2/q3 HTTP 404 |
| B0 reproduction | On this data vintage B0 is 16.65% CAGR, Sharpe 0.74, max DD −34.9% at 10 bps, vs the published 16.39%, 0.73, −35.1% (dataset `db7b70db`, 2026-11-09). 116 of 118 monthly decisions are identical; both differences (2019-01-31, 2019-09-30) involve AEP, so Alpaca's AEP history changed between pulls. Every candidate here is compared with B0 **on the same data** |

## Results by candidate × cost (judged path; B0 also as-live)

The judged path is the continuous path for every candidate except V1, which is judged on its recovery path.
**Realistic friction (5 bps)** is the 5 bps row.

| Candidate | Path | Cost/side | CAGR | Total | Sharpe | Max DD | Turnover/yr | Avg exposure | Time in cash | Costs paid |
|---|---|---|---|---|---|---|---|---|---|---|
| momentum-quality-paper-v1 | continuous | 0 bps | 18.0% | 402% | 0.79 | -34.8% | 9.8x | 97% | 0% | $0 |
| momentum-quality-paper-v1 | continuous | 5 bps | 17.3% | 372% | 0.77 | -34.8% | 9.8x | 97% | 0% | $4,308 |
| momentum-quality-paper-v1 | continuous | 10 bps | 16.7% | 349% | 0.74 | -34.9% | 9.8x | 97% | 0% | $8,317 |
| momentum-quality-paper-v1 | continuous | 25 bps | 15.2% | 296% | 0.69 | -35.0% | 9.8x | 97% | 0% | $19,090 |
| momentum-quality-paper-v1 | continuous | 50 bps | 12.3% | 210% | 0.59 | -35.0% | 9.8x | 97% | 0% | $33,060 |
| momentum-quality-paper-v1 | as_live | 0 bps | 4.2% | 50% | 0.56 | -11.9% | 1.7x | 17% | 83% | $0 |
| momentum-quality-paper-v1 | as_live | 5 bps | 3.4% | 39% | 0.58 | -10.0% | 1.0x | 10% | 89% | $191 |
| momentum-quality-paper-v1 | as_live | 10 bps | 3.4% | 38% | 0.58 | -10.1% | 1.0x | 10% | 89% | $382 |
| momentum-quality-paper-v1 | as_live | 25 bps | 3.7% | 43% | 0.49 | -12.5% | 1.7x | 17% | 83% | $1,746 |
| momentum-quality-paper-v1 | as_live | 50 bps | 2.9% | 33% | 0.51 | -10.0% | 1.0x | 10% | 89% | $1,875 |
| mq-buffer-v1 | continuous | 0 bps | 20.5% | 516% | 0.86 | -31.0% | 6.7x | 98% | 0% | $0 |
| mq-buffer-v1 | continuous | 5 bps | 20.5% | 515% | 0.86 | -31.0% | 6.7x | 98% | 0% | $3,133 |
| mq-buffer-v1 | continuous | 10 bps | 20.5% | 514% | 0.86 | -31.2% | 6.7x | 98% | 0% | $6,270 |
| mq-buffer-v1 | continuous | 25 bps | 19.2% | 455% | 0.82 | -31.2% | 6.7x | 98% | 0% | $14,808 |
| mq-buffer-v1 | continuous | 50 bps | 16.6% | 348% | 0.73 | -31.4% | 6.7x | 98% | 0% | $26,020 |
| mq-fquality-v1 | continuous | 0 bps | 15.3% | 299% | 0.66 | -36.8% | 8.2x | 97% | 0% | $0 |
| mq-fquality-v1 | continuous | 5 bps | 14.6% | 278% | 0.64 | -36.9% | 8.3x | 97% | 0% | $2,755 |
| mq-fquality-v1 | continuous | 10 bps | 14.3% | 267% | 0.63 | -37.0% | 8.3x | 97% | 0% | $5,398 |
| mq-fquality-v1 | continuous | 25 bps | 12.6% | 218% | 0.57 | -37.0% | 8.3x | 97% | 0% | $12,453 |
| mq-fquality-v1 | continuous | 50 bps | 10.0% | 153% | 0.49 | -37.2% | 8.4x | 97% | 0% | $21,882 |
| mq-invvol-v1 | continuous | 0 bps | 14.6% | 276% | 0.70 | -34.3% | 10.5x | 97% | 0% | $0 |
| mq-invvol-v1 | continuous | 5 bps | 14.0% | 258% | 0.68 | -34.2% | 10.5x | 97% | 0% | $4,019 |
| mq-invvol-v1 | continuous | 10 bps | 13.5% | 243% | 0.66 | -34.3% | 10.5x | 97% | 0% | $7,787 |
| mq-invvol-v1 | continuous | 25 bps | 11.5% | 189% | 0.59 | -34.7% | 10.5x | 97% | 0% | $17,657 |
| mq-invvol-v1 | continuous | 50 bps | 8.7% | 126% | 0.48 | -35.1% | 10.5x | 97% | 0% | $30,648 |
| mq-recovery-v1 | recovery | 0 bps | 5.9% | 75% | 0.45 | -31.0% | 7.8x | 61% | 24% | $0 |
| mq-recovery-v1 | recovery | 5 bps | 5.5% | 68% | 0.43 | -27.6% | 7.5x | 57% | 26% | $1,710 |
| mq-recovery-v1 | recovery | 10 bps | 5.0% | 61% | 0.40 | -28.2% | 7.5x | 57% | 26% | $3,313 |
| mq-recovery-v1 | recovery | 25 bps | 4.5% | 53% | 0.36 | -31.0% | 7.7x | 60% | 25% | $8,553 |
| mq-recovery-v1 | recovery | 50 bps | 0.1% | 1% | 0.07 | -39.1% | 7.4x | 55% | 27% | $13,865 |
| mq-wide10-v1 | continuous | 0 bps | 14.1% | 262% | 0.78 | -31.0% | 5.1x | 74% | 19% | $0 |
| mq-wide10-v1 | continuous | 5 bps | 13.7% | 251% | 0.76 | -31.3% | 5.2x | 74% | 19% | $1,839 |
| mq-wide10-v1 | continuous | 10 bps | 13.4% | 240% | 0.74 | -31.4% | 5.2x | 74% | 19% | $3,600 |
| mq-wide10-v1 | continuous | 25 bps | 12.4% | 213% | 0.70 | -31.3% | 5.3x | 74% | 19% | $8,580 |
| mq-wide10-v1 | continuous | 50 bps | 10.4% | 162% | 0.61 | -31.4% | 5.4x | 74% | 19% | $15,481 |

| Candidate (10 bps, judged path) | Sortino | Beta | Alpha/yr vs SPY | Worst month | Longest underwater (sessions) | 2017–22 CAGR / Sharpe | 2023–26 CAGR / Sharpe |
|---|---|---|---|---|---|---|---|
| momentum-quality-paper-v1 | 1.07 | 1.02 | 3.1% | -17.8% | 525 | 20.0% / 0.84 | 11.6% / 0.59 |
| mq-buffer-v1 | 1.25 | 1.03 | 6.2% | -17.4% | 529 | 22.4% / 0.90 | 17.5% / 0.79 |
| mq-fquality-v1 | 0.88 | 1.20 | -1.1% | -12.1% | 401 | 11.7% / 0.54 | 18.3% / 0.77 |
| mq-invvol-v1 | 0.94 | 0.97 | 0.7% | -15.7% | 537 | 16.8% / 0.76 | 8.5% / 0.50 |
| mq-recovery-v1 | 0.55 | 0.34 | 0.8% | -10.5% | 1151 | 8.1% / 0.60 | 0.4% / 0.10 |
| mq-wide10-v1 | 1.06 | 0.81 | 2.2% | -10.5% | 584 | 16.4% / 0.77 | 8.8% / 0.87 |
| SPY buy-and-hold | 1.18 | 1.00 | 0.0% | -12.6% | 488 | 11.0% / 0.63 | 20.1% / 1.29 |

| Candidate | Gates (new) | Failed gates | Original nine | Matched SPY v1 / v2 CAGR | CAGR 90% CI | Sharpe 90% CI | Sharpe − SPY 90% CI | Sharpe − B0 90% CI | $1,000 at 10 bps: CAGR, avg exposure |
|---|---|---|---|---|---|---|---|---|---|
| momentum-quality-paper-v1 | FAILS | sharpe_above_spy | FAILS | 13.9% / 13.9% | 5.8% to 32.2% | 0.35 to 1.31 | -0.49 to 0.31 | — | 7.1%, 59% |
| mq-buffer-v1 | QUALIFIES FOR INDEPENDENT REVIEW | none | QUALIFIES FOR REVIEW | 14.0% / 14.0% | 9.0% to 37.6% | 0.47 to 1.41 | -0.37 to 0.43 | -0.05 to 0.28 | 9.0%, 59% |
| mq-fquality-v1 | FAILS | max_drawdown_within_35pct, sharpe_above_spy | FAILS | 13.9% / 13.9% | 2.7% to 29.9% | 0.24 to 1.14 | -0.58 to 0.13 | -0.48 to 0.20 | 10.3%, 59% |
| mq-invvol-v1 | FAILS | cagr_above_matched_spy_v2, sharpe_above_spy | FAILS | 13.9% / 13.9% | 3.7% to 27.0% | 0.27 to 1.21 | -0.56 to 0.22 | -0.18 to 0.00 | 4.6%, 57% |
| mq-recovery-v1 | FAILS | cagr_above_matched_spy_v2, every_halt_exit_within_15pct, halves_positive_and_6_positive_years, sharpe_above_spy | FAILS | 5.8% / 5.3% | -2.3% to 13.9% | -0.08 to 0.98 | -1.02 to 0.10 | -0.70 to -0.04 | 1.0%, 35% |
| mq-wide10-v1 | FAILS | no_unresolved_at_any_cost, sharpe_above_spy | FAILS | 9.8% / 9.9% | 4.0% to 23.1% | 0.29 to 1.24 | -0.47 to 0.21 | -0.34 to 0.25 | 3.3%, 22% |

| Calendar year (10 bps) | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| momentum-quality-paper-v1 | 4% | 32% | 61% | 13% | -12% | 21% | 14% | 6% | 4% |
| mq-buffer-v1 | 1% | 31% | 65% | 17% | -9% | 10% | 18% | 12% | 28% |
| mq-fquality-v1 | 8% | 38% | 1% | 17% | -11% | 23% | 31% | 23% | -4% |
| mq-invvol-v1 | 5% | 34% | 35% | 13% | -13% | 21% | 14% | 5% | -5% |
| mq-recovery-v1 | 2% | 6% | 22% | -0% | -9% | -2% | -3% | 1% | 6% |
| mq-wide10-v1 | 1% | 33% | 45% | 11% | -8% | 17% | 18% | 0% | 0% |
| SPY | -5% | 31% | 18% | 29% | -18% | 26% | 25% | 18% | 9% |


The V1 halt history at 10 bps:
- **Halts:** 2018-02-08, 2018-10-10, 2020-02-27 (exit −16.4%), 2021-03-04, 2022-01-05, 2023-10-19, 2024-07-25,
  2025-03-13, 2026-03-06, 2026-07-29.
- **Re-entries:** 14 partial re-entries, 4 regime exits back to cash and 1 whipsaw.

## Form 4 candidates (Amendment 1, executions 2017-02-01 to 2026-04-30, B0 on the same window)

SPY buy-and-hold on this window: CAGR 15.0%, Sharpe 0.86, max DD -33.8%.

| Candidate | CAGR 0 / 10 / 25 / 50 bps | Sharpe 10 bps | Max DD 10 bps | Exposure | Turnover/yr | Gates | Failed | Sharpe − SPY 90% CI | Sharpe − B0 90% CI | Picks changed vs B0 |
|---|---|---|---|---|---|---|---|---|---|---|
| insider-only-v1 | 3.9% / 3.7% / 3.4% / 2.8% | 0.52 | -13.4% | 22% | 1.9x | FAILS | halves_positive_and_6_positive_years, no_unresolved_at_any_cost, sharpe_above_spy | -1.02 to 0.32 | -1.02 to 0.29 | 111 |
| momentum-quality-paper-v1 | 19.4% / 18.0% / 16.5% / 13.6% | 0.82 | -34.9% | 97% | 9.7x | FAILS | sharpe_above_spy | -0.41 to 0.35 | — | — |
| mq-insider-filter-v1 | 12.1% / 11.4% / 10.7% / 9.1% | 0.79 | -16.6% | 50% | 5.3x | FAILS | sharpe_above_spy | -0.61 to 0.27 | -0.57 to 0.28 | 111 |
| mq-insider-tiebreak-v1 | 20.6% / 19.3% / 17.4% / 14.7% | 0.87 | -30.9% | 97% | 10.5x | QUALIFIES FOR INDEPENDENT REVIEW | none | -0.38 to 0.34 | -0.30 to 0.32 | 99 |


**Attribution of 227,361 non-derivative Form 3/4/5 rows for the 134 mapped issuers (2016q1–2026q1):**
- **Qualifying purchases:** 3,511 (code `P`, acquired, priced). Of these, 1,455 are indirect ownership. All are
  `UNKNOWN_VENUE`: the data cannot separate open-market from private purchases.
- **Excluded by code:**
  - 95,897 sales;
  - 39,232 option exercises;
  - 38,027 tax withholdings;
  - 36,008 grants;
  - 6,304 gifts;
  - other codes.
- **Excluded by form:** 1,451 rows on Form 5.
- **Duplicates removed:** 71 amendment repeats.
- **Filing lag (filing date − transaction date):** median 2 days, 90th percentile 111 days, max 4,515 days.
- **Late filings:** they are used only from their filing date, so a late filing can never act on old information.
- **Acceptance time:** not in the quarterly data sets, so each filing is treated as known from the close of the
  session after its filing date.

## What would need the owner's independent approval later

1. **Forward ledger for `mq-buffer-v1`:** scheduling it (code in `nextgen_cli forward`; first signal 2026-11-30). It
   needs a change to a scheduled research workflow on main.
2. **Fixing the GE spin-off unresolved positions:** pricing spin-off targets outside the universe (GE→GEV, GE→WAB).
   That is an engine and data change, in a new version.
3. **Any change to the production stop:** level, re-entry or automatic resume. The V1 result argues the 10% level
   is the problem; it does not support an automatic re-entry.
4. **Insider signals in real time:** a per-filing EDGAR Form 4 collector (acceptance timestamps included). The
   quarterly data sets cannot support a forward ledger.
5. **Paper or live promotion of anything:** not recommended on this evidence. It would need its own
   pre-registration, at least 12 forward rebalances, and owner sign-off.
