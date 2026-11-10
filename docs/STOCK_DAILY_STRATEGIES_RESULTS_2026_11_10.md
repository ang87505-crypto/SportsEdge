# Daily stock strategies: historical results (2026-11-10)

**Overall: NONE QUALIFIES.** Rules: `docs/STOCK_DAILY_STRATEGIES_PREREG_2026_11_10.md`, committed (`0434a1b`, 02:50 UTC)
before any run. Nothing is activated. The simulated forward ledgers still run every night, as pre-registered, so the
question keeps being tested on new data.

**Run:** [research-collect 42746861238](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42746861238).
The result file is `results/daily-historical-2026-11-10T030337Z.json` on the `research-data` branch.

**Data:**
- Dataset SHA-256: `d8763775c703deccf2c3973906f643446d9038d381d43b272475179cf56cb493`.
- 138 symbols with bars, none missing.
- Window: 2017-02-01 to 2026-11-06, with $30,000 capital per strategy.

## Results (continuous series)

| Strategy | Before costs | 5 bps | **10 bps (judged)** | 25 bps | Max drawdown at 10 bps | Sharpe at 10 bps | Turnover per year | Costs paid at 10 bps |
|---|---|---|---|---|---|---|---|---|
| Daily reversal (5 biggest losers) | 1.5% | −5.5% | **−12.0%** | −27.6% | −74.7% | −0.67 | 224× | $25,731 |
| Daily 5-day momentum | 11.7% | 1.0% | **−9.0%** | −30.1% | −73.4% | −0.31 | 203× | $37,066 |
| Daily SPY trend (50-day) | 7.8% | 6.9% | **6.0%** | 3.5% | −19.6% | 0.59 | 16× | $6,550 |
| SPY buy and hold | 14.5% | | | | −33.8% | 0.84 | | |
| Weekly strategy, 10 bps | | | 6.1% | | | | | |

**Failed checks**
- **Reversal and momentum:** 8 of 9 failed. Their only pass was the 15% limit on the halt-exit loss.
- **SPY trend:** CAGR above exposure-matched SPY (6.0% vs 7.9%), and Sharpe above SPY buy-and-hold.

**As-live series:** with the 10% halt, all three halted within the first 13 months (2017–2018) and finished between
−1.5% and +1.0% a year.

## What this says

- **Costs decide it.** The momentum strategy made money before costs. At a realistic 10 bps per side it rotated
  its portfolio about 200 times a year and paid more in costs than its starting capital.
- **The trend rule paid the least.** It trades about 16 times a year, so it lost the least to costs. It still
  earned less than simply holding SPY.
- **Caveat on the stock list.** The historical stock list is survivorship-biased, which flatters these results. The
  failure would be at least as clear without that bias.
