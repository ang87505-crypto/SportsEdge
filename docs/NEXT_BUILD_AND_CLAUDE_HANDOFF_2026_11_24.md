# SportsEdge: next build and Claude restart handoff

Checked November 24, 2026. Base main: `ebffeb95b7e360380d4ca2c372a7856227ca7084`.
This is a dated execution plan; older run journals remain intact.

## Verified starting point

- Production serves the inspected main. The November 24 18:38 UTC operations report passed its live site checks.
- NBA props collection and grading are running. The separate research-receipt workflow is `MISSED_SLOT`: the monitor counted 11 missed planned slots out of 21 in its seven-day view. A planned slot is not a completed execution.
- The older NBA moneyline batch is settled: eight bets, 5 wins, 3 losses, +$15.50 virtual profit, $1,015.50 equity, zero pending. PR #212 preserves that journal. Keep this cohort separate from props.
- PR #208 already combines the frozen NBA recalibrator, forward studies, read-only readiness checks, and stored-line replay. Its reviewed candidate head is `d981585a65127bf1dd62cad5a3d43bcea88ebdc1`. It is a draft; hosted database readiness and independent release review remain outstanding. The later archive guard repair #203 is already on main.
- Stock order writes remain disabled on main. The latest inspected execute run #45461718972 reported `NO_EXECUTABLE_DECISION_TODAY`, posts=0 and cancels=0. PR #102's pinned release gate still requires the first owner-supervised session.
- Stock research collection has recovered and reports `NONE QUALIFIES`; this is not a claim that an active strategy beats SPY.
- Kalshi public NOAA collection is separate from exchange access. PR #211 improves archive-based health reporting. Demo/live access must not be activated as part of this work.

## Work split and order

| Order | Owner | Deliverable | Completion evidence |
| --- | --- | --- | --- |
| 1, now | This chat | Recover missed NBA research receipts through existing authenticated scheduler slots | Regression tests, lint/build, draft PR; no hosted dispatch during development |
| 1, in parallel | Claude | Independently review and finish #208 against current main | Exact head/tree, tests, inherited-diff review, frozen artifact hashes, and named hosted readiness blockers |
| 2 | This chat + owner | Review the two concrete changes and run the existing hosted read-only readiness check with authorized access | Actual READY result and owner approval before any migration, merge or scheduled study activation |
| 3 | Claude + owner | Prepare the first supervised stock PAPER session admitted by the existing controller | Fresh eligible decision, clean account, owner Start, real PAPER order/fill receipts, Stop/reconcile/Start and same-session close mark required by #102 |
| 4 | This chat | Review Kalshi #211 and keep independent NOAA evidence collecting | Published archive records and exact valid-pair count; no inferred execution or exchange enablement |

Do not start another parameter search while the frozen NBA challenger is waiting for prospective capture. Do not lower promotion gates or relabel old predictions as new forward evidence. Integrate #208 as one reviewed candidate; do not separately merge its imported ancestor PRs.

## This milestone: read-only research-receipt backups

Changed files:

- `src/lib/server/scheduler-kickoff.ts`: three fixed backup slots for the existing `props-research.yml` workflow, using its existing recent-run check.
- `src/lib/server/scheduler-kickoff.test.mjs`: recovery, exact cutoff, duplicate suppression, failed-run retry, authentication and hour restrictions.
- `vercel.json`: three once-daily cron paths.
- This dated handoff.

| Primary snapshot, UTC | Recovery hour, UTC | Recovery hour in MST |
| --- | --- | --- |
| 15:45 | 16:00–16:59 | 9:00–9:59 a.m. |
| 19:25 | 20:00–20:59 | 1:00–1:59 p.m. |
| 22:25 | 23:00–23:59 | 4:00–4:59 p.m. |

Each backup checks runs created since its own primary slot. A successful, queued or running receipt covers that window; an earlier receipt or completed failure does not. A missing window dispatches the existing read-only workflow on main with empty inputs. The production cron secret, production-only restriction and dispatch-token validation apply before network access. The snapshot uses stored rows and immutable model artifacts; it does not collect odds, place entries, promote models, or change owner controls.

These are best-effort recovery hours, not guaranteed execution times. A dispatch acceptance is not a completed receipt. If both schedulers are unavailable, or credentials/workflows fail, the monitor must continue reporting the missing result. On unavailable run history the existing scheduler may dispatch a duplicate read-only receipt. No distributed at-most-once guarantee is claimed.

Vercel currently documents 100 cron jobs per project and once-daily, per-hour precision for Hobby. GitHub documents that scheduled jobs may be delayed or dropped. Keep the existing scheduler rather than introducing a new provider:

- https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

Validation command:

```sh
node --experimental-strip-types --test src/lib/server/scheduler-kickoff.test.mjs src/lib/server/github-dispatch.test.mjs
```

Local verification completed: 26/26 scheduler and dispatch tests passed. The four new recovery tests failed before the slot definitions were added and passed afterward. `npm run lint` passed with zero errors and six warnings in unchanged files. `npm run build` passed, including TypeScript and generation of all 50 pages. `git diff --check` passed. The resulting manifest has 32 unique cron paths, below the documented limit of 100. No hosted credentials, provider requests or operational dispatches were used for these checks.

Activation requires review, owner merge approval and production deployment. Rollback removes the three new cron entries and matching slot definitions; existing jobs continue. No database migration is needed for this milestone.

## Copy to the refreshed Claude session

```text
Continue SportsEdge in ang87505-crypto/SportsEdge. Inspect current main and AGENTS.md first. Last checked main was ebffeb95b7e360380d4ca2c372a7856227ca7084 on November 24, 2026; verify it again.

Your milestone is to independently review and finish the existing forward-study release candidate PR #208, last checked head d981585a65127bf1dd62cad5a3d43bcea88ebdc1. Do not rebuild or duplicate its work. Read docs/FORWARD_STUDY_RELEASE_CANDIDATE.md and the candidate's linked protocols. Check that main's already-merged #203 archive fix survives integration.

Review the actual code and inherited ancestry from #192/#195/#199/#200/#201/#202/#205/#206/#207. Verify pinned workflow checkout/HEAD, read-only preflight, database privilege/RLS/append-only-trigger checks, forecast-before-lock chronology, stored-line replay, duplicate handling and exact-cent payout accounting. Keep the #195 calibrator artifacts, sample minimums and promotion rules frozen. Run the relevant tests and fix concrete defects on an isolated branch. Identify exact files before editing and preserve existing work.

The other ChatGPT session owns src/lib/server/scheduler-kickoff.ts, its tests, vercel.json and the November 24 handoff note while it builds read-only research snapshot backups. Avoid touching those files in parallel.

Also inspect the stock controller's current first-session blocker. Determine the earliest session admitted by the registered calendar and existing initial-decision option. Give the exact supported owner sequence and explain any blocker from code; do not assume another Monday is required. Do not change cadence, backdate a decision or bypass the pinned #102 gate.

Deliver one reviewable result: exact head/tree, changes and tests, frozen artifact hashes, hosted readiness evidence or exact remaining blocker, integration order and a short owner checklist. Distinguish passing synthetic tests from hosted Supabase readiness, accepted dispatches from completed jobs, and paper fills from real-money trading.

Do not refit models, start another search, spend odds credits, change budgets/risk/STOP controls, dispatch collectors or orders, run hosted migrations, merge PRs, or activate scheduled studies, broker writes, Kalshi demo or live trading without the owner's explicit approval. Preserve all completed work. No profitability claim without qualifying evidence.
```
