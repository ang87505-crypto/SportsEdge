# lab-sports-challengers-v2: pre-registered results (2026-11-13)

**What was pre-registered:** spec SHA-256 `eee835a5…`, committed in `035625f` before any real-data run.
- **Code:** `src/lib/lab/sports/challengers-v2.ts`.
- **Run:** `scripts/lab-sports-challengers-v2.ts`.
- **Data:** pinned SportsDataverse ESPN box scores; 2024-25 and 2025-26 hash-checked; 2026-27 live file hash recorded.
- **Leakage:** 92,880,910 history checks, 0 violations.

## Challengers vs the existing recalibration layer (Brier, game-clustered bootstrap, Holm across 4)
| Candidate | Fold 1 (2025-26 2nd half, exploratory) | Fold 2 (2026-27, out of season) | Disposition |
|---|---|---|---|
| side_asym (separate More/Less slopes) | −0.00043, Holm p 0.003 | +0.00007, CI −0.00042..+0.00056 | NO_CLEAR_EFFECT |
| uncertainty (minutes CV, short history) | −0.00027, p 0.002 | +0.00015, CI −0.00025..+0.00056 | NO_CLEAR_EFFECT |
| line_gap (model-vs-line disagreement) | −0.00044, p 0.003 | −0.00027, CI −0.00075..+0.00021, p 0.52 | NO_CLEAR_EFFECT |
| all_new | −0.00051, p 0.003 | −0.00009, CI −0.00061..+0.00043 | NO_CLEAR_EFFECT |

**Reading:** none qualifies. The fold-1 gains are real but tiny and do not hold out of season. All four continue only as
prospective hypotheses: `--forward` scores games from 2026-11-14 with weights frozen on 2025-26.

## Confirmed weaknesses (base model = production layer 1)
Base-model qualified picks, gap = stated confidence minus hit rate:

| Pattern | Fold 1 | Fold 2 |
|---|---|---|
| More side overconfident | +8.4 pts (Less +1.1) | +6.4 pts (Less −0.1) |
| Model-vs-line gap ≥ 40% | +10.9 pts | +8.3 pts |
| Volatile minutes (CV 0.30–0.50) | +6.7 pts | +6.2 pts |
| Points | worst calibrated stat (+6.3 pts) | worst calibrated stat (+3.2 pts) |

Real captured DFS lines show the same More weakness: 11 of 25 More picks hit vs 32 of 51 Less.

The existing single-slope recalibration (the `props-learn-v1` shadow's recalibration terms) removes most of the More gap in fold 2: More −2.0 pts, Less −1.7 pts.

## Defect found: back-to-back rest is mislabelled (learning layer only)
**The bug:** `src/lib/props/features.ts` defines rest as `floor(elapsed hours / 24) − 1`. One full day off with an earlier tip therefore becomes a "back-to-back".

**Measured impact:**
- **Fold 1:** 22.5% of lines (10,185 of 45,216) are labelled back-to-back despite having rest; 37% are back-to-back by the elapsed definition vs 15% by calendar days.
- **Fold 2:** 22.7% (1,614 of 7,104).

**Scope:** it affects only the learning-layer feature used by the `props-learn-v1` shadow and the lab's matchup/rest layer. The active model does not use it.

**Fix:** a calendar-day definition (`src/lib/lab/sports/rest-calendar.ts`, tested). Changing the frozen production feature is proposed for owner review after the Monday release, not done here.

## Not claimed
- No profitability. Proxy lines imply no return.
- No improvement over the existing model. The real-line sample (76 graded picks) is far below the 500-line review gate.
