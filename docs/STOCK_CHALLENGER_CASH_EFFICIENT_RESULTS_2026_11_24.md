# Stock challengers: cash-efficient whole-share allocation (round 4), results (2026-11-24)

**Verdicts:**
- `current-fill`: **REJECTED**.
- `holdrank10-fill`: **BEATS_CURRENT_BELOW_MATCHED_SPY**, so its learning registry status is `RUNNING`: forward only,
  and never eligible for review until it beats SPY at its own exposure forward.

Nothing is activated. Nothing that trades changed.

## Run and provenance

| Item | Value |
|---|---|
| Rules | `docs/STOCK_CHALLENGER_CASH_EFFICIENT_PREREG_2026_11_24.md`, committed in `a62defd` at 20:29:44 UTC, before the run. Registry timestamps corrected to that time in `e27a6d6` (no rule change) |
| Run | [45481431747](https://github.com/ang87505-crypto/SportsEdge/actions/runs/45481431747): `stock-weekly-backtest.yml`, round 4, end 2026-11-23, commit `e27a6d6`, dispatched 20:30:04 UTC, completed 20:31:45 UTC. Read-only data download only |
| Data | SIP daily bars 2016-01-04 to 2026-11-23; 2,739 sessions; 135 universe members with data plus SPY; universe `large-cap-v1-2026-11-09`; 77 data requests |
| Result file | `research/stock_challenger_cash_efficient_20261124/results.json` (sha256 `be70b16f…`), the run's printed `RESULTS_JSON`. Re-deriving the verdicts from it with the committed code returns the same verdicts |

**Integrity check:**
- `current` and `holdrank10` reproduce round 3's development period exactly (Sharpe 0.449 / 0.621, CAGR 4.26% / 5.96%,
  drawdown −19.75% / −14.93%).
- The holdout differs from round 3 only by three added sessions (Nov 19–23). Over them, the current rules' holdout
  drawdown deepened from −8.7% to −9.3%.

## Results: whole shares from $1,000 at 10 bps per side (judged)

| Period | Strategy | CAGR | Sharpe | Max drawdown | Avg invested |
|---|---|---|---|---|---|
| Dev 2017–2022 | current (live rules) | 4.3% | 0.45 | −19.7% | 39% |
| | holdrank10 (round 3) | 6.0% | 0.62 | −14.9% | 38% |
| | **current-fill** | 6.4% | 0.52 | −24.2% | 48% |
| | **holdrank10-fill** | 7.2% | 0.60 | −17.2% | 49% |
| | SPY at holdrank10-fill exposure | 5.6% | 0.63 | −17.8% | 49% |
| Holdout 2023 to 2026-11-23 | current | 3.3% | 0.45 | −9.3% | 39% |
| | holdrank10 | 3.6% | 0.47 | −8.9% | 39% |
| | **current-fill** | 3.6% | **0.37** | −13.2% | 49% |
| | **holdrank10-fill** | **7.3%** | **0.68** | −11.1% | 50% |
| | SPY at holdrank10-fill exposure | 9.5% | **1.22** | −9.6% | 50% |
| Full | current | 3.9% | 0.45 | −19.7% | 39% |
| | **current-fill** | 5.3% | 0.47 | −24.2% | 49% |
| | **holdrank10-fill** | 7.2% | 0.62 | −17.2% | 49% |
| | SPY at holdrank10-fill exposure | 7.1% | 0.82 | −17.9% | 49% |
| | SPY 100% | 14.2% | 0.83 | −33.8% | 100% |

| Costs and trading (full period) | current | holdrank10 | current-fill | holdrank10-fill |
|---|---|---|---|---|
| Turnover per year | 9.0× | 3.9× | 12.0× | 6.1× |
| Full Sharpe at 25 bps | 0.39 | 0.56 | 0.42 | 0.51 |
| Full CAGR at 25 bps | 3.3% | 4.9% | 4.6% | 5.6% |
| Holdout Sharpe at 25 bps | 0.36 | 0.53 | 0.35 | 0.48 |
| Decisions / rejected / cash-blocked | 516 / 0 / 0 | 516 / 0 / 0 | 516 / 0 / 0 | 516 / 0 / 0 |

Paired weekly holdout differences (204 weeks, descriptive only):

| Challenger | vs current: mean, t | vs SPY at own exposure: mean, t |
|---|---|---|
| current-fill | +0.0%/wk, t 0.25 | −0.1%/wk, t −1.16 |
| holdrank10-fill | +0.1%/wk, t 1.46 | −0.0%/wk, t −0.38 |

## Pre-registered rules

| Rule | current-fill | holdrank10-fill |
|---|---|---|
| R1 beats live (Sharpe dev and holdout; holdout drawdown within 5 points) | **fail**: holdout 0.37 vs 0.45 | pass: 0.60/0.68 vs 0.45/0.45; −11.1% vs −9.3% |
| R2 survives 25 bps | pass: 0.42 vs 0.39 | pass: 0.51 vs 0.39 |
| R3 invests ≥ 5 points more | pass: 49% vs 39% | pass: 49% vs 39% |
| R4 beats SPY at its own exposure (dev and holdout) | fail: 0.52/0.37 vs 0.63/1.22 | **fail**: 0.60/0.68 vs 0.63/1.22 |
| **Verdict** | **REJECTED** | **BEATS_CURRENT_BELOW_MATCHED_SPY** |

## What this says

1. **The allocator fixes the cash drag it targeted.** Average investment rose from 39% to about 49%, close to the 50%
   budget the live planner already allows, with zero cash-blocked decisions. Whole-share drag is now about the same as
   fractional sizing (53%).
2. **Investing more of a no-edge sleeve mostly adds risk.**
   - With the live picks, the extra exposure raised volatility and drawdown more than return. `current-fill` lost
     Sharpe in the holdout (0.45 → 0.37), and its turnover rose 9× → 12×. The band did not offset the fill's extra
     trades.
   - This is a negative result. It is kept.
3. **The fill helped only when combined with the hold buffer.**
   - `holdrank10-fill` had the best holdout of any whole-share variant so far: 7.3% CAGR, Sharpe 0.68. Turnover was
     6.1× against the live 9.0×.
   - The development period did not improve on the buffer alone (Sharpe 0.60 vs 0.62).
   - The holdout edge over the live rules is not statistically distinguishable from zero (t 1.46). One path cannot
     separate it from noise.
4. **The hard bar stands: no stock-selection variant has beaten SPY at the same exposure.** SPY held at 49% delivered
   the same full-period CAGR (7.1% vs 7.2%) with lower volatility, and a far higher holdout Sharpe (1.22 vs 0.68). This
   matches rounds 2 and 3 and the stated expectation in the pre-registration.

## Learning registry

| Entry | Status | Disposition |
|---|---|---|
| `lab-stock-cash-efficient-fill` | `REJECTED` (permanent; the engine will not re-propose this idea) | `REJECTED` |
| `lab-stock-holdrank10-cash-efficient-fill` | `RUNNING`, forward only, `minWeeks: 26` | `NO_CLEAR_EFFECT` |

The engine never promotes. The restored production registry adopts these seed entries on its next run.

## Recommendation

- **Not recommended as a new PAPER registration.** `holdrank10-fill` is better than the live rules, but neither beats
  SPY at the same exposure.
- **The evidence now points at the index itself.** Every weekly stock variant tested from round 1 to round 4 trails
  matched-exposure SPY on a risk-adjusted basis. The most evidence-supported next study is a pre-registered
  passive-core comparison:
  - whole shares of a low-priced S&P 500 ETF, so a $1,000 account can hold it;
  - its tracking difference against SPY;
  - the live stock sleeve kept only if it then adds value forward.
  
  That would be a new experiment and an owner decision. It is not started here.
- **The forward question is unchanged.** Does the live strategy, once it actually trades (PR #102's supervised session,
  next eligible Monday 2026-11-30), match its replay?

## Limits

These are the same as pre-registered:
- the universe is survivorship-biased;
- fills are at the open, not limit orders;
- the fixed-dollar risk limits are modelled only as percentages;
- there is one historical path;
- the 2023+ holdout was already inspected for these selection rules (this round's new element is sizing only).

A historical pass is not evidence of future profit. Everything here is paper and research only.
