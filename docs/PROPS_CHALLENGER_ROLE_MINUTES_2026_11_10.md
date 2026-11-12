# Props challenger `props-nb-role-minutes-v1` (2026-11-10)

**Verdict: no improvement.** The challenger is kept as a versioned research artifact
(`research/props_cal_v1_20261110/props-nb-role-minutes-v1.json`, SHA-256 `447bbc33288a3668…`).
- It is **not** registered in the live shadow loop, because auto-switch is on there and this change promotes nothing.
- The promotion gate, the active stats model (`props-nb-minutes-rate-v1`) and every pick rule are unchanged.

## Data audit (live ledger, read-only)

Run: [props-audit 42767923512](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42767923512). The output is
`research/props_cal_v1_20261110/ledger-audit.json`, covering observations since 2026-11-01: 220 lines and 9 settled
entries.

| Check | Result |
|---|---|
| Grading | 175 graded lines recomputed from their stored box score: **0 mismatches**; no stat revision after the first |
| Player identity | 7 lines unscored as `identity_player_not_found`; no player name maps to two ESPN ids |
| Team mapping | 174 checked, **0** mismatches between the prediction's team and the graded game's team |
| Game times | The provider's start (`lock_at`) is 10 minutes after ESPN's listed start on all 175 lines. Nothing is recorded within 10 minutes of `lock_at`, so **0** lines were captured after ESPN's start. The pregame margin against the listed start is therefore 0–10 minutes; the lock rule is unchanged here. |
| Minutes | 0 played lines without minutes |
| Reproducibility | The stored layer-1 probability recomputes exactly (**max difference 0**, 130 lines) from box scores retrieved before each line was captured |

**Why the learning challenger shows zero graded shadow lines: pending settlement, not a data-flow fault.**
- `props-learn-v1` has scored **34** lines, all for the one game priced by the 410-minute-late collect at
  2026-11-10 02:00 UTC (lock 03:10 UTC).
- All 34 are awaiting settlement. The last completed settle ran at 23:48 UTC on November 9, before those lines
  existed.
- The next settle grades them: the 09:20 UTC slot, or its Vercel backup in the 10:00 UTC hour.

## The challenger

**Why this improvement.** I inspected the evidence and existing work first:
- **Calibration** is already covered by `props-temperature-v2` (registered 2026-11-08) and by the learning layer.
  `props-cal-v1` was therefore **withdrawn before any run** (`amendment-1.json`).
- **Minutes uncertainty** already widens layer 1's distribution through `rate² × sdMinutes²`.
- **Playing time:** the gap left is the minutes forecast itself. Its 4-game half-life average lags role changes. This
  was the deferred hypothesis in the 2026-11-08 calibration study.

**Rule.** If the last 3 played games all moved the same way from games 4–10, by at least 6 minutes on average, expected
minutes = the last-3 mean, and uncertainty is never narrowed. Otherwise the challenger is identical to layer 1.
- **Parameters:** fixed in advance, never searched.
- **Inputs:** earlier played games' minutes only, which the live ledger already stores. No injury, lineup or same-game
  information.

**Protocol.** `research/props_cal_v1_20261110/protocol.json` (06:10 UTC) and `amendment-1.json` (06:12 UTC) were both
committed before any run. Attempted variants: `props-cal-v1` (withdrawn, never run) and this one (run once).

## Results on proxy lines (probability quality, not returns)

| Source | SHA-256 | Role |
|---|---|---|
| `player_box_2025.csv` | `8e34c5b1b7629dda…` | 2024-25 priors (exploratory) |
| `player_box_2026.csv` | `7a4868da67ae7f6e…` | 2025-26: previously inspected, **exploratory** |
| `player_box_2027.csv` | `b941ba23f8d19977…` | 2026-27 through 2026-11-09: **holdout**, unseen by any earlier fit or choice; scored with the production artifact exactly |

Leakage: 0 of 3,136,034 (holdout) and 0 of 181,177,128 (exploratory) inputs came from a game at or after the predicted
game.

**Holdout:** 5,427 lines, 104 games, 2026-10-25 to 2026-11-09. Brier (lower is better); the interval is a paired
game-level bootstrap of challenger minus layer 1, with 1,000 replicates and seed 20261110.

| Stat | Layer 1 | Challenger | Difference, 95% interval | Last-10 Poisson | Season Poisson | Last-10 share |
|---|---|---|---|---|---|---|
| Points | **0.23245** | 0.23306 | −0.0007 to +0.0020 | 0.24613 | 0.24613 | 0.24935 |
| Rebounds | **0.23226** | 0.23226 | −0.0011 to +0.0012 | 0.24316 | 0.24316 | 0.24448 |
| Assists | **0.22504** | 0.22508 | −0.0009 to +0.0010 | 0.24366 | 0.24366 | 0.24438 |

**Notes on the holdout:**
- **Where the rule fired** (138 lines per stat), it was not better: points 0.2282 → 0.2362, interval −0.009 to
  +0.026.
- **Baselines:** layer 1 beats every simple recent-history baseline on every stat. The two Poisson baselines coincide
  because no player has more than 10 games yet this season.
- **Calibration:** layer 1 still over-predicts *More* at the top. On points, the 0.65–0.80 band forecast 0.72 and
  observed 0.63; the 0.80+ band forecast 0.87 and observed 0.80. That is the weakness `props-temperature-v2` and the
  learning layer target. Full band tables, log loss and coverage are in `report.json`.

**Exploratory (2025-26, previously inspected).** 71,595 lines. The challenger was worse on points (+0.0009, interval
+0.0003 to +0.0015), roughly neutral on rebounds and assists. That is consistent with the holdout.

## Real captured lines (separate from the proxy results)

There are 130 graded lines, deduplicated across platforms (PrizePicks preferred), from only 5 games.
- **Comparison:** both models are recomputed from the same point-in-time history.

  | Stat | Lines | Layer 1 | Challenger | Difference, 95% interval |
  |---|---|---|---|---|
  | Points | 66 | 0.2671 | 0.2673 | −0.004 to +0.005 |
  | Rebounds | 38 | 0.2706 | 0.2757 | −0.004 to +0.013 |
  | Assists | 26 | 0.2370 | 0.2357 | −0.017 to +0.016 |

- **A leakage trap caught:** an earlier version of the audit used today's box scores, including rows retrieved after
  the lines were captured. It showed the challenger 0.03–0.05 better. That apparent gain disappeared once the history
  was restricted to what was available at capture time.
- **Sportsbooks at the exact same line:** **no overlap yet**. Same-line book quotes began with the 2026-11-10 collect,
  and those lines await settlement. This comparison waits for future settled lines.
- **Settled virtual entries** (descriptive only, not used to fit anything): 9. 1 won, 5 lost, and 3 Pick6 with
  unknown payout. The known PrizePicks result is −$15.00. Far too few to say anything about profitability.

## Limitations

- **Proxy lines** are not platform lines. The historical results measure probability quality only.
- **Who is scored:** only players who played (PrizePicks voids DNPs), and only after 3 earlier games this season.
- **Small samples:** the early-season holdout and the real-line sample are both small. Same-game lines move together,
  so the intervals resample whole games.
- **Injuries and lineups** have no reliable historical availability timestamps. They stay out of backtests and can
  only be tested prospectively.

## Reproduce

```
node --experimental-strip-types scripts/props-role-eval.ts --prior player_box_2025.csv --season player_box_2026.csv \
  --holdout player_box_2027.csv --out research/props_cal_v1_20261110
```

The holdout file is the live SportsDataverse release, so check its SHA-256 against the value above. The ledger audit
runs from Actions → *Props ledger audit (read-only)*.
