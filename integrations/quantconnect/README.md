# QuantConnect -> SportsEdge: frozen research port (stage 1)

**Status:** offline engineering only. No genuine historical portfolio returns,
verified LEAN strategy backtest, account connection, notification delivery,
automated paper bet, or live trade.

## Implemented

- Frozen baseline stock selection in selection.py: 252-session momentum
  skipping 21 most recent sessions, 200-session total-return trend,
  $5 raw close, $20m trailing 20-session mean dollar volume,
  five names, at most two per historical sector, each targeting
  10% of current equity; 50% intended maximum gross exposure.
- One registered hold-rank-ten candidate: retain qualifying incumbents
  in ranks 1–10 before filling remaining positions by baseline rank.
- Strict rejection of missing raw bars, unavailable timestamps,
  duplicates, unknown permanent IDs and insufficient corporate actions;
  known-short-history IPOs explicitly ineligible, not deleted.
- Offline test_parity_repo.py checks the original frozen SportsEdge
  functions directly using existing SYNTHETIC fixtures.
- main.py is an optional read-only QuantConnect fundamental-universe
  diagnostic (2000–2011) that places **zero orders** and deliberately
  returns zero selected subscriptions to avoid free-node memory overflow.
  No selection results are connected to it yet.
- safety.py is a deterministic *example contract* for future alerts.
  It cannot monitor a real account, deliver notifications, or halt
  any currently enabled orders. Thresholds in tests are examples only.

## Run tests

From repository root:

    python -m unittest discover -s integrations/quantconnect -p 'test_*.py' -v

No keys, broker connections or paid data are required. The added CI workflow
checks the same parity and adversarial synthetic tests.

## Why the full QuantConnect backtest is not ready

QuantConnect's Morningstar fundamental universe includes delisted companies,
but this alone does not prove compatibility with the registered SportsEdge
point-in-time NYSE/NASDAQ/AMEX universe, historical sector and security type,
exact first public trading dates, complete exchange/settlement calendars,
source publication timestamps, or delisting/merger/spinoff/fractional claims.

The selector expects **unadjusted** raw closes, exact ex-date split factors,
dividends per old share, raw consolidated volume, complete dated universe
membership, and known availability before the 08:00 New York decision.
Do not pass adjusted or total-return vendor prices to it or dividends could
be counted twice. A *separate adapter* must reconcile those vendor formats.

Once source and accounting parity pass, the full 2000–2011 development period
and 1999 or earlier warmup must use the same frozen account/cost rules for both
strategies: $1,000 start, whole shares, actual cash/settlement, 15-bp nominal
one-way spread+slippage, 25/50-bp sensitivities, $1/order sensitivity fee,
benchmarks, terminal events, and confidence intervals. Preserve the registered
2012–2016 validation and 2017–2025 sealed test without premature inspection.

## Optional QuantConnect cloud diagnostic

The user's existing SportsEdge-Stock-Research QuantConnect project already
confirmed 3,019 daily SPY observations over 2000–2011.

For a *different* research-only diagnostic, back up its current main.py and
replace that file with the main.py in this directory. Do not create a second
QuantConnect project, and do not assume the diagnostic's flat NAV means
the SportsEdge strategy made 0%. Verify QuantConnect runtime API compatibility
if any errors occur. selection.py remains offline until its source adapter is
implemented and reviewed.

## Future website connection and protective automation

Keep QuantConnect User ID/API token server-side and protect owner-only
read-only result access. Store only permitted derived backtest summaries,
version/source hashes, limitations, and review status in SportsEdge.

Before enabling **paper-only** automatic orders, require independent data
freshness, position/cash reconciliation, order idempotency/receipts,
maximum risk budgets, price availability, market status, kill-switch-on-error
and owner notifications. A critical mismatch must stop *new* orders, not
assume positions were safely liquidated. A sudden gap, venue outage or market
move can cause losses before any alert. Do not connect money or enable live
orders without new owner authorization and demonstrated independent testing.

## Sources

- research/stock_audit_20261012/protocol.json
- analytics/stock_momentum_v1.py
- analytics/stock_rank_buffer_candidate.py
- Pending accounting/readiness PR #43
- https://www.quantconnect.com/docs/v2/writing-algorithms/universes/equity/fundamental-universes
- https://www.quantconnect.com/docs/v2/writing-algorithms/securities/asset-classes/us-equity/corporate-actions
