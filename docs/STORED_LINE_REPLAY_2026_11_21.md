# Stored-line replay — November 21, 2026

The replay reads locally saved observations, original model forecasts and grade revisions. It makes zero provider or database requests and creates no entry, stake or settlement. Capturing new lines continues under the existing provider budget. Replaying a snapshot reuses its existing coverage.

## Run

Use a saved `ResearchRaw` JSON snapshot from the existing authorized `loadPropsResearch` reader:

```sh
node --experimental-strip-types --no-warnings scripts/props-watch-replay.ts --input snapshot.json
node --experimental-strip-types --no-warnings scripts/props-watch-replay.ts --input snapshot.json --as-of 2026-11-13T03:30:00Z
```

The default clock is the snapshot's declared `nowIso`. An explicit clock must fall between `windowStart` and `nowIso`; the program refuses a request outside that retained window. It reads a local file and prints JSON to stdout. Its input remains byte-identical. No live snapshot or production results are supplied by this change.

The input contains the existing `observations`, `predictions`, `results`, `picks` and `entryLegs` arrays, plus `nowIso` and `windowStart`. The file limit is 64 MiB and each array is bounded at 20,000 rows, matching the research reader's bound. Invalid shapes, duplicate database identities or ambiguous grade revisions fail with an explicit error instead of a partial result. Uncaptured games and missing forecasts are never synthesized.

## Receipt and chronology

The receipt binds the exact input bytes with SHA-256 and identifies the replay clock and Watch Only version. A hash establishes reproducibility; source authenticity and capture completeness require their separate original evidence.

- Original provider-update, database-receipt, forecast, lock and grade times remain visible. A forecast must be recorded at or after the line's actual database receipt and before lock. The prior display check used ingestion time instead; a synthetic counterexample could incorrectly count an earlier forecast as a win. The added regression now leaves that line visible but unscored. No affected live row is claimed.
- The shared research evaluator enforces the same receipt-time ordering for rankings and prospective scores. Synthetic regressions reproduced the same gap there. Original artifacts, parameters, registered sample minimums and review gates remain unchanged; earlier published findings are not rewritten.
- Each replay uses only the grade revision available at its selected clock. `gradeRevision` and `gradeOutcome` expose the selected observation/revision identity. A later correction changes the replayed result while preserving the original forecast and input file.
- Pending lines remain pending. Ties and DNP/postponement voids stay outside directional win rate. `gradeKinds` separates their counts while the existing display retains its combined tie/void label. Empty or entirely pending evidence has a null hit rate.
- The first saved exact line is frozen per platform. Both PrizePicks and Pick6 source rows remain visible, while overall accuracy counts the same player/event/stat/line once. Platform-specific totals deduplicate inside their own source. Later repeats cannot replace the first forecast with a more favorable probability.

The output includes all valid saved lines, unscored lines, per-platform totals and an existing-probability 60% subset. It provides source/exclusion counts and original IDs. It computes no financial return and changes no model, threshold, promotion gate, broker setting or stored ledger.

## Verification and release

```sh
node --experimental-strip-types --no-warnings --test scripts/props-watch-replay.test.mjs src/lib/props/watch-only.test.mjs src/lib/server/props-research-data.test.mjs src/lib/command/watch-only.test.mjs
```

The real CLI tests intercept fetch and both native HTTP transports before import. They verify zero network attempts, deterministic replay, unchanged input bytes, revision cutoffs, cross-platform and repeated-snapshot deduplication, pending/tie/void accounting, invalid input, remote-input refusal and bounds on the replay clock. Test records are synthetic. The existing props CI workflow runs the new replay tests alongside its grading, SQL and database-integration checks without production credentials.

This branch follows #206 and preserves the reviewed source heads. A reviewed merge is required before the display fix is deployed. This change applies no migration or hosted operation. Rollback is a code revert; no captured evidence or paper balances need rewriting. Existing research reports and negative findings remain unchanged.
