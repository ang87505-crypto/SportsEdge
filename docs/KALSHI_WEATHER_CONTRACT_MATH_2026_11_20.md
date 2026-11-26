# Kalshi weather prediction and contract math — November 20, 2026

## What this adds

A pure, offline package that turns one archived NWS forecast into probabilities for Kalshi-style NYC daily-high contracts, plus a reproducible evaluation of the archived evidence. Nothing here contacts Kalshi, stores Kalshi data, places orders, changes persistence, workers, UI, schedules or deployment, or promotes a model.

| File | Purpose |
|---|---|
| `src/lib/prediction-markets/kalshi/contract-math.ts` | Verified KXHIGHNY contract facts, strike operators → whole-degree ranges, ladder partition check, fee math, fee-inclusive EV and breakeven |
| `src/lib/prediction-markets/kalshi/weather-distribution.ts` | Registered challenger `nws-empirical-error-pmf-v1-research` (whole-degree distribution) and the **proposed** forecast input/output contract |
| `src/lib/prediction-markets/kalshi/weather-contract-eval.ts` | Walk-forward evaluation on an independent 6-contract ladder and the missing-data blocker report |
| `scripts/kalshi-weather-contract-eval.ts` | Offline evaluation of a `research-data` checkout, bounded by `--as-of` |
| `research/kalshi_weather_contract_v1_20261120/archive-evaluation.json` | Evaluation of the real archive at `research-data@e789e48` |
| `weather-model.ts` (edit) | The existing as-of gate is extracted into `validateTrainingAsOf` and `MIN_TRAINING_DAYS = 30` so both models use the same rule. v0's output is unchanged; its tests pass unmodified. |

## Verification results

All checks used public documents or public NOAA archives. No Kalshi API request was made, and no Kalshi quote was read or stored.

### 1. Historical forecast availability — **blocking**

- `api.weather.gov` does not serve past hourly grid forecasts. The only point-in-time NWS grid forecasts SportsEdge has are its own frozen captures, beginning with the 2026-11-15 target day. There are 7 forecasts in total (11-15 to 11-21).
- No backfill is possible for the registered model's input. A backfilled forecast would carry a capture time later than the event, and the as-of gate correctly refuses that.
- An alternative exists, but it would be a different model. The Iowa Environmental Mesonet (IEM) archives GFS MOS for KNYC with original run times (one run, 2026-11-14 06Z, was checked). However, MOS `n_x` is a 12-hour daytime maximum, not the CLI climate-day maximum, and it comes from a different product. Using it would need its own pre-registration and its own station/day mapping. This PR does not use it.

### 2. Station matching — matched, with residual settlement risk

- Kalshi KXHIGHNY settles on Central Park (KNYC / CLINYC). Sources: the GLOBALTEMPERATURE contract terms and the Kalshi help center.
- Our outcomes are the next-morning CLINYC reports for the same station and the same local-standard-time climate day (1 AM to 1 AM EDT during DST).
- Our forecast is the NWS 2.5 km grid cell `OKX/34,45` at Central Park. It is a modeled grid value, not a station value, and the residual model learns that bias.
- **Residual risk:** the contract lists The Weather Company first and the NWS second, and uses the first non-preliminary report. Kalshi can delay settlement if the CLI maximum conflicts with METAR 6-hour or 24-hour highs, or if it is lower than an earlier report. The code names our outcome "preliminary" because NCEI has not certified it. The help center says daily markets settle on this final next-morning CLI. A Kalshi settlement can still differ from it, so grades here are not settlements.

### 3. Forecast horizon — a real, previously unreported issue

- The workflow cron schedules the forecast for 01:11Z and the outcome for 09:17Z. The archived captures actually landed at **07:49Z–10:19Z** and the outcomes at **~17:50Z–19:40Z**.
- As a result, measured lead time to the start of the climate day is **18.7–21.2 h**, not the ~4 h the cron implies.
- If the delays disappear, the horizon changes by about 16 h, and residuals from the two horizons must not be pooled. The v1 challenger therefore counts only training days within ±6 h of the target's lead time.
- Because outcomes are fetched after that morning's forecast capture, every outcome reaches the model one day later than necessary. **Coordination item for Codex (owner of the workers):** consider running the outcome phase before the forecast phase.

### 4. Contract thresholds — verified

- "between" is inclusive, "above" is strictly greater, "below" is strictly less, and "at least" is ≥. CLI values are whole °F, so `above 66` means ≥ 67 and `below 59` means ≤ 58.
- An event is two strict tails plus four 2°F inclusive bins. The ladder alignment changes from day to day: both odd-start and even-start ladders have been listed. A single fixed band cannot price the event, so v1 produces a whole-degree distribution that any ladder can be summed from.
- The tick size is $0.01, the settlement value is $1.00, and expiration is 10:00 AM ET.
- The existing v0 5°F band is not a Kalshi bin. Its per-band probabilities do not sum to one across a ladder. The evaluation measures that gap.

### 5. Probability calibration — not yet measurable

- There are 2 paired days and 0 holdout days. No calibration statement can be made.
- The reliability buckets, 80% interval coverage, Brier, log loss and ranked probability score are implemented and run on synthetic fixtures. Synthetic fixtures are not evidence.

### 6. Current fee assumptions — verified, with one ambiguity

- The schedule effective 2026-07-07 is current. KXHIGHNY is not in the non-standard list, so the taker fee is `0.07 × C × P × (1−P)` and the maker multiplier defaults to 0. There is no settlement fee.
- **Ambiguity:** the schedule text says the fee rounds up so that fee plus position cost reaches a centicent. The schedule's own table is reproduced exactly, all 42 cells, only with whole-cent rounding (test: `contract-math.test.mjs`). The new code supports both rules and defaults to the more expensive table rule.
- The existing K0 `provisionalTakerFeeMicros` uses the centicent text rule and is left unchanged. Its `feeVerifiedForSeries:false` flag remains correct.

## Pre-registration: `nws-empirical-error-pmf-v1-research`

These parameters are fixed before any holdout exists. Changing any of them requires a new model ID.

- **Input:** one integer NWS grid forecast high per climate day, plus as-of training pairs of that forecast and the CLINYC outcome.
- **Admission:** the exact v0 gate (`validateTrainingAsOf`). It requires at least **30** pairs with outcomes published before as-of, and **30 of them within ±6 h of the target's lead time**. The 30-day requirement is preserved, not relaxed.
- **Distribution:** observed-minus-forecast residuals are clipped to ±25°F. Smoothing uses a discrete Laplace prior centered at 0, with scale `max(1.5, mean |residual|)` and a pseudo-count of 2. Each whole degree gets at least 1 ppm, and integer ppm values sum to exactly 1,000,000. The two edge cells hold the open tails. A strike that would split a tail cell is refused.
- **Evaluation:** walk-forward. Each day uses only outcomes published before its capture, and same-day captures are skipped. Scoring uses the independent ladder `≤f−5, [f−4,f−3], [f−2,f−1], [f,f+1], [f+2,f+3], ≥f+4`. Two baselines are compared on the same ladder: climatology (smoothed historical observed highs) and v0 per bin.
- **Review gate (not a promotion gate):**
  - at least 50 holdout days;
  - lower event Brier **and** lower log loss than both baselines;
  - 80% interval coverage within [0.70, 0.90].

  Passing only makes v1 eligible for owner review. `promotionEligible` is hard-coded `false`. Market-edge claims need price data, which is blocked (see below). Existing promotion gates and previous negative results elsewhere in SportsEdge are not touched.

## Proposed forecast input/output contract (for Codex)

The existing shared types are unchanged: `IndependentWeatherMemory`, `WeatherTrainingDay`, `PaperForecast`, the collector, and the research-data paths. The new contract is defined only in `weather-distribution.ts` and is not persisted anywhere yet. It is a proposal awaiting Codex's agreement before any worker, database or UI uses it.

**Input: `WeatherForecastInputV1`** (`schemaVersion: 'kalshi-weather-forecast-input-v1'`)

- `station: 'KNYC_CENTRAL_PARK'`
- `targetLocalDate`: the climate day, UTC−5 year round
- `forecastHighF`: an integer
- `forecastIssuedAt`
- `forecastAvailableAt`: the capture time, which is the as-of anchor
- `forecastSource: 'NWS_HOURLY_GRID'`
- `sourceDigest`

`forecastInputFromMemory()` derives this from today's frozen files with no migration.

**Output: `WeatherContractForecastV1`** (`schemaVersion: 'kalshi-weather-contract-forecast-v1'`). The `id` is a sha256 of the content.

- `status` is `AWAITING_VERIFIED_HISTORY` or `UNCALIBRATED_EXPERIMENTAL_MODEL`. `blocker` names the reason; insufficient history is a status, not an exception.
- Training fields: `leadHours`, `trainingDays`, `horizonMatchedDays`, `trainingDigest`.
- `distribution` holds the whole-degree pmf, or `null`.
- `contracts[]` holds `{strike, range, probabilityYesPpm}`. Probabilities are `null` until history is sufficient and are never guessed.
- `marketDataUsed: false`.

**Questions for Codex before shared adoption:**

1. Should the frozen forecast store this output beside the v0 fields, or in its own immutable path (for example `kalshi-independent/nyc-weather/contract-forecasts/`)?
2. Can the outcome phase run before the forecast phase?
3. Should IEM-recovered CLI products be admitted under a distinct provenance (next section)?
4. Which strike ladder should the UI show while the Kalshi permission is pending? The independent ladder is the default proposal.

## Explicit missing-data blockers (archive at `e789e48`, as of 2026-11-20T19:00Z)

| Code | Detail |
|---|---|
| `INSUFFICIENT_TRAINING_PAIRS` | 2 of 30 pairs (11-18: forecast 60 / observed 64; 11-19: forecast 61 / observed 64). If every day succeeds, the 30th pair is target **2026-12-17** and the first v1 forecast is captured **2026-12-19**. Each missed day adds a day. |
| `OUTCOMES_MISSED_BY_COLLECTOR` | 11-15, 11-16 and 11-17 have frozen forecasts but no archived outcome (the parser failure before the fix in #186). The latest-text NWS endpoint no longer serves them. The IEM AFOS mirror still has the original next-morning products: **49°F** (issued 0706Z 11-16), **55°F** (0621Z 11-17), **57°F** (0649Z 11-18). They are listed here for review only and are **not admitted**. The current parser requires a fetch within 36 h of issuance, and a mirror recovery needs its own provenance type and owner decision. Admitting all three would still leave 25 missing. |
| `OUTCOMES_PENDING` | 11-20 and 11-21 (next-morning reports not yet published or fetched). |
| Kalshi market data | Not authorized (Developer Agreement and Data Terms; request drafted, not sent). Without prices, no edge, ROI, fill or fee-adjusted P&L can be evaluated. Exchange networking keeps its permission checks. |
| Settlement source | Kalshi ranks TWC above NWS and uses the first non-preliminary report. Our grades are NWS CLI only, not Kalshi settlements. |
| Fee rounding | Schedule text and table disagree; the conservative table rule is the default until Kalshi confirms. |

## Reproduce

```bash
git fetch origin research-data
```

```bash
git worktree add --detach /tmp/research-data e789e4852d838bf6d15ff55fe49724e122b1c757
```

```bash
node --experimental-strip-types scripts/kalshi-weather-contract-eval.ts /tmp/research-data --as-of 2026-11-20T19:00:00Z --archive-ref e789e4852d838bf6d15ff55fe49724e122b1c757 --out /tmp/archive-evaluation.json
```

```bash
diff /tmp/archive-evaluation.json research/kalshi_weather_contract_v1_20261120/archive-evaluation.json
```

The run reads only the checkout and admits only files captured or fetched by `--as-of`, so later archive growth does not change this report. Input file digests and an aggregate digest are included. Aggregate digest: `3c56651dc55c53f36b56cc4075a916fb498599438718659a70158183b5e76552`.

Tests:

```bash
node --experimental-strip-types --test src/lib/prediction-markets/kalshi/*.test.mjs scripts/kalshi-independent-weather-collect.test.mjs scripts/kalshi-weather-contract-eval.test.mjs
```

## Sources (read 2026-11-20)

- Kalshi fee schedule, effective July 7, 2026: https://kalshi.com/docs/kalshi-fee-schedule.pdf
- GLOBALTEMPERATURE contract terms: https://assets.kalshi.com/contract_terms/GLOBALTEMPERATURE.pdf
- Kalshi help center, weather markets: https://help.kalshi.com/en/articles/13823837-weather-markets
- IEM AFOS archive, CLINYC: https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py?pil=CLINYC
- IEM MOS archive, KNYC GFS: https://mesonet.agron.iastate.edu/api/1/mos.json?station=KNYC&model=GFS

## Next, in order (not started in this PR)

1. One NBA recalibration challenger, pre-registered against the existing NBA gates.
2. Stock turnover and allocation research.

Prior verdicts stay recorded as they are, including HOLDRANK10's `BEATS_CURRENT_BELOW_MATCHED_SPY` and the props availability challenger's `NO_CLEAR_EFFECT`.
