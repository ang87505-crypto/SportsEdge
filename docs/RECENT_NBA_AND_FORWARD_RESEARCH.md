# Recent NBA evaluation and forward research

## Evidence

The fixed NBA Elo model (initial rating 1500, K=20, home advantage 65) was evaluated chronologically on 2,460 regular-season games from 2024–25 and 2025–26. The previous two seasons supply the initial rating history. Each prediction precedes its game's rating update; parameters were not selected against these test results.

| Metric | Elo | Always pick home |
|---|---:|---:|
| Correct game winners | 1,635 / 2,460 | 1,351 / 2,460 |
| Accuracy | 66.46% | 54.92% |
| Log loss | 0.61833 | 0.68862 |
| Brier score | 0.21422 | 0.24774 |

2024–25 accuracy is 65.45%; 2025–26 is 67.48%. These are retrospective winner predictions, not betting win rate or profit. Historical matched sportsbook prices were unavailable, so historical ROI is not computed.

SportsDataverse CC BY 4.0 ESPN schedule and NBA Stats schedule mirrors agree on every admitted score, team pair and local game date across all four 1,230-game seasons. Both mirrors share a publisher. Direct NBA pages confirm a six-game sample only; a conflicting Toronto/Brooklyn live recap text is retained as an audit limitation. Full independent original-source verification remains false. Source asset URLs and SHA-256 hashes are pinned in `src/data/research/nba_recent_sources.json`.

Reproduce after downloading the eight pinned assets into one directory, prefixing the NBA Stats filenames with `official_`:

```sh
python analytics/nba_recent_source.py --folder /path/to/assets --manifest src/data/research/nba_recent_sources.json --output /path/to/new-report.json
```

The output path must not already exist. The checked-in summary and per-game predictions preserve the evaluation for review. Training ends April 2026; this model has no offseason roster, injury or lineup adjustments.

## Forward ledger

The immutable model version is `nba-elo-k20-h65-2026-04-v1`. Three opening-night fixtures were checked against the NBA's official 2026–27 schedule before publishing forecasts on October 8, 2026. Forecast timestamps come from the database and must precede tipoff. Publication is idempotent; frozen predictions cannot be edited or deleted.

The shared research account starts with $1,000 in virtual funds. Three simulated positions reserve $29.70, leaving $970.30 available. No results have settled; live win rate and ROI remain unavailable. This is a shared experimental account, not a personal user account and not a real-money betting integration.

Paper placement requires a complete two-way pregame market, matching provider/book/time, quote and receipt no older than one hour, at least 2% model expected return, and a 1% available-bankroll stake. All recorded positions retain their actual source quote, model probability and market no-vig probability. Account row locking prevents overspending concurrent requests.

Final settlement uses ESPN final regular-season results with exact scheduled tipoff, home/away team identity and valid unequal scores. Duplicate conflicting results fail closed. Rescheduled games require review; cancellation voids require a separately verified result record. Settlement is idempotent and uses integer cents. Drawdown uses realized equity; void stakes are excluded from ROI turnover.

All ledger tables have RLS and no client access policies. RPCs are security invoker and executable only by service role. The protected POST `/api/internal/research` accepts `publish`, `paper`, or `settle`, using the existing ingestion token. Public `/api/research`, `/research/nba`, and `/paper-betting` expose research data without credentials. Public sports reads use stored quotes and do not spend Odds API credits.

No recurring collector or settlement schedule is enabled by this change. No Odds API credits were consumed for this milestone. Fresh market collection and later settlement are separate operations. Soccer modeling, personal account flows, and stock research remain outside this milestone.

## Validation

78 Python tests and 33 JavaScript tests cover model chronology, source integrity, odds ingestion, result validation and paper accounting. Database transaction checks verified immutable/idempotent publication, position sizing, settlement payout and repeated settlement without leaving synthetic rows. Lint, production build and TypeScript checks run before deployment. GitHub CI repeats the analytics and ingestion checks.
