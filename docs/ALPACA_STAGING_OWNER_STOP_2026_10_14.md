# SportsEdge — owner-only staged STOP and persistent receipt status

**State:** staging database schema and RPC are installed; Vercel server connection
is not configured or verified. No Alpaca orders, broker writers, or schedules
are activated. No real-money execution code exists.

## Staging database (actual work completed)

The existing Supabase project **SportsEdge Staging** is
`mcaxfaaohyencpspalfe`. Production Supabase remains untouched.

Migration `alpaca_paper_staging_owner_rpc_v3` (source
`database/staging/alpaca_paper_staging_owner_rpc_v3.sql`) was applied
on top of the already-installed private outbox v1 and permanently
HALTED staging stop v2. It creates precisely two public-schema RPC
functions:

- `sportsedge_paper_stage_status()`: returns staging-only aggregate
  counts, HALTED status, an explicit `executionPermitted:false` and
  no account IDs, individual receipts or secrets.
- `sportsedge_paper_stage_halt()`: calls the existing private
  `paper_force_halt` with a fixed staging alias, appends an immutable
  audit record, and returns the resulting status. **Never resumes** or
  authorizes orders.

Explicitly revoked EXECUTE from `PUBLIC`, `anon` and `authenticated`;
only `service_role` may execute the RPC. Both are
`SECURITY DEFINER` with fixed SQL and `search_path=pg_catalog`.
Verified the real staging project responds with `halted=true`,
zero order records, zero unresolved receipts, and client-role access
denied. These functions must NOT be copied to Production without
a separate review.

## Owner-authenticated Next.js service (code only)

- `GET /api/internal/alpaca-paper/staging` returns private aggregate
  status only after validating the separate 30-minute owner cookie.
- `POST /api/internal/alpaca-paper/staging` accepts only same-origin,
  exactly `{"action":"halt"}`, validates the owner cookie, and
  records an additional staging HALT. No resume, broker order or
  schedule route exists. Both responses use `private, no-store`.
- `src/lib/server/alpaca-staging-operator.ts` targets exactly
  `https://mcaxfaaohyencpspalfe.supabase.co`; another Supabase
  project or any non-HTTPS address is rejected. The adapter never
  calls Alpaca. Only safe fixed reason codes reach the browser.
- `src/components/alpaca-staging-stop-panel.tsx` appears **inside**
  the already signed-in private Alpaca PAPER dashboard. It is explicitly
  labeled staging-only and cannot be mistaken for a live broker
  kill switch. When not configured it fails closed.

## Private deployment config required later

In the **authorized Vercel environment** and only when performing
private Preview acceptance, add:

- `SPORTSEDGE_STAGING_SUPABASE_URL`: exactly
  `https://mcaxfaaohyencpspalfe.supabase.co`
- `SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY`: the **staging**
  server-only service-role secret kept in Vercel, **never**
  `NEXT_PUBLIC_*`, browser storage, GitHub, logs or chat.

The **separate** `SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY` must also be
configured for that Preview. These variables are **not** presently
verified on Vercel, which is reporting a 24-hour deployment build-rate
limit. This document is not authorization to enable any order writer.

The staging service-role secret has broad authority in staging; a
more limited server role and independently verifiable deployment
configuration should replace it before releasing any real paper
execution. No untrusted browser receives this credential.

## Isolated verification

`alpaca-staging-owner-stop.yml` runs mocked server request tests,
owner-session/origin boundary checks, and reproduces all three
migrations on a disposable PostgreSQL 17 instance with `anon`,
`authenticated` and `service_role` roles. The tests prove that the
client roles cannot execute the RPC, repeat HALTs are append-only,
and even elevated operators cannot unhalt without a schema change.

**Current release conditions:** trading and scheduling remain hard
disabled. This is the staged STOP observability path, not proof of
paper-order execution, live-market timing or profitable strategy.
Before enabling any Alpaca POST: authoritatively reconcile positions
and broker order IDs, use approved and dated signals, implement
transactionally unique outbox claim, operational monitor/kill switch,
and obtain explicit approval for one tiny PAPER order and the
parameters.
