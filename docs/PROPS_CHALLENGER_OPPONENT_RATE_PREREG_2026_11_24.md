# NBA props challenger `props-nb-opponent-rate-v1`: error breakdown and pre-registration (2026-11-24)

**Written and committed before any 2016-17 to 2020-21 props line was scored by any study.** The breakdown below uses
only seasons earlier studies already inspected (2023-24 to 2025-26); it motivates the hypothesis and is not evidence.
The protocol (`research/props_opponent_rate_v1_20261124/protocol.json`) fixes the sources, folds, parameter grid,
uncertainty method and decision rule. Results go in a separate document, whatever they are.

**Research only.** Production predictions (`props-nb-minutes-rate-v1`, `src/data/props/model_v1.json`) stay frozen.
The frozen monotone calibrator (#208), the promotion `REVIEW_GATE`, sample minimums, budgets and schedules are
unchanged. No provider request or odds credit is used: inputs are public SportsDataverse ESPN box scores (CC BY 4.0),
pinned by SHA-256.

## 1. Error breakdown (exploratory; `research/props_opponent_rate_v1_20261124/breakdown-exploratory.json`)

**Method:**
- **Scoring:** walk-forward proxy lines (`floor(median of last 10 played) + 0.5`, earlier games only), with the
  baseline's league rates, priors and NB dispersion taken from the prior season. This is the design of every earlier
  proxy study, and it reproduces the frozen study's 2025-26 line count exactly (71,595).
- **Seasons:** 2023-24 (70,341 lines), 2024-25 (70,137) and 2025-26 (71,595); 0 leakage violations among about
  880k history checks per season.
- **Calibrated view:** each line is also shown after the frozen **retrospective** monotone calibrator, which was fit
  on 2022-23 only (digest `48d148d8…`), so it is out of sample for every season here.

**Measures:**
- *gap* = mean confidence of the chosen side − its hit rate (positive means overconfident).
- *bias* = mean(y − P(more)) (positive means the stat lands above the line more often than predicted).

Values are percentage points, listed for 2023-24 / 2024-25 / 2025-26.

| Dimension | Baseline | After the frozen calibrator | Evidence for a new challenger? |
|---|---|---|---|
| Overall | gap +2.2 / +2.2 / +2.4 | gap +0.2 / +0.1 / +0.3 | Overconfidence is already handled by the frozen calibrator |
| Confidence 0.80+ (about 2.9k lines/season) | gap +15.1 / +16.7 / +13.6 | gap +1.7 / +3.0 / +0.3 | Handled by the calibrator; small residual, small bins |
| Line distance z ≥ 1 (about 1.3k) | gap +22.3 / +22.8 / +19.3 | gap +3.3 / +3.9 / +0.5 | Handled by the calibrator |
| Direction "more" | gap +5.5 / +5.4 / +5.7 | gap +0.3 / −0.1 / +0.6 | Handled by the calibrator |
| **Expected minutes < 15** (about 11k) | gap +8.4 / +9.3 / +8.7; bias −9.4 / −10.3 / −10.7 | **gap +3.7 / +4.4 / +3.7** (95% CI excludes 0 in 3/3); bias −5.1 / −5.6 / −5.9 | **Sufficient**, but it overlaps the closed availability and role-minutes challengers (both NO_CLEAR_EFFECT). Reserved for a separate pre-registration; not tested here |
| Expected minutes 25–32 | bias +1.3 / +1.0 / +1.2 | bias +2.3 / +2.0 / +2.0 | Mirror image of the low-minutes over-prediction |
| History 3–5 games (about 5k) | bias −6.7 / −6.1 / −7.0 | bias −2.9 / −2.1 / −3.3 | Consistent sign, but small; intervals not established; insufficient |
| Per-minute rate vs league | mixed: <0.7× bias +1.2/+1.6/+0.6, 0.7–0.9× −2.2/−1.7/−1.9, ≥1.1× +0.8 to +1.8 (calibrated) | not monotone | Insufficient: no single direction |
| Stat (market type) | points gap +3.9 / +3.8 / +4.6 | ≤ 0.7 for every stat | None after calibration. **Platform market types** (PrizePicks, Pick6, sportsbook) cannot be measured on proxy lines; they need the hosted real-line ledger |
| **Opponent** (walk-forward allowed-rate factor) | stingy (<0.94) bias −5.2 / −6.1 / −6.6; generous (≥1.06) +1.5 / +2.1 / +2.8 | **stingy −3.6 / −4.5 / −4.9; generous +3.1 / +3.8 / +4.6** | **Sufficient**: see below |

**The opponent finding is the strongest and cleanest.**
- The baseline has no opponent term. After calibration, the residual y − P(more) rises with log(opponent factor).
- The OLS slopes and 95% game-clustered bootstrap intervals (1,000 replicates):

  | Season | Points | Rebounds | Assists | All |
  |---|---|---|---|---|
  | 2023-24 | 0.44 [0.30, 0.59] | 0.48 [0.33, 0.63] | 0.37 [0.25, 0.48] | 0.42 [0.33, 0.50] |
  | 2024-25 | 0.45 [0.28, 0.62] | 0.42 [0.26, 0.60] | 0.44 [0.34, 0.54] | 0.44 [0.35, 0.53] |
  | 2025-26 | 0.79 [0.64, 0.96] | 0.53 [0.42, 0.65] | 0.43 [0.32, 0.54] | 0.53 [0.45, 0.62] |

- The interval excludes zero in **9 of 9** season-by-stat cells. The calibrator cannot fix it, because the
  calibrator sees only the baseline probability, not the opponent.

## 2. The one challenger

`props-nb-opponent-rate-v1` is the baseline unchanged, except that the player's per-minute rate is multiplied by
`opponentFactor ^ beta[stat]`. The same negative binomial and minutes variance are kept.

- **opponentFactor:**
  - per-minute points, rebounds or assists that the defending team allowed in **this season's games that started
    strictly before the predicted game**, divided by the league per-minute rate over the same earlier games;
  - games sharing a start time never see each other;
  - fewer than 10 earlier games means unknown, and then no adjustment.
- **beta:** one value per stat, chosen from the fixed grid {0, 0.1, …, 1.5} by minimum binary Brier on **one fit
  season only** (the season immediately before the test season). Ties go to the smaller value. beta = 0 reproduces
  the baseline (unit-tested).
- **Nothing else changes:** minutes, priors, dispersion, proxy lines and the line set.

## 3. Chronological validation on untouched seasons (frozen)

No props study has scored seasons 2016-17 to 2020-21. In each fold, beta comes from the fit season, and the test
season's model inputs come from its prior season.

| Fold (test season) | beta fit on | Test season prior |
|---|---|---|
| 2018-19 | 2017-18 (scored with 2016-17 priors) | 2017-18 |
| 2019-20 | 2018-19 | 2018-19 |
| 2020-21 | 2019-20 | 2019-20 |

- A test season is used as the next fold's fit season only after its own evaluation, as in standard walk-forward.
- The source files and their SHA-256 values are pinned in the protocol.
- **Uncertainty:** game-clustered bootstrap, 2,000 replicates, seed 20261124.

## 4. Decision rule (frozen)

The primary measure is the per-line paired binary Brier difference (challenger − baseline), pooled over the three
test seasons, with each line scored by its own fold's beta.

| Outcome | Rule |
|---|---|
| `QUALIFIES_FOR_FORWARD_TEST` | pooled Brier difference 95% upper bound < 0, **and** every test season's mean difference < 0, **and** pooled log-loss difference mean < 0 |
| `WORSE` | pooled Brier difference 95% lower bound > 0 |
| `NO_CLEAR_EFFECT` | anything else |

- **Reported, descriptive only:**
  - per-stat paired differences;
  - calibration gap;
  - the residual-versus-opponent slope (it should move toward 0);
  - the fitted betas.
- **Promotion: none.** A qualifying result supports, at most, a separately owner-approved forward shadow on real
  lines, judged by the unchanged production `REVIEW_GATE`: ≥500 graded lines, ≥14 dates, ≥50 games, ≥100 decisions,
  Brier-difference upper 95% ≤ −0.002, and no worse log loss.
- If it were ever adopted, the monotone calibrator would need its own re-registration, because it was fit on
  baseline probabilities.

## 5. Overfitting and look-ahead controls

- **One challenger, one mechanism, three parameters** (one beta per stat) from a fixed 16-point grid. Every beta is
  fitted on a season strictly before its test season.
- **Opponent factors use only earlier games** of the same season, and same-time games are excluded (unit-tested).
  Late-season games cannot change early factors (unit-tested).
- **Untouched data.** The 2016-17 to 2020-21 player box-score files have never been scored for props. The only
  earlier 2016–2020 work in this repo is game-level moneyline Elo (`research/nba_audit_20261012`), a different target.
- **Known limits:**
  - proxy lines are not sportsbook or platform lines;
  - 2019-20 includes the bubble restart and 2020-21 was shortened;
  - box scores carry no injury or rest information;
  - a historical pass is not evidence of profit.

## Reproduce

```bash
node --experimental-strip-types --test scripts/lib/props-breakdown.test.mjs scripts/props-opponent-eval.test.mjs
node --experimental-strip-types scripts/props-opponent-eval.ts --data <dir with player_box_2017..2021.csv> --out research/props_opponent_rate_v1_20261124
```
