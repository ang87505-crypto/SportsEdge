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

**Forward-study chain (#200 → #202): BLOCKED on owner database verification. No research-integrity blocker.**

1. In project `vfyzbliksooljxrlfadp`, run `database/props/checks/forward_studies_readiness.sql` (read-only) and save
   the output.
2. If not `READY`, apply the unchanged
   [pinned bundle](https://github.com/ang87505-crypto/SportsEdge/blob/42fe0bcaec5d06f049f0943914a8cd99cca4aad4/database/props/forward_studies_setup.sql),
   then re-run the check and require `OVERALL = READY`. A `PARTIAL_*` refusal means stop and review.
3. Owner approval, then merge #200.
4. Retarget #202 to `main`, re-run CI, then merge.
5. Dispatch **Forward paper studies** on `main` and require `readiness.state = READY`.

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

## 6. Owner actions

1. Approve and merge #203, then dispatch Research collect on `main` and check the three receipts before
   Mon 14:30 UTC.
2. Run the read-only readiness SQL on `vfyzbliksooljxrlfadp`. Apply the pinned bundle only if needed and only with
   approval, then require `READY` before releasing #200 → #202.
3. Run the Nov 23 supervised stock session per the existing checklist (unchanged).
4. Optionally decide E4 (one free NOAA request for certified Kalshi outcomes).
