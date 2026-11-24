# Stock challengers: cash-efficient whole-share allocation (round 4), pre-registration (2026-11-24)

**Written and committed before any result of this round exists.** The rules, variants, periods, constants and decision
rule below are frozen. Nothing is added, removed or re-tuned after the run. Results go in a separate document, whatever
they are, and negative results are kept.

**Research only.** Nothing that trades changes:
- not the live experiment `stock-v2-weekly-1`, its model, planner (`src/lib/stocks/paper-strategy-rebalance.ts`), risk
  limits, schedule or release flags;
- not PR #102 or its supervised acceptance gate;
- not the weekly decision cadence or the one-time `initial` decision (already used 2026-10-30).

A passing result could at most support a **separately registered** PAPER experiment, decided by the owner. It would
also need a reviewed planner change. Real money stays off. The learning engine never promotes on its own.

## The weaknesses this answers (evidence before this registration)

| # | Weakness | Evidence |
|---|---|---|
| W1 | **Whole-share cash drag.** The live sizing `floor(10% of equity / price)` leaves much of the 50% gross budget idle on a $1,000 account. | Round 3 (run 44602976829): whole shares cut average investment from 53% to **39%** and full-period CAGR from 6.2% to **4.0%**. Nov 16 and Nov 23 shadow plans bought 1 share of each $50–$80 pick and left about $700 of $1,000 unused (about **30% invested**), see `docs/AUTOMATION_OPERATIONS_2026_11_10.md`. |
| W2 | **Transaction costs and churn.** | Daily strategies lost to ~200× turnover (`docs/STOCK_DAILY_STRATEGIES_RESULTS_2026_11_10.md`). The live weekly rules turn over 8.9×/yr; at 25 bps they lose 0.6 CAGR points. The hold buffer cut turnover to 3.9×. |
| W3 | **No edge over the index at matched exposure.** | Rounds 2–3: every variant was below SPY held at the same exposure in the 2023+ holdout (current 0.47 vs matched SPY Sharpe; holdrank10 0.49 vs 1.27). |
| W4 | **The $95 price cap shrinks the universe** to roughly 32 of 136 members. | Weekly decision diagnostics (Oct 30, Nov 23: about 100 `LAST_CLOSE_ABOVE_CAP` skips). |

This round tests **W1 and W2 only**. W4 is not tested, because lifting the cap needs a larger account (an owner
decision), and round 2 showed the no-cap results are the most survivorship-inflated. **W3 is the hard bar for both
challengers.** Expected outcome, stated now: allocation alone does not create stock-selection skill. Raising exposure of
a sleeve that has not beaten matched SPY will most likely improve raw CAGR and still fail R4. If so, that negative result
is recorded and kept.

## The variants

The judged baseline is the live rules, sized exactly as in round 3.

| Variant | Picks | Sizing | Judged |
|---|---|---|---|
| `current` | live: top 5 by 12-1 momentum, trend filter, ≤2 per sector, $95 cap | live floor(10%) whole shares | baseline |
| `holdrank10` | live, plus the frozen top-10 hold buffer (`HOLD_RANK_MAX=10`) | live floor(10%) whole shares | reference (round 3 challenger) |
| **`current-fill`** | **identical to `current`** | **`fill-band-v1`** | **challenger C1** |
| **`holdrank10-fill`** | **identical to `holdrank10`** | **`fill-band-v1`** | **challenger C2** |
| `current-fractional` | live | fractional 10% (rounds 1–2) | integrity reference |

### Allocator `fill-band-v1` (applied at each weekly decision, whole shares)

Implemented as `fill_band_targets` in `analytics/stock_weekly_backtest_v1.py`:

1. **Band (reduces churn):** a pick already held whose value is within **[5%, 15%] of equity** keeps its share count.
   Every other pick starts at the live `floor(budget / price)`, budget = `floor(10% of equity)` in cents.
2. **Gross cap (the live planner's):** the total may not exceed `number of picks × budget`, which is 50% with five
   picks. If banded holdings exceed it, they return to `floor(budget / price)`, worst-ranked first, until the total
   fits.
3. **Fill (reduces idle cash):** whatever is left of that total buys one more share at a time, best-ranked first, in
   repeated passes. A share is added only if it fits the remainder and keeps the name at or below **15% of equity**.
4. Unchanged from round 3:
   - held stocks that are no longer picked are sold;
   - sells settle before buys, and buys are all-or-nothing on cash;
   - splits never count as trades.

**Constants and where they come from (none fitted to data):**
- 50% gross = the live planner's `GROSS_CAP` (5 picks × 10%).
- 15% per name = the registered `maxOrderNotionalCents` 15,000 on the $1,000 registration
  (`config/paper-auto/stock-v2-weekly-1.json`).
- 5% band floor = half the live 10% target.

Under the live limits, every challenger position at $1,000 equity stays within the $150 per-order and 50% gross caps.

## Data, execution model and periods (fixed)

- **Data:**
  - Alpaca SIP daily bars, raw and all-adjusted, from 2016-01-01, read-only.
  - Downloaded inside `stock-weekly-backtest.yml` (round 4) exactly as in rounds 1–3.
  - Universe `config/paper-auto/universe-large-cap-v1.json` as on this commit.
  - **End date 2026-11-23**, the last completed session before this registration.
- **Execution:** at the decision session's open, as in round 3. Valuation is daily on the all-adjusted close, with
  dividends reinvested. Start with $1,000.
- **Costs:** **10 bps per side judged**; 25 bps per side is the robustness check. Alpaca charges no commission. For
  these large caps, 10 bps covers a typical half-spread plus slippage on small limit orders; 25 bps is a stress case.
- **Periods:**
  - development: 2017-01-01 to 2022-12-31;
  - holdout: 2023-01-01 to 2026-11-23;
  - full: both together.
- **SPY at equivalent exposure:** SPY total return held at **each strategy's own realized average invested share in
  that period**, the rest in cash at 0%, rebalanced weekly, with no costs. It is computed separately for every
  whole-share variant. Because a challenger that invests more is compared with *more* SPY, it cannot pass just by
  taking more market exposure.

## Metrics

For each period:
- total return, CAGR, volatility and Sharpe (daily, annualized, cash 0%);
- maximum drawdown;
- average invested share, turnover per year, cash-blocked decisions.

Also reported:
- full-period and holdout results at 25 bps;
- paired weekly differences in the holdout, each challenger against `current` and against its matched SPY. These are
  descriptive only.

## Decision rule, applied to each challenger separately (whole shares, 10 bps unless stated)

- **R1 beats the live rules:**
  - Sharpe is above `current` in **both** development and holdout;
  - holdout maximum drawdown is no more than 5 percentage points worse.
- **R2 survives costs:** full-period Sharpe at 25 bps is above `current` at 25 bps.
- **R3 fixes the mechanism:** full-period average invested share is at least **5 points** above `current`.
- **R4 beats passive at equivalent exposure:** Sharpe is above SPY held at the challenger's own realized exposure, in
  **both** development and holdout.

| Outcome | Verdict | Learning registry |
|---|---|---|
| R1, R2, R3 and R4 | `PROMISING` | `PROMISING` (the most retrospective evidence can reach; forward review still required) |
| R1, R2, R3, not R4 | `BEATS_CURRENT_BELOW_MATCHED_SPY` | `RUNNING`: forward only; never eligible for review until it beats matched SPY forward |
| any of R1–R3 fails | `REJECTED` | `REJECTED`, kept as a permanent negative result |

A tie is not better. A missing metric counts as a failure.

## Overfitting and look-ahead controls

- **Zero fitted parameters.** All three allocator constants come from existing registered limits (above). There is no
  search and no alternative band or cap, and the variant list is fixed at these rows.
- **Two challengers only.** Each must pass all four rules on its own. Passing one does not lend evidence to the other.
  The holdout paired tests are descriptive and are not used to rescue a failed rule.
- **No look-ahead.**
  - Picks use the existing scorer (information before the decision session).
  - The allocator uses only the decision session's open prices, which are also the execution prices.
  - Matched-SPY weights are realized per period. They are a comparison device, not a tradable signal.
- **The holdout is not untouched.** Rounds 1–3 already reported 2023–2026 for these selection rules. The new element
  here is the sizing rule, so this is retrospective, already-inspected evidence, capped at `PROMISING`.
- **Truly unseen evidence is forward only.** The registry entries require at least 26 forward weeks (`minWeeks: 26`)
  before any review. The engine never promotes.
- **Code integrity.** Rounds 1–3 produce byte-identical output on the test fixture before and after this change. The
  live-rule baseline and the round-3 challenger are reused unchanged (unit tests).

## Known limits (stated before the result)

- **Survivorship bias:** today's large-cap list is mapped backwards. This flatters every variant and the comparison
  with SPY.
- **Fills:** at the open, not the live limit orders. There is no market impact beyond the cost assumption, and no
  partial fills.
- **Fixed-dollar risk limits are not modelled** ($150 per order, $1,200 per day, $1,250 capital). They are expressed
  as percentages of equity, which matches them only near $1,000. The challenger's 15% name cap binds before the
  $150 limit only while equity is ≤ $1,000.
- **One historical path:** no confidence interval on Sharpe.

## If anything passes

Nothing activates. The next steps would be the owner's decisions:
1. a reviewed TypeScript planner version implementing `fill-band-v1` with the same tests;
2. a separate PAPER registration on its own account (or an owner decision to change the live one after #102's
   supervised acceptance is complete);
3. at least 26 forward weeks compared with matched SPY.

## Reproduce

```bash
python -m unittest analytics.test_stock_weekly_backtest_v1
```

Then run *Stock weekly backtest (research, manual)* with `end = 2026-11-23` and `round = 4`, a read-only data download.
