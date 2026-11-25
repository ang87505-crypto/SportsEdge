# lab-stock-v3-2026-11-13: pre-registered results (research only)

**Pre-registration:** `analytics/stock_research_v3.py`, committed in `1116fe3` before the run.

**Run:** GitHub Actions [43488863136](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43488863136) on `c6dd64c`.
- Inputs: read-only Alpaca daily bars from 2016 through 2026-11-12, universe `config/paper-auto/universe-large-cap-v1.json`.
- Artifact: `stock-v3-2026-11-12` (id 14069446215, zip SHA-256 `158fb996…c6bc`), holding the full JSON and markdown.

**Periods and assumptions:**
- dev 2017-01-01..2022-12-31; holdout 2023-01-01..2026-11-12 (3.85 years);
- costs 10 bps per side, plus a 25 bps sensitivity;
- weekly block bootstrap, Holm across 4.

## Failure audit: the live weekly rules (`stock-v2-weekly-1`)
| Measure | Value |
|---|---|
| Holdout CAGR / Sharpe | 6.4% / 0.59 (dev 6.3%: stable) |
| SPY holdout CAGR / Sharpe | 20.9% / 1.34 |
| Average exposure | 53% (5 picks × 10%) |
| Exposure-matched SPY holdout CAGR | 10.9% |
| **Exposure drag** (matched SPY − SPY) | **−10.0 pts/yr** |
| **Selection gap** (strategy − matched SPY) | **−4.5 pts/yr** |
| Turnover | 12.0× per year |
| Cost drag at 25 vs 10 bps (holdout total) | −1.2 pts |
| Max drawdown (2017+) | −25.2% |

**Reading:** two problems. The 50% exposure cap costs about two-thirds of the gap to SPY. The momentum selection itself trails passive SPY at the same exposure by about 4.5 pts a year.

## Candidates
| Candidate | Dev CAGR | Holdout CAGR | Holdout Sharpe | Max DD | vs live weekly (Holm p) | Holdout @25 bps | Disposition |
|---|---|---|---|---|---|---|---|
| riskadj-mom | 5.9% | 9.6% | 0.98 | −17.7% | +0.054%/wk, p 0.27 | 9.0% | **REJECTED**: below exposure-matched SPY in dev (5.9 vs 6.1) and holdout (9.6 vs 10.9) |
| mom-lowvol | 6.3% | 5.6% | 0.83 | −15.0% | −0.023%/wk, p 0.61 | 4.1% | NO_CLEAR_EFFECT |
| core-satellite | 11.2% | 17.3% | 1.07 | −33.7% | +0.196%/wk, **p 0.0075** | 17.0% | NO_CLEAR_EFFECT: below exposure-matched SPY (21.1%) |
| core-satellite-riskadj | 10.8% | 19.6% | 1.30 | −33.6% | +0.229%/wk, **p 0.004** | 18.9% | **REJECTED**: below exposure-matched SPY in dev (10.8 vs 11.1) and holdout (19.6 vs 21.1) |
| SPY 100% (benchmark) | 11.0% | 20.9% | 1.34 | −33.8% | — | — | — |

**Result: NONE QUALIFIES.**
- **Core-satellite:** both versions beat the live rules significantly, but only by adding SPY exposure. Neither beats SPY or exposure-matched SPY.
- **Risk-adjusted momentum:** improves the live rules' risk profile (holdout Sharpe 0.98 vs 0.59, max drawdown −8.9% vs −13.3%), but not significantly, and it remains below passive SPY at its exposure.

## Caveats
- The universe is current large caps, NOT survivorship-free, so every strategy result is biased upward. This makes "none beats passive" stronger, not weaker.
- Historical replay with fractional shares at the next open. These are not Alpaca fills or forward PAPER results.
- Low volatility is only a quality proxy. No point-in-time fundamentals are collected.

## Implication (for owner review; nothing was changed)
- **The measured gap is mostly structural.** No ranking change tested here closes it.
- **Any change to the live 10%-per-pick cap, or a core SPY allocation, is a portfolio-policy decision** for the owner after Monday. It is not a model improvement, and the evidence above says it would mostly track SPY.
- **Next research needs better data, not more variants:** survivorship-free constituents, and point-in-time fundamentals or earnings data.
