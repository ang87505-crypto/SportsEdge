# NBA Game Analysis — read-only milestone (2026-10-11)

## What changed

**A new, user-visible site feature**, not a reimplementation of the research engine.

- src/lib/nba-opportunities.ts (new): deterministic screening logic joins frozen published NBA forecasts to stored complete bookmaker price pairs. Screening checks forecast chronology, exact team mapping, model version, odds format, source/ingestion time, same-market bookmaker/provider, no-vig probabilities and a hard maximum age of 60 seconds. Screening is NOT a placed wager.
- src/lib/stocks/nba-opportunities.test.mjs (new): synthetic tests for price changes, stale/future times, incomplete markets, bad probabilities, invalid model timing and absence of side effects. Stored under the existing CI Node test glob.
- src/app/opportunities/page.tsx (new): responsive NBA Game Analysis cards showing model probabilities, recorded source prices, no-vig chance, model-estimated EV when fresh, source timestamps and clear no-bet reasons. Reads existing GET /api/sports?sport=nba and GET /api/research. A 5-second clock updates whether displayed prices have expired; clicking Refresh re-reads stored data and does not call a paid sportsbook provider.
- src/app/sports/page.tsx (one existing-file edit): prominent link to NBA Game Analysis above the existing NBA/EPL sections. No existing content removed.

## Critical limits

- This branch is **stacked on draft PR #22**, which itself depends on PR #21 and earlier work. No release, DB write, provider spending, scheduler, new bet or main-branch change has occurred.
- **NBA-only, read-only.** A screened result is only a mathematical research filter pass for a recently observed price. It is not a live sportsbook offer or an actionable guaranteed wager. The server must independently revalidate immediately before any paper placement.
- Quotes older than 60 seconds fail even when an old freshness label claims they were fresh. Source and ingestion timestamps are checked independently.
- A complete market requires two outcomes from one sportsbook/provider, identical original observation timestamps and matching independently derived no-vig probabilities. Inconsistent or incomplete markets fail closed.
- The upstream odds query caps results at 1,000. Truncation is warned about; more comprehensive pagination needs another milestone.
- Forecasts currently depend on an April 2026 NBA Elo snapshot and do not include latest roster, injuries or lineup uncertainty. Historical winner accuracy does not prove profitable betting.
- EPL opportunities, automatically collected fresh prices, result settlement automation, the stock simulator and separate 100 x $10 NBA experiment remain outside this milestone.
- All existing stock practice data and NBA research positions remain unchanged.

## Verification checklist

Run:
- node --test src/lib/stocks/nba-opportunities.test.mjs
- all existing Node test suites (CI)
- python -m unittest discover -s analytics -p test_*.py
- npm run lint
- npx tsc --noEmit
- npm run build

Preview:
1. Open Sports and follow Open NBA Game Analysis.
2. Confirm clear no-price/no-forecast reasons when current eligible markets are unavailable.
3. Refresh stored data, verifying GET calls only and no new virtual bets.
4. Leave the page open; an aged quote must become stale without fetching new provider credits.
5. Check mobile and keyboard navigation.

## Next independent milestone

Review odds-provider quota, current feed, source audit and scheduling; implement authorized ingestion and source-complete price integrity; verify owner authentication and durable idempotent receipts; test the no-bet-on-line-change path end to end before ever enabling Run.

This is a tested website foundation feature, not a declaration that sports betting is ready for production.
