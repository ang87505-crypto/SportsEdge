# NBA Elo variant study (October 20, 2026)

Research only. The production model (`analytics/nba_elo_walkforward.py`, K=20, home +65) and the site are unchanged.

## Question

Do standard Elo upgrades make the NBA model's probabilities more accurate on games it has not seen?

## Data

The same pinned SportsDataverse ESPN + NBA Stats files as the published study (`src/data/research/nba_recent_sources.json`). All 8 downloaded files matched their recorded SHA-256 hashes, and were reconciled with the existing `load_sources` code: 4,920 regular-season games.

## Pre-registered design

| Season (end year) | Role |
| --- | --- |
| 2022–23 | Rating warm-up only |
| 2023–24 | Development: choose the winner and fit the back-to-back penalty |
| 2024–25, 2025–26 | Held-out test (2,460 games) |

Candidates were fixed before any test result was looked at. They use published FiveThirtyEight-style defaults, not values tuned to these seasons:

| Variant | Change |
| --- | --- |
| A | Margin-of-victory weighted K: `((margin + 3)^0.8) / (7.5 + 0.006 × winner Elo edge)` |
| B | Ratings pulled 25% toward 1505 at each new season |
| C | Back-to-back penalty in Elo points, fitted on 2023–24 only (grid 0–80) |
| D | No home advantage at neutral-site games |
| E | A + B + C + D (penalty refitted on 2023–24 for this combination) |

Decision rule: the lowest development Brier score wins. It is recommended only if its held-out Brier improvement over the production model has a 95% game-day bootstrap interval entirely below zero (4,000 paired resamples of the 330 test days).

As in production, every forecast for a UTC day is made before any result from that day updates the ratings. The back-to-back flag uses only the schedule, which is known before tip-off.

## Results (held-out 2024–26)

| Model | Brier | Log loss | Accuracy | Calibration error | Brier vs. production, 95% interval |
| --- | --- | --- | --- | --- | --- |
| Production | 0.2142 | 0.618 | 66.5% | 3.7% | — |
| A, margin of victory | 0.2102 | 0.609 | 67.3% | 3.7% | −0.0056 to −0.0022 |
| B, season regression | 0.2122 | 0.613 | 66.5% | 3.3% | −0.0031 to −0.0010 |
| C, back-to-back (58 pts) | 0.2132 | 0.616 | 67.1% | 4.0% | −0.0024 to +0.0004 |
| D, neutral sites | 0.2142 | 0.618 | 66.5% | 3.8% | −0.0002 to +0.0002 |
| **E, combined (62 pts)** | **0.2078** | **0.603** | **68.1%** | **3.3%** | **−0.0089 to −0.0039** |

* The production model reproduced its published 66.46% accuracy exactly, which confirms the data and pipeline match.
* E won on development (Brier 0.2115 vs. 0.2143) and kept its lead in both test seasons: 0.2088 vs. 0.2164 in 2024–25 and 0.2069 vs. 0.2121 in 2025–26.
* Margin of victory carries most of the gain. Neutral sites matter almost nothing (few games).

Full numbers: `research/nba_model_v2_20261020/report.json`.

## Finding: live forecasts use a frozen snapshot

Live forecasts are not produced by the walk-forward above. `research_publish` (in `database/migrations/20261008231840_forward_research_ledger_v1.sql`) prices each game from one stored rating snapshot plus a fixed home advantage. The only version in use, `nba-elo-k20-h65-2026-04-v1`, holds ratings from April 13, 2026, and nothing refreshes it during the season.

Replaying the test seasons with the same refresh behaviour (`refresh_cadence` in the report):

| Refresh | Production Brier | Production accuracy | Shadow v2 snapshot Brier | Shadow accuracy |
| --- | --- | --- | --- | --- |
| Daily | 0.2142 | 66.5% | 0.2087 | 67.8% |
| Weekly | 0.2151 | 66.4% | 0.2096 | 67.4% |
| Monthly | 0.2188 | 65.4% | 0.2136 | 67.1% |
| **Frozen all season (today)** | **0.2453** | **60.0%** | 0.2387 | 60.5% |

A Brier score of 0.25 is what a 50/50 guess on every game scores. So the 66.5% shown on the site describes a daily-updating model, not the forecasts being published for 2026–27. Refreshing the snapshot weekly recovers almost all of the gap, needs no schema change, and matters more than any variant above.

## Recommendation

1. **Refresh ratings weekly.** Publish a new immutable model version each week from the latest results. This is the biggest single improvement. It needs an owner decision because the paper-betting code (`NBA_MODEL_VERSION` in `src/lib/nba-paper-run-contract.ts` and `nba-paper-once.ts`) only accepts the April version.
2. **Run v2 as a forward shadow, not a switch.** The shadow snapshot is margin-of-victory updates plus 25% season regression; `research_publish` can price it unchanged. The back-to-back and neutral-site parts would need a richer publish function, so they are left out of the shadow. Shadow forecasts are never used for paper bets.
3. **Decide with the pre-registered scorecard** (`analytics/nba_shadow_scorecard.py`). Keep collecting until 300 paired final games. Adopt the shadow only if the paired game-day bootstrap 95% interval for the Brier difference is entirely below zero; otherwise keep production. Add closing-line value once closing odds are recorded.

## Shadow test: owner steps

Nothing below has been run against any database.

1. Build the snapshot for the cutoff day, using results before that day only:
   ```
   python analytics/nba_snapshot.py --folder <sources> --manifest src/data/research/nba_recent_sources.json \
     --as-of 2026-10-20 --season 2027 --current-season-espn <folder>/nba_schedule_2027.csv --out-dir <dir>
   ```
   The season-start snapshot is committed in `research/nba_model_v2_20261020/shadow/`: 30 teams, ratings through April 13, 2026, already pulled 25% toward 1505. The 2026–27 NBA Stats file was not yet published, so current-season results come from ESPN only; the snapshot records that as `single_source`.
2. Review the generated `.sql` (an idempotent `insert … on conflict do nothing` into `research_model_versions`). Run it in staging first.
3. For each fixture already checked for production, call `research_publish(game_id, '<shadow version>')`. The function enforces pregame timing and team mapping exactly as for production.
4. Weekly, repeat steps 1–3 with a new `--as-of`. Each week gets its own immutable version.
5. Export `research_forecasts` and `research_results` as JSON and run `python analytics/nba_shadow_scorecard.py export.json`.

## Limitations

* The 2024–26 seasons were already used to report the production model, so the test window is not completely untouched. 2026–27 will be the first truly unseen data.
* Brier score and accuracy measure forecast quality, not betting profit. A better forecaster can still lose money against a sharp market. No historical prices were used.
* The back-to-back penalty is a single fitted number. It is large (roughly 2 points of spread, at about 28 Elo points per point), so a forward check matters.
* The sources are mirrors from one publisher; the existing study's notes on partial original-source verification still apply.

## Reproduce

```
# Download the 8 files listed in src/data/research/nba_recent_sources.json into <folder>
# (ESPN files as named, NBA Stats files prefixed "official_"), then:
python analytics/nba_elo_variant_study.py --folder <folder> \
  --manifest src/data/research/nba_recent_sources.json --output report.json
python -m unittest discover -s analytics -p 'test_*.py'
```

The runner refuses to finish if the production baseline does not reproduce the published accuracy.
