# Stock challenger `stock-weekly-holdrank10-wholeshare-v1`: pre-registration (2026-11-19)

**Written and committed before any result of this round exists.** The rules, the variants, the periods and the
decision rule below are frozen. Nothing is added, removed or re-tuned after the run. Results go in a separate
document, whatever they are.

**Research only.** This changes nothing that trades:
- not the live experiment `stock-v2-weekly-1`;
- not its planner, risk limits or release flags;
- not PR #102.

A passing result could at most support a **separately registered** PAPER experiment on its own account, decided by the
owner. Real money stays off.

## The one change

| | Current (`stock-v2-weekly-1`) | Challenger |
|---|---|---|
| Model | `stock-mom252-skip21-trend200-v1` | `stock-mom252-skip21-trend200-holdrank10-v1` |
| Selection | Top 5 by 12-1 momentum, trend filter, at most 2 per sector | **The same**, except a stock already held is **kept while it still ranks in the top 10** of the eligible momentum list. Remaining slots fill in momentum order. |

Everything else is identical:
- the universe and its $95 cap;
- the weekly cadence;
- 10% of equity per pick, in whole shares;
- the 50% gross cap and the sector cap.

The single parameter (10) is `HOLD_RANK_MAX` in `analytics/stock_rank_buffer_candidate.py`, frozen on 2026-10-12, before
any weekly backtest existed. **No parameter is fitted in this round.** The live bridge
(`analytics/stock_weekly_bridge_v2.py`) and planner (`src/lib/stocks/paper-strategy-rebalance.ts`) already accept this
model version, so no code path would change if it were ever registered.

## Why this change: the failure analysis it answers

1. **Trading costs decide stock results here.**
   - The daily strategies failed because turnover of about 200× a year cost more than the starting capital
     (`docs/STOCK_DAILY_STRATEGIES_RESULTS_2026_11_10.md`).
   - The live weekly rules trade 12× a year. At 25 bps per side their full-period return fell from +86% to +73%
     (round 1, run 41259087271).
2. **Whole shares make churn expensive on the $1,000 account.**
   - On 2026-11-16 every planned leg was 1 share (OXY, MO, SLB, BMY, CSX), so each rank change in the top 5 means a
     full exit and a full re-entry of that position.
   - Each of the three shadow plans left $696–698 unused, about **30% invested** against the fractional backtest's 53%
     (`docs/AUTOMATION_OPERATIONS_2026_11_10.md`).
3. **The hold buffer is the only weekly change that already passed against the live rules.** In round 1,
   `momentum-buffer10` was PROMISING: Sharpe 0.52→0.62 in development and 0.61→0.71 in the holdout, with turnover
   12×→4.8×. That replay used fractional shares, it was never re-tested under the account's real whole-share sizing,
   and it was never registered as a challenger.
4. **What it does not address:** neither the current rules nor this challenger has beaten SPY at matched exposure
   (round 2, every variant BELOW_SPY). This round tests that again and records the answer either way.

## Data, execution model and periods (fixed)

- **Data:** Alpaca SIP daily bars, raw and all-adjusted, from 2016-01-01, read-only. Downloaded inside
  `stock-weekly-backtest.yml` (round 3) exactly as in rounds 1 and 2. The universe is
  `config/paper-auto/universe-large-cap-v1.json` at revision `large-cap-v1-2026-11-09`. The end date is
  **2026-11-18**, the last completed session before this registration.
- **Execution model (new in this round, specified from the Nov 16 shadow plans before any whole-share result):** the
  live planner's sizing applied at the decision session's open.
  - **Sizing:** budget per pick = 10% of equity; target = `floor(budget / price)` whole shares. A pick that rounds to 0
    shares is not bought.
  - **Rebalancing:** a held stock not picked is sold. A continuing pick is traded only by whole-share differences.
    Sells settle before buys, and buys need enough cash.
  - **Starting state:** $1,000 at the start.
  - **Valuation:** daily, on the all-adjusted close (dividends reinvested), as in rounds 1 and 2.
  - **Splits:** held whole-share counts follow the raw-to-adjusted ratio, so a split does not create a trade.
- **Costs:** 10 bps per side, judged. 25 bps per side is the robustness check.
- **Periods:** the same split as rounds 1 and 2.
  - development: 2017-01-01 to 2022-12-31;
  - holdout: 2023-01-01 to 2026-11-18;
  - full: both together.
- **SPY at comparable exposure:** SPY total return held at the strategy's own **realized average invested share in
  that period** (the rest in cash at 0%), rebalanced weekly, with no costs. Reported for both the current rules and the
  challenger. The nominal 50% SPY benchmark is also shown.
- **Reference rows, not judged:** both strategies replayed with fractional shares, as in rounds 1–2. The current rules
  must reproduce round 1 within the universe revision (MMC→MRSH, EA removed); that is the integrity check.

## Metrics

For each period:
- total return, CAGR, volatility and Sharpe (daily, annualized, cash at 0%);
- maximum drawdown and end value;
- turnover per year and average invested share.

Also reported:
- the full period at 25 bps;
- weekly paired return differences (challenger minus current) in the holdout: mean and a t-statistic. This is
  descriptive only and not part of the rule.

## Decision rule (whole-share replay at 10 bps unless stated)

- **R1 (beats the current rules):** all three must hold:
  - the challenger's Sharpe is higher than the current rules' in **both** development and holdout;
  - its holdout maximum drawdown is no more than 5 percentage points worse;
  - its full-period turnover is lower.
- **R2 (survives costs):** the challenger's full-period Sharpe at 25 bps is higher than the current rules' at 25 bps.
- **R3 (beats passive at comparable exposure):** the challenger's Sharpe is higher than SPY held at the challenger's
  realized exposure, in **both** development and holdout.

| Outcome | Verdict | Learning registry status |
|---|---|---|
| R1, R2 and R3 | `PROMISING` | `PROMISING` (the most retrospective evidence can reach) |
| R1 and R2, not R3 | `BEATS_CURRENT_BELOW_MATCHED_SPY` | `RUNNING`: forward only; never eligible for review until it beats matched SPY forward |
| R1 or R2 fails | `REJECTED` | `REJECTED`, kept as a permanent negative result |

A tie is not better. A missing metric counts as a failure.

## Separation of tuning and evaluation, stated honestly

- **Nothing is tuned:** zero fitted parameters, no feature search, and the variant list is these two rows.
- **The historical holdout is not untouched.** Rounds 1 and 2 (2026-11-01) reported 2023–2026 for this exact selection
  rule with fractional shares. This round's new element is the whole-share execution model, and it changes the picks'
  actual sizes and trades. The historical result is therefore **retrospective, already-inspected evidence**, capped at
  `PROMISING`.
- **The only untouched data is forward:** weeks after 2026-11-19. The learning registry entry requires at least 26
  forward weeks (`minWeeks: 26`) before any review, and the engine never promotes on its own.

## Known limits (stated before the result)

- **Survivorship bias:** today's large-cap list is mapped backwards. This flatters both strategies and the
  comparison with SPY.
- **Fills:** at the session open, not the live 09:50 limit orders. No spread, and no market impact beyond the cost
  assumption.
- **Fixed-dollar risk limits are not modelled:** $150 per order, $1,200 per day, the $1,250 capital limit. They start to
  bind only once equity passes about $1,500. They apply to both strategies alike, and changing them is an owner
  decision.
- **One historical path:** no confidence interval on Sharpe.
