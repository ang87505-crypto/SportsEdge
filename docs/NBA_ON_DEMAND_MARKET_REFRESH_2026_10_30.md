# One-time research market refresh

The production database already has `research_dispatch`, `research_claim`,
`research_finish` and `research_reserve_credit`. Its dispatch URL was missing
from the deployed application. The additive `/api/internal/research-cycle`
POST handler restores that URL and refreshes stored markets only.

Next.js and its ESLint config are patched from 16.4.0 to 16.4.3, including the
security fixes released in 16.4.1. The lockfile pins the resolved packages.

An operator with authorized database access issues `research_dispatch(true)`
for a read-only connection probe. A successful probe consumes no provider
credits. After checking the receipt in `research_runs`, the operator can issue
`research_dispatch(false)` for one explicit refresh. The existing dispatcher
generates a random 256-bit bearer token, stores only its SHA-256 hash, and sends
the request through `pg_net`. The application atomically claims a queued run
less than ten minutes old. A claimed run cannot be replayed.

The handler accepts only a bounded `{runId}` body and never accepts caller odds,
model settings, account IDs or wager instructions. It is enabled only for
Production with the original `fzyjazhvkstvwwzjhlrr` research source and server
credentials. Preview fixtures and read-only research credentials fail closed.
Existing account/order controls and the separate stock staging store are untouched.

Each non-probe run reserves two requests through the existing eight-request
rolling-day / 240-request rolling-month cap, then calls the existing dual-track
NBA/EPL collector once. Reservations are conservative, including failed calls.
It records counts and provider quota in the receipt, never provider URLs or keys.
On an uncertain result, inspect `research_runs`, market timestamps and snapshot
counts before issuing another explicit run. Append-only snapshot uniqueness
prevents duplicate rows; it does not refund provider credits.

This endpoint creates no forecasts, virtual wagers, results, settlements or
automatic schedules. Upcoming NBA identities and start times must still be
verified independently before immutable publication. An explicitly requested
paper wager then uses the existing account and database placement checks.

Validation:

```sh
node --experimental-strip-types --test src/lib/server/research-cycle-handler.test.mjs
npm run lint
npm run build
```

Record actual dispatch IDs and post-refresh counts after deployment; successful
deployment alone does not mean that any paper position has been recorded.
