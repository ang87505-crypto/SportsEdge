# SportsEdge owner acceptance plan — one browser, one guided test

**Status on 2026-10-14:** Engineer-side checks are in progress; full end-to-end
owner acceptance has **not** been completed. No order submission authorized.

## Single entry point

Once the stacked private Alpaca PRs are reviewed, merged and deployed under
a controlled environment, start at `/testing`. It appears in the permanent
sidebar, mobile navigation and Ctrl+K/⌘K command menu. The walkthrough has
six checkpoints and readable next-step links. On Preview, use the deployment
link for the exact tested SHA; do not confuse an earlier Preview with Production.

## Functional owner acceptance (in order)

| Checkpoint | How to verify | Evidence/pass rule |
| --- | --- | --- |
| Navigation | From Overview open Test center, Sports, Stocks, Progress, Guide; repeat at mobile width | Route resolves, heading present, back to Overview works, no overflow or dead links |
| NBA saved research | Visit Sports and paper-betting; observe pending and settled records | Saved data source is labeled; historical game-winner accuracy is not called betting ROI; no fabricated empty metrics |
| Stock manual journal | Add/close a **virtual manual** position if desired, export JSON and inspect restore preview, cancel before replacing | Local browser only, correct realized P&L, no unauthorized broker data writes |
| Stock algorithm evidence | Read registered baseline/candidate protocol and claims | No historical profit number until a legitimate fully sourced after-cost backtest |
| Private Alpaca PAPER viewer | In protected Preview, sign in with **owner** secret stored privately, refresh snapshot, click on-demand **read-only** history audit | Signed cookie required, cash/equity/order summary from broker, no secrets in URLs/logs, unauthenticated viewer has no balances |
| Paper execution | **Do not submit orders** from app at this stage | No order buttons, no enabled scheduler, no released backend writer; staging gate defaults to HALTED |

**Do not record API secrets, full owner key, access tokens or account identifiers
in screenshots, tickets, recordings or chat.** Review only sanitized summary
status (e.g. test passed / failed and error code).

## Staging verification already performed

- The Supabase project named `SportsEdge Staging`, project ID
  `mcaxfaaohyencpspalfe`, was already active and initially contained
  no application tables or migrations.
- Versioned staged SQL:
  `database/staging/alpaca_paper_outbox_staging_v1.sql`;
  applied using the Supabase migration tool as
  `alpaca_paper_staging_outbox_v1`.
- Verified afterward: three private tables, zero order records, zero gate
  records, forced RLS on outbox, and no read/write access for `anon` or
  `authenticated`. **No schema or rows were touched in Production.**
- Existing isolated Postgres CI checks prove state transitions and racing
  stale-version receipts under disposable connections, but **do not** prove
  a live transaction service is authenticated to this staging database.

## Release blockers and required gates before a first small PAPER order

1. Review all three previously stacked Alpaca PRs #54, #55, #56, and this
   owner test-center PR; CI must pass on the exact merged commit.
2. Vercel Preview availability must recover from any deployment-build rate
   limit. No automatic plan upgrade or paid service activation.
3. Perform real HTTPS owner-session and locked-account QA in the exact Preview,
   independently verify accountType PAPER and no public broker data leakage.
4. Build an authenticated server-only **staging** receipt service with
   transactional CAS and immutable event logging. Connection configuration
   must not be in the browser, logs or GitHub; no direct client DB privileges.
5. Implement a **real operator emergency stop**, verify its persisted state
   and recovery, and independently prevent any automatic broker submission
   during uncertain, missing or unreconciled receipts.
6. Obtain a complete authoritative broker order/position snapshot under an
   approved freshness and pagination contract (historical order paging is
   not an atomic snapshot). Validate broker-side `client_order_id` semantics
   with the paper account and after-hours/halt behavior.
7. Obtain licensed timestamped signals from a reviewed study; Astra's
   engineering PR #53 does not prove profitability. Confirm market hours,
   quote availability, eligibility and risk-adjusted budgets.
8. Implement broker PAPER `POST` only behind immutable fixed-paper-host,
   owner-authenticated one-shot authorization, transactionally unique
   durable outbox and agreed max order/daily/portfolio risk caps. No retry
   on lost/uncertain response; reconcile using client ID then human review.
9. Only then ask for **fresh approval** of one specific simulated order
   (ticker, side, share count, limit price, maximum virtual amount, window).
   Observe all broker receipts/fills, check state reconciliation, and stop.
10. Automatic schedules need separate explicit approval of the stock model,
    spending cap, cadence, account, stop criteria and monitoring. Real-money
    execution is a separate project, not implied by PAPER.

## Engineer CI criteria

- `npm run lint` and `npm run build` pass on exact SHA.
- Browser smoke checks 320, 390, 768, 1024, 1440 px where applicable,
  including Test center, private locked broker page and keyboard/mobile
  navigation. No private keys are configured during public browser CI.
- The `sportsedge-staging-preflight` workflow reproduces the staged
  migration in disposable Postgres 17 and runs RLS, immutability,
  stop-gate, CAS and concurrent-connection tests.
- Mocked Alpaca read-only inventory and reconciliation tests cover
  pagination, limits, partial/unknown results, duplicate order IDs and
  wrong broker receipt IDs. A 404 never enables duplicate submissions.
- An automated CI pass is **not** a real authenticated owner test.
- Vercel build-rate limiting is a deployment blocker, not a reason to
  subscribe without owner approval.

## Roles

- **Engineering session:** app navigation, release boundaries, staging
  database security, receipt persistence and reconciliation.
- **Astra:** strategy, point-in-time stock history, data licensing,
  algorithm research and legitimate after-cost backtest.
- **Owner:** one guided browser acceptance session *when engineering is
  ready*, plus explicit order/schedule/risk approval later.

Full acceptance is not declared complete until the owner verifies the
specific deployed site, authenticated paper snapshot, and all agreed
release prerequisites. There is no estimated completion percentage.
