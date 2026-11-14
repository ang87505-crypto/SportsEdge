# SportsEdge: Independent NOAA weather memory for prediction-market research

Prepared November 13, 2026. Draft PR #170; all of this remains unmerged and inactive pending owner review.
This feature is not a Kalshi data feed, trading account, or real-money system.

## What is now implemented
1. Once the owner reviews/merges the research PR (not before Monday's supervised stock PAPER session), the independent NOAA weather workflow will wake daily. It collects an NWS hourly grid forecast for the 24-hour Central Park local-standard-time climate day (midnight EST to midnight EST, UTC-5 year-round). It stores the *complete original normalized hourly snapshot*, issuance/capture timestamps, gridpoint URL, SHA-256 digest and separately computed forecast high. No Kalshi URL is contacted.
2. The first eligible forecast on each date is frozen to a new immutable file in the existing GitHub research-data branch at kalshi-independent/nyc-weather/forecasts/YYYY-MM-DD.json. Duplicate scheduled/manual invocations validate and reuse the file with **zero extra provider calls**. The existing branch-wide commit helper prevents updates/deletions to this path.
3. The next morning the workflow fetches the official NOAA/NWS CLINYC product from a fixed HTTPS URL, rejects any 4:30 PM interim reports or mismatched dates, and preserves the first full-day product text and parsed high in cli-daily-preliminary/YYYY-MM-DD.json. It is explicitly labeled PRELIMINARY: NCEI certification and possible post-publication corrections are separate.
4. If a matching earlier frozen forecast exists, the workflow calculates an independent 5°F range hit, absolute temperature error and Brier score if an appropriately pre-trained probability existed. The result is saved to independent-grades/YYYY-MM-DD.json. One unique climate date counts as one independent evaluated event, not one Kalshi trade.
5. The collector also writes a dated, immutable forward scorecard to scorecards/YYYY-MM-DD.json: unique matched days, mean absolute error, experimental band hit rate, number of scored model probabilities and Brier score. No market wins or P&L are asserted.
6. When 30 *previously observed and available* independent NWS grid forecasts paired with preliminary Central Park full-day CLI observations have accumulated, an existing empirical-error model can start issuing explicitly unvalidated 5°F band probabilities for later days. It excludes all not-yet-published outcomes and refuses targets that have already started.
7. The read-only /prediction-markets/kalshi research page displays the latest recorded independent forecast and optional preliminary observed high by reading the GitHub research-data branch. It does not call NWS or Kalshi when opened.

## Explicit resource budget
- First forecast capture: at most **2 free NOAA/NWS GETs** for the /points lookup + pinned hourly forecast; retries after success use the archive.
- Daily observed result: **1 free official NWS CLI GET**; retries after success use the archive.
- Opening the SportsEdge page: **0 NWS GETs, 0 Kalshi GETs**. It reads the GitHub archive, which is NOAA-only public data.
- Model training/replay: **0 provider GETs**; reads already archived local files. No ML API, LLM token charges, broker keys or paid service required.
- GitHub scheduled jobs can be delayed or dropped. Forecasts MUST have a real before-the-event capture time; missing days are missing, never backfilled with later data. The latest CLI source only serves recent products, so a missed outcome is not automatically recoverable from the current/latest text endpoint.

## Critical evidence boundaries
- NWS hourly grid forecast is a modeled forecast for an approximate 2.5 km grid, not an observed temperature at station KNYC.
- NYC climate-report high is preliminary, measured on local standard time (UTC-5) year-round, not automatically a Kalshi settlement. A report can later be corrected or certified by NCEI.
- This research uses the independently defined forecast-anchored [5°F] bin, NOT actual Kalshi market bins; official rules, reference source, special settlement conditions and fees MUST be checked separately.
- A reported 60% independent band hit rate is NOT a 60% winning Kalshi strategy. Market price, valid edge, liquidity, actual fills, fees, and market-specific settlement are separate.
- Latest/current BLS CPI values are NOT historical release-time vintages; economic forecasting requires its own proper point-in-time dataset.
- A forecast may be recorded immediately after the workflow is approved and active, but 30 **consecutive usable observation pairs** will take about 30 days at one pair/day from scratch; missing dates or invalid evidence increase this. Even at 30 pairs, skill is unproven and must be compared to baselines across many unseen days.

## Approval/activation boundary
The dedicated GitHub workflow is .github/workflows/kalshi-independent-weather-memory.yml. Its daily schedules are inert while PR #170 remains draft/unmerged. This PR must NOT be merged/deployed before Monday Nov 16 supervised stock PAPER acceptance.
This workflow writes only government-source independent research files to the existing research-data branch. It does not write to SportsEdge private account databases or Vercel secrets and cannot place trades.
A repo reviewer should examine the new workflow's contents:write scope and public research-data publication before merging. No personal data is stored there.

**Kalshi market ingestion is separately disabled**, despite the NOAA archive being free. The standard Kalshi API Developer Agreement restricts storage/reuse of exchange data to members' own trading use; exact AI, quote-retention, and private research scope needs written clarification and account/market eligibility validation. Ask Kalshi via docs/KALSHI_API_PERMISSION_REQUEST_2026_11_13.md, which is drafted but NOT sent. Only after an applicable permission/contract is confirmed should a *separate PRIVATE* authorized market-price adapter be added, using bounded TTL quotes and per-order fresh executable books. Never put Kalshi quotes on public research-data.

## Verification
Offline tests:
    node --experimental-strip-types --test src/lib/prediction-markets/kalshi/*.test.mjs
    node --experimental-strip-types --test scripts/kalshi-independent-weather-collect.test.mjs

The K0 PR CI runs this suite; all live government fetch calls in unit tests are injected mocks. The real NOAA scheduled fetch and official settlement outcome remain unverified until legitimate post-approval forward captures are recorded.

References:
- NOAA NWS API pricing, 7-day observation limits, and cache guidance: https://www.weather.gov/documentation/services-web-api
- NWS Central Park local standard-time climate report windows: https://www.weather.gov/okx/CentralParkHistorical
- NWS New York City CLINYC product: https://tgftp.nws.noaa.gov/data/raw/cd/cdus41.kokx.cli.nyc.txt
- Kalshi Developer Agreement: https://kalshi-public-docs.s3.amazonaws.com/Kalshi-Developer-Agreement.pdf
- Kalshi Data Terms: https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf
