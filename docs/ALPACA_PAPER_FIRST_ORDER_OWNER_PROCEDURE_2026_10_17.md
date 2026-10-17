# First genuine Alpaca PAPER acceptance order: owner procedure

Scope: the existing staging v6 / PR #66 one-share PAPER BUY LIMIT DAY order
(at most USD 25.00) placed by the owner from the protected Preview of branch
`acceptance/alpaca-paper-first-order`. This document does not change code,
flags, databases or deployments, and it does not submit an order. It is the
checklist the owner follows when separately authorizing that single order.

## What was independently re-verified (2026-10-17, disposable databases and mocks)

- Staging v1–v6 migrations and all existing SQL tests pass on PostgreSQL 16;
  the outbox CAS two-connection race passes.
- New `database/tests/alpaca_paper_first_order_v6_adversarial.sql`:
  missing gate row denies approval; each time/price guard rejects without
  persisting; an expired approval cannot be claimed and leaves the gate halted;
  a STOP while an order is in flight closes the gate re-read before the POST;
  an uncertain receipt cannot later be overwritten; order economics are
  immutable; no `sportsedge_paper_*` RPC is callable by `anon`/`authenticated`.
- New `database/tests/alpaca_paper_first_order_v6_race.sh`: two concurrent
  approvals and two concurrent claims each produce exactly one winner.
- New `src/lib/server/alpaca-owner-first-order-adversarial.test.mjs`: a STOP
  between claim and POST sends nothing; a refused (duplicate) approval never
  claims or posts; timeout, malformed reply and HTTP 422
  `client_order_id must be unique` are all recorded as uncertain with exactly
  one POST and a final STOP; only `paper-api.alpaca.markets` is contacted.

Passing tests use mocked brokers and disposable databases. They do not prove
the Preview deployment, staging database or Alpaca account are configured.

## Known traps the owner must accept before clicking

1. **The lifetime slot can be consumed without an order.** Any approval whose
   claim then fails (approval older than its 2-minute window, quote older than
   60 seconds at claim, RPC timeout after approval, or an operator STOP between
   claim and POST) leaves a non-`planned` row. No granted RPC can retire it, so
   no second first-order approval is possible. Recovery requires a separately
   reviewed staging migration, never a manual table edit in production.
2. **A clean broker rejection is recorded as `submission_uncertain`.** HTTP
   4xx/5xx, timeouts and malformed replies are treated identically. This fails
   closed but requires manual reconciliation even when Alpaca refused the order.
3. **No RPC records the final broker outcome.** After `broker_acknowledged` or
   `submission_uncertain`, fills/cancellations are observed on the broker only.
4. **The limit is checked against an IEX quote**, not the consolidated NBBO.
5. **Function time budget.** The route makes about twelve sequential calls with
   7.5–8.5 s timeouts inside a 60 s function. If Vercel terminates the function
   after the claim, the final STOP never runs; the gate then shows open with a
   `submitting` row. Because of the lifetime index this cannot create a second
   order, but the owner must then trigger STOP from the dashboard.

## Preconditions the owner verifies (cannot be verified from CI)

- [ ] The Preview deployment for `acceptance/alpaca-paper-first-order` at the
      reviewed commit shows Vercel status *Ready*. (On 2026-10-14 the project
      hit `api-deployments-free-per-day`; the acceptance commit `9d1feba` was
      pushed three minutes after a rate-limited status, so its Preview may not exist.)
- [ ] Preview-only environment variables, scoped to that branch:
      `SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY` (64 hex), `ALPACA_PAPER_KEY_ID`,
      `ALPACA_PAPER_SECRET_KEY` (PAPER keys), `SPORTSEDGE_STAGING_SUPABASE_URL`
      = `https://mcaxfaaohyencpspalfe.supabase.co`, `SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY`.
      No Production scope for any of them.
- [ ] Staging database has v1–v6 applied: owner dashboard shows staging HALTED,
      zero stored intents, zero unresolved receipts.
- [ ] The paper account has no positions and no open orders (preflight blocks otherwise).
- [ ] A liquid symbol priced under USD 25 with a tight IEX quote.
- [ ] At least 09:35 ET and more than 20 minutes before the close.

## Procedure

1. Open the Preview, sign in with the dashboard owner key, open the private
   Alpaca paper page and refresh the snapshot.
2. Run the one-order preflight for the chosen symbol and limit. Continue only
   if the remaining blockers are exactly `STAGING_EMERGENCY_STOP_ENGAGED`,
   `NO_OWNER_APPROVED_EXECUTION_PATH` and `NO_DURABLE_BROKER_ORDER_RELEASE`.
3. Submit once with the exact confirm phrase. Do not click twice, refresh or
   retry. The expected response is `paper_broker_acknowledged` with
   `gateHalted: true` and `requiresReconciliation: false`.

## Post-submission reconciliation (same session)

1. One-order status (stage RPC): record `status`, `brokerOrderObserved`,
   `brokerStatus`, `gateHalted`. Expected: `broker_acknowledged`, `true`, gate halted.
2. Private dashboard recent orders: one new BUY of the chosen symbol, quantity 1,
   status `new`/`accepted`/`filled`. Cross-check in the official Alpaca paper
   dashboard (order id, submitted time, limit price, filled price).
3. Reconciliation panel: complete history read, open orders 0 (after fill) or 1.
4. After a fill: positions show one share; cash decreased by fill price.
5. Record evidence in the owner log: order id, client order id
   (`sepaper_` + 32 hex), timestamps, limit, fill, gate state.

There is currently no owner route that looks up an order by its client order
id (the function `inspectPaperOrderByClientId` exists but is not exposed), so
step 2 relies on the dashboard's recent orders and Alpaca's own dashboard.

## If the result is `paper_submission_uncertain`

- Never retry, never approve another order (it will be refused anyway).
- Engage STOP if the dashboard shows the gate open.
- Inspect recent orders and the Alpaca paper dashboard for the symbol/time.
  Absence in the 25 most recent orders is not proof the POST failed; check again
  after the close and in the full order history.
- Record the outcome manually; the database will continue to show uncertain.

## Rollback

Nothing to roll back in code. After the test: remove the Preview-only broker and
staging service variables, or revert the acceptance branch flag commit.
