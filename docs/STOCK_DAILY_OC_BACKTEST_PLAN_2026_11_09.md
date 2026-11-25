# Daily open-to-close stock PAPER experiment: pre-registered backtest plan

Written and committed **before any result of this study exists** (2026-11-09). Nothing in this
plan changes after results are seen. Research only: no trading code, no orders, no database
writes, no release switch changes. The weekly $1,000 strategy (`stock-v2-weekly-1`), NBA props,
existing records, owner controls and PR #102 are untouched.

## Question

Does any of five simple daily rules, bought at the open and sold at the close of the same
session on a $30,000 PAPER account, beat simply holding SPY, trading SPY open-to-close, and the
live weekly strategy, after costs?

## Data

- Alpaca market data, read-only, with the existing first paper account's keys held as GitHub
  secrets (`ALPACA_PAPER_AUTO_KEY_ID`, `ALPACA_PAPER_AUTO_SECRET_KEY`), through the same fetch code
  as the weekly backtest (`analytics/stock_weekly_backtest_v1.fetch`): `/v2/calendar` for
  sessions and `/v2/stocks/bars`, `timeframe=1Day`, `feed=sip`, `asof=2026-11-06`, both
  `adjustment=raw` (open, close, volume) and `adjustment=all` (split- and dividend-adjusted
  open and close). No other source. No paid plan.
- Universe: `config/paper-auto/universe-large-cap-v1.json` (136 hand-reviewed large caps with
  sectors) plus SPY.
- Data window 2016-01-01 to 2026-11-06. **Evaluation window 2017-01-03 to 2026-11-06**, the same
  start as the weekly backtest so the two compare over identical dates; 2016 is warm-up only.
- The run prints a SHA-256 fingerprint of the downloaded dataset, the request count, the number of
  sessions and symbols, per-symbol missing-bar counts in the evaluation window, and the number of
  sessions where the raw and adjusted close-to-close returns differ by more than 0.5% (splits,
  dividends and other adjustments).

## Known biases (stated now, not discovered later)

- **Survivorship:** the universe is today's list mapped backwards. Stocks that collapsed or were
  delisted before 2026 are missing. This flatters every rule, most of all the "buy yesterday's
  losers" rules, because losers that kept falling to zero are absent.
- **No untouched test period.** The same 2016–2026 Alpaca data was already examined in the weekly
  backtests (rounds 1 and 2), and short-term reversal and momentum are well-known published
  effects. The 2017–2022 and 2023–2026 splits below are descriptive only; neither is a holdout.
- **Multiple testing:** five rules are compared; the best of five looks better than its true edge.
- Daily bars are execution approximations, not guaranteed fills.

## Execution model (all rules)

Session T is the trading day. Everything that decides an order uses only bars through session
T−1 (the previous completed session), as a pre-open job would.

- **Eligible:** a member with raw and adjusted bars on T−1 and T−2; raw close on T−1 ≥ $5; average
  raw close × volume over T−20..T−1 ≥ $20,000,000 (the weekly strategy's floors). SPY is never a
  rule pick.
- **Yesterday's return** r = adjusted close(T−1) / adjusted close(T−2) − 1 (includes dividends;
  splits cancel).
- **Orders:** a limit-on-open buy for each pick, limit L = raw close(T−1) × 1.03, rounded to cents.
  Shares = floor(0.20 × E ÷ (L × 1.0025)), where E is the account equity at the T−1 close. The
  account is flat overnight, so E is cash. Five positions at most 20% each cannot exceed 100%,
  so there is no leverage even if every order fills at its limit.
- **Opening fill:** filled at raw open(T) if a bar exists on T and raw open(T) ≤ L. Otherwise the
  order is **unfilled** (gap above the limit, or no bar: halt, missing data) and that slot stays
  cash. Unfilled orders are counted.
- **Closing exit:** market-on-close at raw close(T). If session T has no raw close for a filled
  position, the exit is **unresolved**: the position stays open, valued at its entry price, is
  listed as unresolved, and is exited at the next available raw close. It is never reported as
  closed at a price that did not exist.
- **Costs:** charged as price slippage per side: buy at open × (1 + c), sell at close × (1 − c), for
  c = 5, 10 and 25 basis points. Same sizing at every cost level.
- **Drawdown pause (as-live series):** when equity at a close is at or below 90% of its running
  peak, the next 5 sessions trade nothing (an owner review), then trading resumes with the peak
  reset to current equity. The pause count is reported. A continuous series without the pause is
  also reported as a diagnostic. **Pass/fail uses the as-live series.**
- Starting capital $30,000; cash earns 0%.

## The five rules (frozen)

Ties in any ranking are broken by symbol, alphabetically.

| Rule id | Picks for session T |
|---|---|
| `losers5` | The 5 eligible members with the lowest r, counting only r < 0. |
| `gainers5` | The 5 eligible members with the highest r, counting only r > 0. |
| `losers5-spy200` | `losers5`, but only when SPY's adjusted close(T−1) is above the mean of its 200 adjusted closes T−200..T−1 (all present); otherwise no positions. |
| `losers5-volz` | Members with r < 0, ranked by r ÷ s (lowest first), where s is the sample standard deviation of the 20 adjusted daily returns ending at T−2 (prices T−22..T−2, all present, s > 0). The 5 lowest. |
| `losers5-spy200-sector2` | `losers5-spy200`, walking down the loser ranking and taking at most 2 members per sector. |

Fewer than 5 candidates means fewer positions; the rest stays cash.

## Comparisons (same dates)

- **SPY open-to-close:** all equity in SPY at the raw open, out at the raw close, every session,
  same slippage per side.
- **SPY buy-and-hold** including dividends: adjusted close series from the open of 2017-01-03; no costs.
- **Weekly strategy:** the live `stock-v2-weekly-1` momentum rules as replayed by
  `analytics/stock_weekly_backtest_v1.replay` (its own $1,000 account, 10% per pick, $95 cap)
  at the same three cost levels. It is about half invested, so returns differ in risk as well.

## Reported for every rule and comparison

Total return, CAGR, annualised volatility, Sharpe (daily, 0% rate), maximum drawdown, end value,
total costs paid, average exposure (invested share of equity after the opening fills), share of
sessions with a position, orders placed, filled, unfilled, unresolved exits, and calendar-year
returns, at 5, 10 and 25 bps; plus the 2017–2022 and 2023-01-01–2026-11-06 descriptive splits.

## Pass/fail (frozen)

Evaluated on the as-live series, 2017-01-03 to 2026-11-06, **10 bps per side** unless stated.
A rule **QUALIFIES FOR REVIEW** only if every condition holds:

1. Net CAGR > 0 at 10 bps **and** at 25 bps.
2. Sharpe > SPY buy-and-hold Sharpe over the same dates.
3. Net CAGR > SPY open-to-close net CAGR at 10 bps.
4. Sharpe > the weekly strategy's Sharpe at 10 bps over the same dates.
5. Maximum drawdown no worse than −35%.
6. Net CAGR > 0 in both 2017–2022 and 2023-01-01–2026-11-06.
7. Positive net return in at least 6 of the 10 calendar years 2017–2026 (2026 is partial).

If no rule passes all seven, the result is **NONE QUALIFIES** and nothing is proposed for paper
trading. The least bad rule is never chosen automatically.

If one or more rules qualify, that only makes them candidates for review. Daily trading
activation stays off until a separate reviewed change, an owner Start, and a supervised paper
session. Paper results alone, for any length of time, never turn on real money.
