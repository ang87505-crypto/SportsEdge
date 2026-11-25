# Daily open-to-close stock PAPER experiment: backtest results

**Verdict: NONE QUALIFIES (v1 and the corrected v2).** No rule is proposed for paper trading.
Daily-trading activation stays off. Nothing here places, schedules or enables an order.

- Plan, committed before any result: `docs/STOCK_DAILY_OC_BACKTEST_PLAN_2026_11_09.md` (commit 9f65748).
- Corrections, committed after the v1 results and before any v2 result:
  `docs/STOCK_DAILY_OC_BACKTEST_V2_CORRECTIONS_2026_11_09.md` (commit 525dc36).
- Code:
  - `analytics/stock_daily_oc_backtest_v1.py`: preserved, unchanged since 866794c.
  - `analytics/stock_daily_oc_backtest_v2.py`: the corrections.
  - Tests: `analytics/test_stock_daily_oc_backtest_v1.py` (22) and `analytics/test_stock_daily_oc_backtest_v2.py` (10).
- Evaluation window 2017-01-03 to 2026-11-06 (2,476 sessions), $30,000 virtual capital.

## Runs and data fingerprints

| Run | Code | Base data SHA-256 | Results SHA-256 | Verdict |
|---|---|---|---|---|
| [42689444342](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42689444342) | v1, 9719445 | `de8a61bddce7e07d9a9dce94d63649528bda44b4007b1eefe55e744c3748f085` | `df3e5955…71f1` | NONE QUALIFIES |
| [42690807640](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42690807640) | v1, 866794c (report additions only) | same | `aefc6420…cb31` | NONE QUALIFIES; every pre-registered number identical |
| [42692791862](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42692791862) | v2, cc40458 | same, **verified**: the run stops on any mismatch | `7492c6e0…eb4c` | NONE QUALIFIES |

The v2 identity supplement (Alpaca corporate-action pages and MRSH bars) has SHA-256
`3116eb7bbd32c38b483518d91d8d6ea301627ff28f04341c1e9a28d2c9b05ce7`.

- **Source:** Alpaca market data only, read with the existing paper account's keys held as GitHub
  secrets: SIP daily bars, raw and split/dividend-adjusted, `asof=2026-11-06`, plus `/v1/corporate-actions`.
- **Not used:** any other data source or any paid plan.
- **Full JSON:** each run's results file is a 30-day workflow artifact. This container cannot
  download artifacts, so the tables below are copied from the run logs.

## Data quality and biases

- **Survivorship:** the universe is today's 136-stock large-cap list mapped backwards. Stocks
  that failed before 2026 are absent, which flatters the "buy yesterday's losers" rules most.
- **No untouched test period.** 2016–2026 was already examined in the weekly backtests, and
  reversal and momentum are published effects. The 2017–2022 and 2023–2026 splits are descriptive only.
- **Five rules were compared,** so the best looks better than its true edge.
- **Adjustments:** 2,825 member-sessions (v2; 2,821 in v1) had raw and adjusted returns differing
  by more than 0.5%. These are dividends and splits. Signals use adjusted closes; fills use raw
  opens and closes.
- **Security identity audit** (v2, from Alpaca's own corporate-action records):
  - **MMC:** name change to **MRSH** on 2026-01-14. v1 silently lost MMC for 206 sessions. v2
    joins MRSH's bars from the change date, rescaled so the adjusted return across the join equals
    the raw return.
  - **EA:** cash merger at $210 a share, delisted 2026-08-04. The 67 missing sessions are real.
    The strategy is flat overnight, so no position could be stranded.
  - No member has an unexplained gap.
- **Execution approximations:**
  - Daily-bar opens and closes stand in for the opening and closing auctions; they are not guaranteed fills.
  - Entries are limit-on-open at the previous close +3%, so a gap above the limit leaves the order unfilled.
  - Whole shares are sized from the previous close.
  - Costs are slippage per side.

## v2 (corrected): gross, net and break-even

These figures use the no-pause series, which shows each rule's edge. Pass/fail uses the as-live
series further down.

| Rule | Gross CAGR (0 bps) | Gross end value | Net CAGR 5 bps | Net CAGR 10 bps | Net CAGR 25 bps | Break-even cost per side |
|---|---|---|---|---|---|---|
| losers5 | 6.2% | $54,132 | -14.9% | -28.0% | -38.7% | 1.29 bps |
| gainers5 | -7.4% | $14,113 | -24.6% | -32.8% | -40.3% | none (loses before costs) |
| losers5-spy200 | 2.8% | $39,205 | -14.8% | -25.7% | -37.8% | 0.71 bps |
| losers5-volz | -0.8% | $27,651 | -19.7% | -30.5% | -39.4% | none (loses before costs) |
| losers5-spy200-sector2 | 4.4% | $45,623 | -13.5% | -25.6% | -38.3% | 1.03 bps |
| SPY open-to-close | 3.8% | $43,298 | -19.3% | -37.3% | -70.6% | 0.74 bps |
| SPY buy-and-hold (dividends, no costs) | 14.5% | $113,605 | | | | |
| Weekly strategy ($1,000, about half invested) | | | 6.6% | 6.3% | 5.2% | |

**Why every rule loses:** a daily round trip pays the cost twice a session, about 252 times a
year. At 5 bps per side that is about 22% a year. The best rule's gross edge is 6.2% a year, so it
breaks even only below 1.29 bps per side. That is below any realistic spread for these stocks.
Before costs, even the best rule earns less than half of simply holding SPY.

## v2 (corrected): as-live, the pass/fail basis

With the peak seeded at $30,000 and no automatic restart, every rule hits the 10% drawdown pause
in 2017 and stays in cash for the rest of the window.

| Rule | Cost/side | End value | CAGR | Sharpe | Max DD | Halted on | Orders | Filled | Unfilled (gap) | Costs paid |
|---|---|---|---|---|---|---|---|---|---|---|
| losers5 | 5 bps | $27,210 | -1.0% | -0.30 | -10.2% | 2017-06-23 | 600 | 590 | 10 | $3,268 |
| losers5 | 10 bps | $26,848 | -1.1% | -0.50 | -11.2% | 2017-03-21 | 270 | 263 | 7 | $2,901 |
| losers5 | 25 bps | $26,873 | -1.1% | -0.90 | -10.6% | 2017-02-06 | 120 | 117 | 3 | $3,187 |
| gainers5 | 5 bps | $27,436 | -0.9% | -0.50 | -10.6% | 2017-03-21 | 270 | 267 | 3 | $1,513 |
| gainers5 | 10 bps | $27,223 | -1.0% | -0.61 | -10.2% | 2017-03-14 | 245 | 243 | 2 | $2,703 |
| gainers5 | 25 bps | $27,053 | -1.0% | -0.93 | -10.3% | 2017-02-01 | 105 | 105 | 0 | $2,880 |
| losers5-spy200 | 5 bps | $27,210 | -1.0% | -0.30 | -10.2% | 2017-06-23 | 600 | 590 | 10 | $3,268 |
| losers5-spy200 | 10 bps | $26,848 | -1.1% | -0.50 | -11.2% | 2017-03-21 | 270 | 263 | 7 | $2,901 |
| losers5-spy200 | 25 bps | $26,873 | -1.1% | -0.90 | -10.6% | 2017-02-06 | 120 | 117 | 3 | $3,187 |
| losers5-volz | 5 bps | $26,962 | -1.1% | -0.45 | -10.2% | 2017-07-03 | 630 | 624 | 6 | $3,446 |
| losers5-volz | 10 bps | $26,817 | -1.1% | -0.59 | -10.6% | 2017-04-21 | 380 | 376 | 4 | $4,076 |
| losers5-volz | 25 bps | $26,638 | -1.2% | -0.99 | -11.2% | 2017-02-01 | 105 | 104 | 1 | $2,819 |
| losers5-spy200-sector2 | 5 bps | $26,962 | -1.1% | -0.41 | -10.5% | 2017-04-28 | 405 | 396 | 9 | $2,188 |
| losers5-spy200-sector2 | 10 bps | $26,501 | -1.3% | -0.60 | -11.9% | 2017-03-21 | 270 | 263 | 7 | $2,863 |
| losers5-spy200-sector2 | 25 bps | $26,856 | -1.1% | -0.84 | -10.5% | 2017-02-01 | 105 | 102 | 3 | $2,770 |

- **Two identical rows:** `losers5` and `losers5-spy200` match because both halted in 2017,
  before SPY ever fell below its 200-day average.
- **Even with no costs,** every rule halts in 2017:
  - `losers5`, `losers5-spy200` and `losers5-spy200-sector2` on 2017-08-10;
  - `gainers5` on 2017-05-04;
  - `losers5-volz` on 2017-10-26.
- **No exit failures:** zero unresolved exits and zero entries blocked by one in any run.

**Pass/fail at 10 bps:** every rule FAILS five of the eight conditions:
- CAGR positive at 10 and 25 bps;
- Sharpe above SPY buy-and-hold;
- Sharpe above the weekly strategy;
- both halves positive;
- at least 6 positive years.

The halt keeps every drawdown within 35%. Every rule beats SPY open-to-close, which loses even
more, and none has an unresolved exit. **NONE QUALIFIES.**

## v2: calendar-year net returns at 10 bps (no-pause series), with gross for reference

| Series | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|---|
| losers5 | -43.3% | -31.2% | -34.4% | -32.3% | -22.1% | -50.2% | -16.9% | -17.1% | -8.3% | -7.0% |
| gainers5 | -36.6% | -61.2% | -22.0% | -62.4% | -18.1% | -27.8% | -32.1% | -22.2% | -12.5% | 2.5% |
| losers5-spy200 | -43.3% | -38.7% | -40.4% | -19.8% | -21.9% | -17.4% | -19.4% | -17.7% | -19.9% | -4.8% |
| losers5-volz | -40.1% | -44.1% | -36.1% | -40.5% | -24.4% | -48.1% | -17.7% | -17.6% | -9.9% | -8.9% |
| losers5-spy200-sector2 | -44.0% | -35.8% | -38.2% | -18.3% | -23.1% | -16.9% | -22.5% | -15.9% | -21.7% | -7.8% |
| losers5 (gross) | -8.7% | 10.0% | 4.3% | 7.8% | 11.7% | -29.8% | 34.0% | 17.9% | 25.2% | 3.3% |
| gainers5 (gross) | 1.6% | -39.0% | 22.0% | -52.1% | 16.4% | 10.7% | -8.9% | -25.0% | 11.5% | 32.2% |
| losers5-spy200 (gross) | -8.7% | -10.0% | -10.2% | 15.0% | 11.7% | -12.1% | 21.5% | 18.2% | 5.1% | 3.8% |
| losers5-volz (gross) | -3.8% | -10.6% | 1.0% | -7.3% | 14.8% | -33.1% | 20.3% | 12.0% | 10.3% | 0.2% |
| losers5-spy200-sector2 (gross) | -9.7% | -5.8% | -7.0% | 16.7% | 12.3% | -12.3% | 20.0% | 22.1% | 1.3% | 12.5% |
| SPY buy-and-hold | 20.9% | -5.0% | 31.1% | 18.5% | 28.6% | -18.2% | 26.2% | 24.9% | 17.7% | 8.7% |
| SPY open-to-close (10 bps) | -35.1% | -49.8% | -30.9% | -35.5% | -33.9% | -42.9% | -27.7% | -39.1% | -34.1% | -35.8% |
| SPY open-to-close (gross) | 7.2% | -17.1% | 14.4% | 7.0% | 9.3% | -5.6% | 19.2% | 0.9% | 8.7% | -1.5% |
| Weekly strategy (10 bps) | (see note) | -11.8% | 8.9% | 5.4% | 18.1% | 6.3% | 4.3% | 11.1% | 6.0% | 1.8% |

Note: the weekly replay's curve has no point before its first session, so its 2017 calendar
return is not computed. Its full-period figures are unaffected.

Descriptive splits at 10 bps, no-pause series; neither period is untouched:

| Rule | Net 2017–2022 | Net 2023–2026 | Gross 2017–2022 | Gross 2023–2026 |
|---|---|---|---|---|
| losers5 | -36.3% | -12.9% | -2.0% | 20.5% |
| gainers5 | -40.9% | -17.7% | -11.9% | 0.2% |
| losers5-spy200 | -31.1% | -16.3% | -3.0% | 12.4% |
| losers5-volz | -39.3% | -14.2% | -7.7% | 11.0% |
| losers5-spy200-sector2 | -30.2% | -17.9% | -1.6% | 14.3% |

The stronger gross numbers in 2023–2026 come from the period with the most survivorship bias
(today's list), and they still do not survive costs. They are not a reason to tune the rules.

## v1 results (preserved; superseded by v2 for the as-live series)

v1's as-live series used the defective pause (peak set at the first close, automatic restart after
five sessions) and lost MMC from 2026-01-14. Its net results at 10 bps:

| Rule | End value | CAGR | Sharpe | Max DD | Pauses |
|---|---|---|---|---|---|
| losers5 | $1,225 | -27.8% | -1.91 | -96.1% | 39 |
| gainers5 | $732 | -31.5% | -2.71 | -97.8% | 39 |
| losers5-spy200 | $1,826 | -24.8% | -2.02 | -94.0% | 30 |
| losers5-volz | $936 | -29.7% | -2.55 | -96.9% | 39 |
| losers5-spy200-sector2 | $1,901 | -24.5% | -2.04 | -93.7% | 31 |

v1's zero-cost diagnostic, added after its results: `losers5` +6.1% CAGR, `losers5-spy200-sector2`
+4.4%, `losers5-spy200` +2.7%, `losers5-volz` -0.8%, `gainers5` -7.2%, SPY open-to-close +3.8%.

| Correction | v1 numbers affected |
|---|---|
| 1–2 (pause) | The as-live series and its pass/fail inputs only. The no-pause, gross and comparison series are unaffected. v1's max-drawdown failures (worse than -90%) came from restarting after each pause; v2 halts at about -10% to -12%. |
| 3 (unresolved) | Nothing: v1 had zero unresolved exits. |
| 4 (identity) | Every rule and the weekly comparison from 2026-01-14 (MMC/MRSH). The `losers5` gross CAGR moved from 6.1% to 6.2%; no verdict changed. |

## Reproduce

Unit tests (no network):

```bash
python -m unittest analytics.test_stock_daily_oc_backtest_v1 analytics.test_stock_daily_oc_backtest_v2 analytics.test_stock_weekly_backtest_v1
```

The full run needs an Alpaca key pair with market-data access. Never paste keys into a shared
place. In this repo the keys live only as GitHub secrets, and each run starts when its workflow
files change on the research branch.

```bash
python -m analytics.stock_daily_oc_backtest_v2 fetch --universe config/paper-auto/universe-large-cap-v1.json --end 2026-11-06 --output bars.json.gz
```

```bash
python -m analytics.stock_daily_oc_backtest_v2 run --universe config/paper-auto/universe-large-cap-v1.json --data bars.json.gz --end 2026-11-06 --output results.json --markdown results.md
```

`fetch` refuses to write the dataset unless the base fingerprint equals
`de8a61bd…f085`. After the PR merges, both workflows can also be started by hand from the Actions tab.

## What is done and what is not

**Done**
- Pre-registration before results.
- Tested v1 and v2 code, with mutation checks on every safeguard and correction.
- Three real runs with a verified dataset fingerprint.
- Identity audit.
- Gross, net and break-even reporting.
- Verdict: NONE QUALIFIES.

**Not done, by design**
- No daily trading code.
- No release switch changed.
- No orders.
- No tuning of the five rules.
- No paid data.
- Paper results, for any length of time, never turn on real money.

**Blockers and limits**
- The full results JSON exists only as 30-day artifacts; this container cannot download them.
- There is no survivorship-free universe on the free data used here.
- Opening and closing auction fills are approximated from daily bars.

**Follow-up outside this branch**
- The live weekly autopilot's universe still lists **MMC**. Its weekly decision currently skips
  MMC as "not an active listed asset". It should follow the 2026-01-14 change to MRSH.
- **EA** should be removed from the live universe, since it was delisted on 2026-08-04.
