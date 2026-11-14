# Watch Only — every captured NBA player-prop line, no bets

**Implementation:** \`src/lib/props/watch-only.ts\`; **view:** \`/paper-betting/watch\`; **tests:** \`src/lib/props/watch-only.test.mjs\`. Draft PR #179, not deployed until independently reviewed and merged.

## Already-persisted source

The existing NBA props worker obtains only authorized/available PrizePicks and Pick6 player-stat lines through The Odds API, and stores each admitted source quote in \`props_observations\` before scheduled game lock. It also stores the baseline model forecast in \`props_predictions\` (scored or unscorable); later grade revisions go into \`props_line_results\`, including lines not selected for virtual entries.

Watch Only makes **no provider calls**. It reads the existing, bounded 90-day Supabase research snapshot and regenerates all its results from those immutable source records and latest admissible grade revisions. Each row shows the source platform, player, game, stat, original line, quote time, saved time, original model probability (or unscorable), result and actual box-score stat. Source rows from both platforms remain visible; a repeated event/athlete/stat/line counts once in combined accuracy, but platform-filtered figures count that one observation once. Unscorable lines remain visible at the default **All captured** filter.

No entries, user account, PrizePicks sign-in, new database writes, staking, fictitious payouts or dollar P/L are involved. The existing virtual entry and hypothetical even-money shadow ledgers remain separate. The new page will NOT start any extra collection, expand NBA coverage, bypass daily provider credits, change scoring algorithms, or affect scheduled NBA settlement / supervised stocks.

## Filtering

- **All captured** includes scored and unscorable lines with their original source.
- **60%+, 70%+, 80%+** use the **unconditional model probability of the selected side** from the frozen forecast. This is different from some existing model reports using conditional-over/under confidence given no tie.
- Group by Eastern-time game/slate day. The all-period metrics are based on the existing *90-day bounded read*, not claimed lifetime history.
- Toggle between both DFS source platforms and either one. Exact duplicate lines are never double counted in a filtered group.
- Grade only on a strictly after-lock result with an actual value agreeing with the reported outcome, or a verified void. Pending, unscorable and invalid records cannot be fabricated into hits or misses. Final corrections are applied via latest verified grade revision.
- Day-over-day cumulative accuracy is computed only from verified directional wins and losses; pending, ties, voids and unscorable rows do not change the denominator. A missing prior denominator produces an unknown delta, not a fake 0%.

## Important constraints

- This is a **read-only database-derived watchlist**. The underlying source records are already persistent; no new persistent watchlist table is needed, and the interface never inserts an artificial "bet".
- **Every captured line** does NOT mean every PrizePicks line in the app. The live collector only fetches its budgeted games and markets. The specific line is an indicative third-party feed; it may be unavailable, delayed or different for some users. Login is neither required nor desirable for this tracking.
- Pre-lock observations are validated against original timestamps, source-quote freshness, minimum lead time and fair probability sums. Historical results fetched later are never presented as if they were a pregame prediction.
- The retained window and total number of rows are bounded by the existing \`loadPropsResearch\` read contract (90 days; 20k per table). If that fails or is incomplete the page should say unavailable, not report no wins.
- Adding new sports/games or removing collection budgets requires separately verified source permissions, model research and controlled source credits. Recording every *available* prediction does not magically supply another 15–20 priced games daily.
- PrizePicks TOS, provider usage rights, data retention and applicable law still apply. Never scrape authenticated PrizePicks pages or silently create entries. This is research accuracy tracking, not a trading recommendation.

**Preflight verification:** \`node --experimental-strip-types --test src/lib/props/watch-only.test.mjs\`; full CI including production build, existing NBA props tests, and desktop/mobile browser smoke. Never merge until green.
