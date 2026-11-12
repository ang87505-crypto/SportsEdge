# Research challenger `props-gap-shrink-v1` (pre-registered 2026-11-12)

**Status:** research only. Scored prospectively in the read-only research receipts. It is not in the live shadow loop,
it never picks, and it never promotes. The active model (`props-nb-minutes-rate-v1`), the selection rule
(`props-select-v1`), the promotion gate, entry limits and the API budget are unchanged.

## Why this challenger
The ledger audit on 2026-11-12 ([run 43168551088](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43168551088))
found the live model overconfident on real DFS lines: 54 graded recorded picks, 25 hits (46.3%) against a mean
stated confidence of about 64.5%, and a Brier score of 0.282.

The misses concentrated where the model's mean was far from the DFS line:

| Model-vs-line gap | Graded picks | Hits |
|---|---|---|
| under 15% | 26 | 15 (58%) |
| 15–25% | 20 | 6 (30%) |

A credible explanation is that a DFS line already reflects information the model does not use, such as role,
rotation, injury and opponent. A large disagreement is then more often the model's blind spot than an edge.

**This pattern was found in the same 54 picks, so it is a hypothesis, not evidence.** The thresholds below were chosen
after seeing that sample. Only lines ingested after the forward start count, and nothing before it is ever scored.

## Frozen rule (`src/data/props/challenger_gap_shrink_v1.json`, `gapShrink()` in `src/lib/props/research.ts`)
- `gap = |model mean − line| / line`.
- `keep = clamp(1 − (gap − 0.10) / (0.30 − 0.10), 0.25, 1)`.
- The conditional More probability `q = pMore / (1 − pTie)` becomes `0.5 + (q − 0.5) × keep`. The explicit tie
  probability is preserved.
- Effect: a gap under 10% is unchanged; a 20% gap keeps half the edge; 30% or more keeps a quarter.

## Evaluation (the same admission rules as the registered calibration study)
- Forward start: **2026-11-12T12:00:00Z**. Registered at 07:10 UTC, before any line captured after it exists.
- Each line contributes only its first archived pre-lock forecast. The result must be graded after lock and match the
  box-score actual. Both platforms count, deduplicated by exact line.
- Score: paired Brier and log loss against the live model on the same lines, with a game-level bootstrap.
- **Review gate:** at least 500 graded lines, 14 dates and 50 games; the 95% upper bound of the Brier difference
  below −0.002; and log loss no worse. This is the same strict bar as `props-temperature-v2`.
- Passing the gate means only "ready for owner review". It does not promote anything, and it does not show
  profitability: real-line hit rates and payouts are a separate question.

## Where to see it
The `NBA props research receipts` workflow (3 times a day, read-only) adds a `gapChallenger` block to its JSON line. The
full evaluation is in `snapshot.json → challengers`.
