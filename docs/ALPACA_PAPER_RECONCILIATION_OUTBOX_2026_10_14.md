# SportsEdge — Alpaca PAPER durable receipts and broker reconciliation, milestone 2

**Implementation state: GitHub draft PR #56, all trading disabled. This is NOT a live order executor.**

## What changed

1. `src/lib/server/alpaca-paper-reconciliation.ts`: trusted server-only, fixed-host, GET-only paper-order inventory. Uses Alpaca Trading API's documented `/v2/orders` pagination with `status=all`, `limit=500`, `direction=desc`, `nested=false`, `before_order_id` cursor, and requires a final page containing fewer than 500 rows. It fails closed at 12 pages, duplicate server IDs, duplicate client IDs, chronology inversions, unsupported order status or nested legs, invalid payload or provider error. **This verifies only the bounded account-order enumeration; it is not evidence of complete positions, corporate events, account fills or model profitability.** Its result is always `safeForExecution:false`.
2. A fixed-host GET `/v2/orders:by_client_order_id` lookup can identify an uncertain previous submission by its deterministic client order ID. A 404 is explicitly `not_observed_retry_forbidden`, **not** proof of rejected execution.
3. `src/lib/stocks/paper-reconciliation-decisions.ts`: matches complete broker-history observations against stored receipt identifiers and states without mutating anything. It reports conflicts, missing observations and uncertainties. Even all matched receipts do not enable trading.
4. `database/ddl/alpaca_paper_outbox_CAS_PROPOSAL_20261014.sql` adds to the previous unapplied draft a private execution gate (halted unless explicitly present and unhalted), protected immutable intent economics, receipt event history and compare-and-swap transition function using row-level locking and a lock version. It is deliberately **SECURITY INVOKER, with no public/client grants**. It is a DDL design and is NOT deployed or called by the application.
5. `database/tests/alpaca_paper_outbox_cas.sql` plus `database/tests/alpaca_paper_outbox_race.sh`: execute on an **isolated disposable PostgreSQL 17 container only**. Verify missing execution gate blocks owner approval, anonymous/authenticated access denied, state transition guards, cannot rewrite immutable source data, receipt/audit consistency, active-account uniqueness and exactly one successful compare-and-swap across two concurrent connections.
6. `.github/workflows/alpaca-paper-reconciliation.yml` builds/testing the above plus security-focused mocked Alpaca pagination/uncertain-order tests. It cannot contact the real broker and gets no credentials.

7. `src/app/api/internal/alpaca-paper/reconciliation/route.ts` provides an **owner-cookie protected, manually requested, no-store GET-only** read-only inventory check. It first validates the PAPER account, then runs bounded broker-history pagination, returning only counts, a timestamp and non-executable status; no raw IDs, credentials, orders, or account numbers are exposed. `src/components/alpaca-paper-reconciliation-panel.tsx` adds a button in the **already unlocked private Alpaca dashboard** for this expensive on-demand audit. The button cannot place, amend, or cancel orders. It is not automatically refreshed. A complete bounded history read is **not a point-in-time atomic snapshot** and not evidence of an approved outbox.

## Intentionally missing — do not enable trading

- **No persistent Supabase outbox.** The SQL proposals are not migrations and have not been installed in your actual project. They are tested on ephemeral PostgreSQL and expire after CI.
- **No operational kill switch or durable scheduler.** The proposed gate in SQL is not connected to an authenticated operational interface. Default paper-execution switch remains OFF.
- **No authorization to write broker orders.** There is **no order creation or cancellation endpoint** in the code added here. The private dashboard's new on-demand history check is owner-authenticated and **read-only**. It can make several Alpaca GET requests, so do not trigger repeatedly.
- **No verified point-in-time live signals, no approved model, no auto-strategy selection, no owner-defined budgets.** Synthetic/fixture tests cannot establish profitable research.
- **No proof of account-level history completeness for more than 6000 orders.** Enumeration limit fails closed, never marks a truncated page as complete. Real provider pagination and order behavior must be tested with an authenticated Preview, without credentials entering logs.
- **No automatic reconciliation after a lost HTTP response.** Lookup is implemented; a human-reviewed immutable receipt transition/transactional reconciler and durable watchdog must be built before trading.
- No independently verified trading-calendar compliance, partial fills, replacements, split adjustments or repeated worker recovery.

## Release and integration order

1. **PR #54:** private owner-only, read-only Alpaca dashboard.
2. **PR #55:** offline order intent planning and receipt state machine.
3. **PR #56:** private broker order enumeration, read-only receipt matching and disposable-Postgres CAS proof.

These are stacked branches; they are not merged into `main`. Never merge #56 without its parents and without an explicit review of the SQL data security model.

Then: establish a **separate approved staging database** and apply a generated migration only after review; test least-privilege connection and RLS, two independent worker claims, process crashes, network timeout and broker-reported partial fills. Extend persistent receipt reconciliation and halt logic, *then* build a paper-only broker writer with production-safe authentication, session/market-hours checks and a genuine human approval flow. No automated paper execution before separate explicit owner approval of strategy, fixed capital risk, schedule, limits and stop criteria. Start with a **single explicitly owner-confirmed small PAPER order** before considering recurring execution.

## Reproduction in disposable CI

```sh
node --experimental-strip-types --test src/lib/server/alpaca-paper-reconciliation.test.mjs src/lib/stocks/paper-reconciliation-decisions.test.mjs src/lib/server/alpaca-paper-reconciliation-guard.test.mjs
# GitHub workflow: setup disposable postgres:17; create anon/authenticated test roles
psql -X -v ON_ERROR_STOP=1 -f database/ddl/alpaca_paper_outbox_PROPOSAL_20261014.sql
psql -X -v ON_ERROR_STOP=1 -f database/ddl/alpaca_paper_outbox_CAS_PROPOSAL_20261014.sql
psql -X -v ON_ERROR_STOP=1 -f database/tests/alpaca_paper_outbox_cas.sql
bash database/tests/alpaca_paper_outbox_race.sh
```

## Official Alpaca contract checked

- [Get All Orders](https://docs.alpaca.markets/us/reference/getallorders-1): `before_order_id` cursor, 500 max per page, `status=all`.
- [Get Order by Client Order ID](https://docs.alpaca.markets/us/reference/getorderbyclientorderid): exact client ID lookup.
- [Working with Orders](https://docs.alpaca.markets/us/docs/working-with-orders): broker `client_order_id` is an identifier, not a substitute for server-side durable idempotency or exactly-once guarantees.

All paper-only data/keys must stay on the server and the Alpaca PAPER host; no real-money host is added by this work.
