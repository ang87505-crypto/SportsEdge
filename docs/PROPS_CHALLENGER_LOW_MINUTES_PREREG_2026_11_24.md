# NBA props challenger `props-nb-low-minutes-v1`: pre-registration (2026-11-24)

**Written and committed before any 2011-12 to 2015-16 props line was scored by any study.** The protocol
(`research/props_low_minutes_v1_20261124/protocol.json`) fixes the sources (SHA-256), folds, segment, fitting rule,
uncertainty method and decision rule. Results go in a separate document, whatever they are.

**Research only.** Production `props-nb-minutes-rate-v1`, the frozen monotone calibrator, `REVIEW_GATE`, budgets and
schedules are unchanged. The opponent challenger (`docs/PROPS_CHALLENGER_OPPONENT_RATE_*`) and its results are
preserved unchanged. Inputs are public SportsDataverse ESPN box scores (CC BY 4.0); there are no provider requests.

## Motivation: exploratory evidence, already-inspected seasons only

The 2023-24 to 2025-26 breakdown (`research/props_opponent_rate_v1_20261124/breakdown-exploratory.json`) found that,
**after** the frozen calibrator, lines with baseline expected minutes **under 15** remain:
- overconfident (gap +3.7 / +4.4 / +3.7 points, 95% CI above 0 in 3 of 3 seasons);
- over-predicted (bias −5.1 / −5.6 / −5.9 points).

**Disclosure.** Before writing this, I checked the proposed mechanism on the same exploratory seasons, fitting on
each prior season. It reduced the under-15 bias from about −10 to about −3 points, and gave an all-lines paired Brier
difference of about −0.0018 (CI excluding 0) in both 2024-25 and 2025-26. That check is motivation, not evidence. It is
why the holdout below uses older seasons that no props study has scored.

## The one challenger

For lines whose baseline expected minutes are **strictly below 15**, `props-nb-low-minutes-v1` re-prices the line with
the baseline's own negative binomial, but with adjusted minutes:

- expected minutes × **m**;
- minutes SD² = (m × SD)² + (s × expected)².

This is `adjustedProbabilities` in `src/lib/props/availability.ts`. Lines at or above 15 minutes are unchanged.
m = 1 and s = 0 reproduces the baseline (unit-tested).

**Fitting (`fitLowMinutes`):**
- m = mean(min(minutes, 53) / expected minutes);
- s = √max(0, variance of that ratio − mean model CV²);
- both are taken over the **unique** under-15 player-games of the **preceding season only**;
- **no line outcome is used**, only realized minutes.

The mechanism tests one specific explanation: expected minutes for low-minute players are too high and too certain.
The closed availability challenger (`NO_CLEAR_EFFECT`) used the same adjustment form by *availability category*. This
challenger uses an *expected-minutes* segment instead.

## Chronological validation on untouched seasons (frozen)

| Test season | m, s fitted on | Test-season inputs from |
|---|---|---|
| 2013-14 | 2012-13 (scored with 2011-12 priors) | 2012-13 |
| 2014-15 | 2013-14 | 2013-14 |
| 2015-16 | 2014-15 | 2014-15 |

**Uncertainty:** game-clustered bootstrap, 2,000 replicates, seed 20261124.

## Decision rule (frozen; identical in form to the opponent challenger)

The primary measure is the paired binary Brier difference (challenger − baseline) on **all** lines, pooled over the
three test seasons.

| Outcome | Rule |
|---|---|
| `QUALIFIES_FOR_FORWARD_TEST` | pooled upper 95% < 0, **and** every test season's mean < 0, **and** pooled log-loss difference < 0 |
| `WORSE` | pooled lower 95% > 0 |
| `NO_CLEAR_EFFECT` | anything else |

**Descriptive only:**
- the under-15 segment's Brier difference, gap and bias before and after;
- the fitted m and s;
- a **combined** arm (opponent scaling with beta fit on the same season, then this adjustment) compared with the
  opponent challenger alone. It is not part of any rule.

**Promotion: none.** A qualifying result supports, at most, an owner-approved forward shadow on real lines, judged by
the unchanged `REVIEW_GATE` (Brier-difference upper 95% ≤ −0.002 and the sample minimums).

## Limits

- Proxy lines, not platform lines.
- Only games the player played are scored. In production, a did-not-play leg is voided, so this tests the
  played-minutes mechanism only.
- 2011-12 was a lockout-shortened season, used only as priors.
- No injury or rest data.
- A historical pass is not evidence of profit.
