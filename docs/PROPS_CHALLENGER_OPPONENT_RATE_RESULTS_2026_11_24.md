# NBA props challenger `props-nb-opponent-rate-v1`: results (2026-11-24)

**Verdict: `QUALIFIES_FOR_FORWARD_TEST`**, by the frozen rule in
`docs/PROPS_CHALLENGER_OPPONENT_RATE_PREREG_2026_11_24.md`.

**The effect is real but small.** It is about **7× smaller** than the production review gate's required Brier
improvement on real lines (upper 95% ≤ −0.002). Nothing is promoted, and production predictions stay frozen.

## Provenance

| Item | Value |
|---|---|
| Pre-registration | Commit `042c295` at 20:59:05 UTC, before any 2016-17 to 2020-21 line was scored |
| Evaluation | `scripts/props-opponent-eval.ts`, one run after that commit, local, no network |
| Inputs | SportsDataverse `player_box_2017.csv` to `player_box_2021.csv`, every SHA-256 matching the protocol |
| Leakage | 0 violations in all fit and test seasons |
| Result file | `research/props_opponent_rate_v1_20261124/results.json` |

## Results: untouched seasons, chronological folds, proxy lines

| Test season | beta (points / rebounds / assists), fit on the previous season only | Lines | Paired Brier diff (95% CI) | Log-loss diff (95% CI) |
|---|---|---|---|---|
| 2018-19 | 0.6 / 0.5 / 0.7 | 70,983 | −0.000242 (−0.000361, −0.000125) | −0.00052 (−0.00078, −0.00026) |
| 2019-20 | 0.8 / 0.5 / 0.6 | 59,262 | −0.000331 (−0.000478, −0.000187) | −0.00071 (−0.00100, −0.00040) |
| 2020-21 | 0.7 / 0.5 / 0.7 | 61,362 | −0.000361 (−0.000508, −0.000213) | −0.00076 (−0.00108, −0.00045) |
| **Pooled** | per fold | **191,607 (3,231 games)** | **−0.000308 (−0.000384, −0.000229)** | **−0.00066 (−0.00083, −0.00049)** |

**Rule check:**
- pooled Brier upper bound < 0: **yes**;
- every season's mean < 0: **yes**;
- pooled log loss < 0: **yes**.

So the verdict is `QUALIFIES_FOR_FORWARD_TEST`.

**Descriptive results (not part of the rule):**
- **It removes what it targets.** The residual-versus-opponent slope fell from 0.34 / 0.36 / 0.39 (all 95% CIs above
  0) to 0.00 / 0.01 / 0.04 (all CIs spanning 0).
- **Per stat:** 8 of 9 season-by-stat Brier intervals lie below 0. The ninth (2020-21 assists, −0.000156, CI to
  +0.0001) points the same way.
- **The fitted betas are stable** across folds (0.5–0.8), roughly half of a full proportional adjustment. That is
  consistent with opponent factors being noisy, season-to-date estimates.
- **Practical size:**
  - baseline Brier is 0.2374, so the improvement is about 0.13%;
  - chosen-side hit rate rises by about 0.1 point (59.72% → 59.82% in 2018-19);
  - the overall calibration gap barely moves (2.39 → 2.34 points), because the main overconfidence is a separate
    issue, handled by the frozen calibrator.

## Disclosure: related existing ideas

The pre-registration did not mention these. They change no rule, but they matter for interpretation.

- **`lab-sports-ablation-v1-matchup-rest`** (`INSUFFICIENT_DATA`) uses a similar opponent allowed-ratio feature
  (`src/lib/props/features.ts`: last 15 games, at least 5), combined with home and rest terms. It was never evaluated
  forward because the lab tables are not applied.
- **The learned layer `props-learn-v1-shadow`** (`NO_CLEAR_EFFECT`) also uses matchup features.
- **This study is narrower:**
  - opponent only;
  - season-to-date factors needing at least 10 earlier games;
  - one fitted exponent per stat;
  - validated chronologically on seasons no props study had touched.
  
  It supports the opponent part of those ideas. It says nothing about home or rest.

## What this means

1. **The opponent weakness is real and consistent.** It appears in three exploratory seasons and three untouched
   seasons, for every stat. The model does lose information by ignoring the opponent.
2. **It is not enough to change production on its own.** The improvement (−0.0003 Brier) is far below the
   production `REVIEW_GATE` threshold (−0.002 upper 95% on real lines). On real platform lines, which are sharper
   than proxy lines, the edge may be smaller still.
3. **Recommended next step (owner decision):**
   - record this challenger as a forward **shadow** next to the frozen monotone shadow (#208), on real lines,
     judged by the unchanged gate;
   - or combine it with the separately evidenced low-minutes bias in one new pre-registered challenger.
   
   Either way it needs a new registration. The frozen monotone calibrator was fit on baseline probabilities, so a
   combined model would need its own calibration study.

## Learning registry

`lab-props-opponent-rate` has this history: `PROPOSED` (pre-registration) → `RUNNING` → `PROMISING`.
- **The evidence is retrospective only.** No forward predictions are recorded for it, because no production path
  exists.
- It can reach `READY_FOR_REVIEW` only from forward evidence that meets the registered minimums, and the engine never
  promotes.

## Limits

- Proxy lines, not sportsbook or platform lines.
- 2019-20 includes the bubble restart; 2020-21 was shortened.
- No injury or rest data.
- One historical path per season.

A historical pass is not evidence of profit.
