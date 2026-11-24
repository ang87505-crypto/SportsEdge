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
- The query now also requires each guard to be enabled (O or A), unconditional, BEFORE ROW INSERT, and bound to its function. The `props_append_only` trigger must be BEFORE ROW UPDATE and DELETE through `props_immutable()`, with no column list or WHEN clause.
- It adds a `shadow` row for `props_predictions`. That table's `props_prediction_chronology` lock guard and append-only trigger are what keep NBA shadow forecasts before lock. Its older props_v1 grants are displayed but not gated. Supabase's default grants may give service_role UPDATE/DELETE/TRUNCATE there, and that is a separate pre-existing review item; this candidate does not repair it.
- New disposable cases: disabled penny stake guard, disabled lab lock guard, disabled shadow lock guard, settlement guard bound to a no-op function, and a column-limited append-only trigger. All return NOT_READY. Re-enabled or restored guards return READY.

Unchanged by the review: the generated owner setup bundle, model artifacts, registered sample minimums, promotion gates, source schedules, budgets, stock session files, broker controls and Kalshi demo/live access. Frozen artifacts are byte-identical to #200 (`research/props_monotone_cal_v1_20261120`, calibrator digest `8b84007d37b9…`, baseline digest `4ca4be3779f1…`). There is no new strategy or new performance result.

Observations that do not block release:

- Lab/penny freezing now runs after a *successful* capture tick or grading cycle, or on the daily 17:37 UTC schedule. The old in-tick lab step ran even after a failed tick. Lines that lock within about 30 minutes of a failed tick may therefore miss a lab forecast. They are never backfilled. The NBA monotone shadow runs inside the capture cycle and is unaffected.
- The readiness query checks configuration, not guard function bodies. A hand-replaced function body with the same name would still pass. Do not edit study functions by hand.

GitHub checkout semantics: https://github.com/actions/checkout/tree/11bd71901bbe5b1630ceea73d27597364c9af683
Workflow context: https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
PostgreSQL trigger modes: https://www.postgresql.org/docs/current/catalog-pg-trigger.html

## Verification and limits

Synthetic and local results are recorded in the PR. They do not establish hosted readiness. The hosted active props project has not been inspected from this candidate. No hosted migration, preflight, study recording or source capture was performed. The SQL regression uses disposable synthetic databases only.

CI success is separate from operational readiness. The read-only SQL inspects schema configuration; it does not prove write success, an actual worker run, sufficient forward evidence, or model quality. The app's GET preflight proves required table/column reads only.

## Hosted database readiness

Required before merge, in the active props project vfyzbliksooljxrlfadp:

1. Run database/props/checks/forward_studies_readiness.sql from this candidate's final head, read-only, and retain all rows.
2. Every row must be READY, including `shadow | props_predictions`, and `zz | OVERALL` must be READY.
3. If only study rows are MISSING, the unchanged database/props/forward_studies_setup.sql is the existing setup. It creates absent complete schemas and narrows study grants, and it refuses partial schemas. Applying it is a hosted migration and needs separate owner approval.
4. On the nine study tables, grant and RLS states (`SERVICE_ROLE_CAN_UPDATE_DELETE_OR_TRUNCATE`, `SERVICE_ROLE_CANNOT_READ/INSERT`, `ANON_OR_AUTHENTICATED_ACCESS`, `RLS_DISABLED`) are repaired by re-running that same bundle. `APPEND_ONLY_TRIGGER_MISSING`, `INSERT_GUARD_TRIGGER_MISSING`, `WRONG_KIND`, a sequence state, or any non-READY `shadow` row needs review, not an automatic workaround. Never edit grants, triggers or rows by hand.
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
