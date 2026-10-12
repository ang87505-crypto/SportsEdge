# NBA owner-command receipts — engineering handoff

Status: **DRAFT, NOT ACTIVATED.** This handoff covers owner-triggered NBA paper *batch commands* only. It does not modify prediction strategy, odds-selection logic, stake sizing, the settlement RPC, or Astra's stock engine.

## New behavior

- `PaperRunControls` generates a fresh UUID only when the owner explicitly clicks Run and submits it with the authenticated request.
- Existing owner identity, CSRF/Origin checks, JSON request validation and `SPORTSEDGE_PAPER_RUNS_ENABLED` gating still run before claim.
- A private server-only receipt store checks an existing command first, then inserts one `running` row **before** calling the unchanged `placeResearch(10)`.
- An exact replay of an already completed UUID returns its saved summary, with `replayed=true`; no additional runner call.
- Two distinct unresolved command IDs for the same NBA research account conflict at a database-level unique partial index. A competing request returns 409; no runner call.
- A missing/unreachable receipts table or storage/config error fails closed with 503 and **cannot fall back to an unguarded batch**.
- If the runner throws, reports any `failedGames` (a potentially committed but unacknowledged position), or its final receipt update cannot be confirmed, the endpoint returns 503 `uncertain`, with no automatic retry. The receipt remains either `uncertain` or `running` and the partial unique index blocks new NBA batch commands.
- A successful batch is marked `completed` with its *actual* runner summary, without claiming which returned position IDs were newly inserted. Settlement `refresh` retains its existing separate behavior and never creates new wagers.

## Database rollout — REQUIRES separate staging approval

`database/ddl/paper_command_receipts_v1.sql` is a **staging-only schema proposal**. It is not a Supabase migration and has **not** been applied anywhere. The Supabase CLI must generate a timestamped migration filename (`supabase migration new nba_paper_command_receipts_v1`) during reviewed rollout; use the checked SQL after reviewing against the latest migrations and schemas.

The table enables RLS, grants only service-role access and denies `anon`/`authenticated`. It has a permanent unique UUID receipt and unique active/uncertain slot per NBA research account. No automatic unlock, timeout, or lease expiry may occur: an uncertain write must be reconciled with actual ledger records by an authorized operator before a separate reviewed resolution procedure can release the slot. Do **not** delete an ambiguous receipt or guess that no position was placed.

The production flag must stay `SPORTSEDGE_PAPER_RUNS_ENABLED=false` / unset. The new HTTP handler deliberately does **not** attempt to create database tables.

## Test plan

- Pure unit tests: identical-ID replay, competing requests, uncertain-position report, runner throw, lost completion acknowledgment, missing database claim and invalid identifiers.
- Route tests: owner checks, disabled flag, strict origin/JSON, UUID requirement, stock execution rejected, replay response, blocked response and errors without leaking DB internals.
- Before activation, staging must additionally test **real Postgres** unique constraint races from separate database connections; dropped HTTP responses after INSERT and PATCH; conflicting owner identity; RLS grants using anon/authenticated; and actual authenticated owner sessions behind a protected Vercel preview.
- Also verify no provider costs are triggered by duplicate HTTP requests; the runner itself can still use existing stored quotes and separate score-refresh calls.
- Keep no live gambling and no real-money brokerage functionality enabled.

## Known limits

1. Only NBA `run` commands are receipt-protected. Owner-triggered `refresh`/optional once-per-minute settlement checking is separate and uses existing idempotent DB settlement protections, not these receipts.
2. Two intentionally submitted *different* command IDs may start one after the other if the first completes. This design enforces **at-most-once execution per command ID**, not an account-wide lifetime one-run limit.
3. A lost first claim response that committed may result in an unresolved `running` row. This blocks future runs until an operator resolves it; safety is preferred to availability.
4. A browser refresh can lose its last displayed command ID. It is not permission to submit a replacement after an uncertain result.
5. Existing per-forecast SQL protection remains authoritative for bet-level idempotency and acceptance. This new layer is solely about owner batch-request replay and overlap.

## Authenticated staging readiness — 2026-10-12 follow-up

The connected Supabase account was inspected **read-only**. The SportsEdge project has no existing development branches, and the only visible project is the original SportsEdge database. A Supabase branch or second project may incur additional charges, so neither was created without an explicit organization and cost confirmation.

### Engineering validation added now

- `src/lib/stocks/paper-auth-integration.test.mjs` exercises the actual `ownerSession` and `ownerIdentity` handlers against an in-process fake Supabase Auth API, and then submits requests through `createPaperHandlers`. It verifies strict HttpOnly/Secure/SameSite owner cookies, verified owner access, expired/anonymous/unverified/wrong-owner refusal, disabled release flag, CSRF denial, provider failure, stock execution blocking and logout behavior. **It does not claim a real Supabase auth test.**
- Owner-only `GET /api/paper-control?commandId=<uuid>` can read an existing NBA command's state without creating positions or rerunning the strategy. Invalid IDs, non-owner sessions and storage outages fail closed; receipts and results are marked private/no-store.
- The sports owner UI keeps the original submitted UUID in sessionStorage until its completed receipt is confirmed. A lost network reply or page refresh leaves the new-run button blocked and offers **Check existing command status**. No request retries automatically. The browser can start a genuinely new batch only after a completed result is verified; running, uncertain, missing, and unavailable status retains the warning.
- Existing command IDs never contain credentials; command status is still owner-authenticated server-side. If browser storage is unavailable, the frontend refuses an untrackable new run.
- The SQL uniqueness, RLS and grant verification uses a disposable GitHub Actions PostgreSQL instance, not the connected Supabase project.

### Hosted staging activation checklist (not performed)

1. Confirm the intended **Supabase organization** and explicitly accept the cost quote for an isolated branch or second project. Do not use the existing SportsEdge project for DDL experiments.
2. Ensure isolated project migrations match the audited NBA tables and SQL RPC requirements. Review actual migration history before applying `database/ddl/paper_command_receipts_v1.sql` as a generated timestamped migration.
3. Configure staging-only secrets and allowlist origin. Never reuse production owner credentials or service-role keys in test fixtures. Leave `SPORTSEDGE_PAPER_RUNS_ENABLED` disabled until tested.
4. Test real Supabase login/logout, expired JWT, anonymous and non-owner denial, cross-site requests, conflicting command IDs, lost reply cases, command receipt replay, and error scrubbing.
5. For a controlled paper run, use only seeded virtual fixtures, no paid odds-provider calls, and a separately authorized staging flag; ensure the staging DB cannot write to production.
6. Reconcile all running/uncertain receipts in the disposable ledger before authorizing any new batch. There is no automatic unlock.
7. Re-run Next.js build, all Node/Python tests, PostgreSQL concurrency checks, responsive browser checks, and staging HTTPS test. Get explicit release approval before merging or enabling automated execution.

**Not validated:** production-like Supabase Auth, a real owner login, real hosted credential configuration, replay after a database failover, actual wager execution, or automatic background paper operation.
