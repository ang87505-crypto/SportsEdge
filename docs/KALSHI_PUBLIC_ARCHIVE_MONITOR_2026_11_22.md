# Monitor the independent public weather archive

The existing operations monitor omitted the independent NOAA workflow and did not check whether a fresh forecast and preliminary outcome were actually published. A green workflow alone cannot establish that useful records were collected.

This candidate adds the NOAA workflow as a required monitored job and refreshes operations status after it completes. A read-only public heartbeat at `GET /api/research/kalshi-health` verifies the already-public forecast and scorecard archive. It reports stale/missing forecasts and outcomes separately, and routes failures to the existing operations status and alert path.

The endpoint has no private database, account, worker-control, credential or exchange capability. It publishes public archive fields only, with sanitized failure codes. Private workspace and account diagnostics continue to require the existing owner sign-in.

Collection with fewer than the unchanged 30 required training pairs is healthy. Model admission, market-data access and demo activation remain separate from public-source collection health. Freshness limits are 36 hours for a forecast capture and 60 hours from the last graded climate day's UTC-5 start. These are operational thresholds and do not change model requirements.

## Validation and release

Required checks: Kalshi/collector/monitor/archive regressions; lint, build and TypeScript; built HTTP read-only/public-output checks; final-head hosted CI. Tests exercise stale and missing source records, future timestamps, bounded morning grace and sanitized output. The public endpoint reads only the existing immutable archive and uses no new source requests in the collector itself.

Local results: all 193 Kalshi, collector, monitor and archive tests pass with zero failures/skips. Lint has zero errors and six existing warnings. The production build, TypeScript and built HTTP public-output/read-only checks pass. Consult the PR for final-head hosted CI; these local results do not claim that this monitoring candidate is deployed.

This branch changes public research monitoring only. It does not change collection schedules, model rules, stock files, props settings, stakes, budgets, access approvals or trading controls. No database migration is required. Main release still requires owner approval. After release, verify the production SHA, a fresh HTTP heartbeat and a newly published operations receipt before calling the monitoring change operational.

Rollback is a code revert. Preserve the original public forecasts, outcomes, scorecards and evaluation receipts.
