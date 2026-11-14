# Kalshi research — independent BLS CPI observation memory

**Draft only / not deployed or activated.** Implements a free public economic-data research archive alongside (but not inside) the Kalshi market adapter and NOAA weather collector. No exchange, stock, NBA or real-money behavior changes.

## What this adds
- One owner-gated, **weekly** BLS v1 GET using the existing reviewed `CUUR0000SA0` CPI-U All Items parser; no API key or Kalshi credits.
- Frozen data under `research-data/kalshi-independent/bls-cpi/observations/YYYY-MM-DD.json`: actual UTC collection timestamp, response digest, period IDs, numeric index readings, source ID and explicit `POST_PUBLICATION_SERIES_AS_SEEN_NOT_EVENT_TIME_VINTAGE` status.
- The first accepted observation for a UTC date is immutable. Re-running the same date verifies the saved record and makes **zero external calls**. If BLS changes a prior period afterward, the old collection remains unchanged and a later collection creates a new separate date.
- Always preserves the distinction between an **observed revised CPI timeseries** and a **point-in-time pre-announcement CPI forecast**, actual Kalshi settlement, market price or profitable trading opportunity. The archive cannot be used to backfill missing pre-release predictions.

## Release and cost guard
- Prepared workflow: `.github/workflows/kalshi-public-cpi-memory.yml`.
- Inert unless `vars.SPORTSEDGE_PUBLIC_CPI_MEMORY_ENABLED` is exactly `true` in GitHub Actions. Manual dispatch is also gated by that variable. Do not set it until this draft PR has passed checks and an operator reviews the data publication.
- One GET per active scheduled Wednesday; 4–5 public BLS requests per month, **zero** Kalshi API or Odds API requests. Manual calls are one at most per UTC day.
- BLS API v1 is public without registration. BLS documentation specifies up to 25 daily queries for unregistered users, so the proposed cadence is well below this limit, barring unrelated consumers. Use polite, bounded requests.
- Sources: https://www.bls.gov/developers/api_signature.htm and https://www.bls.gov/developers/api_FAQs.htm.
- The existing append-only research-data branch helper prevents editing previously recorded files. It shares its serialized concurrency lock with the NOAA and other research collectors.
- The data branch is public and records **only** public economic data; no user-specific account data, passwords, keys or market quote snapshots.

## Why this does not yet identify Kalshi opportunities
- BLS CPI publishes monthly, and CPI observations represent what was known **after publication**. Market research needs a separately frozen pre-release forecast, exact contract rules, independently verified contract outcome, and approved current Kalshi quotes (including spread, depth, series fees and slippage).
- Recording released CPI figures by itself does not prove a probability, edge, win rate or profit.
- Whether a New Mexico account and each specific Kalshi contract are eligible, and whether private AI quote retention and modeling are permitted, remains unresolved. The written permission request in `docs/KALSHI_API_PERMISSION_REQUEST_2026_11_13.md` remains unsent.
- Do not alter `KALSHI_DATA_PERMISSION_APPROVED` without actual applicable written authorization. **No automated real betting.**

## Test
`node --experimental-strip-types --test scripts/kalshi-independent-cpi-collect.test.mjs`

Offline tests use stubbed BLS payloads; **first real provider fetch is not validated by a green CI run**. Confirm live schema and archived source evidence on the first separately approved manual run before trusting a schedule.

Work deliberately stays outside Monday's stock PAPER execution path.
