# Independent cross-review — November 21, 2026

Research and validation review of the two open release chains. Evidence snapshot: 2026-11-21 (UTC), heads confirmed
via the GitHub REST API at review time. No merge, migration, collector dispatch, model, stake, schedule, STOP-state,
watcher or demo/live change was made. No provider request or credit was used.

| Chain | PR | Head (confirmed current) | Base |
|---|---|---|---|
| Archive repair | #203 | `2f83b395c7b6feae490e7a74f92da4630de1bb11` | `main` `1c6f05d` |
| Archive verification | #204 | `29b0a6890a71483f85701b80687a07e8bb5eb3b5` | #203 |
| Forward-study integration | #200 | `42fe0bcaec5d06f049f0943914a8cd99cca4aad4` | `main` `1c6f05d` |
| Reconciliation follow-up | #202 | `54311297cdf850c661c01523bbb3d209712c3975` | #200 |
| Read-only study preflight (reviewed in section 7) | #206 | `c6870b4a8795740536ca52bf1628a11352affdd4` | #202 |

## 1. #204 against #203

- **Net change is two files only:** `git diff 2f83b39 29b0a68` touches `.github/workflows/verify.yml` (+14) and
  `docs/SPORTSEDGE_INTEGRATION_BASELINE_2026_11_21.md` (+86).
  - Intermediate commit `44de7a6` carried GPT's own guard edit and a Python test. Merge `29b0a68` removed both.
  - `.github/scripts/research-data-branch.sh` and `scripts/data-branches.test.mjs` are byte-identical to #203.
- **New CI job `Data branch publication guards`:**
  - runs `node --test scripts/data-branches.test.mjs` only;
  - workflow permissions are `contents: read`, checkout has `persist-credentials: false`;
  - no `secrets.*`, no `npm ci`, no provider host.
  - The test's only token is the literal `test-only-not-a-token`, and its remotes are disposable local bare repositories.
- **Exact-head CI** (`29b0a68`, Verify run 44951725382). Every check run succeeded:
  - job 136990924015: 5/5 archive tests, including "lab stock forward ledger may append new frozen rows; rewriting or
    truncating an earlier row is refused";
  - job 136990924204: `Ran 430 tests … OK`;
  - job 136990923883: "Checked 56 responsive route/viewport combinations; 0 failures".
  - GPT's recorded counts are confirmed. Not re-run locally: no change or failure justified it. #203's own run
    showed the regression failing before the fix and passing after.
- **Append behaviour:** legitimate appends pass, while edits to or truncation of historical rows are refused.
  This is covered by that test against the real script and was not changed by #204.

## 2. #200 and #202 research-integrity review

All items were checked against source at the pinned heads.

- **Frozen calibrator.**
  - `research/props_monotone_cal_v1_20261120/fit.json`, `monotone-calibration.ts` and the pre-registration are
    byte-identical to #195 `c25e483` (blobs `74fb910`, `31dac03`, `ab693f9`).
  - I recomputed sha256 of `forward.monotone` independently. It equals the pinned `8b84007d…4a633`.
  - Training: 2024-25 and 2025-26 box scores (23,865 lines per stat), leakage check 880,704/0. Nothing from the
    forward period.
  - Baseline digest `4ca4be37…298be` equals the existing `baselineCanonicalSha256`. A mismatch on either digest
    blocks all shadow writes.
- **Exact baseline pairing.**
  - The shadow stores `baselinePredictionId`. `forward.ts` pairs to that exact row and counts a conflict instead of
    substituting another baseline when:
    - the baseline is absent;
    - its key or observation differs;
    - it is later than the shadow.
  - Shadow inputs come only from baseline rows newly inserted in the same run (`ON CONFLICT DO NOTHING` returns
    only new rows), so the shadow and its stored baseline use identical values.
- **Pre-lock, ties, duplicates.**
  - The application skips rows at or after lock, rows with a cutoff before `notBefore`, and rows with future inputs.
  - The database trigger `props_check_prediction` sets `predicted_at` from the DB clock and raises
    `PROPS_PREDICTION_AFTER_LOCK`.
  - `UNIQUE(observation_id, model_version)` plus ignore-duplicates means the first frozen row wins.
  - Tie mass is conserved exactly (`pTie` copied; the non-tie conditional is recalibrated).
  - Uncertain batch writes are never retried.
- **Baseline contamination.** Shadow rows share `props_predictions` with the existing learn shadows. Baseline
  research readers filter `model_version`, and pick paths read by prediction ID. No new contamination path.
- **Promotion gates unchanged.** `src/lib/props/promotion.ts`, `contract.ts` and `research/engine/registry.json` are
  identical to main.
  - The shadow registers with `REVIEW_GATE` minimums (500/14/50/100) and cannot promote.
  - The proxy-line arm stays separate.
- **#202 corporate actions.**
  - `reconcile()` calls `verify_archive()` before any calculation. It checks per-page hashes, page counts, terminal
    pagination and failed-chunk shape.
  - The derived `reconciliation.json` is byte-identical to #201 (`97b7477`).
  - The earlier audit docs only gained dated pointer notes; their original text and results are preserved.
  - Disputed RTX/COST cases are cited to primary filings without repairing vendor series.
  - The doc says plainly that it gives "no new qualifying strategy".
  - Stock execution, #102 and Nov 23 files are untouched by both PRs.
- **Local re-run on #202's tree (includes #200):**
  - 82/82 Node tests, covering the shadow, calibration, lab engine, penny, readiness and setup;
  - 40/40 Python tests (stock data audit plus corporate-action reconciliation and integrity).
  - Exact-head GitHub CI: #200 11 success, 3 intentional skips, Vercel success. #202 7/7 success, Vercel success.
  - No review threads.

No research-integrity blocker was found in #200 or #202.

## 3. Findings

| # | Severity | Finding | Evidence | Disposition |
|---|---|---|---|---|
| F1 | **High** (time-bound) | Production research archive is **not repaired**. Two failed runs; the week-48 lab freeze for the 2026-11-23 decision is not on `research-data`. | `research-data` ledger has only `decision_session 2026-11-16` (10 rows, frozen 2026-11-14T04:43Z). Runs 44867479053 and 44891899827 failed. | Source fix #203 is ready. Production stays failing until merge plus a successful publication receipt (section 5). |
| F2 | Medium | Neither acceptance check in #200 can see excess privileges: the runbook's existence query (step 2) and the app's `forwardStudyReadiness()` (GET `limit=1`). Main's `props_lab_v1.sql` revoked from `PUBLIC, anon, authenticated` but **not** `service_role`. Under Supabase default grants, `service_role` keeps `UPDATE/DELETE/TRUNCATE`, and `TRUNCATE` bypasses the append-only row triggers. | Local PostgreSQL 16, main schema plus default grants: `SET ROLE service_role; TRUNCATE props_lab_experiments CASCADE` succeeded and wiped a frozen row. After the unchanged #200 bundle (applied twice), privileges narrow to `SELECT, INSERT` on all nine tables. | **Unverified on the hosted project.** #200's bundle already fixes it. Fixed here by adding the read-only check `database/props/checks/forward_studies_readiness.sql`, which reports `NOT_READY` in that state and `READY` after the bundle (verified in 3 disposable scenarios). Not a #200 code defect; no source head changed. |
| F3 | Low | The Kalshi count can be misread: hosted receipts report **2** training pairs, the archive audit **3/30**. Both are correct at their own times. | Hosted tick `tick-2026-11-21T04:00` was read at 04:12:32Z. The third pair (target 11-20) only became valid when its CLINYC outcome was captured at 2026-11-21 06:21Z. | Correction notes appended to both Day 1 docs. The current figure is **3/30, 27 remaining, earliest admission target 2026-12-17**; the minimum is unchanged. |
| F4 | Low | The Day 1 audit said "Fixed in this PR" (D1) and recorded the week-48 gap as certain (E5). Both overstate. | Wording in `RESEARCH_BASELINE_AUDIT_2026_11_21.md`. | Correction note appended. Original text kept. |
| F5 | Info | Shared concurrency group: a pending dispatch in `research-data` can be displaced by a later queued run from another workflow in the group. | `concurrency: research-data` in 6 workflows. | The owner must confirm completion, not just dispatch (section 5). |

Production impact of this follow-up: none. It changes docs plus one read-only SQL file that nothing executes.
Rollback: revert the commit.

## 4. Release recommendations

**Archive chain (#203 → #204): READY FOR OWNER REVIEW.** Merge order:

1. Merge #203 into `main`.
2. Retarget #204 to `main`, confirm green and merge.
3. Retarget this follow-up to `main` and merge.

#204 is optional for the Monday deadline. Only #203 is needed for the collector to publish.

**Forward-study chain (#200 → #202 → #206): BLOCKED on owner database verification. No research-integrity or
code blocker; #206 PASS (section 7).** The release order is in section 6.

Do not merge #192, #195, #199 or #201 separately; they are imported. Keep this release after the Nov 23 session.

Database status from this review:

- **Confirmed present:** the six lab tables, per main-branch preflight 44950715831.
- **Unverified:** the four penny relations, and service-role privileges on all ten.
- This session has no access to the project, so nothing was queried and nothing is labelled absent.

## 5. Monday pre-open research freeze

`cmd_lab_forward` freezes picks for the next decision session after the last daily bar:
`last_bar = 2026-11-20` gives `decision_session = 2026-11-23`.

- **Collector schedules.** Both run Tue–Sat only: GitHub cron `17 2 * * 2-6` and Vercel `0 4 * * 2-6`. So nothing
  scheduled runs between now and Monday's open.
- **Why it can't be recovered later.** A Tuesday run sees `last_bar = 11-23` and freezes 11-30. `freeze()` never
  backfills, so the week-48 decision would be permanently unrecorded.
- **When to run.** Any successful run between now and **Mon 2026-11-23 14:30 UTC (7:30 AM MST)** gives a genuine
  pre-open freeze with `data_through = 2026-11-20`. A run on Sunday is as valid as Monday morning and leaves time to
  retry. Avoid the shared-group slots at :11/:17/:47 past the hour.

Owner sequence:

1. Merge #203.
2. Run **Research collect (nightly)** via `workflow_dispatch` on `main`.
3. Require all three receipts:
   - (a) the run concluded `success`;
   - (b) `research-data` has a new commit `collect <run_id>`;
   - (c) `lab/stock-forward-ledger.jsonl` on `research-data` has new rows with `decision_session` `2026-11-23`,
     `data_through` `2026-11-20`, and `frozen_at` earlier than `2026-11-23T14:30Z`, with the 10 earlier rows
     byte-unchanged.

Only then is production archive publication repaired. If (c) is missing at 14:30Z, record week 48 as missing; do not
backfill.

This research run reads market data only and is independent of the supervised stock session. The Nov 23 PAPER
session requirements, STOP controls and #102 are unchanged.

## 6. Consolidated owner actions and merge order (supersedes the earlier list)

**A. Archive chain: before Mon 2026-11-23 14:30 UTC (7:30 AM MST).**

1. Approve and merge #203 into `main`. This is the only merge the Monday freeze needs.
2. Dispatch **Research collect (nightly)** on `main`.
3. Require the three receipts in section 5.
4. When convenient, retarget #204 to `main` and merge it, then do the same for #205. Re-check CI after each retarget.

**B. Nov 23 supervised stock session.** Unchanged: follow the existing checklist, keep STOP controls, and leave #102
alone until its gate passes.

**C. Forward-study chain: after the Nov 23 session.**

1. In the SQL editor of `vfyzbliksooljxrlfadp`, run the read-only
   `database/props/checks/forward_studies_readiness.sql` and save the output. This is the only check that covers grants,
   RLS, append-only triggers and penny sequences.
2. Only if it is not `READY`, and with approval, apply the unchanged
   [pinned bundle](https://github.com/ang87505-crypto/SportsEdge/blob/42fe0bcaec5d06f049f0943914a8cd99cca4aad4/database/props/forward_studies_setup.sql).
   Re-run the check and require `OVERALL = READY`. A `PARTIAL_*` refusal means stop and review.
3. Land #200, #202 and #206 on `main` as **one** release. The recommended way is to:
   - merge #206 into #202's branch;
   - then #202 into #200's branch;
   - re-run CI on #200's final head, then merge #200.

   Why: the `Forward paper studies` workflow is not on `main` yet. #200 adds it with the old guard, under which a
   manual dispatch, the 17:37 UTC schedule and every successful capture all **record**. #206 is what makes manual
   dispatch default to preflight. Merging #200 alone would start recording before any preflight could run.
   Merging #200 also starts the monotone shadow on the next capture, which is the intended forward-test start.
4. Immediately dispatch **Forward paper studies** on `main` with the default **preflight**. Require
   `status = READY`, `mode = preflight`, the expected host and the merged commit.
5. Confirm the first scheduled or follow-up **record** receipt, then the first monotone-shadow rows on a later real
   capture. Only those future records count as forward evidence. Gates stay unchanged.

**D. Optional.** Decide E4 (one free NOAA request for certified Kalshi outcomes).

## 7. #206 review: read-only study preflight (PASS)

Head `c6870b4` was confirmed current. It is one commit on top of #202 and touches four files: the workflow, the CLI,
its test and the study doc. It changes nothing under `src/`.

| Check | Result | Evidence |
|---|---|---|
| Manual dispatch defaults to preflight; recording needs explicit `record` | **Pass** | Choice input with `default: preflight`. The preflight job runs on `mode == 'preflight' \|\| ''`, the record job on `mode == 'record'`. The test evaluates the actual `if:` expressions for 11 contexts. |
| Preflight is bounded GET only, covers all ten tables and columns, and cannot write | **Pass** | `--readiness-only` returns after `forwardStudyReadiness()`, which runs 10 `select=<cols>&limit=1` GETs with at most 3 bounded read retries each. Freeze, stake, settle and report tasks are in the record branch only. The test intercepts `fetch`: exactly the 10 tables, `GET`, no body, `limit=1`, no `labFreeze`/`pennyFreeze`/`pennySettle` keys. No promotion path exists in this script. |
| Bad arguments and the older database are refused before any request; access failures stay distinct | **Pass** | Any argument list other than `[]` or `['--readiness-only']` gives `INVALID_ARGUMENTS`, exit 2, zero calls. The host must equal `vfyzbliksooljxrlfadp.supabase.co` before `propsStore()`: `WRONG_PROJECT`, zero calls. HTTP 404 means `NOT_MIGRATED`. `42501`/401/403 mean `UNAVAILABLE`, with "Check access…" advice and no apply-the-migration advice. |
| Credentials only after tests, only on main, exact commit | **Pass** | Both hosted jobs `needs: test`. Secrets appear only in the step env of `preflight` and `record`, never in `test`. Preflight checks out `ref: ${{ github.sha }}` with `persist-credentials: false`. Both jobs require `github.ref == 'refs/heads/main'`. |
| Schedule and successful follow-ups keep recording; failed upstream, PRs and non-main branches run nothing | **Pass** | `schedule` and `workflow_run` success both record. Failure, cancelled, `pull_request` and non-main dispatch skip both jobs. The upstream workflows (`props-daily.yml`, `props-tick.yml`) have only `schedule` and `workflow_dispatch` triggers, so fork-PR runs cannot reach `workflow_run`. |
| A GET-only READY is described accurately, and the doc points to #205 | **Pass** | `FORWARD_PAPER_STUDIES_2026_11_19.md` says READY "proves the required table reads, not write privileges, a completed study run or qualifying forward evidence". It links the #205 SQL pinned at `0b8d2df` (correct path) as the separate grants/RLS/trigger/sequence check that must also pass before activation. |

**Exact-head CI** (`c6870b4`; every job log is for that SHA):

- `test` job 136996607104: `tests 24, pass 24, fail 0`, including the 8 new CLI and workflow cases.
- Python job 136996606841: `Ran 470 tests … OK`.
- Browser job 136996606866: "Checked 56 responsive route/viewport combinations; 0 failures".
- Lint/build, provider-contract, isolated build, replay and Vercel all succeeded.
- `Read-only study database preflight` and `record` were skipped on the PR, as intended.

All recorded figures are confirmed. Not re-run locally: no change or failure justified it.

**Non-blocking observations** (no change requested):

- (i) A select naming a missing *column* returns PostgreSQL `42703`, which is classified `UNAVAILABLE` ("check
  access") rather than `NOT_MIGRATED`. This is conservative, because it never recommends applying a migration on
  ambiguous evidence, but it labels a schema mismatch as an access issue. Read the per-table `code`.
- (ii) Pre-existing: the `record` job checks out `ref: main` while `test` ran on `github.sha`. If `main` moves in
  between, recording runs code that test did not cover. #206 did not introduce this and left it unchanged.
- (iii) The hosted preflight can only run on `main`, so it confirms readiness after release. The pre-merge gate is the
  #205 SQL check (step C1).

No defect requires a follow-up branch. Hosted privileges remain **unverified**.
