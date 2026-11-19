# Props learning layer: historical replay (2026-11-08)

**Verdict:** on 45,216 historical stat lines it never trained on, the learning layer beat the current stats model
(`props-nb-minutes-rate-v1`) on all three stats. Every 95% interval sits entirely on the "better" side.
It also raised the hit rate of qualifying (60–80%) picks on all three stats.

This replay used **proxy lines** and **no sportsbook data**, so it measures probability quality, not profit.
Real PrizePicks lines are harder than proxies. Forward results on real lines decide whether the layer takes over.

Report: `research/props_learn_replay_20261108/report.json` · Script: `scripts/props-learn-replay.ts`

## Setup

- **Data:** SportsDataverse ESPN NBA player box scores (CC BY 4.0), pinned by SHA-256:
  - `player_box_2025.csv` (2024-25) `8e34c5b1…e4f7`
  - `player_box_2026.csv` (2025-26) `7a4868da…cc89`
- **Stats model (layer 1):**
  - player priors from 2024-25
  - spread (NB dispersion) fit on 2025-26 games through 2025-12-31, as in the calibration protocol
- **Learning layer:** per-stat ridge logistic regression with the matchup terms. Its inputs:
  - the stats model's estimate
  - the opponent's allowed rate (last 15 games)
  - home/away
  - rest days and back-to-back

  Sportsbook weights are held at zero, since no historical book data exists. λ is chosen by time-ordered validation.
- **Split:** train on 26,379 lines (2025-10-27 → 2025-12-31); test on 45,216 lines (2026-01-01 → 2026-04-13), 739 games.
- **Lines:** proxy, floor(median of the last 10 played) + 0.5, from earlier games only.
- **No peeking:** 90,588,564 inputs were checked; 0 came from a game at or after the predicted game's start.
  The script refuses to write a report otherwise.

## Results (test window)

Brier is the 3-outcome score from `research.ts` (lower is better). The interval is the paired game-level bootstrap
of learning − stats (1,000 replicates, seed 20261108); negative favours the learning layer.

| Stat | Stats model Brier | Learning Brier | Difference, 95% interval | Qualifying-pick hit rate (stats → learning) |
|---|---|---|---|---|
| Points | 0.24803 | **0.24263** | −0.00677 to −0.00401 | 60.9% (6,853 picks) → **64.7%** (4,230) |
| Rebounds | 0.23749 | **0.23539** | −0.00270 to −0.00152 | 64.9% (6,885) → **66.1%** (6,795) |
| Assists | 0.23286 | **0.23170** | −0.00169 to −0.00062 | 65.2% (7,948) → **66.3%** (7,866) |

Against the registered promotion margin (upper 95% ≤ −0.002), **points** clears it on this replay. Rebounds and assists
are better but by less than that margin. The live switch is still decided only on forward real lines.

## What the layer learned (weights, read in plain words)

| Stat | Trusts the stats model | Opponent effect | Notes |
|---|---|---|---|
| Points | 0.50 (halves its confidence) | 0.20 | Mostly fixes the known overconfidence on points |
| Rebounds | 0.87 | **1.54** | A strong rebounding opponent matters a lot |
| Assists | 0.83 | 0.28 | Small home bump (+0.07) |

Rest and back-to-back weights are near zero on all three stats.

## Limits

- Proxy lines are easier than PrizePicks lines, so hit rates here overstate what real lines allow.
- The sportsbook terms could not be tested historically; they learn only from forward graded lines (≥ 150 needed).
- One season, one split. The forward shadow test under the registered gate is the real check.
- No dollar results are claimed.
