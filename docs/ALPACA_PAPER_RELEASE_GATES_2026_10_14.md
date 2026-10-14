# Alpaca PAPER — engineering release gates, staged HALT and offline scheduler

**Status: no automated or owner-approved PAPER order submissions.** This is
a release-engineering milestone, not an activated broker service.

## Verified on the existing SportsEdge Staging project

- Project `mcaxfaaohyencpspalfe` (not Production) had staged paper outbox
  migration `alpaca_paper_staging_outbox_v1`.
- Applied new staging-only migration `alpaca_paper_staging_halt_v2`.
  Source: `database/staging/alpaca_paper_staging_halt_v2.sql`.
- Installed a **stop-only** stored function
  `sportsedge_private.paper_force_halt(account_alias,reason)` which forces a
  per-account execution gate to `halted=true` and appends an immutable audit
  row. No unhalt API exists. A database trigger rejects writes of
  `halted=false`, even through privileged application queries unless an
  independently reviewed migration first changes the schema.
- An operator staging halt was executed for the non-sensitive alias
  `sportsedge-paper-stage`; verified `halted=true`, zero order records,
  one appended stop-audit event, and no `anon`/`authenticated`
  schema or stop-function privileges. This DOES NOT claim any app can
  automatically call the stop function: Vercel is not connected to this
  private staging schema and a broker-order writer does not exist.
- This is explicitly a **staging hard lock**, not a ready-to-toggle
  operational kill switch for hypothetical broker writes.

## Implemented offline contracts

- `paper-scheduled-rehearsal.ts` requires a **reviewed** XNYS exchange
  session, source digest, UTC timestamps, session date matching America/New_York,
  a fresh calendar check, open and close buffers, no uncertain receipts,
  a valid PAPER-only broker snapshot and the existing `planPaperIntent`
  constraints. All results are `dry_run_only` and
  `executionPermitted:false`; there is no scheduled job, no
  `POST` to Alpaca and no order flow.
- `paper-broker-order-contract.ts` produces a deterministic non-executable
  broker request *draft*: fixed PAPER host, whole shares, buy/limit/DAY,
  explicit price precision and a deterministic candidate
  `client_order_id`. The function never uses `fetch` or Alpaca secrets.
  It rejects unexpected execution permissions or order economics.
- Separate isolated test matrices check duplicate signals, live accounts,
  uncertain receipts, stale/future market evidence, market closure,
  U.S. DST, trading buffers, and the absence of any HTTP broker calls.
- CI recreates the actual staged schema in **disposable PostgreSQL**,
  validates the stop-only gate, protects audit events, disallows unhalt,
  and proves that attempts to approve orders while halted fail closed.

## What this does NOT finish

A truly enabled, trustworthy paper-trading service still requires:

1. A server-only, least-privilege, authenticated **staging database adapter**
   connected to the receipt transaction process, including crash/race tests,
   without granting browser clients access to the private schema.
2. A **deployed stop control** checked immediately before every broker
   order call, with monitoring and independent operator access.
3. A reviewed **paper-only Alpaca write adapter**, real paper credentials
   isolated from live account credentials, idempotent client order identity,
   authoritative order reconciliation and correct response handling.
4. A genuine provider calendar/quote/signal feed. There is NO verified
   real-time stock selector or profitable historical model yet.
5. A reviewed queue or scheduler, including deployment/plan limitations
   and safe persistence across serverless restarts.
6. A single small PAPER test authorized for an exact ticker, quantity,
   limit price, maximum virtual dollars and session window.
7. New approval for unattended scheduled paper orders with agreed
   capital/risk limits, monitoring, alerting, and stopping rules.

The owner requested engineering autonomy. That authorizes these safe
implementation changes, not actual brokerage submissions, real trading,
subscriptions, or automatic financial execution.

## Integration status

The Alpaca UI and safety stack begins at PR #54 and continues through
#55, #56, #57; this stage builds on that stack. It does not alter
Astra's independent stock algorithm and point-in-time research.
Promote to Production only after exact-head CI and privacy review, with
execution switches remaining false.
