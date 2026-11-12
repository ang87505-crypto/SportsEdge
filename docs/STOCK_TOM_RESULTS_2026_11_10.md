# SPY turn-of-the-month (`spy-tom-v1`): historical results (2026-11-10)

**Verdict: FAILS. NONE QUALIFIES.**
- **Rules:** `docs/STOCK_TOM_PREREG_2026_11_10.md`, committed (`d0eb4f4`, 06:25 UTC) before any evaluation.
- **Status:** nothing is activated. The simulated forward ledger keeps running nightly as pre-registered.

**Run:** [research-collect 42769066851](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42769066851), result
`results/tom-historical-2026-11-10T063157Z.json` on `research-data`.

**Fingerprints:**
- dataset `5143ba7830eae5cfa6cbbc11fe7a12bb29e5cd32e0373ff607d8e1ab85300838`;
- exchange calendar `4ca7d770e9690d8d…`;
- no missing symbols.

**Window and capital:** 2017-02-01 to 2026-11-06, $30,000, 117 month-end windows entered.

## Daily candidates, verified before this work

From `results/daily-historical-2026-11-10T030337Z.json` (dataset `d8763775…`), continuous at 10 bps per side:

| Strategy | CAGR |
|---|---|
| Reversal | −12.02% |
| 5-day momentum | −9.04% |
| SPY trend | +6.05% |
| SPY buy and hold | +14.47% |

All three FAILED.

**Limitations of those results:**
- The 2017–2026 history was already inspected, so it is exploratory.
- The stock list is the current one (`large-cap-v1-2026-10-30`), which is survivorship-biased.

## Results (continuous path)

| Cost per side | CAGR | Total return | Max drawdown | Sharpe | Costs paid |
|---|---|---|---|---|---|
| Gross | 4.29% | +50.5% | −10.6% | 0.58 | $0 |
| 5 bps | 3.02% | +33.6% | −10.9% | 0.42 | $3,974 |
| **10 bps (judged)** | **1.81%** | **+19.1%** | **−12.1%** | **0.27** | **$7,484** |
| 25 bps | −1.79% | −16.1% | −22.6% | −0.19 | $15,670 |

**Trading:** turnover 24× a year (12 round trips) and average exposure 19% (about 4 of 21 sessions). There were no
unresolved positions at any cost level.

**Benchmarks**

| Benchmark | CAGR | Sharpe | Max drawdown |
|---|---|---|---|
| SPY buy and hold | 14.47% | 0.84 | −33.8% |
| SPY exposure-matched to this rule (no costs) | 4.08% | 0.53 | −16.3% |
| Weekly strategy, 10 bps | | 0.52 | |

**Break-even cost per side** (linear interpolation on the 0/5/10/25 grid):
- **0.83 bps** to match exposure-matched SPY;
- **17.5 bps** to reach zero CAGR.

**Calendar years at 10 bps:**

| 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|
| −8.0% | −0.0% | +22.2% | +2.6% | −0.4% | +2.5% | −2.7% | −3.9% | +9.3% |

**Halves:** +2.2% and +1.2% a year.

**With the actual pause rule** (as-live, 10% halt, owner-only resume): the rule halted on 2018-03-01 (2018-02-06 at
25 bps) and finished between −0.9% and −1.2% a year.

**Failed checks**
- CAGR positive at 10 **and** 25 bps;
- CAGR above exposure-matched SPY;
- Sharpe above SPY;
- Sharpe above the weekly strategy;
- at least 6 positive years.

**Passed:** drawdown within 35%, both halves positive, no unresolved positions, and halt-exit loss within 15%.

## What this says

**No edge before costs.** Before costs, the window earned about what SPY earns on any 19% of days: 4.29% against
4.08%, a gap that 0.83 bps per side erases. The effect McConnell and Xu documented through 2005 is not visible in SPY
over 2017–2026. That is consistent with the general finding that published anomalies weaken after publication, though
this window is too short to say why.

## Limitations

- **Data:** the 2017–2026 SPY path was previously seen, so this is exploratory, not a fresh holdout. Confirmation
  would come only from the prospective ledger: first window buys at the 2026-11-30 open; no review before 24 windows.
- **Execution:** fills are at the next open, so the held interval is the paper's window shifted by one overnight at
  each end.
- **Cash:** idle cash earns 0% in the engine, which understates a cash-heavy rule. At about 81% in cash, a T-bill yield
  would add materially, but cash yield is not part of the pre-registered comparison.
- **Costs:** a flat bps per side; no modelled spread or market impact.
