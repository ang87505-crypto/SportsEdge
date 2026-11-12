# Cost-aware momentum: fixed research plan

Written 2026-11-01 UTC (2026-10-31 Mountain), on main
`98624281f8ed8b735241ab594e4bb4221a989f86`, before running this experiment.

## Objective and evidence boundary

Improve net compound returns, rather than a backtest's gross profit, without silently
borrowing money or changing the running paper accounts. No strategy can guarantee the
largest future profit. This study tests a small, specified set of hypotheses; it does
not search a parameter grid or promote a historical winner automatically.

All of 2017–2026 has already been inspected. These are exploratory diagnostics, not an
untouched holdout, even though this plan precedes the new run. The present-day 136-stock
universe is survivor-selected and has static sectors. A historical pass cannot establish
an investable edge. The original monthly research protocol and weekly paper models are
not amended.

## Fixed comparisons

All use the existing 252-session momentum, skip the most recent 21 sessions, require a
positive trend against the 200-session mean, select at most five stocks and two per
sector, and decide weekly from completed sessions only.

| Name | Price cap | Target per pick | Hold rank | Rebalance band | Ranking |
|---|---|---|---|---|---|
| current | $95 | 10% | none | none | existing momentum |
| uncapped | none | 10% | none | none | existing momentum |
| cost-aware | none | 10% | 10 | 20% of target | existing momentum |
| risk-adjusted | none | 10% | 10 | 20% of target | momentum / 252-session return volatility |
| full-cost-aware | none | 20% | 10 | 20% of target | existing momentum |

The uncapped control separates the affordability constraint from the trading policy.
The rank-ten buffer reuses the existing candidate's idea. The band avoids trimming and
re-buying small allocation changes: a continuing target is rebalanced only when the
dollar change exceeds both one raw share and 20% of its target. Exits are always sold.
The risk-adjusted comparison changes only ranking relative to cost-aware. Full-cost-aware
changes only exposure. No fitted parameters or leverage are introduced.

## Accounting repairs and reporting

- A new version of the research replay preserves v1 and its historical outputs.
- Execute sales before purchases, deduct costs, and proportionally reduce proposed buys
  when their total debit exceeds cash. Assert cash is nonnegative throughout.
- Fractional total-return units remain a research approximation. Whole-share execution,
  settlement, actual limit-order fills, dividends in cash, and corporate-action lifecycle
  accounting are not replicated. No live-planner parity is claimed.
- Never select using the decision day's open, close, or bar availability. A missing
  execution price rejects that rebalance; a missing held closing mark aborts the run.
  Do not forward-fill a held price through a data gap.
- Include the initial trade's cost in returns. Benchmarks pay the same assumed costs.
- Compare with weekly 50% SPY / 50% cash and 100% SPY. Cash earns zero; Sharpe uses a
  zero risk-free rate. Report actual exposure and one-way turnover relative to equity
  at each trade, not relative to the initial $1,000.
- Report 10, 25 and 50 bps **per side** for every strategy and benchmark, annual results,
  2017–2022 and already-seen 2023–2026 results, CAGR, drawdown, volatility, costs, turnover,
  order count, rejected decisions, and buy reductions caused by the cash constraint.
- Show the number of genuine dollar turnovers and whether any cash invariant failed.
  No artificial return forecast, confidence level, or best-case bound is assigned.

The primary historical diagnostic is net CAGR against the exposure-matched benchmark,
with drawdown and annual consistency alongside it. Flag drawdown beyond the running
account's 25% stop threshold; the study does not pretend that a stop guarantees that
maximum loss, nor does it simulate that stop. Do not change criteria after seeing results.

## Execution and next decision

Run locally from a licensed data snapshot or in the bounded, read-only GitHub research
workflow. The first push to `research/stock-cost-aware-momentum-20261101` runs this fixed
study; subsequent code or plan changes rerun it, and are separate exploratory attempts.
The workflow uses the existing paper account's credentials only for calendar and market
data GETs. It cannot submit orders or write the database. The public repository's standard
Ubuntu runner and the existing data entitlement are used, with no purchases or upgrades.
Provider bars remain on the temporary runner; upload aggregate results only. Record the
source commit, data digest and universe digest. Provider revisions mean a new fetch need
not reproduce identical bytes; an authorized private snapshot is needed for that.

Publish every comparison, including failures. The next candidate for a separately
registered forward paper experiment should be chosen for net return, cost robustness and
acceptable drawdown together. Anything breaching current limits needs a separately
reviewed research account, never an automatic change to an existing account. Future
forward observations after this frozen plan supply new evidence; these historical years
do not. PR #94 and Monday's current paper execution are outside this change.

## Research basis

Implementation costs and momentum crashes are established research questions, not
evidence that this specific implementation will profit:

- Ross, Moskowitz, Israel and Serban, *Implementing Momentum: What Have We Learned?*
  (2017): https://www.aqr.com/insights/research/working-paper/implementing-momentum-what-have-we-learned
- Daniel and Moskowitz, *Momentum Crashes* (2014 working paper):
  https://www.nber.org/papers/w20439
- Alpaca historical-bars interval and adjustment specification:
  https://docs.alpaca.markets/us/reference/stockbars
