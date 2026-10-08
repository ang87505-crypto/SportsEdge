# NBA historical source benchmark — 2026-10-08

## Measured result and scope

Fixed SportsEdge Elo: **1,632 / 2,457 = 66.42%** winner accuracy on non-neutral NBA regular-season games in 2013-14 and 2014-15. Always-home baseline: **57.79%**. This is an old, reconstructed historical benchmark, not live predictions, current-season validation, against-the-spread accuracy, or betting profitability.

Training: 4,676 eligible games from seasons ending 2010–2013. Evaluation window fixed before scoring: 2013-10-01 to 2015-06-30. Existing K=20, home advantage=65 and initial rating=1500 are unchanged; no parameter search. Ratings update after all games sharing a publisher date are predicted. This is a rolling evaluation; prior evaluation dates may update subsequent forecasts.

| Metric | Elo | Always-home frequency baseline |
| --- | ---: | ---: |
| Accuracy | 66.42% | 57.79% |
| Binary Brier | 0.211969 | 0.244395 |
| Log loss | 0.612146 | 0.681921 |

2013-14: 801/1,229 = 65.17%. 2014-15: 831/1,228 = 67.67%. Descriptive Wilson 95% interval for overall accuracy: 64.53–68.26%; repeated team games are correlated, so this is not a rigorous generalization interval. Ten-bin home-win probability calibration error: 0.02333. Historical odds are absent; ROI and market-relative edge cannot be calculated.

## Source and audit

Attribution: FiveThirtyEight, Historical NBA Elo dataset, CC BY 4.0. Publisher declares Basketball-Reference as its upstream. See https://github.com/fivethirtyeight/data/tree/master/nba-elo and https://github.com/fivethirtyeight/data#readme . Adaptation uses final scores, dates and franchise IDs only; publisher Elo and forecast fields are ignored.

Pinned file Git blob: `6d6ccd07151aed322e1a77c57ea83b8ea58c5523`. SHA256: `d46ed3540ee8d9eca31b3e94cc8c777e0be5156173d814ebf65b8195e8d616bc`. The adapter refuses a changed file. It reconciles both opponent rows, winner, scores, identity and date; rejects missing/duplicate pairs; excludes non-NBA, playoffs, neutral games and out-of-scope seasons. Source team rows are not independent games. Neutral exclusions explain counts below 1,230 per full season.

Game dates have no documented timezone or tipoff time. Internal UTC-midnight values are grouping proxies only and removed from exported predictions; output contains `game_date`, never fabricated tipoff timestamps. This source cannot pass the separate live dataset contract requiring actual tipoffs. No timestamps or predictions are inserted into Supabase.

The source fingerprint and internal consistency are verified. **Scores have not yet been independently reconciled against official NBA records.** The JSON retains `result_source_independently_verified=false`. The result is preliminary historical evidence, not a completed modern production-model validation gate.

## Files and reproduction

- `analytics/nba_historical_source.py`: source adapter and fixed evaluation runner.
- `analytics/test_nba_historical_source.py`: 11 deterministic adapter tests.
- `src/data/research/nba_historical_2015.json`: all evaluated probabilities, outcomes, diagnostics and source manifest.

Download the CSV from the source URL in the artifact manifest, then:

```sh
python analytics/nba_historical_source.py --input /path/to/nbaallelo.csv --output /path/to/new-report.json
python -m unittest discover -s analytics -p 'test_*.py' -q
```

Output uses exclusive creation and will not overwrite prior audits. Full local analytics suite: 69 tests passed (58 existing + 11 new). No existing repository files changed. No API credits consumed or recurring collection enabled.

## Remaining milestone gates

Obtain recent licensed results with authentic tipoffs and season types, independently reconcile score samples, and preregister a modern out-of-time window. Compare probabilities with no-vig market prices; then persist immutable pregame forecasts and separately settle outcomes. The public website should not label this old historical hit rate as current model accuracy. The previous live collection was independently checked: NBA 46 games/262 quotes, EPL 20/447; zero predictions/final scores, production READY at commit 649fe85a70324c86b5fb29e65b525be4d8baeb3a.
