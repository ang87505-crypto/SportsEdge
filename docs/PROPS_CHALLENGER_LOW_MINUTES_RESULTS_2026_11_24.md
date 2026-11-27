# NBA props challenger `props-nb-low-minutes-v1`: results (2026-11-24)

**Verdict: `QUALIFIES_FOR_FORWARD_TEST`**, by the frozen rule in `docs/PROPS_CHALLENGER_LOW_MINUTES_PREREG_2026_11_24.md`.

- **The strongest effect so far.** It is about 4.5× the opponent challenger's (pooled Brier −0.00138 against
  −0.00031), and it replicates in every held-out season.
- **It is still not enough alone for production.** The production `REVIEW_GATE` needs an upper 95% bound ≤ −0.002 on
  real lines; the pooled upper bound here is −0.00122.
- Nothing is promoted. Production predictions, the opponent challenger and all negative results are preserved.

## Provenance

| Item | Value |
|---|---|
| Pre-registration | Commit `339e1e1` at 21:27:59 UTC, before any 2011-12 to 2015-16 line was scored |
| Evaluation | `scripts/props-low-minutes-eval.ts`, one run after that commit, local, no network |
| Inputs | `player_box_2012.csv` to `player_box_2016.csv`, every SHA-256 matching the protocol |
| Leakage | 0 in all fit and test seasons |
| Results | `research/props_low_minutes_v1_20261124/results.json` |

## Results: untouched seasons, chronological folds, proxy lines

| Test season | m / s (fit on the previous season, realized minutes only) | Lines (under 15 min) | Paired Brier diff, all lines (95% CI) |
|---|---|---|---|
| 2013-14 | 0.934 / 0.475 | 70,227 (11,736) | −0.00165 (−0.00190, −0.00141) |
| 2014-15 | 0.909 / 0.442 | 71,250 (10,779) | −0.00128 (−0.00154, −0.00101) |
| 2015-16 | 0.928 / 0.460 | 71,610 (11,127) | −0.00120 (−0.00144, −0.00097) |
| **Pooled** | per fold | **213,087 (3,561 games)** | **−0.00138 (−0.00152, −0.00122)**; log loss −0.0039 (−0.0043, −0.0035) |

**Rule check:**
- pooled upper bound < 0: **yes**;
- every season < 0: **yes**;
- log loss < 0: **yes**.

So the verdict is `QUALIFIES_FOR_FORWARD_TEST`.

**Descriptive results (not part of the rule):**

| Under-15 segment | Segment Brier diff (95% CI) | Overconfidence gap | Bias on P(more) |
|---|---|---|---|
| 2013-14 | −0.0099 (−0.0113, −0.0084) | 6.6 → 2.9 points | −9.8 → −4.1 |
| 2014-15 | −0.0084 (−0.0102, −0.0067) | 6.6 → 4.2 | −8.7 → −2.3 |
| 2015-16 | −0.0078 (−0.0093, −0.0062) | 6.2 → 3.4 | −8.0 → −2.2 |

- **The fitted adjustment is stable across all five fitted seasons**, including the two exploratory checks (m 0.90–0.93,
  s 0.44–0.50). Low-minute players play about 7–10% fewer minutes than the model expects, with far more spread than
  it assumes.
- **Combined with the opponent challenger** (beta fit on the same season), compared with the opponent challenger
  alone: −0.00164 / −0.00128 / −0.00120. **The two effects add.** The combined model's improvement over the baseline
  is roughly −0.0017, still short of the −0.002 gate.
- **Some overconfidence remains** in the segment (gap 2.9–4.2 points). The frozen monotone calibrator, or a
  re-registered calibration of a combined model, would address it.

## Interpretation

The low-minutes weakness is real, mechanistic and large within its segment. The cause is expected minutes that are
too high and too certain, not per-minute rates. Together with the opponent result, this is the first pair of NBA
improvements that both replicate chronologically on untouched data.

**Recommended next step (owner decision; not started):** one new pre-registered challenger combining both adjustments
with a re-fitted monotone calibration, recorded as a forward **shadow** on real platform lines (the #208 shadow
pattern). It would be judged only by the unchanged `REVIEW_GATE`. No production model change is proposed.

## Learning registry

`lab-props-low-minutes` history: `PROPOSED` (pre-registration) → `RUNNING` → `PROMISING`. The evidence is
retrospective only, there is no forward recording, and it is never auto-promoted.

## Limits

- Proxy lines, not platform lines.
- Played games only. In production, a did-not-play leg is voided.
- 2011-12 was a lockout season (priors only).
- No injury or rest data.

A historical pass is not evidence of profit.
