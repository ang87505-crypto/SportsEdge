# Cost-conscious SportsEdge odds refresh controls (2026-10-11)

**Scope:** Protected backend collection for NBA and EPL, stacked after NBA results-reconciliation draft PR #24. This change does NOT schedule requests, actually contact The Odds API in development, add paid-provider subscriptions, or activate trading. Existing provider timestamps, append-only snapshots and latest-market quote gating remain intact.

## Why

The original protected endpoint always fetched both NBA and EPL when called. That wastes API calls when the owner wants only one sport, and a GET without an explicit mode could inadvertently initiate billable requests. The Windows verification script also immediately collected both sports whenever its Collect switch was present.

## New behavior

- Authenticate with the existing secret SPORTSEDGE_INGEST_TOKEN (32+ chars; server-only). Unauthenticated calls still receive 404.
- GET /api/internal/collect-markets?probe=1 -> read-only Supabase connectivity verification, no provider calls or database writes.
- GET /api/internal/collect-markets?plan=1&track=nba -> protected, **zero-provider-cost** dry run describing the desired track and *number of HTTP source requests planned* (one for NBA alone or EPL alone; two for both). It explicitly does NOT claim to know the billing credits.
- GET /api/internal/collect-markets?collect=1&track=nba -> explicit, token-authorized one-time NBA collection, **would consume provider quota when invoked**. Other valid track options: soccer and both. Existing default choice remains both when the track parameter is omitted.
- GET without collect=1/probe=1/plan=1 returns 400, with no external request. Invalid track parameters return 400.
- The collector can fetch exactly one track, or both sequentially. When both are requested, BOTH provider feeds must be successfully received before any Supabase writes. If a provider reports zero credits after the first response, the second call is skipped. A database problem after fetch can still cause a partial persistence; append-only dedupe makes a manually approved retry reconcile the saved rows, but *provider calls remain billable*.
- The authorized PowerShell script has a new Track choice: both (default), nba or soccer. It probes Supabase, displays the plan, and asks the owner to type YES before invoking an explicitly selected provider collection. It continues to pin its known deployment hostname to avoid accidentally sending the private token to an arbitrary URL. Its exact production domain must be verified before use.

## New and modified files

- NEW src/lib/ingestion/collection-policy.ts + .test.mjs
- NEW src/lib/ingestion/collection-choice.integration.test.mjs (synthetic mock provider and Supabase responses)
- MODIFIED src/lib/server/collect/odds-collector.ts (reuse existing two-track path with one-or-two-track selection)
- MODIFIED src/app/api/internal/collect-markets/route.ts (explicit plan/probe/collect modes)
- MODIFIED scripts/check-and-collect.ps1 (single-sport option + a second local confirmation)
- This handoff.

## Security and limitations

- No public browser endpoint; no secret exposed to the frontend. The sportsbook-ingestion endpoint remains private and uses the original server token.
- There is **no persistent provider credit budget, per-hour lock, multi-instance rate limit, or Cron schedule** here. Repeated authorized manual collection requests can consume multiple provider credits. Do not use unattended automation or frequent polling until a durable cap and hosting/cost review are approved.
- The Odds API credits depend on actual provider plan, requested region/markets and headers, NOT merely the number of HTTP source requests; the plan deliberately says credit count unknown.
- The provider's source timestamp remains distinct from SportsEdge's ingestion timestamp. Receiving a quote is not proof a real sportsbook still offers the price.
- No automatic bets or stock orders, no database migration or writes from this development milestone, no merges/production changes.

## CI and release review

Run Python and Node test suites, npm run lint, npm run build and TypeScript checking. Verify the protected endpoint's real token authorization on a staging environment, including rejecting missing collect=1 with zero vendor calls; test with mock source responses first. Never exercise the chargeable path with a real vendor key in staging without separate owner approval.

A future pricing/operations milestone must verify actual Vercel plan, provider remaining budget and update frequency, durable throttle/receipt, acceptable quote freshness, legitimate fixture mapping and deployment domain. If the site cannot refresh quotes within the approved budget, show NO ACTIONABLE PRICE rather than make up current prices.

This milestone makes the *manual authorized refresh workflow* safer and more economical; it does not itself guarantee real-time odds collection.
