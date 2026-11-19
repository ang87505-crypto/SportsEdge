# Stock challenger `stock-weekly-holdrank10-wholeshare-v1`: results (2026-11-19)

**Verdict: `BEATS_CURRENT_BELOW_MATCHED_SPY`.** In the learning registry, `lab-stock-holdrank10-wholeshare` moves from
`PROPOSED` to `RUNNING` (forward only).

The challenger beat the current weekly rules on the pre-registered checks, mostly by trading less. It did **not** beat
SPY held at the same exposure, in either period. Nothing is activated, and nothing that trades changed.

## Run and provenance

| Item | Value |
|---|---|
| Rules | `docs/STOCK_CHALLENGER_HOLDRANK10_PREREG_2026_11_19.md`, committed in `c9d91df` at 19:53:19 UTC, before the run |
| Run | [44602976829](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44602976829): `stock-weekly-backtest.yml`, round 3, end 2026-11-18, on `c9d91df`, started 19:53:27 UTC |
| Data | SIP daily bars 2016-01-04 to 2026-11-18; 135 universe members with data plus SPY; universe `large-cap-v1-2026-11-09` |
| Result file | `research/stock_challenger_holdrank10_20261119/results.json`, the run's printed `RESULTS_JSON` |

The result file was copied from the run log because the artifact host is not reachable from the authoring session.
Re-rendering it with the committed code reproduces the run's tables, and `verdicts_round3` on it returns the same
verdict.

Correction recorded: the pre-registration commit stamped the registry entry 21:30 UTC by mistake. That is later than
the run, so it was corrected to the commit time, 19:53:19 UTC. No rule, parameter or variant changed.

## Results: whole shares from $1,000 at 10 bps per side (judged)

| Period | Strategy | CAGR | Sharpe | Max drawdown | Avg invested |
|---|---|---|---|---|---|
| Development 2017–2022 | Current rules | 4.3% | 0.45 | −19.7% | 39% |
| | **Challenger** | **6.0%** | **0.62** | **−14.9%** | 38% |
| | SPY at challenger's exposure | 4.5% | 0.63 | −14.2% | 38% |
| Holdout 2023 to 2026-11-18 | Current rules | 3.5% | 0.47 | −8.7% | 39% |
| | **Challenger** | **3.8%** | **0.49** | **−8.9%** | 39% |
| | SPY at challenger's exposure | 7.5% | 1.27 | −7.5% | 39% |
| Full 2017 to 2026-11-18 | Current rules | 4.0% | 0.45 | −19.7% | 39% |
| | **Challenger** | **5.1%** | **0.57** | **−14.9%** | 38% |
| | SPY at challenger's exposure | 5.6% | 0.84 | −14.3% | 38% |
| | SPY 100% | 14.3% | 0.84 | −33.8% | 100% |

| Costs and trading (full period) | Current rules | Challenger |
|---|---|---|
| Turnover per year | 8.9× | **3.9×** |
| Sharpe at 25 bps | 0.40 | **0.57** |
| CAGR at 25 bps | 3.4% | **5.1%** |
| Holdout Sharpe at 25 bps | 0.38 | 0.56 |
| Decisions / rejected / cash-blocked | 515 / 0 / 0 | 515 / 0 / 0 |

**Pre-registered rules**

| Rule | Result | Why |
|---|---|---|
| R1: beats the current rules | **pass** | Sharpe higher in development (0.62 vs 0.45) and in the holdout (0.49 vs 0.47). Holdout drawdown −8.9% vs −8.7%, within the 5-point limit. Turnover is lower. |
| R2: survives 25 bps | **pass** | Full-period Sharpe 0.57 vs 0.40 |
| R3: beats SPY at its own exposure | **fail** | Development 0.62 vs 0.63; holdout 0.49 vs 1.27 |

## What this says

1. **The improvement is real but small where it matters.**
   - In development the buffer adds +1.7 points of CAGR and cuts the worst drawdown by 4.8 points.
   - In the holdout the gain is +0.3 points of CAGR and +0.02 Sharpe. The paired weekly difference is indistinguishable
     from zero: 203 weeks, mean +0.006% a week, t = 0.17. R1 passed in the holdout by a margin that this one path
     cannot separate from noise.
2. **Most of the gain is lower cost.**
   - Turnover drops by more than half, from 8.9× to 3.9× a year.
   - Going from 10 to 25 bps per side costs the current rules 0.6 points of CAGR a year (4.0% → 3.4%), and the
     challenger under 0.1 (5.11% → 5.05%).
   - This matches the failure analysis: the stock strategies here lose mainly to trading.
3. **Neither strategy beats doing nothing clever.** SPY held at the same ~39% exposure beat both:
   - holdout CAGR 7.5% vs 3.8%;
   - full period 5.6% vs 5.1%, with a lower drawdown.

   Selecting individual stocks has not added value over the index here, before or after this change.
4. **Whole shares cost the live rules about 2 points a year.** The fractional reference rows reproduce round 1 (current
   rules: 12.0× turnover, full Sharpe 0.53 vs 0.55 in round 1). The small difference comes from the universe revision
   (EA removed, MMC→MRSH) and three more weeks of data. Moving to whole shares on $1,000:
   - drops average investment from 53% to 39%;
   - drops full-period CAGR from 6.2% to 4.0%.

   The live account invests even less at today's prices: about 30% on Nov 16.

## What it means for the learning registry and next steps

- `lab-stock-holdrank10-wholeshare` is `RUNNING`, retrospective only. It needs at least 26 forward weeks
  (`minWeeks: 26`), and it can never reach review unless it also beats matched SPY forward. The engine never promotes;
  the restored production registry adopts this entry on its next run (`report.seed.adopted`).
- **Not recommended as a new PAPER registration on this evidence.** It is better than the current rules, but neither is
  better than SPY at the same exposure. Registering it would need the owner's decision on a separate account, and it
  would trade without a demonstrated edge over the index.
- The useful forward question is unchanged: does the current weekly strategy, once it actually trades (PR #102, the
  Nov 23 session), match its replay? The Learning evidence panel now separates targets, orders, fills and realized
  results for that.

## Limits

These are the same as pre-registered:
- the universe is survivorship-biased;
- fills are at the open, not the live limit orders;
- the fixed-dollar risk caps are not modelled;
- there is one historical path;
- the 2023+ holdout was already inspected under fractional sizing in rounds 1–2.

A historical pass is not evidence of future profit. Everything here is paper and research only.
