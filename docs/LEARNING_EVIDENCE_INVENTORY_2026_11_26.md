# Learning engine: experiments without an automatic evidence feed (2026-11-26)

Source: the engine evaluation archived at `research-data:learning-engine/runs/45889209252-1/` (main, 2026-11-26 20:11 UTC).
- Its `evidence` section reports 29 experiments, 20 active, 4 fed automatically and **16 owner-supplied only**.
- All three inputs (sports, stocks, weather) were `CONNECTED`.
- The 4 automatic experiments are:
  - `props-learn-v1-shadow` and `props-learn-v2-shadow`: ledger pairing;
  - `lab-weather-knyc-multisource-emos-v1`: weather scorecards;
  - `lab-stock-psychology-v1`: stock research ledger.

  All four are `INSUFFICIENT_DATA`.

Storing data is not the same as learning from it. An experiment counts as automatic below only if a producer writes evidence that the engine reads on its own.

Failed and rejected findings are preserved unchanged. They are terminal, and the engine reports but never advances them.
- Failed: `props-learn-v3-shadow`.
- Rejected: `daily-oc-losers5-v1`, `momentum-quality-paper-v1`, `berkshire-13f-top5-paper-v1`, `daily-reversal5-v1`, `daily-momentum5d-v1`, `daily-spy-trend50-v1`, `spy-tom-v1`, `lab-stock-v3-riskadj`.

## Inventory

| # | Experiment (status) | Evidence required | Producer | Exists? | Latest usable evidence | Blocker / next step |
| --- | --- | --- | --- | --- | --- | --- |
| 1–4 | `lab-sports-ablation-v1-{recalibration, role-minutes, matchup-rest, market}` (INSUFFICIENT_DATA) | Forward frozen predictions per ablation layer. Gate: ≥500 lines, 14 dates, 50 games. `market` also needs `props_market_views` | Forward lab tables `database/props/props_lab_v1.sql` plus scoring in `scripts/lab-sports-ablation.ts` | Retrospective only. The forward tables are not applied (`props-activation-preflight` checks for them) | Retrospective `research/lab_sports_ablation_20261112/report.json`. Seeded 2026-11-13 | **Owner:** apply `props_lab_v1.sql` (a migration; not done here). Then add a read-only forward scorer. `matchup-rest` keeps its recorded ~22.5% rest-label defect |
| 5 | `props-gap-shrink-v1` (RUNNING) | Prospective Brier against the live model on the same admitted lines | `scripts/props-research-snapshot.ts` → `evaluateGapChallenger` (props-research workflow) | **Yes** | Run 45861417224 (2026-11-26 16:43 UTC), which uploads `snapshot.json` as a 90-day artifact. That artifact could not be downloaded here (artifact storage host blocked) | **Eligible integration (authorized data).** Publish the snapshot's `challengers` block append-only to research-data, then add an engine reader similar to `stock-research.ts`. Stays NO_CLEAR_EFFECT / INSUFFICIENT_DATA below the gate |
| 6–9 | `lab-sports-challengers-v2-{side-asym, uncertainty, line-gap, all-new}` (RUNNING) | Prospective scoring from 2026-11-14 with frozen weights, on props ledger predictions and graded results | Spec and scorer `src/lib/lab/sports/challengers-v2.ts` (pre-registered in `035625f`) | Scorer yes; **no forward runner** | Retrospective fold results only (all NO_CLEAR_EFFECT) | **Eligible integration.** Run the frozen scorer inside `props-research-snapshot.ts` on the rows it already reads, then feed it the same way as #5. `side-asym` also covers audit item E2 ("More" overconfidence) |
| 10 | `lab-sports-injury-rotation` (INSUFFICIENT_DATA) | Licensed, timestamped pre-lock injury/rotation feed | None | **No** | None | **Owner:** select and authorize a licensed source. Nothing can be built on stored data |
| 11 | `qmom-disclosure-follower-v1` (INSUFFICIENT_DATA) | 26 forward weeks vs SPY | `analytics/research` → `summary.json candidates[]` (nightly research-collect) | **Yes** | `summary.json` (2026-11-26 11:02 UTC): 12 forward **sessions** since 2026-11-10, total −4.75%, `INSUFFICIENT FORWARD SAMPLE` | **Eligible integration.** Add a reader for `candidates[id].forward`. It must count weeks as the registry defines them, not sessions: either the producer emits graded weeks, or the reader reports sessions and stays INSUFFICIENT_DATA |
| 12–13 | `lab-stock-v3-mom-lowvol`, `lab-stock-v3-core-satellite` (RUNNING) | Weekly forward picks vs `stock-v2-weekly-1` and SPY | `analytics/stock_research_v3.py` | **No** (only in unmerged #165) | Retrospective only (recorded Holm p and holdout figures) | Merge or retire #165; owner decision. Until then they cannot advance |
| 14 | `lab-stock-holdrank10-wholeshare` (RUNNING) | 26 graded forward weeks | `summary.json labHoldrank10`, read by `src/lib/lab/engine/stock-research.ts` | Yes, but empty | `labHoldrank10.frozenRows = 0` and `forward = {}` on 2026-11-26. The reader correctly returns nothing | **Investigate the producer.** No forward pick has been frozen since registration on Nov 19 |
| 15–16 | `lab-props-opponent-rate`, `lab-props-low-minutes` (PROMISING, retrospective only) | Forward frozen predictions meeting the registered minimums | Retrospective evaluators `scripts/props-opponent-eval.ts`, `scripts/props-low-minutes-eval.ts` | **No forward producer** | Retrospective verdict QUALIFIES_FOR_FORWARD (2026-11-24) | Add a forward shadow scorer on the props ledger (same pattern as #5). PROMISING stays retrospective until then |

## Related observation (an automatic experiment)

`lab-stock-psychology-v1` is fed automatically, but its 10 variants all show:
- `latest_session` 2026-11-16;
- `weeks` 0;
- `pending` 1.

That is in `summary.json` as of 2026-11-26. No second weekly decision is visible for the week of Nov 23. The engine records exactly this (0/26 weeks). The producer's weekly cadence should be checked before anyone reads the count as progress.

## Integrations possible with already-authorized saved data (not implemented in this milestone)

1. `props-gap-shrink-v1` (#5): the snapshot already computes it.
2. `lab-sports-challengers-v2-*` (#6–9): the frozen scorer exists, and the snapshot already reads the rows.
3. `qmom-disclosure-follower-v1` (#11): `summary.json` already holds it, but sessions must not be converted into weeks.

Each one reports NO_CLEAR_EFFECT or INSUFFICIENT_DATA below its gate, and none can promote anything.

The other 10 need an owner action:
- a migration (4 ablation experiments);
- a licensed source (injury/rotation);
- a merge decision on #165 (2 stock v3 experiments);
- new forward producers (opponent-rate and low-minutes, 2 experiments);
- a producer investigation (holdrank10).
