# SportsEdge: Alpaca PAPER automation foundation (no orders)

**Status: OFFLINE PREVIEW / DO NOT ENABLE EXECUTION.**

This PR is stacked on the private read-only broker viewer [PR #54](https://github.com/ang87505-crypto/SportsEdge/pull/54). It creates an offline, testable order-intent contract, a fail-closed receipt state machine and a **private readiness explanation** within the signed-in Alpaca PAPER dashboard. It does **not** send broker orders, schedule work, persist authorizations, run a strategy, or change Production.

## What is implemented

1. `src/lib/stocks/paper-automation-plan.ts` generates **non-executable draft intents only** from a fully specified, source-checked paper signal and a complete broker snapshot. It refuses live accounts, sells/shorts, stale or future timestamps, unaudited sources, dirty order state, unbounded sizing, failed broker status and duplicate signals.
2. All intents are `limit` / `day` / buy-only. Conservative hard-coded engineering caps: $100 per order, $200 daily total, $250 per symbol, five daily orders, five open orders and <=20% paper-equity exposure. Checks also require available cash and buying power. These are **testing constraints**, not a released trading policy. No recommendation is implied.
3. `src/lib/stocks/paper-automation-release.ts` defines hard-disabled features independently of client runtime options: `placeOrdersEnabled=false`, `scheduledOrdersEnabled=false`, `realMoneyEnabled=false`, `durableReceiptStoreReady=false`, `emergencyStopOperational=false`, `verifiedLiveSignalSource=false`, `brokerReconciliationComplete=false`.
4. `src/lib/stocks/paper-automation-receipts.ts` adds deterministic immutable receipt transitions with approval identity, optimistic version checks, broker ID reconciliation and uncertainty locks. Timeouts are not assumed rejected. **This is not durable storage and never places orders.**
5. `src/components/alpaca-paper-automation-readiness.tsx` appears only inside the existing signed-in broker dashboard, with truthful observed-account status and missing execution gates. No public account data or order controls.
6. `database/ddl/alpaca_paper_outbox_PROPOSAL_20261014.sql` is **unapplied** DDL proposing private denied-by-default rows, unique intent/signal IDs and one active/uncertain order per account. It is not a Supabase migration. Explicitly review and test independently before deploying.

The `GET /api/internal/alpaca-paper/view` reader, secret validation, owner-session login and paper-only Alpaca credentials remain unchanged. There is **no POST/DELETE/PATCH to the Alpaca broker API, no order-placement Next.js route, no cron trigger and no live broker submission**.

## Important correctness boundary

- The private Alpaca viewer reads at most **25 recent orders**. This never proves the complete order history. A future live planner must enumerate relevant broker orders using the appropriate, reviewed API semantics, and reconcile account, positions, order status and durable outbox receipts before any orders.
- Synthetic test fixtures can set `sourceReviewed=true`, but the code has **no genuine reviewed signal feed**. Fixture completeness and passing tests do not establish that market prices are actual tradeable quotes.
- Deterministic preview fingerprints prevent divergent candidate hashes but **do not** reserve broker-side `client_order_id` or guarantee unique execution. Exactly-once requires a durable outbox, broker-compatible client IDs, atomic reservation, reconciliation and non-retry on uncertainty.
- A scheduled worker, persisted kill switch, operator identity/authorization, market-hours calendar, halt handling, provider entitlements, full deployment protection and rate-limit/backoff policy are **not implemented**. Never turn on orders simply by changing a boolean.
- True paper execution must be isolated from real Alpaca credentials and from the unrelated sports virtual betting ledger.
- Existing stock historical backtest gates remain unmet. Research in PR #53 has not shown historical profitability, and the model used to generate paper signals requires separate approval.

## Before a single small owner-approved paper test

1. Review the PR #54 privacy and auth controls and complete Preview owner login testing. Preserve signed-in private account access.
2. Obtain **timestamped, licensed, independently reviewed** paper candidate signals and source revisions; implement deterministic risk sizing and trading calendars without future information.
3. Build a reliable **full** broker snapshot and immutable reconciliation of positions and submitted orders. Broker API's 25 recent orders is not enough.
4. Implement a real **transactional** Supabase outbox and signed approval protocol; exercise two simultaneous workers and ambiguous broker responses. Test proposed SQL in an isolated database, then generate a separately reviewed migration. Do not directly execute the proposal in Production.
5. Implement server-only PAPER endpoint writes and an independent force-OFF emergency-stop switch, with verified limits/approval, idempotent broker client order IDs and an operator-verified kill switch. Never point to live-money host. No automatic retries when the broker response is unknown.
6. Review costs, broker fills, partial fills, cancellation, rejections, sessions and halt behavior; prove state convergence in paper sandbox tests.
7. Only after engineering and security checks, obtain explicit fresh approval of *exact* paper limits, strategy, schedule, capital budget and stop criteria. Start with one manually approved small paper order before any recurring execution.

## Reproduction

```bash
node --experimental-strip-types --test src/lib/stocks/paper-automation-plan.test.mjs src/lib/stocks/paper-automation-receipts.test.mjs
node --experimental-strip-types --test src/lib/server/alpaca-paper-reader.test.mjs src/lib/server/alpaca-owner-session.test.mjs
npm run lint
npm run build
```

No owner key, Alpaca API credentials, money, paper accounts or Supabase project are needed for these local offline tests. Do not put any secret into CI, git, logs or ChatGPT.

## Research/engineering team boundaries

Astra owns frozen stock strategy, historical source, backtest protocol and statistical research. This PR owns **only** order-intent safety scaffolding and owner-dashboard explanations. Do not alter PR #53 or assume its tests authorize automated trading.

**Integration recommendation:** Keep this PR stacked on #54 and draft until #54 is security-reviewed and deployed. The readiness panel can ship independently after review, but execution flags stay hard off. No real-money or paper-order activation is authorized.
