# Sports page: visible quote freshness (2026-10-11)

**Scope:** Show explicit, automatically aging status for stored bookmaker prices, without calling the paid provider or placing any wager.

## Files

- NEW src/lib/ingestion/quote-display.ts: pure source/ingest timestamp, market completeness and original server freshness validation. Fresh, Aging, Stale and Incomplete labels. Maximum client age 60 seconds; server policy can only be tighter, never relaxed. A stale server label can never be promoted back to fresh.
- NEW src/lib/ingestion/quote-display.test.mjs: synthetic tests covering time progression, future timestamps, malformed values, incomplete markets and policy bounds.
- UPDATED src/app/sports/page.tsx: shows status beside each stored price; refreshes the status label as time passes even when the user keeps the page open. Adds Reload stored prices control, which only makes another GET request to SportsEdge's existing read-only sports route.

## What it cannot do yet

- Reload stored prices does NOT call The Odds API or refresh bookmaker prices. The owner may use the separate private, explicitly confirmed refresh mechanism from PR #25 after staged review and verified provider-cost limits.
- No price can be represented as guaranteed executable, even when the last source timestamp is recent.
- No paper-bet button changes, no owner session change, no new positions or settlements.
- EPL source prices still depend on the same stored feed and their own model quality.
- No merge, production release, or provider/API charge was part of this milestone.

## Verification

Unit tests for no future timestamps and 60-second expiry, all existing CI checks, lint, build and TS. Browser QA: open Sports, choose NBA/EPL, inspect Price status and watch it expire. Reload stored prices must call GET only and must not invoke collection or paper-bet routes.

## Next steps

This completes the visible stale-line warning, NOT a production live-odds service. Release still requires reviewing stacked branches, actual owner sign-in, safe migrations and provider quota limits. After a properly authorized collection, the site can display new stored prices; without any fresh collection it should show Stale / unavailable, never invented current prices.
