# NBA forward paper-betting experiment: 100 distinct $10 virtual wagers

**Status: REGISTERED, NOT ACTIVE / NOT COMPLETED**
**Study ID:** `nba-elo-100x10-v1`
**Registration:** October 9, 2026; no retroactive wagers admitted before 2026-10-09T07:34:06Z
**Target:** 100 eligible NBA model-driven paper wagers, fixed **$10 (1,000 cents)** each, with **$1,000 virtual bankroll** / maximum combined stake. **Zero** new bets enrolled at registration.

## Important distinction

This is a proposed *future-facing NBA sports-betting study*, not 100 fake or already-placed bets. The separate stock trader has no model or real market feed; the existing NBA research ledger has three previously recorded research positions, two at stakes below $10, and the existing automatic account sizing is 1% of available bankroll rather than fixed $10. **Do not rename, relabel, or retroactively import those wagers into this independent $10 cohort.**

At registration the database had only three published NBA forecasts and ten EPL experimental forecasts, zero EPL paper bets, and stored odds older than one hour. There is not enough contemporaneous quote/model evidence to create 100 prospective $10 bets now. No model has established profitable real-world execution. No future results are known or invented.

## Pre-registered method

- **One sport/model only:** NBA; model version `nba-elo-k20-h65-2026-04-v1`. Do not pool soccer outcomes or stock trades into its win-rate or ROI.
- At most **one wager per unique real NBA game**. Each prospective forecast must be published before placement and tipoff. The forecast and source odds must be provably present before the bet timestamp.
- Use only actual `h2h` sportsbook quote snapshots from one complete, two-outcome, same-sportsbook pregame market; odds must be observed and ingested no more than **one hour** before placement and strictly before game start. Never backdate or invent quote timestamps.
- Record one best eligible side by highest **model estimated EV**, requiring `p_model * decimal_odds - 1 >= 0.02` and `p_model > p_no_vig`. Deterministically break ties by source quote ID; retain the other side of the market to enable audit.
- Stake **exactly $10** every time. Stop accepting additional positions at **100 total**. Do not bypass available virtual cash.
- Save immutable `game_id`, selected side, model version, publication timestamp, source odds snapshot ID, all original price timestamps, the actual pregame placement timestamp, and odds and probabilities. Keep the separate NBA and EPL research accounts unchanged.
- Settle from independently verified NBA results, only after final status; void legitimately cancelled games. Compute won/lost profit in integer cents, with half-up cent rounding; verify source. Do not invent final scores.
- Do not select bets to improve prior results. Report selection rate (qualifying opportunities / observed opportunities), foregone games, book coverage, and stale-quote skips alongside results.

## Reporting

After each settlement show **recorded**, **pending**, **won**, **lost**, **void**, **settled win rate**, **settled stake**, **realized paper P&L**, **ROI**, and bankroll equity. Void bets are excluded from settled win-rate and ROI denominators. ROI stays **unmeasured** when no non-void wagers are settled. A 100-game sample remains small and cannot alone prove a persistent positive expected value; report uncertainty, price-quality and the difference between forecast calibration and realized ROI.

## Code introduced — safe evaluation milestone

- `analytics/paper_bet_study.py`: deterministic cohort validator, ledger arithmetic and evaluator, no network calls and no betting execution
- `analytics/test_paper_bet_study.py`: test coverage for prospective timestamps, incomplete study, exact stakes, odds arithmetic, duplicates, impossible timestamps and fabricated profits
- `src/data/research/nba_100x10_study.json`: **empty** registered study, explicitly not 100 fake bets

Run (no sports provider API usage):

```sh
python -m unittest discover -s analytics -p 'test_*.py' -v
python analytics/paper_bet_study.py src/data/research/nba_100x10_study.json
```

Expected evaluation initially: `recorded_bets=0`, `pending=0`, `roi=null`, `win_rate=null`, `available_cents=100000`.

**Limitations:** The evaluator validates internally consistent records; only independent verification against original Supabase quote IDs, immutable forecast and official game results can establish real-world provenance. Caller-supplied JSON alone is not proof a bet was placed. A functional runner, separate append-only database cohort, snapshot integrity/provenance, a constrained `place` RPC with fixed stakes, result reconciliation and secure scheduling have **not** yet been implemented or activated. Do not manually edit the `bets` array to impersonate official placement.

## Next separately reviewed milestone

Implement a distinct, append-only, fixed-stake NBA cohort in Supabase (new additive migration, never modify existing NBA/EPL accounts or original `research_place` RPC), then a protected server runner that refreshes eligible quotes within free API quotas and only inserts qualifying pregame positions under a strict 100-bet cap. Decide data provider quota/cost with the owner before any provider refresh, and never activate a schedule without confirming Vercel/Supabase execution and plan limits. Independently verify every step and document actual bet IDs before calling it operational.

If the user instead intended **100 stock trades**, do not use these sportsbook tests: the stock simulator currently uses manual prices and has no automated stock-selection algorithm. Design a separate stock test only after a reproducible model, licensed historical prices and realistic fill costs exist.
