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

## Recommendation

E clears the pre-registered bar. The next step is a **forward shadow test**, not a switch:

1. Publish E's forecasts beside the production forecasts for the 2026–27 season, without placing paper bets on them.
2. After a pre-set number of games (for example 300), compare both on Brier score and, once closing odds are recorded, on closing-line value.
3. Change the paper-betting model only if E still leads.

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
