# Pre-registration: daily stock strategies (2026-11-10)

Written and committed **before** any of these three strategies has been run on historical or forward data.
Owner request: test whether trading every day makes money, using paper money only. Nothing here places a
broker order, activates a strategy or touches real money. Results, good or bad, are reported as they come out.
The rules below are not changed after results are seen; any data-integrity correction is a separate,
dated amendment written before a rerun (as with `docs/STOCK_STRATEGY_RESEARCH_PREREG_AMENDMENT_1_2026_11_09.md`).

## Common rules (all three)

- **Engine:** `analytics/research/engine.py`, unchanged: the signal uses data up to the close of session *k*; orders
  execute at the open of session *k+1*, sells first; buys are limit-on-open at 3% above the prior close; sizing
  `floor(w·E / (price·1.0025))`; 20% rebalance band; corporate actions applied; an unresolved position blocks new buys.
- **Capital:** $30,000 per strategy. **Costs:** 0, 5, 10 and 25 bps per side; judged at **10 bps**.
- **Series:** *continuous* (never halts) and *as-live* (10% drawdown from the starting-equity-seeded peak halts and
  sells at the next open; only the owner resumes, so no resume is simulated).
- **Universe:** the committed large-cap universe file `config/paper-auto/universe-large-cap-v1.json` as of this
  commit, plus SPY. It is today's list, so the historical test is survivorship-biased in its favour.
- **Eligibility at session k:** an adjusted close on every one of sessions *k−60…k*, a raw close of at least $5, and an
  average daily dollar volume (close × volume) of at least $20 million over sessions *k−19…k*.
- **Historical window:** first execution 2017-02-01, last session 2026-11-06 (same as the 2026-11-09 study).
- **Pass/fail:** the same nine checks as `docs/STOCK_STRATEGY_RESEARCH_PREREG_2026_11_09.md`
  (`analytics/research/evaluate.verdict`), on the continuous 10 bps series unless the check says otherwise.
  All nine must pass for **QUALIFIES FOR REVIEW**; otherwise **FAILS**.

## The three strategies

1. **`daily-reversal5-v1` (short-term reversal).**
   - **Selection:** at each close, the 5 eligible members with the lowest one-session adjusted return. A member
     only qualifies if that return is below zero.
   - **Sizing:** 20% each. Unused weight stays in cash. Rebalanced every session.
   - **Disclosure:** this is related to the rejected `daily-oc-losers5-v1` (PR #109), which bought losers at the
     open and sold at the same day's close. This variant holds from one open to the next open.
2. **`daily-momentum5d-v1` (short-term momentum).**
   - **Selection:** at each close, the 5 eligible members with the highest five-session adjusted return
     (`ac[k]/ac[k−5] − 1`). A member only qualifies if that return is above zero and its adjusted close is above
     the average of its last 50 adjusted closes.
   - **Sizing:** 20% each. Rebalanced every session.
3. **`daily-spy-trend50-v1` (daily trend timing).**
   - **Rule:** at each close, hold 100% SPY if SPY's adjusted close is above the average of its last 50 adjusted
     closes; otherwise hold cash.
   - **Checked:** every session.

Ties are broken by symbol. These parameters are fixed; no variant, lookback or count is searched.

## Forward paper ledgers (simulated, no broker)

- **Start:** the first signal is the close of **2026-11-09**, so the first simulated trades are at the open of
  **2026-11-10**.
- **Ledgers:** one separate $30,000 ledger per strategy, updated nightly by the research workflow from completed
  sessions only.
- **Sample:** no review until at least **252 forward sessions** (about a year).
- **No automatic activation:** a good forward record never activates a strategy by itself. Moving a strategy to the
  real paper account would be a separate, owner-approved release. Real money is never in scope.

## What is reported

- **Results:** gross and net returns at every cost level, CAGR, total return, maximum drawdown, Sharpe, turnover,
  exposure, ending cash, costs paid, both halves and calendar years.
- **Comparisons:** SPY buy-and-hold, exposure-matched SPY and the weekly strategy.
- **Provenance:** the dataset fingerprint, plus the forward sample size and status.
