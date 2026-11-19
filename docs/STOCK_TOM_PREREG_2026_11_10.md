# Pre-registration: SPY turn-of-the-month (2026-11-10)

Committed **before** any evaluation of this rule in this project. Research only: no broker order, no activation,
no real money. The weekly autopilot settings and the frozen November 10 forward experiment are not touched.
Failure is a valid outcome. These rules are not changed after results are seen; a data-integrity correction would be a
dated amendment written before any rerun.

## Why this candidate (primary source)

- **Source:** McConnell, J. J. and Xu, W. (2008), "Equity Returns at the Turn of the Month", *Financial Analysts
  Journal* 64(2), 49–64, doi:10.2469/faj.v64.n2.11. Earlier: Lakonishok and Smidt (1988), *Review of Financial
  Studies*.
- **Finding:** US equity returns over the interval from the **last trading day of a month through the third trading
  day of the next month** were significantly higher than on other days.
- **Proposed reason:** month-end payment flows (salaries, dividends, interest) are invested in equities.
- **Reproducible:**
  - the window definition is exact and uses only the public exchange calendar;
  - the instrument (SPY) has free daily data through the existing Alpaca source;
  - no parameter is fitted.
- **Not reproducible here:**
  - the paper's 1926–2005 sample (Alpaca daily data starts in 2016);
  - its close-to-close returns, because the engine trades at the next open (below).
- **Evidence standard:** influencer screenshots and delayed holdings disclosures are not evidence of a real-time
  trading algorithm, and none is used.

## Relationship to earlier ideas

- **`daily-spy-trend50-v1`** (rejected 2026-11-10) also traded SPY or cash. It used a price signal (the 50-day
  average). This rule uses only the calendar: no price input and no lookback.
- **The daily strategies** (reversal, momentum) were cross-sectional stock selection. This rule picks no stocks, so
  there is no universe survivorship.
- **Previously seen data:** SPY's 2017–2026 path was seen in earlier work (as a benchmark). This rule has not been
  evaluated on it.

## Rules (`spy-tom-v1`)

| Item | Rule |
|---|---|
| Universe | SPY only. Otherwise cash, earning 0%: the engine pays no interest on cash, which understates the strategy |
| Window | Day −1 (last trading session of the month) through day +3 (third trading session of the next month), from the exchange calendar |
| Trading times | The engine executes at the next open. Signal at the close of day −2 → buy at the open of day −1. Signal at the close of day +3 → sell at the open of day +4. The holding period is open(−1) to open(+4): the paper's close-to-close window shifted by one overnight at each end |
| Position | 100% SPY target, whole shares: `floor(w·E / (price·1.0025))`; limit-on-open buys at 3% above the prior close; sells first |
| Costs | 0, 5, 10 and 25 bps per side; judged at 10 bps |
| Corporate actions / prices | Existing engine: dividends and splits applied; a missing bar leaves the order unfilled (recorded); unresolved positions block buys |
| Risk controls | The *as-live* path applies the 10% drawdown halt (peak seeded at the $30,000 starting equity, sell at next open, owner-only resume, so no resume is simulated). The *continuous* path never halts |
| Capital | $30,000 |

## Pass/fail (all must pass at 10 bps unless noted)

These are the nine checks used for every earlier candidate (`analytics/research/evaluate.verdict`):
1. CAGR positive at 10 and 25 bps.
2. CAGR above the exposure-matched SPY benchmark: SPY scaled each day by the strategy's own exposure.
3. Sharpe above SPY buy-and-hold.
4. Sharpe above the weekly strategy.
5. Maximum drawdown within 35%.
6. Both halves positive.
7. At least 6 positive calendar years.
8. No unresolved position at any cost level.
9. Halt-exit loss within 15%.

All nine → QUALIFIES FOR REVIEW (research only); otherwise FAILS.

## What is reported

- **Returns:** gross and 5/10/25 bps returns, CAGR, total, maximum drawdown, Sharpe, turnover, exposure, annual
  returns and both halves; continuous and as-live paths.
- **Benchmarks:** SPY buy-and-hold and exposure-matched SPY.
- **Break-even costs:** the per-side cost at which CAGR reaches 0, and the cost at which it falls to the
  exposure-matched benchmark. Both are linear interpolations on the evaluated grid, labelled as such.
- **Provenance:** the dataset fingerprint.

## Confirmation

- **Historical:** the 2017-02-01 to 2026-11-06 window is **exploratory**. SPY's path there is already known, though
  it is post-publication relative to the paper.
- **Prospective:** confirmation is a simulated forward ledger from the 2026-11-10 close, updated nightly. Its first
  window buys at the open of Monday 2026-11-30.
- **Review:** no review before **24 completed windows** (about two years). A forward record never activates anything by
  itself.
