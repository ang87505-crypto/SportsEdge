# Stock paper operations UI — review handoff (2026-10-14)

Scope: UI-only operational clarity on a branch based on merged main
`03a061bafbe00e7ed6b028ecb5cc24951cd54bce`. No trading-worker,
provider-adapter, brokerage, database, API, Supabase, scheduler, stock strategy
or release-manifest modifications. This is independent of Astra's PR #67
and must not accidentally merge its research branch.

## Changes
- Owner one-shot status check now drops all previous stage/release/approval/quote
  evidence *before* requesting a fresh status. HTTP 401, 403, malformed reply,
  staged 503 and transport failures explain the issue and fail closed. Snapshot
  checked time appears only after successful validation.
- Preflight describes recognized broker blockers without leaking provider errors,
  and rejects invalid/unexpected shapes; it never places an order.
- Automation readiness accurately separates existing one-order acceptance,
  on-demand reconciliation, staging STOP verification and unreleased scheduling.
- Dashboard links directly to the owner test and paper performance evidence.
  The performance panel explicitly refuses strategy P&L, Sharpe, drawdown and
  benchmark claims from a single Alpaca account snapshot.
- Staging STOP, broker reconciliation, Testing Center and page introduction
  remove out-of-date statements about missing one-order capabilities.

## How to verify
```sh
node --experimental-strip-types --test src/lib/stocks/alpaca-paper-ui-diagnostics.test.mjs src/components/alpaca-paper-ui-guard.test.mjs
npm ci
npm run lint
npm run build
```
CI adds these diagnostic/UI guard tests to the existing GitHub workflow.
Check manual acceptance on protected acceptance Preview separately; this
branch does not itself enable order execution. A stale status failure must
clear the UI evidence. Sign-out and expiry must still require owner login.

## Operational and performance evidence boundary
The paper-account viewer shows broker reported cash/equity/open positions and
up to 25 recent orders. It is **not** a complete attributed strategy ledger.
Astra's future controlled execution path must supply verified, timestamped
experiment identity, opening capital/cashflows, fill/fee receipts, daily equity,
benchmark and adjustments. Only after those are integrated and reconciled can
any strategy after-cost return or risk/benchmark metric be displayed.
No snapshot metric here can be used as permission for broker orders.

Deployment remains Preview-review-first. Do not promote this PR before
checks pass, and do not make a Production, live-money or scheduling release
as part of this UI update.
