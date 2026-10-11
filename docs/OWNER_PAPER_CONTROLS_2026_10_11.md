# Owner paper controls: review milestone

Version: `owner-paper-controls-v1`; reviewed locally 2026-10-11.
Stacked on PR #20 (`c2f4427d74411c6c4e70f08ec02be26f2512c887`), preserving its pages, read-only readiness checks and NBA skip reporting. This document describes the next milestone after PR #20; its earlier statement that no owner route exists describes that earlier commit.

## Behavior

- Owner signs in using a confirmed Supabase Auth account. The server verifies the access token with Auth on every privileged request and matches one configured owner UUID. No signup, owner creation or password reset is introduced.
- Pressing Run requests one NBA batch examining at most ten upcoming, unrecorded forecasts. Existing locked `research_place` performs the authoritative freshness, edge, integer-cent staking and uniqueness checks. The existing frozen 1%-of-available-cash experiment remains unchanged; this does not activate the proposed 100 x $10 study.
- Known existing positions and deterministic skip reasons remain separate. Returned IDs are confirmed positions, not a verified count of newly created bets. Stop on an uncertain write without retrying. Ledger uniqueness prevents duplicate positions for a forecast; **there is no durable per-command receipt**, so replaying a request can examine further forecasts. Do not represent this as exactly-once batch execution.
- Check final results calls the existing settlement operation and refreshes displayed ledger balances. Optional checking every 60 seconds works only while the signed-in sports page is open. No recurring new bets, background scheduler, provider price refresh or paid odds request is installed. ESPN result checks use the existing source validation.
- Stocks remain blocked server-side even for the owner. The $1,000 automated study has no connected verified price feed, persistent execution adapter or account. The separate $10,000 manual browser journal is unchanged. No stock return is measured or invented.

## Files

`src/components/paper-run-controls.tsx` extends PR #20 readiness UI. `src/lib/server/research-operations.ts` adds batch bounds and uncertain-write stopping while retaining PR #20 reporting. PR #20 page files are inherited unchanged.

New code: `src/lib/paper-control.ts`, `src/lib/server/paper-owner.ts`, `src/app/api/paper-control/route.ts`, `src/app/api/paper-control/session/route.ts`. New tests: `src/lib/stocks/paper-controls.test.mjs`, `paper-owner.test.mjs`, `paper-runner.test.mjs` (kept in this directory for the existing CI test glob).

## Configuration and release gate

No production configuration, Auth users, database schema, records or deployments were changed. Missing configuration or a release flag other than literal `true` disables execution.

Server environment requirements for a reviewed release:

- Existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or existing service-role fallback) for the ledger.
- `SUPABASE_PUBLISHABLE_KEY` for the same project's Auth REST endpoint.
- `SPORTSEDGE_OWNER_USER_ID`: UUID of the reviewed, confirmed, non-anonymous owner account.
- `SPORTSEDGE_SITE_ORIGIN`: exact HTTPS origin without a trailing slash; preview and production must use their respective origins.
- `SPORTSEDGE_PAPER_RUNS_ENABLED`: leave unset/false until review and authenticated staging verification are complete.

Secrets stay server-side. Session cookie is HttpOnly, Secure, SameSite=Strict, host-only and capped at one hour; no refresh token is retained. Every POST requires exact request/Origin matching, JSON and a custom header, followed by owner verification. Provider errors expose no private details. Logout clears the cookie and requests provider logout; a copied access token can remain valid until expiration. Auth provider rate limiting is preserved, but distributed app-level throttling and revocable application sessions are not implemented.

Before enabling: test owner/non-owner/expired sessions over HTTPS, deployment origin behavior, provider rate limits, and database locking/concurrent calls in staging. Durable command receipts and settlement pagination remain follow-up work. Existing forecast retrieval is limited to the latest 100; old pending games outside that window can require operator settlement. The current HTML smoke test does not replace a real authenticated browser/database test.

## Verification

2026-10-11 local results:

```sh
node --test src/lib/ingestion/*.test.mjs src/lib/research-math.test.mjs src/lib/result-validation.test.mjs src/lib/stocks/*.test.mjs
# 55 passed, zero failed (19 new owner/control/runner tests)
npm run lint
npm run build
npx tsc --noEmit
# all passed
python -m unittest discover -s analytics -p 'test_*.py'
# 127 passed in the matching stock research workspace (PR #19 analytics)
```

Production-server HTTP smoke: GET status reports unconfigured; both mutation routes reject with 403; `/stocks` and `/paper-betting` return 200 and render readiness controls. No credentials, remote writes or wagers used. Auth/database positive-path tests use synthetic mocks, not live account verification. No browser visual QA or full real provider-to-ledger run is claimed.

## Next independent milestone

Preserve PR #15 accounting, PR #16 data contract, PR #18 `stock-mom252-skip21-trend200-v1` and PR #19 execution planner. Connect a verified, point-in-time stock dataset to the model, then implement durable owner-command receipts and a transactional stock ledger adapter with quote provenance, costs, corporate actions and account revision locking. Test this in an isolated account before exposing Run. Historical stock performance remains unmeasured. No profitability claim follows from either the NBA audit or synthetic stock tests.
