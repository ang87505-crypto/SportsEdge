# Independent NFL and NHL daily research memory

**Draft, isolated, unmerged.** This is deliberately not part of the NBA props release, odds ingestion, stock PAPER execution or Kalshi exchange integration. All live money, player-prop and strategy release switches remain unchanged.

## Scope and providers
- NFL: `nflverse/nflverse-data` **schedules** release `games.csv` from `https://github.com/nflverse/nflverse-data/releases/tag/schedules`. See its CC BY 4.0 license and documentation; credit nflverse and Lee Sharpe (nfldata). This is the licensed release rather than scraping third-party bookmaker lines.
- NHL: SportsDataverse `nhl_schedule_{endSeason}.csv` release from `https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nhl_schedules`, CC BY 4.0; credit SportsDataverse / fastRhockey.
- Daily archive workflow: one **GET per league and UTC date**, at most two free public-dataset requests per scheduled collection day. Repeated completed dates verify immutable files and consume **zero** further source requests. A separately requested read-only preflight performs one additional public GET per selected league; it is never part of scheduled collection.
- The files do not contain bookmaker spreads, odds, market identifiers, Kalshi prices, user accounts, personal records, stakes or orders. Existing Odds API costs stay exactly as before.

## Data lineage and no-lookahead
At a real fetch timestamp, save the current season's schedule and source-reported older finals in `research-data/independent-sports/{nfl|nhl}/snapshots/YYYY-MM-DD.json`. The source URL, source SHA, observation timestamp, season and attribution are recorded; only whitelisted team/game/time/rest/score fields are retained.

For an event on the capture date or later, any provider-listed score is **suppressed** until a later day's independent snapshot. This avoids claiming in-progress/same-day scores are final. A 2026 schedule downloaded now is **not** an independent historical 2024 point-in-time forecast. Historical rows are observation-derived research material, not evidence that they were available pregame.

A frozen event snapshot is not a prediction or paper bet. Before enabling forecasting for any league, build a distinct versioned predictor, record probabilities before the game and grade only later finalized games. No winnings or 60% success percentages are inferred here.

## Protection / activation
- Draft PR only: no source controller, DB migrations, Odds API budget, props capture schedule, stock model, Kalshi data rights gate, Supabase project, Vercel configuration or active website route is changed.
- Workflow schedule is inert unless the repository **Actions variable** `SPORTSEDGE_INDEPENDENT_SPORTS_COLLECT_ENABLED` is exactly `true`. Even manual dispatch is gated. First confirm live provider schema and credits/permissions on an isolated research run.
- Set the Actions variable only after tests pass, the source schemas are checked against real files, and you consciously approve the public data branch archive. If the first run fails schema checks, it does not write a misleading record.
- The existing `.github/scripts/research-data-branch.sh` branch helper enforces append-only changes and disables Vercel deployments on research-data commits.
- NFL and NHL captures are **persisted separately**. If the NHL source fails after NFL succeeds, the NFL snapshot is already committed, and the workflow still reports the NHL failure. Conversely, NHL can still be attempted after a failed NFL download. Neither failure is silently treated as successful.
- Use `Actions → Independent NFL NHL daily research memory (no paid odds) → Run workflow` for a first supervised capture after merging and enabling; check the **research-data** branch for immutable files. GitHub schedules can be late/missed. Never rewrite a past prediction.
- To pause collection, remove or set the variable to false. It does not affect existing sports or stock workflows.

## Optional source compatibility preflight — no writes
Run these on an isolated trusted environment with internet access, **before** merging/enabling the scheduled workflow:

```sh
node scripts/independent-sports-preflight.mjs nfl
node scripts/independent-sports-preflight.mjs nhl
```

Each command makes **one bounded public release download**, parses the real CSV, checks required columns, current season, duplicates, timing and scores, and prints a compact source SHA, row count and timestamp. It **never writes a snapshot, database row, Git commit, bet or order**. No paid odds API or account token is used. It exits nonzero if the release file is missing, oversized, corrupt or incompatible. Verify the actual GitHub release asset, licence/attribution and both successful outputs before owner approval; a green mocked test suite is not live verification. Run the commands explicitly rather than as an automatic step in every PR, to avoid unplanned source requests.

## What to expand later
1. **MLB:** SportsDataverse MLB schedule archive has a `.csv.gz` release. Add bounded decompression and schema tests rather than assuming it matches NHL.
2. **NCAAF/NCAAB/WNBA:** add separately licensed public schedule/outcome feeds with stable IDs and source availability timestamps.
3. **Player statistics:** retain independent box scores, minutes, injuries and lineups where usage rights and identity matching are validated. Keep them outside the paid player-prop capture pathway.
4. **Kalshi weather/economic events:** continue NOAA and point-in-time macro releases independently; live exchange quotes and eligibility are a separate permissions problem.
5. **Prediction learning:** after enough forward seasons/games, compare calibrated models against time-matched baselines, then only promote shadow candidates via independent holdout gates.

Unit tests:

```sh
node --test scripts/independent-sports-collect.test.mjs
```

No live provider call is made in this test. A green synthetic CI suite does not certify first-source live compatibility. Live source preflight has not yet been completed or verified from this PR. 
