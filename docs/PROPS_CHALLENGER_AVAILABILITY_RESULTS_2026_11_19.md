# NBA props challenger `props-nb-availability-v1`: results (2026-11-19)

**Verdict: `NO_CLEAR_EFFECT`.**
- The point estimates favour the challenger, but both 95% intervals cross zero. Nothing is promoted.
- The training fit also weakens the premise: recently absent players were *not* more uncertain than everyone else.
- The overconfidence this study set out to target is real, but it is general, not availability-specific (see What this
  says).

Rules: `docs/PROPS_CHALLENGER_AVAILABILITY_PREREG_2026_11_19.md` and `research/props_availability_v1_20261119/protocol.json`.

## Order of work, all in git history

| Step | Commit | What |
|---|---|---|
| 1 | `9c02129` | Pre-registration: rules, data hashes, decision rule, injury-report access decision. Nothing had been fit or scored. |
| 2 | `54047f4` | Implementation and unit tests; no run |
| 3 | `14c8dc1` | Fit on 2025-26 only (`fit.json`) committed **before** the holdout was scored |
| 4 | this commit | One holdout evaluation (`report.json`), results and registry proposal |

**Reproduce:**
1. Download the three pinned files listed in the protocol.
2. Run these two commands:

```bash
node --experimental-strip-types scripts/props-availability-eval.ts fit --prior player_box_2025.csv --training player_box_2026.csv --out research/props_availability_v1_20261119
```

```bash
node --experimental-strip-types scripts/props-availability-eval.ts evaluate --holdout player_box_2027.csv --fit research/props_availability_v1_20261119/fit.json --out research/props_availability_v1_20261119
```

A second run of both steps produced byte-identical `fit.json` and `report.json`. Both runs found 0 leakage
violations:
- training: 1,956,216 inputs checked;
- holdout: 66,329 inputs checked.

The adjustment with m=1, s=0 reproduces the baseline probabilities to within 6.8e-6.

## Training fit (2025-26 only, 23,865 played player-games)

r = actual minutes ÷ baseline expected minutes. The extra spread is the spread beyond what the baseline already assumes.

| Category | Player-games | Mean r (`m`) | Extra spread (`s`) | Adjusted? |
|---|---:|---:|---:|---|
| RETURNING | 360 | 0.9881 | 0.1575 | yes |
| RECENT | 1,204 | 0.9758 | 0.1574 | yes |
| CLEAR | 18,306 | 0.9758 | **0.2500** | no (reference) |
| UNKNOWN | 3,995 | 0.9706 | 0.2541 | no (reference) |

**Before any holdout result, this already contradicted the premise.** Players back from a stated absence played close
to their expected minutes. Their extra spread was *smaller* than for everyone else. The baseline understates minutes
spread, and overstates expected minutes by about 1–3%, for **all** players.

**Exploratory split inside 2025-26** (fit through Jan 31, score Feb–Apr; previously inspected season, descriptive):
2,745 adjusted lines in 359 games, Brier +0.00038 [−0.00080, +0.00153]. No clear effect.

## Holdout: 2026-27 season (2026-10-20 to 2026-11-18 ET)

Lines are scored once a player has 3 earlier played games, so scored lines start in the season's first week. The report's
UTC dates run 2026-10-25 to 2026-11-19. 10,008 scored proxy lines in 180 games.

| Category | Lines | Games |
|---|---:|---:|
| RETURNING | 78 | 16 |
| RECENT | 261 | 48 |
| UNKNOWN (record incomplete; unchanged) | 1,227 | 142 |
| CLEAR (unchanged) | 8,442 | 180 |

**Primary: adjusted lines (RETURNING + RECENT), challenger minus baseline.** Paired bootstrap of whole games, 2,000
replicates, seed 20261120.

| | Baseline | Challenger | Difference [95% interval] |
|---|---:|---:|---|
| Brier | 0.24207 | 0.24088 | −0.00119 [−0.00356, +0.00101] |
| Log loss | | | −0.00248 [−0.00756, +0.00215] |

339 lines in 58 games, above the pre-registered minimum of 150 lines and 30 games. The upper bound is above zero, so the
pre-registered rule gives **NO_CLEAR_EFFECT**.

**Ablation and splits.** Descriptive; they cannot change the verdict, and there are many of them, so an isolated interval
that excludes zero is not evidence.

| Subset | Lines | Full | Mean-only | Variance-only |
|---|---:|---|---|---|
| Adjusted, all stats | 339 | −0.00119 [−0.00356, +0.00101] | −0.00054 [−0.00243, +0.00121] | −0.00072 [−0.00142, −0.00007] |
| RETURNING | 78 | −0.00115 [−0.00340, +0.00142] | −0.00055 | −0.00067 |
| RECENT | 261 | −0.00120 [−0.00416, +0.00163] | −0.00054 | −0.00074 |
| Points | 113 | −0.00317 [−0.00761, +0.00090] | −0.00184 | −0.00150 |
| Rebounds | 113 | −0.00144 [−0.00488, +0.00198] | −0.00065 | −0.00086 |
| Assists | 113 | **+0.00104** [−0.00217, +0.00439] | +0.00087 | +0.00018 |
| All 10,008 lines | 10,008 | −0.00004 [−0.00012, +0.00003] | −0.00002 | −0.00003 |

**Calibration on adjusted lines** (P(more), non-tie):

| | Mean P(more) | Observed more | Calibration-in-the-large | ECE |
|---|---:|---:|---:|---:|
| Baseline | 0.4501 | 0.4189 | +0.031 | 0.0591 |
| Challenger | 0.4326 | 0.4189 | +0.014 | 0.0624 |

- **In the large:** the challenger halves the over-prediction of *More* on these lines.
- **By bin:** calibration got slightly worse (ECE 0.0591 → 0.0624). With only 339 lines, both readings are noisy.

## What this says

1. **Availability from earlier box scores is not where the overconfidence lives.** The rule touches 3.4% of lines. On
   those lines the effect is small and uncertain, and on assists it points the wrong way.
2. **The overconfidence is general.** On all 10,008 holdout lines, the baseline's top bands are well above what happened:

   | Baseline band | Predicted | Observed |
   |---|---:|---:|
   | 0.65–0.80 | 0.709 | 0.601 |
   | 0.80+ | 0.867 | 0.719 |

   The live ledger shows the same direction on *More* picks. The training fit shows why: minutes spread is understated
   for every category (CLEAR players need s = 0.25), and expected minutes run 1–3% high.
3. **Lead, not tested.** A general minutes-spread and minutes-level correction, fit on training data, is the natural next
   hypothesis. It is *not* claimed here:
   - It must be pre-registered on its own.
   - It must be checked against the already-tested global recalibration and minutes-uncertainty shrinkage.
   - It must be scored on games after 2026-11-18. This holdout has now been seen.
4. **The pre-game injury signal stays unknown.** The NBA's official injury report is the right signal for tonight's
   availability, including teammates' absences, which drive the minutes surges behind missed *Less* picks. Its terms
   exclude gambling and fantasy use, so it is not collected (see the rules document). Using it would need written
   permission or a licensed feed: an owner decision.

## Learning registry: proposal only

`research/props_availability_v1_20261119/registry-proposal.json` and `registry-result.json` hold the entry and its
result in the learning engine's formats:
- the hypothesis key is `sports:recent-stated-absence-availability`, which no tested or rejected idea uses;
- the result maps to `RUNNING`, retrospective and never promotion.

A unit test checks that the entry registers cleanly against the current seed. They are **not applied**: the shared
registry and engine are left to their owner.

## Limits

- **Holdout:** four weeks, early season, where players have few games of history.
- **Lines:** proxy lines, not PrizePicks lines, so this measures probability quality, not returns.
- **Coverage:** only players who played are scored, because platforms void DNPs.
- **Data:** the reason text is ESPN box-score wording from earlier games, and absent players may be unlisted, which is
  treated as unknown. The training data is one season.
- **This holdout is now used.** Any follow-up needs later games.

A neutral or favourable point estimate on proxy lines is not evidence of profitable picks.
