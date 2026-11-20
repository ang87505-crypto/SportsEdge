# NBA props challenger `props-nb-availability-v1`: pre-registration (2026-11-19)

**Committed before any category statistic, any fit, or any holdout outcome was computed.** The machine-readable rules are
in `research/props_availability_v1_20261119/protocol.json`. Nothing below is changed after results are seen, and the
result is reported whatever it is.

**Research only.** It does not change:
- the production model `props-nb-minutes-rate-v1` (`src/data/props/model_v1.json`);
- picks, stakes or capture budgets;
- the shared learning registry and engine, or broker settings.

Production activation, if ever, belongs to the owner and Codex.

## What is already tested, and what this is not

| Already tested | Result | Why this is different |
|---|---|---|
| Minutes-uncertainty shrinkage (`lab-sports-challengers-v2-uncertainty`): shrink toward 50% when minutes CV is high | No clear effect | It reacts to how *variable* minutes have been. This reacts to a recorded *absence event* and can move the mean, not only shrink. |
| Short-history shrinkage | No clear effect | It counts games of history, not absences. |
| Role/minutes trend (`props-nb-role-minutes-v1`): follow a 3-game minutes shift | No improvement on holdout | It follows a played-minutes trend and ignores games missed. |
| Recalibration, side asymmetry, line-gap shrinkage, learned layer | No clear effect or insufficient data | These are global probability transforms with no availability input. |
| Injury/rotation layer (`lab-sports-injury-rotation`) | Blocked | It needs a pre-game injury feed. This uses none (see below). |

## Why this target: current error breakdowns

**Live ledger** (learning run 44635571701, 2026-11-19; 543 graded lines, 20 games; small):
- Recorded *More* picks hit 48.7% at 63.7% mean confidence, a gap of +15.0 points whose game-clustered interval excludes
  zero (+0.5 to +31.5).
- Players with steady minutes (CV under 0.15) show a +15.1-point gap, but its interval crosses zero.
- Overall Brier is 0.2493 against 0.25 for a coin flip.

**Earlier diagnostics** (`docs/AI_LEARNING_LAB_2026_11_12.md`, 2025-26 second half): misses are dominated by playing-time
shocks:
- minutes surges are 3.4× as common among missed *Less* picks as among hits;
- minutes collapses are 1.6× as common;
- production per minute is not distinctive.

**The gap this targets:** the baseline is conditional on playing and averages the minutes of *played* games only. It already
refuses players back from absences longer than 21 days. A player back from a shorter absence is scored as if nothing
happened, although returning players often face minutes limits or leave early. Recently absent players are the one
availability group the baseline does not see. The record of who was absent, and why, is in the box score of the
earlier game, so it is known before the next tip-off.

## The rule

**Availability category** of a player for a game is built only from the player's team's **5 most recent earlier games**,
counting games since the player's first listed appearance for that team. In each such game the player is:
- **PLAYED:** listed, and played.
- **ABSENT_STATED:** listed as did-not-play with a stated reason other than "COACH'S DECISION": injury, illness, rest,
  personal, suspension, not with team, or anything else stated.
- **ABSENT_COACH:** listed as did-not-play for "COACH'S DECISION". This is a rotation choice, not availability, and
  does not trigger the rule.
- **UNLISTED:** not in that game's box score. This is **unknown**: never treated as available, absent or injured.

The categories are then:

| Category | Definition | Adjusted? |
|---|---|---|
| `RETURNING` | ABSENT_STATED in the team's most recent game | yes |
| `RECENT` | not RETURNING; ABSENT_STATED somewhere in the window | yes |
| `UNKNOWN` | neither; some game in the window UNLISTED | no, baseline unchanged |
| `CLEAR` | otherwise | no, baseline unchanged |

**Adjustment** for category *c*. The per-minute rate and the negative-binomial form are unchanged:
- expected minutes × `m_c`;
- minutes variance becomes (`m_c` × baseline SD)² + (`s_c` × expected minutes)².

**Fitting the four numbers** (`m_RETURNING`, `s_RETURNING`, `m_RECENT`, `s_RECENT`):
- **Data:** the **2025-26 season only**, using the existing exploratory layer-1 pipeline.
- **Unit:** every played player-game the baseline scores; r = actual minutes (capped at 53) ÷ baseline expected minutes.
- **`m_c`:** the mean of r.
- **`s_c`:** the square root of the variance of r beyond what the baseline already assumes:
  √max(0, var(r) − mean((SD/expected)²)).

The fitted numbers are committed **before** the holdout is scored.

**Variants:**
- **full:** both numbers;
- **mean-only:** `s_c` = 0 (ablation);
- **variance-only:** `m_c` = 1 (ablation).

## Data and evaluation

| File | SHA-256 | Role |
|---|---|---|
| `player_box_2025.csv` | `8e34c5b1…4ef5` | 2024-25 priors for the training pipeline |
| `player_box_2026.csv` | `7a4868da…cc89` | 2025-26: the only data used for fitting |
| `player_box_2027.csv` | `f3c5d6cf…a848` | **Holdout:** 2026-27, 2026-10-20 to 2026-11-18, outcomes unopened until fit is committed |

The files are SportsDataverse ESPN player box scores (CC BY 4.0), the same pinned source every earlier props study used.

- **Lines:** proxy lines (floor of the last-10 median + 0.5) from earlier games only; not PrizePicks lines.
- **Baseline on the holdout:** the production artifact exactly, as the live worker scores it.
- **Scores:**
  - binary P(more) without ties;
  - Brier and log loss;
  - calibration bands, ECE over 10 bins, and calibration-in-the-large (mean P(more) minus the observed more rate).
- **Uncertainty:** paired bootstrap resampling **whole games**, 2,000 replicates, seed 20261120.

**Primary comparison:** holdout lines in RETURNING or RECENT, all three stats pooled, full variant minus baseline.

| Verdict | Condition |
|---|---|
| `INSUFFICIENT_DATA` | fewer than 150 adjusted holdout lines, or fewer than 30 games |
| `IMPROVES` | Brier difference upper 95% < 0 **and** log-loss difference < 0 |
| `WORSE` | Brier difference lower 95% > 0 |
| `NO_CLEAR_EFFECT` | otherwise |

These are **descriptive only** and cannot change the verdict:
- the ablations;
- per-category and per-stat splits;
- all-lines totals;
- an exploratory chronological split of 2025-26 (fit through 2026-01-31, score February to April). That season was
  inspected by earlier studies.

**No verdict promotes anything.**

## Official injury reports: access investigated, collection NOT enabled

**What exists.** The NBA publishes the official injury report on `official.nba.com`, as timestamped PDFs at
`ak-static.cms.nba.com/referee/injury/Injury-Report_YYYY-MM-DD_HH_MMAM|PM.pdf`.
- Teams must designate a participation status by 5 p.m. local time the day before a game, or by 1 p.m. on the second
  day of a back-to-back.
- They must file a game-day report between 11 a.m. and 1 p.m. local time.
- The page lists an updated report every 15 minutes.

This is exactly the timestamped pre-game availability signal the blocked `injury-rotation` layer needs.

**Terms.** Checked 2026-11-19. `official.nba.com`'s footer links to the NBA.com Terms of Use (last updated July 13,
2026), and its `robots.txt` does not exclude the report files. The Terms say:

> "No Basketball Content from the Services may be reproduced, republished, uploaded, posted, modified, reused,
> transmitted, reproduced, distributed, copied, publicly displayed, linked to, or otherwise used except as provided in
> these Terms of Use without the written permission of the Operator."

> "you may download material displayed on the Services to any single computer only for your personal, noncommercial
> use"

The NBA Statistics section adds that they "may not be used in connection with any gambling activity (including legal
gambling activity)" or "any fantasy game or other commercial product or service".

**Decision: no collector is added.** SportsEdge uses NBA player data to choose PrizePicks/Pick6 entries, which is
exactly the use excluded above. Automated, repeated collection into a stored dataset is not personal single-computer
viewing. Collecting this signal would need one of:
- the NBA's written permission; or
- a licensed injury feed (a paid provider), which is an owner decision with its own terms review.

Until then, every line's pre-game injury status is **unknown**. This study never infers it, and never treats a missing
report as "healthy". The authoring sandbox also cannot reach NBA hosts, so nothing was downloaded from them.

**The box-score reasons used here are different.** They come from the already-adopted SportsDataverse dataset,
published after each game. They describe earlier games only, never the game being predicted. A player not listed is
unknown.

## Known limits, stated before results

- **Small early-season holdout:** about four weeks. RETURNING/RECENT lines are a small share, so intervals will be
  wide; a NO_CLEAR_EFFECT is likely and will be reported as such.
- **Proxy lines,** not market lines, so this measures probability quality, not returns.
- **Players who did not play are not scored.** Platforms void DNPs, so the rule can only affect players who played.
- **Reason text is ESPN's wording,** not the official report, and absent players may not always be listed.
- **One season of fitting;** absence patterns can change between seasons.
