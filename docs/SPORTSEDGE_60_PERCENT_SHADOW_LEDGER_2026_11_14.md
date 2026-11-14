# SportsEdge 60%+ shadow forecast ledger — November 14, 2026

**Status: draft PR, not merged, not deployed, not changing any live strategy or limit.**

## What is already real

The current NBA props collector writes **every scored player-stat prediction**, **every model pick/skip decision**, and **the original DFS line** to the existing Supabase `props_observations`, `props_predictions`, and `props_picks` tables *before the event*. Later box-score grading is stored as append-only `props_line_results` revisions. Actual virtual entries are tracked separately in `props_entries` + `props_entry_settlements`, including available real PrizePicks simulated settlement and Pick6 payout-unknown status. The existing /paper-betting/predictions page already displays all-model results.

This addition does not require more paid Odds API calls, another database, a new migration, or more credentials. It uses the existing **owned Supabase ledger**, with a 90-day bounded read, to derive a reproducible research-only shadow study. Individual hypothetical selections are traceable to existing immutable `observationId`/`predictionId` source records; no separately asserted execution receipt is invented.

## Rules and evidence

- Threshold: **original raw model probability >=60%**, no artificially lowered/retuned probability, and **no upper limit in the study**. Every admissible pre-lock saved forecast above 80% is visible, but flagged as outside the current production pick rule's 60–80% band.
- Source: `props-nb-minutes-rate-v1` forecasts in the existing research loader. Other models and sports must get their own separate source-and-grading contracts. This is not a claim to cover NFL/NHL/EPL or all sports today.
- Deduplication: one first-captured immutable forecast per `event|athleteId|stat|line|modelVersion` across PrizePicks and Pick6. Rechecks, later odds movements and other platforms do not replace the original forecast.
- Time integrity: original observation, provider quote, data cutoff, and forecast must be recorded before lock. The first quote must be reasonably fresh; late/future/malformed data is rejected.
- Final result: only the latest valid revision graded **after** lock and consistent with the reported numerical statistic. Missing grade, future grade, inconsistent actual, and incomplete/unverified result remain PENDING.
- Recorded picks and imaginary shadow study selections remain separate: a research forecast is not a wager, and the existing 3-entries/day/account cap stays intact.

## Hypothetical P/L, not actual profits

For comparability only, **each** research candidate has a fixed imaginary $5 stake at fictitious decimal odds **2.00 (even money)**:
- win = +$5 net;
- loss = −$5 net;
- tie/DNP/postponed = $0 net;
- pending = null/unknown.
- pre-game hypothetical expected net = $5 × (original probability of chosen side − original probability of opposite side). Ties contribute $0, not a loss.

These benchmark prices are **never claimed to be executable**. They do **not** represent real sportsbook quotes, individual PrizePicks payouts (which require multiple legs), Pick6 peer-pool payouts, Kalshi contract prices, actual account equity, or real cash returns. For actual settled virtual *entries* refer to the original /paper-betting/props ledger.

If a future authorized sportsbook-price study is approved, only exact same-line PRE-DECISION quotes from the existing `props_book_quotes` table may be matched; never reconstruct market odds from the outcome or post-lock prices. A hypothetical positive model edge at imaginary 2.00 odds is not a profitable executable opportunity.

## Coverage and limits

The goal of **15–20 unique games/day** is a study target, not a forced number of bets. SportsEdge cannot manufacture 15–20 priced NBA games/day under its current credit policy. The present props collector budgets roughly 7 worst-case credits/day and 200/30 days; an event-odds request typically reserves 3 credits for three markets. Free NFL/NHL results archives are in draft PR #172 but are **not player-prop forecasts**. Expansion needs separately licensed sources, game/event ID reconciliation, sport-specific models, and forward quality checks before paper picks are recorded.

**Kalshi**: the separately merged independent NOAA workflow `.github/workflows/kalshi-independent-weather-memory.yml` can archive public weather once scheduled and run; this study does not touch its timetable. BLS CPI memory and NFL/NHL results archive PRs #173/#172 remain draft; their sources and flags require separate review. Kalshi exchange market data/API storage/reuse remains blocked pending verified rights and account eligibility. Never feed public NOAA forecasts through an unverified Kalshi contract-payout calculator.

## Verification and safe deployment

`node --experimental-strip-types --test src/lib/props/shadow-ledger.test.mjs` verifies threshold inclusion, same-line deduplication, pre-lock chronology, impossible probabilities, result revisions, ties, DNP, pending outcomes, null unknown P/L, hypothetical winnings and no missing evidence counted as losses. General repo CI must also pass lint/Next production build and browser smoke.

Merge this read-only page only after review of all green checks and proof of zero new Odds API calls, no Supabase writes, no changes to release switches or database schema. No automation is turned on by this feature, and no new real-money mechanism is built.
