# Kalshi K0 — isolated read-only market data (2026-11-13)

Related: [Issue #169](https://github.com/ang87505-crypto/SportsEdge/issues/169).

This draft adds a **non-production research library**, not a live Kalshi integration. It makes **no requests unless explicitly imported and called**. It has no page, cron, database table, API keys, account, authenticated endpoint, deposit, order or live trading path. It does not change sports picks, Alpaca PAPER, the Monday freeze, or PR #102.

The initial allowlist is **only** the Kalshi NYC daily temperature series `KXHIGHNY`, because Kalshi's official quick-start documents it explicitly. No sports markets, economic series (not yet independently verified), or arbitrarily entered market URL can be used. Weather market settlement rules must be independently verified against official source material before developing any forecast.

## Data safety
- Source root hardcoded: `https://external-api.kalshi.com/trade-api/v2`; public GET only; no credentials or redirects.
- One bounded request per call, 8-second timeout, no automatic retries or persistent snapshots; 429 raises an explicit error.
- HTTP response capped at 200 KB; market count at 30; book depth 20.
- Provider dollar strings are parsed as **integer microdollars**. No pretend quote if an orderbook is empty or invalid.
- `buyYesAsk = $1 - best NO bid`, `buyNoAsk = $1 - best YES bid`; these are best displayed *orders at request time*, not guaranteed fills or net-of-fee opportunities.
- Latest traded price and UI percentage are deliberately not used to calculate executable prices.

## To test
```sh
node --experimental-strip-types --test src/lib/prediction-markets/kalshi/client.test.mjs
```

## Still required before any schedule or paper trading
1. Review Kalshi Data Terms and permitted retention/redistribution (public GET is not a perpetual data license).
2. Verify one permitted live read under supervision and real schema; no live read performed by this PR.
3. Research and approve specific weather/economic series, official station/settlement source and event timing.
4. Add immutable pre-lock forecast ledger, fee and slippage model, market benchmark, and forward outcome grading.
5. Owner must separately approve data collection schedules and any storage. Real-money trading is not part of K0.

Docs: https://docs.kalshi.com/getting_started/quick_start_market_data · https://docs.kalshi.com/getting_started/orderbook_responses
