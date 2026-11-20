# Stock challenger `stock-mom252-skip21-trend200-cashaware-v1`: pre-registration (2026-11-20)

**Written and committed before any result of this round (round 4) exists.** The rules, variants, periods and decision
rule are frozen. Nothing is added, removed or re-tuned after the run, and the results go in a separate document
whatever they are.

**Research only. This changes nothing that trades:**
- not `stock-v2-weekly-1`, its planner (`src/lib/stocks/paper-strategy-rebalance.ts`), risk limits, bankroll or
  release flags;
- not PR #102, PR #187, the Nov 23 supervised session or any broker control;
- not the NBA (#195) or Kalshi (#194) experiments.

No order is sent. A passing result could at most support a **separately registered** PAPER experiment, decided by the
owner and integrated by Codex.

## Audit: why the Nov 16 shadow plans invested about 30%

The live planner sizes every pick as `floor(floor(equity / 10) / ask)` whole shares and refuses any plan above
`GROSS_CAP = equity / 2`. With five picks, two separate effects compound:

| Layer | Effect on $1,000 | Source |
|---|---|---|
| 1. Design ceiling | 5 picks × $100 = **$500 (50%) at most**; the other half is idle cash at 0% by design | `budget=Math.floor(x.equityCents/10)`, `GROSS_CAP` |
| 2. Floor rounding | a $50–79 stock gets exactly 1 share (2 shares exceed $100); five such picks hold about $300. **Floor rounding left about $200 of the $500 budget idle.** | Nov 16 run log: 1 share each of OXY, MO, SLB, BMY, CSX; $696–698 unused per plan |
| 3. Price cap | the $95 universe cap admits only stocks whose price allows ≥1 share, so no pick rounds to 0 | `max_last_close` in `universe-large-cap-v1.json` |

**Historical context.**
- In round 3 (whole shares, run 44602976829), the current rules averaged **39%** invested, against 53% fractional.
- The difference cost about 2 CAGR points a year.
- Floor rounding loses the most when prices sit just above `budget / n` for an integer n. In November 2026 many picks
  are priced $50–79, which is the worst band: 50–79% of the $100 budget.

A second turnover source shows up in the round-3 code. A continuing pick is re-sized to `floor(budget / price)` every
week, so ordinary price and equity drift moves it by ±1 share. That repeatedly trades the most expensive part of a small
whole-share account.

**What does not cause it.**
- Not a cash shortage: round 3 recorded 0 cash-blocked decisions.
- Not the sector cap.
- Not missing quotes.

## Prior results that stay as recorded

| Experiment | Verdict |
|---|---|
| Round 1 variants (fractional) | `momentum-buffer10` PROMISING vs live; all else NOT_BETTER |
| Round 2 account-size variants (weight 0.20, no price cap) | every variant BELOW_SPY; none better than live after drawdown |
| Round 3 `holdrank10` (whole shares) | BEATS_CURRENT_BELOW_MATCHED_SPY: registry `RUNNING`, forward only |
| AI2 v3 candidates | risk-adjusted momentum REJECTED; core-satellite and mom+low-vol NO_CLEAR_EFFECT |
| Daily strategies, turn-of-month, 13F followers | REJECTED |
| Steady/low-volatility `stock-lowvol252-trend200-v1` (PR #94, unmerged) | round 1 Sharpe 0.54 vs SPY 50% 0.86; not research evidence of an edge |

## The one hypothesis

**Cash-aware, band-rebalanced whole-share sizing.** It keeps the current production selection and the existing risk
envelope, and puts the idle half of the per-pick budget to work without new limits or more trading. That improves
capital utilization and cost-adjusted risk-adjusted return over the live floor sizing.

Registry key: `stocks:cash-aware-whole-share-sizing` (no existing entry uses it).

| | Current (`stock-v2-weekly-1`) | Challenger |
|---|---|---|
| Selection | top 5 by 12-1 momentum, trend200, ≤2 per sector, $95 cap, weekly | **identical** (`stock-mom252-skip21-trend200-v1`) |
| New pick size | `floor(10% of equity / open)` | `round_half_up(10% of equity / open)`, at most `floor(15% of equity / open)` |
| Continuing pick | re-sized every week to `floor(10% / open)` | **kept unchanged while its value is within 5–15% of equity**; outside the band, re-sized like a new pick |
| Dropped pick | sold | sold (unchanged) |
| Gross cap | 50% of equity, plan refused above it | 50% of equity: while the plan exceeds it, remove one share from the largest position (ties by symbol) |
| Cash | sells first; buys all-or-nothing | unchanged |

**Fixed parameters.** These come from existing limits and are not fitted:
- 10% target and 50% gross cap: the live planner.
- 15% per-name ceiling: `maxOrderNotionalCents` of $150 on the $1,000 account in `config/paper-auto/stock-v2-weekly-1.json`.
- 5% lower edge: the band is symmetric around 10%.

**Not changed:** fractional shares. The live controller refuses fractional quantities (`FRACTIONAL_QUANTITY`) and the
release is whole-share only. Fractional rows remain reference only.

**Expectation, stated in advance.** A sizing rule cannot add selection skill. Raising exposure raises CAGR and drawdown
together and leaves Sharpe roughly unchanged, so any Sharpe gain must come from more even weights and lower trading
cost. The exposure-matched SPY requirement (R3) is the binding test: it failed for every earlier stock variant.

## Data, execution model and periods (fixed)

- **Data and universe:** identical to round 3. Alpaca SIP daily bars from 2016-01-01, raw and all-adjusted, read-only,
  downloaded inside `stock-weekly-backtest.yml` (round 4). Universe `large-cap-v1-2026-11-09`. End date
  **2026-11-18**, the same as round 3.
- **Execution:** round 3's whole-share model at the decision session's open. 10 bps per side judged, 25 bps robustness.
- **Periods:**
  - development 2017-01-01..2022-12-31;
  - holdout 2023-01-01..2026-11-18;
  - full.
- **Independence:** **every historical period here has already been inspected** (rounds 1–3). This round is therefore
  **exploratory**. No untouched historical window exists in this data: it starts in 2016 and needs 253 sessions per
  decision.
- **Integrity check:** the `current` and `holdrank10` rows must reproduce round 3 exactly (same code path, same data
  end).

## Variants

| Row | Role |
|---|---|
| `current` | frozen production comparison (judged baseline) |
| `holdrank10` | previously tested alternative (reference; must reproduce round 3) |
| **`cashaware`** | **the challenger (judged)** |
| `cashaware-nearest-only` | ablation: nearest-share sizing, no band (descriptive) |
| `cashaware-band-only` | ablation: floor sizing with the band (descriptive) |
| `holdrank10-cashaware` | combination (descriptive only; cannot change the verdict) |
| `current-fractional` | reference |

## Metrics (every row, every period)

**Returns and risk:**
- CAGR, volatility, Sharpe;
- Sortino (downside deviation of daily returns below 0);
- maximum drawdown.

**Capital use:**
- average and minimum invested share (capital utilization);
- cash drag: SPY 100% CAGR minus SPY-at-the-row's-exposure CAGR.

**Trading and costs:**
- turnover: traded value ÷ average equity per year, plus round 3's traded ÷ $1,000 per year;
- costs paid in dollars and as % of average equity per year;
- full and holdout metrics at 25 bps.

**Benchmarks:**
- SPY at the row's own realized exposure per period;
- SPY 100%; SPY 50%.

**Uncertainty:** circular block bootstrap of paired **weekly** returns (8-week blocks, 2,000 replicates, seed 20261120),
95% intervals for:
- the annualized Sharpe difference, challenger − current, per period;
- the annualized Sharpe difference, challenger − SPY at the challenger's exposure, per period;
- the mean weekly return difference.

These intervals are reported. They do not loosen or replace the rules below.

## Decision rule (frozen; a tie is not better; a missing metric fails)

| Rule | Condition |
|---|---|
| R0 mechanism | challenger holdout average invested share ≥ current + 5 points |
| R1 beats current | Sharpe above current in development AND holdout; holdout max drawdown no more than 5 points worse; turnover per average equity no higher than current |
| R2 survives costs | full-period Sharpe at 25 bps above current's at 25 bps |
| R3 matched benchmark | Sharpe above SPY held at the challenger's own exposure, in development AND holdout (the existing promotion requirement) |

| Verdict | When | Registry |
|---|---|---|
| `QUALIFIES_FOR_FORWARD_TEST` | R0–R3 all hold | `RUNNING`, forward only; never eligible for review before 26 forward weeks that also beat matched SPY |
| `BEATS_CURRENT_BELOW_MATCHED_SPY` | R0–R2 hold, R3 fails. **Does not qualify** under the promotion rules. | `RUNNING` forward only, as holdrank10 |
| `FAILS` | R0, R1 or R2 fails | `REJECTED` |
| `INSUFFICIENT_EVIDENCE` | the run does not complete, or a judged metric is missing | `INSUFFICIENT_DATA` |

**Frozen forward test.** The same code and rules, re-run with a later `--end`. Its window starts with the first decision
after the data end: **the week of 2026-11-23**. It needs 26 forward weeks before any review, with R3 judged on forward
weeks only. Nothing is promoted by any verdict; the owner decides any PAPER registration.

## Known limits, stated before results

- **Survivorship bias:** the universe is today's large-cap list, which flatters every row and the comparison with SPY.
- **Fills:** at the open, not at the live limit price. Spreads are not modelled beyond the bps cost.
- **No interest on cash:** cash earns 0%.
- **Not modelled:** the fixed-dollar caps other than the 15% name ceiling (`maxDailyNotional`, order counts).
- **One path:** there is one historical path, and every historical period has already been inspected.
