# SportsEdge integration baseline — November 21, 2026

Evidence snapshot: 2026-11-21T21:24:02.817Z. User-facing date: Saturday, November 21 (Mountain time).

## Decision

Integration audit completed. Keep the release held: the existing hosted lab is present, but the complete new forward-study readiness check is unverified, previews have no study database connection, and production research collection is failing at archive publication. No merge, migration, release flag, model, stake, schedule, credential or trading control was changed by this audit.

## Pinned integration matrix

| Component | Pinned state | Verified evidence | Remaining acceptance |
|---|---|---|---|
| Production main | `1c6f05d94899e3d34f5a3a0cc7ff0c6b997f5f56` (#197) | Vercel production READY; live `/api/version` returns this exact SHA and `production` | Operational warnings below prevent a blanket healthy verdict |
| Draft #200 | `42fe0bcaec5d06f049f0943914a8cd99cca4aad4`, based on main | 11 successful check runs, 3 intentional main-only skips; Vercel success; preview version matches; no inline review threads | Verify all ten study relations and service-role access in the active database, then owner release approval |
| Draft #202 | `54311297cdf850c661c01523bbb3d209712c3975`, targets #200 | All 7 check runs successful; Vercel success; preview version matches; no inline review threads | Review as a stacked follow-up, preserving #200's source pin |
| #200 source dependencies | #192 `30db05c21d92903ae1ceb4ed472d2b58c417662e`; #195 `c25e4838c426ee55f72c5dda620871a94614a172`; #199 `1b97cfd4ffb5688ab5d40f5de4095ebbb696fac4` | Source pins and changed-file lists match the integration runbook | These are overlapping source branches; do not merge them independently as additional copies of the integrated work |
| #202 source dependency | #201 `aa9ef7016a3b4ff2e1b9cbaae37edc7cf099f574` | Reconciliation follow-up retains the earlier immutable findings; shadow-writer blob is identical to #200 | Research validity belongs to Claude's independent review |
| Existing NBA lab | Six lab relations present in `vfyzbliksooljxrlfadp` | Today's main-branch read-only preflight reports schema APPLIED, 864 predictions, 96 flags, 15 stakes, zero tampered forecasts | This preflight does not inspect the four new penny relations or prove new shadow privileges |
| New forward/penny studies | Setup bundle blob `47ca8f5964a0db7fdcfb0ef17da8bafa9a61cb05`, identical in #192 and #200 | Disposable PostgreSQL CI passes complete setup, privileges, penny accounting and new shadow writer | Hosted penny relations and permissions remain unverified. Both previews display 'Not connected in this deployment' |
| Kalshi scheduled platform | Production #197 | Stored receipt `tick-2026-11-21T04:00` completed 04:04:38 UTC / 9:04:38 PM MST Nov 20 | Last recorded read at 04:12:32 UTC: 2 training pairs, demo STOPPED, 0 attempts. This is timestamped evidence, not a fresh owner-account read |
| Stock supervised release | Draft #102 `9e23e6305eb04bc20ea7e393bd2c49da4bd2a811` | Monitor still reports the first-session requirement | Nov 23 owner-supervised paper session, reconciled fills, Stop/Start and same-session close evidence; expired prior watcher is not renewed |

## Production job findings

1. **Research archive publication fails.** Run [44891899827](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44891899827) passed 100 synthetic research tests and completed source collection and forward calculations, then failed with `APPEND_ONLY_VIOLATION: lab/stock-forward-ledger.jsonl`. The earlier manual run [44867479053](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44867479053) also failed. A successful computation does not mean those records were published.
2. **The producer really appends.** `analytics/research/cli.py`, `cmd_lab_forward`, opens that ledger in append mode and writes newly frozen rows. The archive helper omitted this one file from both its modification allowlist and its byte-prefix checks. This audit adds it to both lists. Prior bytes still must match exactly and truncation still fails; snapshots remain immutable.
3. **The release watcher expired safely.** Run [44881513105](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44881513105) reports props #99 ALREADY_MERGED, stock #102 EXPIRED_REVIEW_REQUIRED, then its retirement job succeeded. The terminal failure is an approval-window boundary, not evidence of a failed broker order. Do not extend the window or reactivate the watcher as a routine repair.
4. **Monitor success is not an all-clear.** The [21:08 UTC monitor](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44949931746) reports ATTENTION: props research MISSED_SLOT, capture tick MISSED_SLOT, learning RAN_LATE, research collector FAILING, research evaluation PENDING_FIRST_RUN, release watcher RETIRED, plus a SEC source problem and the missing supervised stock session. The later 21:17 UTC preflight and capture run completed, but do not retroactively erase missed slots.
5. **QMOM input quality needs research review.** The failed nightly collector's source step reported QMOM PARSE_FAILED, SEC OK and zero new filings. The archive repair does not claim to repair the QMOM parser or validate a strategy.

## Frozen NBA and budget baseline

The [read-only preflight](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44950715831) was generated at `2026-11-21T21:17:13.905Z` against the expected active props project. It reports:

- Existing props control RUNNING, unchanged by this audit. No duplicated run slots, duplicate capture claims/plans, claims without an outcome, entry-cap breaches or tampered lab forecasts.
- Budget v2 active: 7 credits per rolling day, 200 per 30 days, provider reserve floor 60. Current recorded usage 6/day and 77/30 days. Last provider balance 428. Provider-actual accounting column exists but v3 is not active.
- Last completed settlement `2026-11-21T16:29:03.770189Z`. Site budget answer agrees with the ledger.
- Known-payout PrizePicks virtual account: 22 settled entries, 7 wins / 15 losses, $110 staked, -$5 net, $495 remaining from $500. Eleven unknown-payout Pick6 entries are excluded from profit/ROI.
- Raw pick audit: 110 hits / 189 graded picks, 6 pending. The separate deduplicated calibration view is 85/144 selected graded lines (59.03%), average confidence 65.01%; these populations must not be pooled.
- Deduplicated line audit: 670 unique lines, 618 graded, 21 ties, 7 void/DNP, 24 ungraded. No grade corrections reported.
- Learning v1: 503 paired observations, 10 dates, 18 games, 53 decisions. Learning v2: 250 observations, 5 dates, 9 games, 18 decisions. Both remain below registered forward requirements; nothing is promoted.

These are recorded observations for Claude's review, not newly qualifying models or a recommendation to change stakes.

## Access and setup boundary

The connected Supabase account lists older project `fzyjazhvkstvwwzjhlrr` as healthy and staging `mcaxfaaohyencpspalfe` as inactive. It does not list the active props project `vfyzbliksooljxrlfadp`; direct project lookup and a harmless SELECT both return INVALID_ARGUMENT. No database mutation was attempted, and the older project is not substituted.

Existing lab setup is now verified through trusted main-branch workflow evidence. The old blanket claim that the whole lab is absent is therefore stale. The four penny relations and the complete service-role readiness contract are still unknown. A preview rendering HTTP 200 without its configured database is not proof of hosted readiness.

Before a release, the owner should inspect all ten relations and intended service-role privileges on the active project. If the full bundle has not been installed, use the exact [#200 setup bundle](https://github.com/ang87505-crypto/SportsEdge/blob/42fe0bcaec5d06f049f0943914a8cd99cca4aad4/database/props/forward_studies_setup.sql). Run the reviewed ten-table readiness check and require READY. Preserve existing lab history.

## Verification

Independently read the existing final-head GitHub checks and job logs:

- [#200 PostgreSQL](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44863502688): 450 unit tests, all SQL suites including penny/privilege setup, 10 database integration tests and 7 provider-contract tests pass with zero skips/failures in those groups.
- [#202 Python](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44865936048): 470 tests pass.
- [#202 browser](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44865936019): 56 responsive route/viewport combinations, zero failures.
- Both preview `/lab` responses are HTTP 200; their penny panels explicitly say the deployment is not connected.
- Main has 154 check-run records in the inspected two-page snapshot: 116 success, 35 skipped, 3 failures. These include recurring operational runs and are not 154 independent regression tests. Do not describe production as all-green.

The archive repair adds seven meaningful local-Git integration tests: valid ledger append, changed historical prefix plus append, truncation, deletion, existing run-log append, immutable snapshot rewrite, and no-change replay. Each uses a disposable bare remote and synthetic rows. These tests are picked up by the existing deterministic Python CI suite. The current PR's exact-head check runs are the authority for this repair's execution results; there is no fresh local test claim because this session's executor is unavailable.

Reproduce the focused tests with `python -m unittest analytics.research.test_data_branch -v`. Run `python -m unittest discover -s analytics -p 'test_*.py' -v` for the existing full analytics gate. No provider requests or account credentials are needed for these tests.

## Release sequence and rollback

1. Independently review this narrow archive repair and its CI. After owner-approved merge, run the existing collector and require a real successful archive-push receipt. Do not replay lost data as if it was saved earlier. Freeze any new Monday research rows at their actual future capture time.
2. Verify the active ten-table study setup and intended privileges. Keep #200 and #202 draft until these checks and owner approval are complete.
3. Review #202 on top of the frozen #200 head. A release should combine/rebase the reviewed changes coherently and rerun affected checks; do not treat independent merges of overlapping source branches as required dependencies.
4. Verify the exact new production SHA and future worker receipts after any approved release. A no-eligible-entry result is valid; historical backfills cannot establish forward evidence.
5. Keep Kalshi demo/live activation separate. Keep stock #102 held for its supervised session and renewed owner review.

Rollback of this archive repair is a normal reviewed revert of the helper's two-line change. It does not remove historical records. Do not delete or rewrite the research-data branch or change production controls to hide an archive failure. Database/schema rollback is not applicable to this PR.

## Claude handoff

Keep research/model work separate from this archive repair. Use the pinned heads above and today's correctly scoped baseline counts. Review QMOM parsing, the SEC source issue, sport-specific model validity and the Kalshi training minimum. Preserve negative findings. This integration audit adds zero Odds API calls and dispatches no collection, broker, exchange or model-activation operation.
