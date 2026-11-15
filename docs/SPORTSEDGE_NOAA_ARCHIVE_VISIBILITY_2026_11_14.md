# Verify independent NOAA weather capture, not exchange data — 2026-11-14

**Draft, unmerged and not a data collector activation.** Adds observation only to the existing operations monitor. It does not introduce Kalshi API calls, market quotes, prices, market scraping, account access, orders, paid data, new Supabase writes, new run schedules or a model promotion.

## Why

The existing **independent NYC weather memory** workflow is already in `main`: `.github/workflows/kalshi-independent-weather-memory.yml`. Its job can complete without establishing that a verifiable JSON file was actually archived (or on a different day than expected). At research review time, we could not find a forecast for **Nov 12, Nov 13, or Nov 14** at `research-data/kalshi-independent/nyc-weather/forecasts/YYYY-MM-DD.json`. That is a limited archive-path check, **not** proof that all NOAA processing failed or that no forecasts exist elsewhere.

## What changes

- `config/ops/jobs.json` adds an **optional** `public_events` job for the existing NOAA-only workflow. Planned GitHub times and completed workflow runs are shown separately. A run reported successful by Actions is **not** evidence of forecast/grade publication.
- `scripts/ops-monitor.mjs` uses **existing public GitHub `research-data` archive reader** `loadLatestIndependentWeather` and the scorecard reader. This checks only bounded public raw.githubusercontent.com URLs, with 404/unavailable/corrupt source separately handled. It never calls NWS, Kalshi, The Odds API or Supabase.
- `src/lib/ops/status.ts` adds optional `evidence.publicWeather` state with validated dates. Output remains compatible with legacy status files. UI/assistant ops summaries now distinguish a valid recorded forecast vs awaiting archive vs archive unavailable.
- `.github/workflows/ops-monitor.yml` can re-evaluate status when the existing NOAA workflow completes; it does NOT dispatch or enable that workflow. Its extra PR test verifies backward-compatible status parsing.
- Synthetics test future timestamps, fake status, missing archive, and refusal to label a NOAA forecast as a Kalshi win or contract quote.

## What needs attention if no data appears

1. Review GitHub Actions → `Independent NYC weather memory (NOAA only)` → latest four runs. Confirm whether forecast and outcome phases *started*, and which step failed. Do not treat a scheduled time as an executed job.
2. For a run that claimed success, check `research-data/kalshi-independent/nyc-weather/forecasts/<target>.json`, and verify timestamp before target climate day plus SHA integrity. If absent, inspect the research-data branch commit step.
3. Check source attribution and NOAA API status/rate limits. Do **not** reconstitute a forecast retroactively from weather observations or past model output.
4. If a case fails, open a separate small PR with a mocked regression before modifying a live collector. Preserve existing immutable data.
5. Record each verified forecast/outcome pair over enough future days for calibration. Independent NWS grid forecasts, preliminary Central Park CLI reports, actual Kalshi settlement data and executable contract prices are **four different evidence sources**.

## Status and usage

The `/automation` monitor and Ask SportsEdge system-health summary can show the new status after a review/merge. This PR does not automatically collect any new data. The workflow exists in `main`, but the archive and Action receipts must be verified independently before claiming it is functioning.

**Exchange market data remains blocked** pending explicit permitted data storage/reuse scope and account eligibility; do not import exchange quotes into publicly published GitHub research-data. No real-money trading mechanism is included.
