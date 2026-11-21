# NBA props challenger `props-nb-monotone-cal-v1`: results (2026-11-20)

**Verdict: `QUALIFIES_FOR_FORWARD_TEST`.**
- All eight pre-registered requirements (R0–R7) hold on the untouched 2023-24 season.
- This admits the frozen forward calibrator to prospective evaluation, and nothing more. Nothing is promoted, and the
  production model, picks, stakes, bankrolls, risk limits and promotion gates are unchanged.
- The evidence is **retrospective, on proxy lines**. It shows better probability quality on a season the challenger never
  saw. It does **not** show profitable picks.
- The forward arm has 4 games so far and is `INSUFFICIENT_EVIDENCE`.

Rules: `docs/PROPS_CHALLENGER_MONOTONE_CAL_PREREG_2026_11_20.md` and `research/props_monotone_cal_v1_20261120/protocol.json`.

## Order of work (git history on this branch)

| Step | Commit (UTC) | What |
|---|---|---|
| 1 | `aa6cfea` 21:20:30 | Pre-registration: rules, hashes, requirements, frozen algorithm and its unit tests. No 2021-24 line had been scored. |
| 2 | `aa3c514` | Evaluation implementation and tests, plus the exploratory 2025-26 diagnostics (an already-inspected season). No fit, no holdout run. |
| 3 | `98a94de` 21:24:59 | Frozen fit: retrospective calibrator from 2022-23, forward calibrator from 2025-26. The holdout was still unscored. |
| 4 | this commit | One holdout evaluation (`report.json`), one forward run (`forward-report.json`), this document |

**Reproducibility.**
- A second run of `fit` and of `evaluate` produced byte-identical `fit.json` and `report.json`.
- Leakage violations were 0 in every run:
  - training: 872,898 checks;
  - forward training: 880,704;
  - holdout: 900,783;
  - forward window: 1,175.
- The holdout has 0 pushes, because every proxy line is a half-point line.

## Audit of the stated findings

| Finding | Source | Verified value |
|---|---|---|
| 80%+ predicted 86.7%, observed 71.9% | PR #191 `research/props_availability_v1_20261119/report.json`, baseline P(more) band 0.80–1.00, **proxy lines** 2026-10-25 to 2026-11-19 | 270 lines: 0.8670 predicted, 0.7185 observed |
| Brier 0.2493 vs 0.2500 on 543 lines | `research-data` `learning-engine/runs/44635571701-1/report.json`, **real graded lines** | 0.249276 on 543 lines |
| Earlier challengers not reliably better | registry and challenger reports (see the pre-registration) | Yes: NO_CLEAR_EFFECT, no improvement or insufficient evidence |

The two figures come from different samples (proxy vs real lines) and are not directly comparable.

## Holdout results: 2023-24, untouched

70,341 proxy lines in 1,189 games (2023-10-30 to 2024-04-14). The baseline is the production algorithm with 2022-23
parameters (backtest design). Intervals are 95% from a paired bootstrap of whole games (2,000 replicates, seed
20261121). All scores are binary on P(more).

| | Baseline | Tested single-slope recal | **Challenger** |
|---|---:|---:|---:|
| Brier | 0.238450 | 0.236490 | **0.235791** |
| Log loss | 0.672505 | 0.665521 | **0.663821** |
| ECE (10 bins) | 0.02285 | 0.01435 | **0.00525** |
| Calibration-in-the-large | +0.0191 | +0.0007 | +0.0006 |
| Murphy reliability / resolution | 0.00287 / 0.01200 | 0.00070 / 0.01160 | 0.00015 / 0.01177 |
| AUC | 0.62590 | 0.62487 | 0.62577 |
| SD of P(more) | 0.1455 | 0.1113 | 0.1137 |

| Comparison (difference, 95% interval) | Brier | Log loss | ECE |
|---|---|---|---|
| **Challenger − baseline (primary)** | **−0.00266** [−0.00308, −0.00224] | −0.00868 [−0.01000, −0.00744] | −0.01760 [−0.02131, −0.01329] |
| Tested recal − baseline (reference) | −0.00196 [−0.00236, −0.00155] | −0.00698 [−0.00807, −0.00587] | −0.00850 [−0.01469, −0.00464] |
| Challenger − tested recal | −0.00070 [−0.00087, −0.00054] | −0.00170 [−0.00211, −0.00130] | −0.00909 [−0.01194, −0.00346] |

**High-confidence lines.** These are fixed sets, chosen by the baseline's own confidence.

| Baseline confidence | Lines (games) | Baseline hit rate | Baseline Brier | Challenger Brier | Difference [95%] |
|---|---|---:|---:|---:|---|
| ≥ 0.70 | 12,107 (1,188) | 0.695 | 0.22051 | 0.20771 | −0.0128 [−0.0149, −0.0108] |
| ≥ 0.80 | 2,852 (1,044) | 0.711 | 0.23373 | 0.19611 | −0.0376 [−0.0440, −0.0314] |
| ≥ 0.90 | 703 (498) | 0.654 | 0.30608 | 0.22348 | −0.0826 [−0.0999, −0.0659] |

**Subgroups.** Brier difference, challenger minus baseline:

| Subgroup | Lines | Difference [95%] |
|---|---:|---|
| More (baseline P ≥ 0.5) | 26,425 | −0.00718 [−0.00831, −0.00613] |
| Less | 43,916 | +0.00006 [−0.00006, +0.00017] (no change) |
| Points | 23,447 | −0.00612 [−0.00706, −0.00515] |
| Rebounds | 23,447 | −0.00122 [−0.00165, −0.00077] |
| Assists | 23,447 | −0.00065 [−0.00098, −0.00031] |

**Confidence bands** (each model by its own forecasts; confidence → hit rate):

| Band | Baseline More | Challenger More | Baseline Less | Challenger Less |
|---|---|---|---|---|
| 0.50–0.60 | 0.544 → 0.537 (14,125) | 0.546 → 0.549 (19,605) | 0.551 → 0.549 (20,238) | 0.550 → 0.551 (21,830) |
| 0.60–0.70 | 0.644 → 0.574 (7,264) | 0.644 → 0.620 (5,365) | 0.645 → 0.646 (16,607) | 0.645 → 0.641 (15,317) |
| 0.70–0.80 | 0.743 → 0.620 (3,183) | 0.731 → 0.674 (482) | 0.739 → 0.727 (6,072) | 0.735 → 0.729 (7,025) |
| 0.80–0.90 | 0.843 → 0.635 (1,189) | none | 0.830 → 0.848 (960) | 0.821 → 0.858 (716) |
| 0.90+ | 0.938 → 0.640 (664) | none | 0.916 → 0.897 (39) | 1 line |

| Requirement | Result |
|---|---|
| R0 data | 70,341 lines / 1,189 games; 23,254 training lines per stat |
| R1 Brier upper < 0 | −0.00224 |
| R2 log loss upper < 0 | −0.00744 |
| R3 ECE upper < 0 | −0.01329 |
| R4 baseline ≥ 0.70 set, Brier upper < 0 | −0.0108 |
| R5 no subgroup lower > 0 | max lower bound −0.00006 (Less) |
| R6 compression | resolution 98.1% of baseline (≥ 80%); AUC −0.00014 (≥ −0.002); SD 78.1% (≥ 50%) |
| R7 below tested recal | −0.00070 |

## What this says

1. **The overconfidence is a shape problem.** In this season too, baseline More forecasts plateau: stated 0.74 / 0.84 /
   0.94 hit 0.62 / 0.635 / 0.64. Less forecasts are calibrated. The monotone map learned that plateau from 2022-23, and
   it held on 2023-24.
2. **It beats the tested linear recalibration,** a modest but clear −0.0007 Brier and about half the remaining ECE.
   Recalibration of either kind beats the raw baseline.
3. **Strong forecasts that were genuinely strong survive.** Less 0.80+ forecasts stay, and hit 85.8%. More forecasts
   above about 0.75 disappear because baseline More forecasts at 0.80+ hit only 63.5–64.0% in the holdout. Both training
   fits showed the same plateau: the 2022-23 points map takes stated 0.77–0.93 to 0.655–0.664. Ranking is kept (AUC unchanged); the probabilities are only made truthful.
4. **Remaining miscalibration is small:**
   - challenger More 0.70–0.80 is still 5.7 points high (482 lines);
   - Less 0.80–0.90 is 3.6 points *under*-confident.

## Forward arm (prospective)

| | |
|---|---|
| Calibrator | `fit.json → forward`, fit on 2025-26 only, digest `8b84007d37b9…4a633`, frozen at `98a94de` before any forward outcome was opened |
| Window | 2026-27 games from 2026-11-19T12:00Z, production artifact `src/data/props/model_v1.json` exactly |
| Now | 246 lines, 4 games (`player_box_2027.csv` sha256 `0cf1a388…5198`) → **INSUFFICIENT_EVIDENCE**. No forward metric is reported below the minimum. |
| Sufficient at | ≥ 150 games and ≥ 5,000 lines: about three weeks of the regular schedule (around 2026-12-10) |

Re-run as games accrue (the live file grows; each run records its hash):

```bash
node --experimental-strip-types scripts/props-monotone-cal-eval.ts forward --season player_box_2027.csv --fit research/props_monotone_cal_v1_20261120/fit.json --out <dir>
```

## Known limitations

- **Proxy lines** (floor of the last-10 median + 0.5) measure probability quality. Real platform lines are set by the
  market and are harder; the More weakness was first seen there.
  - Nothing here supports a profitability claim.
  - Hit rates on proxy lines are not platform win rates.
- **One untouched season, three seasons old.** The baseline parameters there come from 2022-23, not `model_v1.json`.
  League scoring changed over these seasons. The forward arm tests transfer to the current season and artifact.
- **The calibrator sees only the baseline P(more) and the stat.** It does not add information (injuries, rotation); it
  re-labels confidence. Errors driven by unseen information remain.
- **Selection interaction.** Under the challenger, few More lines would exceed the current pick thresholds. This matches
  observed hit rates, but it would change which picks qualify. Any use in selection or staking is a separate owner
  decision.
- **One season of training per arm;** the calibration shape can drift. The two independent fits (2022-23 and 2025-26)
  produced similar shapes.

## Integration instructions for Codex (do not activate)

Nothing in this PR is wired into the worker, database, registry or UI. Suggested shadow-only integration, if the owner
approves:

1. **Compute alongside production, never instead of it.**
   - **Input:** for each scored line, take `q = pMore / (pMore + pLess)` from the unchanged production prediction.
   - **Map:** `calibrate(fit.forward.monotone, stat, q)` from `src/lib/props/monotone-calibration.ts`. Before use,
     verify `calibrationDigest(fit.forward.monotone) === fit.forward.digest`.
   - **Integer lines:** keep the baseline `pTie` and store `pMore' = q'(1 − pTie)` and `pLess' = (1 − q')(1 − pTie)`.
2. **Record** it as a separate model id, `props-nb-monotone-cal-v1`, in a challenger/shadow ledger. Store the pre-lock
   timestamp and the calibrator digest. It must not occupy a production shadow slot without the owner's decision, and must
   not feed selection, staking, bankrolls or entries.
3. **Registry.**
   - Hypothesis key: `sports:monotone-nonparametric-recalibration` (no existing entry uses it).
   - Status: retrospective evidence maps to at most `PROMISING`. `READY_FOR_REVIEW` still needs the existing real-line
     forward gate (500 graded lines, 14 dates, 50 games).
   - The registry and engine are not edited here.
4. **Evaluate real lines** with the existing paired evaluator against production on the same lines. Keep it separate
   from the proxy-line forward arm above, and never mix binary scores with the tie-aware multiclass scores.
5. **Leave unchanged:** `src/data/props/model_v1.json`, the selection rule, risk limits, paper bankrolls and promotion
   gates.

## Reproduce

Download the pinned files from
`https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_player_boxscores/<file>`. The script
refuses any file whose SHA-256 differs from `protocol.json`.

```bash
node --experimental-strip-types scripts/props-monotone-cal-eval.ts fit --retro-prior player_box_2022.csv --retro-training player_box_2023.csv --forward-prior player_box_2025.csv --forward-training player_box_2026.csv --out research/props_monotone_cal_v1_20261120
```

```bash
node --experimental-strip-types scripts/props-monotone-cal-eval.ts evaluate --prior player_box_2023.csv --holdout player_box_2024.csv --fit research/props_monotone_cal_v1_20261120/fit.json --out research/props_monotone_cal_v1_20261120
```

```bash
node --experimental-strip-types scripts/props-monotone-cal-eval.ts diagnose --prior player_box_2025.csv --training player_box_2026.csv --out research/props_monotone_cal_v1_20261120
```

Tests:

```bash
node --experimental-strip-types --test src/lib/props/monotone-calibration.test.mjs src/lib/props/calibration-eval.test.mjs scripts/lib/props-season-score.test.mjs
```

## Data blockers

- **Forward evidence:** 4 games so far; about three more weeks are needed for the proxy-line forward minimum.
- **Real platform lines:** graded lines live in the props database, which Codex owns; this PR does not read it. The live
  sample (543 lines, 20 games) is far below the review gate.
- **Pre-game injury reports:** still not collected. NBA terms exclude gambling and fantasy use (see PR #191). The
  calibrator cannot fix errors that come from that missing information.
