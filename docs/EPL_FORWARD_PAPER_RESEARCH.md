# EPL forward paper betting — research milestone (October 8, 2026)

## Implementation and provenance

Added only new files: `analytics/epl_forward_paper.py`, `analytics/test_epl_forward_paper.py`, `src/data/research/epl_october_2026_fixtures.json`, `src/data/research/epl_october_2026_forecasts.json`, and `database/migrations/20261009_epl_forward_research_ledger_v1.sql`. No NBA model or positions were overwritten.

The immutable experimental `epl-elo-k20-h65-draw-pre20260408-v1` forecasts are linked to 10 EPL fixtures scheduled October 10–12, 2026, and published before kickoff in `public.research_epl_forecasts`. Data inputs were a pinned OpenFootball revision (`e6744429ee395bc86f247348c6184bb08d4eb361`), containing 778 completed source games across three seasons, with incomplete 2025–26 and 2026–27 coverage. Draw frequency was fitted to 665 pre-April 8 games (153 draws), with match-day time-ordered Elo ratings (K=20, home advantage=65), last included match September 20. **These are experimental model probability estimates, not bookmaker-implied odds, a validated betting strategy, or a guaranteed positive ROI.** Historical soccer model accuracy is not a sportsbook bet win rate.

The fixture identity, home/away club names and UTC kickoff are checked against stored `games` (all 10 matches exactly matched), referencing the Premier League's October fixture amendments: https://www.premierleague.com/en/news/4688862/fixture-amendments-for-premier-league-matches-in-october-and-november.

## New isolated tables

- `research_epl_forecasts`: immutable three-outcome probabilities, source revision, publication time and fixture identity
- `research_epl_accounts`: separate $1,000 virtual bankroll
- `research_epl_positions`: immutable selected source odds, model probability, no-vig probability and stake (currently empty)
- `research_epl_results`: official-result evidence to be separately verified; no result has been inserted
- `research_epl_settlements`: append-only virtual settlement (currently empty)

All use RLS and no `anon` or `authenticated` grants; service-role-only RPC `research_epl_place(account,game,quote)` evaluates a fresh, complete same-book three-way pregame h2h market, at least 2% estimated EV, positive no-vig model edge, available bankroll, one position per game, 1% stake. `research_epl_settle()` calculates cents from validated result rows. These RPCs are **not** scheduled or exposed to public calls; no real sportsbook orders are possible.

**No EPL bets were placed in this milestone:** the latest stored quote at time of check was more than one hour old. For integrity, do not bypass quote freshness by retroactively setting `placed_at`. Collect fresh Odds API quotes through the existing authenticated server collector, then separately call the service-role placement RPC only for surviving candidates. Do not mix this research account with NBA or personalized `paper_bets`.

## How to verify

```sh
python -m unittest discover -s analytics -p 'test_*.py'
python analytics/epl_forward_paper.py --fixtures src/data/research/epl_october_2026_fixtures.json --output /tmp/epl-new-snapshot.json
```

For an **exact reproduction**, use `--cache-dir <directory>` containing `2024-25/en.1.json`, `2025-26/en.1.json`, `2026-27/en.1.json` from the pinned commit. The command refuses to overwrite an existing snapshot. Compare probabilities with `src/data/research/epl_october_2026_forecasts.json` to confirm reproducibility. Check database counters for 10 EPL forecasts, zero EPL positions, zero EPL settlements, three pre-existing NBA research positions.

## Next independent milestone (not yet done)

1. Refresh provider quotes within the 1-hour live-quote window (may consume API quota).
2. Implement and test a server-only EPL placement runner reading stored forecasts and choosing only fresh full three-way markets; never insert positions from snapshots directly.
3. Implement independently verified full-time result identity, late changes, draw-safe settlement and dashboard display; run an end-to-end test before enabling automation.
4. Validate predictive calibration against chronological holdout and bookmaker fair-probability baseline; report observed paper ROI only after settled positions exist.

Do not promise 55% win rate or profitability. All positions are simulated research only.
