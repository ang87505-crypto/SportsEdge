# Forward paper studies: single release candidate

This candidate packages the completed forward-study chain for one review and one eventual owner-approved main release. It includes #200, #202, #206 and #207 through their existing ancestry; their reviewed branches are unchanged. Do not merge the imported source PRs separately.

## Source and changes

| Source | Pinned head | Included work |
| --- | --- | --- |
| #200 | 42fe0bcaec5d06f049f0943914a8cd99cca4aad4 | Exact-baseline monotone shadow, frozen paper studies, SEC intake and stock evidence |
| #202 | 54311297cdf850c661c01523bbb3d209712c3975 | Corporate-action archive verification and redacted report retention |
| #206 | c6870b4a8795740536ca52bf1628a11352affdd4 | Manual default preflight, explicit record choice and bounded GET-only CLI |
| #207 | 18147898f2db896c14a3fa96c778224ee599285a | Offline stored-line replay, grade provenance and receipt chronology |
| #205 SQL only | ecc260b14d55ce62a6a88448ed24faad92417095 | Read-only hosted grants/RLS/trigger/sequence check, strengthened below |
| #208 candidate | d981585a65127bf1dd62cad5a3d43bcea88ebdc1 | Exact-commit workflow checkouts and the first readiness strengthening |
| #208 review | 4462f0983731abb35edf582c2546baf833a57e14 | Replay receipt-order dedup, correction-delta penny equity, insert-guard readiness ([review](FORWARD_STUDY_INDEPENDENT_REVIEW_2026_11_24.md)) |
| main | ebffeb95b7e360380d4ca2c372a7856227ca7084 | Merged #203 archive repair and #210 Kalshi demo balance check, integrated by a clean merge |

The net edits after #207 are limited to:

- Pin the test, preflight and record checkouts to the same workflow event commit. Immediately verify actual Git HEAD against GITHUB_SHA in each job. The previous record checkout followed moving main and could execute a newer untested tree while its receipt named the older commit.
- Extend the real-workflow regression to refuse a moving-main checkout or a removed HEAD guard. Existing event, credentials and preflight tests remain.
- Include the #205 readiness query, with the additional requirement that append-only triggers fire in normal origin sessions (O or A); a disabled or replica-only trigger is insufficient.
- Exercise that exact query inside a read-only transaction on disposable PostgreSQL. Also reproduce the original query's false READY on a disabled trigger.
- Add this release note.

## Independent review (2026-11-24)

The review covered workflow pinning, inherited diffs, frozen NBA calibrator, forecast-before-lock chronology, database privileges/RLS/append-only protections, replay and penny-cent accounting. It found one concrete defect and fixed it in the read-only check only:

- **The readiness query could report READY with the BEFORE INSERT guards disabled.** Those triggers set the database clock, refuse after-lock and after-result writes, and compute penny stakes and returns in whole cents. With `props_penny_freeze`, `props_penny_grade` or a lab chronology trigger disabled, or rebound to another function, the service role could insert caller-chosen stakes, settlements or post-lock forecasts. Reproduced on disposable PostgreSQL before the fix: `OVERALL = READY`.
- Both reviews fixed this independently; the integrated query is #208's `4462f09` version (`INSERT_GUARD_MISSING_OR_DISABLED`). Each guard must be enabled (O or A), unconditional, exactly BEFORE ROW INSERT, and bound to its function. The `props_append_only` trigger must be exactly BEFORE ROW UPDATE OR DELETE through `props_immutable()`, with no column list or WHEN clause.
- This branch adds only a `shadow` row for `props_predictions` on top. That table's `props_prediction_chronology` lock guard and append-only trigger are what keep NBA shadow forecasts before lock. Its older props_v1 grants are displayed but not gated. Supabase's default grants may give service_role UPDATE/DELETE/TRUNCATE there, and that is a separate pre-existing review item; this candidate does not repair it.
- Disposable cases from #208: disabled penny freeze, replica-only lab chronology and append-only without DELETE return NOT_READY. Restored triggers return READY. Added here: disabled shadow lock guard and missing shadow append-only trigger return NOT_READY. Broad legacy grants on `props_predictions` remain READY (reported, not gated).

Unchanged by the review: the generated owner setup bundle, model artifacts, registered sample minimums, promotion gates, source schedules, budgets, stock session files, broker controls and Kalshi demo/live access. Frozen artifacts are byte-identical to #200 (`research/props_monotone_cal_v1_20261120`, calibrator digest `8b84007d37b9…`, baseline digest `4ca4be3779f1…`). There is no new strategy or new performance result.

Observations that do not block release:

- **Experiment-manifest drift on a frozen props file.** `scripts/experiment-manifest.mjs verify docs/experiments/manifest-2026-11-13-candidate.json` reports `src/lib/server/props-cycle.ts` drifted for `props-paper-v1`. This is new in this candidate: the frozen NBA shadow hook. The other two drifted props files, `capture-plan.ts` and `props-tick.ts`, already drift on main. The hook runs after baseline predictions and picks are saved and catches all of its own errors. It writes only `props-nb-monotone-cal-v1` rows and cannot change a pick, entry or stake, so production behaviour is unchanged. At release, record the drift as an owner-acknowledged additive change, and take a new manifest snapshot after merge. The stock experiment has zero drift.

- Lab/penny freezing now runs after a *successful* capture tick or grading cycle, or on the daily 17:37 UTC schedule. The old in-tick lab step ran even after a failed tick. Lines that lock within about 30 minutes of a failed tick may therefore miss a lab forecast. They are never backfilled. The NBA monotone shadow runs inside the capture cycle and is unaffected.
- The readiness query checks configuration, not guard function bodies. A hand-replaced function body with the same name would still pass. Do not edit study functions by hand.

GitHub checkout semantics: https://github.com/actions/checkout/tree/11bd71901bbe5b1630ceea73d27597364c9af683
Workflow context: https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
PostgreSQL trigger modes: https://www.postgresql.org/docs/current/catalog-pg-trigger.html

## Verification and limits

Synthetic and local results are recorded in the PR. They do not establish hosted readiness. The hosted active props project has not been inspected from this candidate. No hosted migration, preflight, study recording or source capture was performed. The SQL regression uses disposable synthetic databases only.

CI success is separate from operational readiness. The read-only SQL inspects schema configuration; it does not prove write success, an actual worker run, sufficient forward evidence, or model quality. The app's GET preflight proves required table/column reads only.

## Status on 2026-11-27 (head merged with production main `87c0134`)

### Deployed vs candidate only

| Deployed on main `87c0134` | Only in this candidate (not deployed) |
| --- | --- |
| Props collect, settle and capture ticks; `props-learn-v1`/`v2` production shadows (ledger-models); research-engine evidence feeds, 6/20 active experiments automatic per #233's archived receipts; props-research snapshots (#233) | The frozen `props-nb-monotone-cal-v1` shadow hook in `props-cycle.ts`; the `forward-paper-studies.yml` recorder (lab freeze, penny paper study); the 13-row readiness query and its 18 synthetic cases; the engine's `trackMonotoneShadow` discovery; stock audit/corporate-action opt-in steps |

### Shadow-learning integration: verification (code and synthetic database)

| Requirement | Mechanism | Verified by |
| --- | --- | --- |
| Recorded before lock | Client skips rows with `lock_at <= now`. The database trigger `props_prediction_chronology` (`props_check_prediction`) sets `predicted_at` from the database clock and raises `PROPS_PREDICTION_AFTER_LOCK` at or after lock, or if `data_cutoff` is after the prediction or the lock. It also requires a running run | `props_v1.sql` lines 292–306; `props-monotone-shadow.test.mjs` and integration test; readiness case `disabled-shadow-prediction-lock-guard` → NOT_READY |
| Original timestamps and model versions | `data_cutoff` copied from the baseline row; `predicted_at` set by the database; `model_version = props-nb-monotone-cal-v1` (constant); `inputs` keep `baselinePredictionId`, `calibratorDigest` `8b84007d…` and `baselineArtifactSha256` `4ca4be37…`; refuses to run if the live model digest differs | `props-monotone-shadow.ts`; `monotone-shadow.ts` |
| No duplicates | `UNIQUE(observation_id, model_version)` with ignore-duplicates; only newly saved baselines (this run) are shadowed, never backfilled; an uncertain batch is never resubmitted | `props_v1.sql` line 183; shadow tests |
| Graded against verified outcomes | The engine's ledger loader maps the provenance fields. `trackMonotoneShadow` registers the experiment only after the first genuine ledger receipt whose probabilities recompute exactly. Grading uses the same `ledger-models` pairing as `props-learn-v1/v2` against verified line results, under the unchanged `REVIEW_GATE` minimums. No promotion path | `src/lib/lab/engine/monotone-shadow.ts`, `forward.ts`; engine tests |

Nothing above has run against the hosted props database from this candidate.

### Execution receipts (completed runs, not schedules)

From the archived engine reports on `research-data` (`learning-engine/runs/*/report.json`), which read the props ledger itself:
- graded picks rose from 144 (Nov 21) to 150, 159, 168, 174 and 185 (Nov 26). Latest: 185 picks, 108 hits; 854 scored lines, 32 games, 17 dates; alarms `OK`.
- `props-learn-v2-shadow` rose from 250/500 observations over 5/14 dates (Nov 21) to 496/500 over 10/14 dates (Nov 26). Clusters 18/50 and decisions 40/100 remain below the gate.
- `props-learn-v1-shadow` stands at clusters 27/50 and decisions 75/100. Both remain `INSUFFICIENT_DATA`.
- No growth from Nov 26 to 27: there were no NBA games on Thanksgiving.

GitHub runs on main since Nov 24, all `success`:
- props-daily: 27 (scheduled plus Vercel-backup dispatches);
- props-tick: 40+;
- props-research: 20;
- research-engine: 32.

`props-learn` (weekly) last ran on Nov 22: scheduled at 17:37 UTC plus a 16:33 UTC Vercel backup. The next planned run is Sun Nov 29; that is a plan, not a receipt. ops-status (Nov 27 04:44 UTC) agrees.

### Hosted readiness: NOT OBTAINED (access blocker)

The 13 rows are 11 relations, the penny sequences and OVERALL. They read `pg_class`, `pg_trigger` and `has_table_privilege`, which only the Supabase SQL editor or a direct Postgres connection can reach. PostgREST cannot.
- This session has no credentials for `vfyzbliksooljxrlfadp`.
- The repository's Actions secrets (`SPORTSEDGE_PROPS_SUPABASE_URL`, `SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY`) are PostgREST credentials and cannot run catalogue SQL.
- No workflow on main runs this query. `forward-paper-studies.yml` exists only in this candidate, and its preflight is the GET-only ten-table check, not the 13-row query.
- No hosted readiness has ever been recorded. The primary research project is not a substitute.

**Owner action:** run the step below in the SQL editor of `vfyzbliksooljxrlfadp` and paste the 13 rows into the PR.

### Manifest after an authorized merge

`docs/experiments/manifest-2026-11-13-candidate.json` drifts on three `props-paper-v1` frozen files:
- `src/lib/server/props-cycle.ts`: this candidate, `825f2c31` → `cbd27dd6`;
- `src/lib/props/capture-plan.ts` and `src/lib/server/props-tick.ts`: already on main since the Nov 13 snapshot (#183 and the capture fixes).

Recorded-file changes: `props-tick.yml`, `database/props/props_lab_v1.sql` (grant narrowing only, not applied), `config/research/registry.json`, `scheduler-kickoff.ts` and `vercel.json`.

After the owner approves the frozen-file change and merges, run `node --experimental-strip-types scripts/experiment-manifest.mjs snapshot docs/experiments/manifest-<date>.json` on main, and point `experiment-freeze-check.yml` at it.

## Hosted database readiness

Required before merge, in the active props project vfyzbliksooljxrlfadp:

1. Run database/props/checks/forward_studies_readiness.sql from this candidate's final head, read-only, and retain all rows.
2. Every row must be READY, including `shadow | props_predictions`, and `zz | OVERALL` must be READY.
3. If only study rows are MISSING, the unchanged database/props/forward_studies_setup.sql is the existing setup. It creates absent complete schemas and narrows study grants, and it refuses partial schemas. Applying it is a hosted migration and needs separate owner approval.
4. On the nine study tables, grant and RLS states (`SERVICE_ROLE_CAN_UPDATE_DELETE_OR_TRUNCATE`, `SERVICE_ROLE_CANNOT_READ/INSERT`, `ANON_OR_AUTHENTICATED_ACCESS`, `RLS_DISABLED`) are repaired by re-running that same bundle. `APPEND_ONLY_TRIGGER_MISSING`, `INSERT_GUARD_MISSING_OR_DISABLED`, `WRONG_KIND`, a sequence state, or any non-READY `shadow` row needs review, not an automatic workaround. Never edit grants, triggers or rows by hand.
5. Repeat the read-only SQL after any approved change. Permission denial does not establish missing tables.

## Owner release gate

1. Hosted readiness above: OVERALL = READY.
2. Final-head CI green on this candidate, then owner approval for this single candidate's merge into main. Approval for a draft or a code review is not release approval.
3. Merging starts the frozen NBA shadow inside the existing capture cycle and enables the scheduled and workflow_run study recording. Manual dispatch still defaults to preflight; the schedule is not disabled. Do not merge before the owner intends that forward start.
4. Immediately run Forward paper studies on main with preflight. Require mode = preflight, status = READY, the active props host and the merged workflow commit.
5. Confirm a later real record receipt and new pre-lock shadow rows before calling the study operational. Never fabricate or backfill missed forward predictions. Keep schema receipts, application preflight receipts and actual recording receipts distinct.

## Stock session ordering

This candidate touches no stock controller, worker, decision, release-gate, scheduler, Vercel or Kalshi files. The earlier review recommended merging after the supervised stock session. That session has still not happened. Nov 23 recorded `TARGETS`, but only main's `SHADOW_PLAN_ONLY` executes ran, and nothing has run on `release/stock-paper-orders` since Nov 10. The next session admitted by the registered weekly rule is Monday 2026-11-30. The one-time `initial` decision was used on 2026-10-30. To keep production unchanged on that day, do not merge or deploy this candidate between the 08:00 ET decision and the after-close mark on 2026-11-30.

## Rollback

No database change is made by this candidate. If deployed, code rollback is a reviewed revert. Preserve all stored evidence and negative findings; do not drop tables or rewrite balances. New legitimate forward records must remain auditable.
