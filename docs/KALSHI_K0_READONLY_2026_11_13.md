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

## 2026-11-13 development update — permission gate and offline paper components

### Important: published Kalshi Data Terms
I reviewed the official three-page **Kalshi Data Terms of Use** linked in the homepage footer:
https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf

The text describes personal non-commercial access, but explicitly excludes software development using Kalshi Data without prior written consent. It separately restricts collection, compilation, analysis, redistribution and use of Kalshi Data with machine learning/AI. **A public API endpoint does not automatically authorize an AI-powered platform to ingest and learn from Kalshi prices.** Determine whether Kalshi offers a separate written API/data license for this use; obtain/record authorization before enabling any network collection, data storage, public display or AI feature.

The connector now **fails closed** when a real network fetch is attempted unless the owner has reviewed written rights and explicitly configured both:
`KALSHI_DATA_PERMISSION_APPROVED=1` AND `KALSHI_DATA_PERMISSION_REFERENCE=<reviewed consent/license identifier>`.
Mock-injected requests are for locally created synthetic fixtures only; these variables do not by themselves prove legal permission. Never set them speculatively.

### Built, committed, tested on synthetic fixtures
- `paper.ts`: immutable timestamped research forecasts, strict pre-event cutoff, limit by observed depth, correct opposing-book ask pricing, provisional fee and explicit slippage; **hypothetical fills only**.
- `settlement.test.mjs` + `getWeatherOfficialResult()`: fail-closed official-result parser from the GET-only market API, requiring `settled` and actual `yes/no`; rejects ambiguous/void/revised rules and records response digest.
- `evaluate.ts`: Brier score, log loss, paired market-midpoint benchmark, independent-event count and *hypothetical* fee-adjusted virtual P&L/ROI/drawdown; never labels modeled returns as realized profits or a proven edge.
- `nws.ts`: independent NOAA/NWS Central Park-region hourly-grid weather forecasts (free public API) with issuance timestamp, host-pinned URL, no fabricated probability or station settlement. Explicit call and meaningful User-Agent required.
- `src/app/prediction-markets/kalshi/page.tsx`: static blocked/readiness interface. No service call, trade or public market data.
- `kalshi-paper-verify.yml`: isolated synthetic-fixture Node tests, no secrets or external network.
- No actual Kalshi API request has been made, no user account is connected, no new production route is deployed, and no authorized collection or trading is running.

### Still blocked / not built
- Written clarification or grant from Kalshi (or applicable authorized data feed agreement) for AI-powered price use, model training, storage and redisplay.
- Weather market resolution station-specific data and historic *as-of* forecast calibration to create a genuine independent probability model. Hourly grid point estimates are not probability forecasts or certified Central Park outcomes.
- Real quote ingestion; durable live forecast and settlement storage; licensed historical datasets; scheduling; monitoring; actual proof of alpha.
- Economic market series/fees; nonstandard Kalshi products; expanded sports markets.
- Any Kalshi authenticated or real-money execution: **NOT IMPLEMENTED**; New Mexico sports rules contested, account/product eligibility must be rechecked, and explicit future authorization required.
- Nothing should be merged/deployed before Monday's 2026-11-16 stock PAPER acceptance/freeze gate.

### Suggested permission request
Ask Kalshi Developer Support whether the exchange permits the proposed private research use under an API/data agreement: collecting and retaining bounded quotes, calculating fair probabilities using independently developed models, comparing market-implied prices to those models, maintaining an internal paper-trading ledger, and optionally displaying derived statistics in a personal/private app; ask separately about AI-assisted research, raw data retention duration, redistribution, and real-money order API eligibility in New Mexico at age 19. Do not assume approval from registration or public market accessibility.

## Further progress: chronological weather replay, CPI data, final-settlement checks
- **Weather replay:** weather-replay.ts only trains on NWS/verified-station observations known before the forecast as-of, requires 30 known observations, evaluates fixed independent forecast-anchored 5 F bands, and compares against an unconditional climatology baseline. It uses no Kalshi data. Synthetic tests are not evidence of forecast skill.
- **Kalshi settlement lifecycle:** client.ts accepts terminal finalized/settled market statuses only alongside a valid settlement timestamp, binary yes/no result and no provisional flag. If provided, settlement value must match the outcome. paper.ts freezes both primary and secondary settlement rules and refuses later rule mismatches.
- **BLS CPI independent source:** bls-cpi.ts uses public GET on the BLS unregistered API v1 for CPI-U All Items, series CUUR0000SA0. Its current revised history is explicitly NOT original release-time vintages and cannot support point-in-time CPI release backtests. See https://www.bls.gov/developers/api_signature.htm
- **Permissions request ready but not sent:** docs/KALSHI_API_PERMISSION_REQUEST_2026_11_13.md. No written Kalshi authorization has been obtained. Kalshi support: https://help.kalshi.com/en/articles/13823855-contact-kalshi-support

### Further limitations
The public Kalshi Get Market endpoint is cached. The published market-list filter vocabulary and market record lifecycle statuses differ. The present normalizer is a conservative interpretation tested on synthetic fixtures, not verified live responses. Weather research bands are NOT Kalshi contract bins. Exact contract rules, fees, special settlements, original BLS release vintages, historical NWS archives, and licensed data rights remain external prerequisites.

All exchange connections remain disabled: no Kalshi API account, no live Kalshi collection, no quote storage, no orders or real money, and no production schedules. Nothing in this PR demonstrates a profitable strategy.

## Independent live-government-data memory — additional work
See docs/KALSHI_INDEPENDENT_WEATHER_MEMORY_2026_11_13.md for details and NOAA/NWS source links.

New research-only workflow .github/workflows/kalshi-independent-weather-memory.yml is prepared (currently inert because this PR remains unmerged). When the owner reviews and merges the research code after the stock PAPER release, its scheduled NOAA-only jobs will archive two GETs for a future NWS hourly forecast and one subsequent GET for the full next-morning Central Park CLI report. Duplicate successful dates use cached files rather than provider requests. Preliminary CLI observations are never called Kalshi settlements.

Immutable filenames: kalshi-independent/nyc-weather/forecasts/YYYY-MM-DD.json, cli-daily-preliminary/YYYY-MM-DD.json, independent-grades/YYYY-MM-DD.json and scorecards/YYYY-MM-DD.json on the existing append-only research-data branch. The site's read-only research view retrieves these archived independent records and displays forecast-high, training count, observed preliminary high, independent band coverage, and Brier when available. It makes zero Kalshi API requests.

Critical measurement detail: Central Park daily climate reports use local STANDARD time UTC-5 year-round, not an ordinary America/New_York civil-day window during daylight saving time. This timezone boundary is encoded and tested. NWS forecast grid temperature is not a station observation. Daily NWS CLINYC observations are preliminary, not NCEI-certified, and not an exchange resolution. Weather model calibration requires 30 earlier qualifying point-in-time forecast/report pairs and stays experimental. No live Kalshi prices, quotes, market-data archives, automatic trading, user accounts or real-money activity are enabled.

Kalshi-specific data use remains separately permission-gated. Do not upload exchange quotes to the public research-data branch or flip network switches based on NOAA permission.
