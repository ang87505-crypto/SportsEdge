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
