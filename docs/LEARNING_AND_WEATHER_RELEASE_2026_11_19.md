# Continuous learning evaluation and NOAA grading — November 19, 2026

## Milestone

Integrate the existing AI 2.0 engine/intake work from #166/#167 and the NOAA parser correction from #186 onto current main. Evaluate predictions already saved by production shadows, persist the research lifecycle between jobs, and show dated evidence in the lab. This is the shortest path to useful forward-learning evidence without waiting for the separate nine-variant ablation migration.

**Prepared release, not a production activation receipt.** The older phase reports are historical snapshots. This document describes the proposed integration; live activation must be verified after merge.

## What changes on release

- The research engine runs after a successful `NBA props paper cycle` on main, with a daily 17:47 UTC backup and a manual entry point. It reads the existing props database using bounded GET requests. There are no extra odds-provider, broker, model-provider or exchange calls.
- The worker restores the last successful registry from `research-data`, so previously rejected and already registered hypotheses survive the next run. A failed evaluation is visible and cannot replace accepted resume state.
- Newly created production shadows are discovered through their existing model events and hash-verified artifacts. They are evaluated only on predictions made after their original database registration; no training or model activation is performed by this discovery step. Failed/stale experiments wait for review rather than blocking later challengers.
- The existing trainer skips creation when all three shadow slots are full. This preserves existing candidates instead of replacing them every three weekly trains. With at most two funded games per rolling day, a 50-game gate requires at least 25 captured game days; a 21-day replacement cycle can prevent any model reaching it. An eligible promotion or owner retirement can free a slot. Thresholds, weights and current predictions do not change.
- Every publication creates `learning-engine/runs/<workflow-run>-<attempt>/registry.json` and `report.json`. `learning-engine/index.jsonl` is append-only. The existing Git publisher rejects edits to run files and rewrites of the index prefix. Writers share the existing `research-data` concurrency group.
- `/lab` fetches hash-verified published results and identifies stale, failed, unavailable, or saved-only evidence. Chat receives a registry only from a current successful publication. Historical November 13 seed records never become evidence of a current job merely because a new deployment exists.
- The existing operations monitor watches the engine. The lab also flags published evidence older than 48 hours.
- The NOAA climate parser accepts complete-day `YESTERDAY` and legacy `TODAY` temperature headings. The regression tests now actually transform the fixture into the legacy heading. Interim reports remain refused.
- Kalshi readiness text distinguishes the integrated research scaffold, active government weather collection, and gated exchange ingestion.

## Evidence admission and model behavior

The engine pairs the candidate and baseline on the same unique captured line. Both forecasts must be recorded before lock; their data cutoff must precede prediction, their probabilities must be valid, and their game/stat/lock metadata must match. Grades need valid publication times after lock and no later than the evaluation cutoff. The database reader verifies the graded direction against the stored actual, paginates data, excludes fixtures, uses Eastern game dates, and reports failures instead of silently accepting a truncated source.

Registered review thresholds and the production scoring functions are unchanged. Repeated input does not create repeated hypotheses. Rejected ideas remain rejected. Evaluation fingerprints include probabilities, outcomes and metadata rather than only line IDs.

The production-shadow comparison can operate with the existing predictions even when `props_lab_v1.sql` has not been applied. The nine-variant ablation lab remains separately blocked until that database setup is verified; its unavailable count is displayed as unknown, not zero. The new evaluator does not train or promote models; the existing trainer retains its behavior when a slot is free. Stock execution and risk settings are unchanged. Stock forward research continues through its existing nightly workflow; this engine does not invent weekly observations or treat a retrospective stock result as forward evidence.

## Real NOAA verification

The repaired parser was run against the actual November 19 next-morning CLINYC report for November 18. The official product reported a preliminary Central Park maximum of **64°F**. It paired successfully with the already archived pre-event forecast of **60°F**, an absolute error of **4°F**. The stored independent band contained the observation, but no trained band probability was available, so its Brier score remained null.

This is one genuine forecast/outcome parsing check, not a profitability result, a calibrated model, a Kalshi settlement, or evidence that all missing historical days were recovered. Its source product, digests, frozen-forecast reference and grade are retained in `research/learning_engine_release_20261119/noaa-parser-verification.json`. The production weather archive was not changed during this check.

## Release verification

Local verification of this integration: 958 JavaScript tests discovered, 911 passed, 47 PostgreSQL-dependent tests skipped, zero failures. TypeScript and the production build pass. Lint has zero errors and six pre-existing warnings. Owner-sign-in and assistant HTTP smoke checks pass. Next.js/eslint-config-next are updated to 16.4.6; Zod resolves to 4.6.7; the current dependency audit reports zero vulnerabilities. SQL integration remains a CI requirement; no production database was used as a test fixture.

Before merge:

1. Run the complete discovered JavaScript suite, type checking, lint, production build, owner-sign-in HTTP smoke and assistant HTTP smoke.
2. Confirm immutable publication, failed-run restore, append-only index guards, corrupt/stale-source behavior, pagination and timestamp admission tests pass.
3. Confirm the dependency security patch has a clean current audit and review the resulting manifest/lockfile diff.
4. Review CI and the deployment preview against the actual PR head.

After merge:

1. Verify production `/api/version` matches the merged commit.
2. Observe one real engine job from the existing props cycle or the daily backup. Require an immutable archived receipt and registry, not only a green workflow.
3. Verify `/lab` displays that publication time, correct sample counts and the registered readiness status; check a subsequent run restores the accepted registry.
4. Observe the next NOAA outcome run publish an outcome and grade for an existing forecast. Earlier missing reports stay missing unless an official historical source can verify them.

No purchase, database migration, actual wager, broker order, model switch, or Kalshi market-data activation is part of this release. Exchange networking retains its existing permission checks.
