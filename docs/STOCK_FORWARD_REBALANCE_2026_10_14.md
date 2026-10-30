# Forward paper strategy integration

This change connects recomputed stock selections to a portfolio rebalance plan.
It does **not** activate a schedule, place a paper order, authenticate a market
data source or establish profitability. Automated paper testing does not require
a successful historical backtest, but still requires working current inputs and
verified order execution.

## Implementation and dependencies

Base: main `03a061bafbe00e7ed6b028ecb5cc24951cd54bce` (merged #66).
The one-owner-order acceptance route, database controls, UI and release manifest
are unchanged. No changes to #53 or any frozen protocol.

Two previously reviewed-source modules are reused byte-for-byte from #53
`4628b46f51501518f91d54c918c85509107cc247`, not reimplemented:

- `analytics/stock_accounting_v2.py`, blob `0a2e4b7e2c8ab2840944f0e0e69eeee3ef5fe3d4`
- `analytics/stock_universe_scoring_v1.py`, blob `45602d5cf0da90e6a28e33cf5a087fbb5f34c8b3`

Their dependencies (`stock_momentum_v1`, `stock_data_contract`,
`stock_rank_buffer_candidate`) already exist on main. This imports neither
historical replay drivers nor website research reports. Integration of the
remaining historical PR stack is still separate.

`stock_forward_signal_v1.forward_signal` accepts source shards, full declared
universe, listing history, action coverage, calendar, actual held IDs and one
registered model version. It recomputes scores and selections using the frozen
code. There are no caller-supplied scores or target weights. Omitted universe
members fail the entire decision; known short-history members remain explicit.
The experiment must be registered before its decision. The source snapshot must
be captured from decision time through 60 seconds later; each bar/action used
must still be available strictly before the decision under the frozen contract.
These timestamps are supplied evidence, not an authenticated clock or proof of
publication. Results explicitly keep source verification and execution false.
Only 2026 engineering decisions are admitted: the historical study and 2027
reserved prospective evaluation remain separate and unchanged. Warmup prices
are inputs, never a new historical performance evaluation.

`planComputedForwardSignal` consumes that output plus a fresh paper account and
quotes. It binds permanent IDs/symbols and prior consolidated liquidity back to
the model output. `planStrategyRebalance` then calculates whole-share changes:

- Frozen basket limits: five names, two per sector, 10% per name, 50% gross.
- Exits and overweight trims before purchases. Sale proceeds never become cash
  inside this planner; require actual settlement and replan from a fresh account.
- Keep the monthly selection fixed after sells; do not rerank the candidate
  using post-trade holdings. Actual positions may change only through reconciled
  fills/events in the future durable controller.
- Fresh quotes and account, zero open orders or uncertain receipts, complete
  positions/order enumeration, whole shares and 1% prior ADV order limit.
- Buy limits at supplied ask, sell limits at supplied bid. Existing exposure is
  valued conservatively at ask. $0/$1 fee reserve is explicit and cash reserved.
- Insufficient settled cash blocks the complete buy basket, not selected names.
  An unaffordable whole-share target is explicitly diagnosed.

The real paper experiment will use actual limit-order fills; this differs from
the frozen historical open-price proxy. Do not label these outputs a replication
of historical costs. The planner does not deduct invented slippage from broker
cash. Separate after-cost measurement/stress accounting is still required.

## Reproduce (no credentials or provider calls)

```bash
python -m unittest analytics.test_stock_forward_signal_v1 analytics.test_stock_momentum_v1 -v
node --experimental-strip-types --test src/lib/stocks/paper-strategy-rebalance.test.mjs
python -m analytics.stock_forward_signal_v1 --input source-envelope.json --output new-signal.json
```

The CLI refuses to overwrite output. `source-envelope.json` must contain actual
normalized source evidence; no market dataset is shipped. Tests use explicitly
fictional fixtures. The cross-language test sends a computed Python signal into
the Node planner and independently checks basket quantities/cash, then alters
the liquidity field and verifies rejection. No tests prove provider coverage.

## What prevents activation now

1. Current source adapter: authenticated full declared universe, exchange/type/
   sector, permanent IDs, raw daily bars, actions and session calendar. Do not
   declare an Alpaca asset list to be the full registered universe without proof.
2. A dedicated experiment account/budget and pre-start registration. Existing
   manual paper positions cannot be silently included, closed or reset. Need the
   actual account equity/snapshot, not an invented $1,000 subaccount inside a
   larger brokerage account.
3. Verified single paper-order acceptance, then a reviewed durable multi-order
   controller that supports sells, partial fills, cancellations, settlement,
   emergency stop and external/unknown account changes. The v6 lifetime-one-order
   gate is intentionally unsuitable for a recurring rebalance; do not bypass it.
4. Authenticated scheduled worker, storage and monitoring. Reserve unique
   experiment/account/decision/security/side intents before broker submission;
   `planId` changes with prices/snapshot and is NOT a sufficient duplicate key.
   A missed monthly cutoff must be recorded, not backdated and traded late.
5. Broker-derived equity/fill reporting plus benchmark and cost measurement.

No source access or schedule has been verified in this change. Requiring these
operational pieces does not impose a historical-profit gate. The next work is
current data plus durable forward execution, not another historical backtest.

## Provider evidence checked October 14, 2026

Alpaca's current FAQ documents that historical SIP queries can be made without a
subscription when the end time is at least 15 minutes old. This is potentially
enough for prior-day consolidated volume; verify access on the actual account.
Do not silently substitute single-exchange IEX volume. Free data access alone
does not supply complete classification or corporate-event evidence.

- https://docs.alpaca.markets/us/docs/market-data-faq
- https://docs.alpaca.markets/us/docs/about-market-data-api
- https://docs.alpaca.markets/us/v1.4.2/docs/paper-trading

Paper execution is simulated and omits some live trading frictions. No external
services, paid subscriptions, broker orders, scheduled jobs or account changes
were made by this implementation.
