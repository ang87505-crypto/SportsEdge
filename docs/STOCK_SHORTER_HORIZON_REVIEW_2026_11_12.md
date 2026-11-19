# Shorter-horizon stock strategies: review (2026-11-12)

**Decision: keep the weekly schedule. No shorter-horizon candidate is activated, and none is added now.**
Order limits, broker writes and the live weekly decision cadence are unchanged.

## What has already been tested (pre-registered, inactive)

**Daily strategies.** Pre-registration: `docs/STOCK_DAILY_STRATEGIES_PREREG_2026_11_10.md`. Results:
`docs/STOCK_DAILY_STRATEGIES_RESULTS_2026_11_10.md`. Data: 138 symbols, 2017-02 to 2026-11, with costs and
walk-forward rules registered before the run.

| Strategy | Before costs | At 10 bps per side (judged) | Max drawdown | Turnover per year | Verdict |
|---|---|---|---|---|---|
| Daily reversal (5 biggest losers) | 1.5% | −12.0% | −74.7% | 224× | FAILS 8 of 9 checks |
| Daily 5-day momentum | 11.7% | −9.0% | −73.4% | 203× | FAILS 8 of 9 checks |
| Daily SPY trend (50-day) | 7.8% | 6.0% | −19.6% | 16× | FAILS: below exposure-matched SPY (7.9%) and SPY Sharpe |
| Weekly strategy (current) | | 6.1% | | | |

The published research summary (2026-11-12 04:43 UTC) still reports **NONE QUALIFIES**. Simulated forward
ledgers for all three started 2026-11-10 and have 2 sessions each. That is far too few to read, and they continue
nightly as pre-registered. The turn-of-month study (`docs/STOCK_TOM_RESULTS_2026_11_10.md`) also did not qualify.

**Lesson.** Trading more often multiplied costs faster than it added return. Daily turnover of about 200× a year
cost $25k–$37k on $30k of capital over the window. That turned a positive gross return into a large net loss.

## Why no intraday candidate

- **Data.** The research pipeline holds daily bars only. The free Alpaca market data feed is IEX: a small share of
  consolidated volume, and not the NBBO. It cannot support realistic fill, spread and slippage modelling for
  minute-level strategies. A consolidated (SIP) feed or quote history is a paid subscription, which needs owner
  approval and was not requested.
- **Costs.** Intraday holding periods mean even higher turnover than the daily strategies that already fail at 10 bps.
- **Bias risk.** Without point-in-time intraday data and historical constituents, any intraday backtest would carry
  look-ahead and survivorship risk that the registered rules forbid.

## What would justify reopening this

1. The weekly strategy passes its release gate and builds a clean forward PAPER record.
2. A daily candidate's simulated forward ledger beats exposure-matched SPY after costs, over a registered minimum
   sample, on an untouched holdout.
3. If intraday is ever considered: the owner approves a data source with consolidated quotes, a new pre-registration
   is committed before any run, and the same cost, slippage and holdout rules apply.

Win rate and gross return are not criteria on their own. Any additional trading frequency has to show a net,
risk-adjusted advantage.
