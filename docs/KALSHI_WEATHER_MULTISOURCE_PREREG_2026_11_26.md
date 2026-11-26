# Kalshi NYC high-temperature challenger: multi-source EMOS (pre-registration, 2026-11-26)

**Model ID:** `knyc-multisource-emos-v1-research`

**Status:** pre-registered. Research only.

**Frozen parameters:** `research/kalshi_weather_multisource_v1_20261126/protocol.json`. Its SHA-256 is recorded in the commit that adds it. That commit comes **before** any historical outcome from PR #226 was read.

## Unchanged

- **Live collector:** the NOAA collector and its schedule.
- **Existing challengers:**
  - `nws-empirical-error-v0`;
  - `nws-empirical-error-pmf-v1`, including its 30-day minimum, horizon matching and 50-day review gate.
- **Historical retrieval:** PR #226 (ChatGPT) owns it. This work only reads its outputs.
- **Exchange access:** none. No Kalshi data, no orders, no stakes.

## Research basis

**Sources**
- **NBM text bulletins**, NWS/MDL v4 card (vlab.noaa.gov/web/mdl/nbm-textcard-v4.0):
  - `NBS` gives `TXN` (maximum valid **12Z–06Z**) and `XND` (its standard deviation, °F).
  - `NBP` gives QMD percentiles.
- **NBM documentation** (blend.mdl.nws.noaa.gov/nbm-documentation):
  - NBM already blends 100+ inputs, including GFS and HRRR;
  - bias correction uses a decaying average;
  - weighting is by mean absolute error;
  - an AWS archive exists from about May 2020.
- **GFS MOS:** the daytime maximum `X` is defined **7 AM–7 PM LST** (MDL TPB 05-05 and 05-07; NWSI 10-1601). The NWS NDFD MaxT uses the same window.
- **HRRR:** a 3 km model with hourly cycles. The 00/06/12/18Z cycles run to **48 h**. Archived on AWS (`noaa-hrrr-bdp-pds`) since 2014 as GRIB2 grids only; there is no station text product.
- **EMOS:** Gneiting et al. 2005, *Monthly Weather Review* 133:1098, doi:10.1175/MWR2904.1.
  - The predictive mean is a bias-corrected weighted average of member forecasts.
  - The predictive variance is linear in the ensemble spread.
  - Parameters are fitted by minimum CRPS on a trailing window.
  - In that paper, EMOS beat every bias-corrected member and the bias-corrected ensemble mean for 48-hour temperature.

**What this implies for SportsEdge**

1. **Kalshi's target window differs from every model's.**
   - Kalshi settles on the **CLI climate day**: midnight to midnight local standard time, 05Z–05Z.
   - NBM's max covers 12Z–06Z.
   - GFS MOS and NDFD cover 12Z–00Z.
   - Only a max of the hourly grid over the climate day (the live NWS collector, or HRRR hourly fields) matches it exactly.
   
   The models disagree most on warm-advection nights and cold-frontal mornings. Per-member, station-specific bias correction absorbs the average window difference; residual window error is part of the predictive variance.
2. **NBM already contains GFS and HRRR.** Combining them is not independent evidence. Weights are therefore shrunk 50% toward equal weights, and every member is also scored alone.
3. **Uncertainty should come from the spread and NBM's own `XND`,** not a constant. The variance is `a + b·spread²`, with `XND²` added to the spread when NBM is present.
4. **Bias and skill vary with the season and the horizon.**
   - A 30-day trailing window tracks seasonal bias.
   - Two fixed anchors are fitted separately: day-ahead at 14:00Z on D−1, and same-day at 11:00Z.
   - Every parameter is fitted per station.
5. **Historical availability differs by source.**

| Source | Historical archive |
|---|---|
| NBM, GFS MOS | IEM MOS archive (PR #226 retrieves it) |
| HRRR | grid-point extraction from GRIB2. Not built; not in #226 |
| Official NWS forecast | live capture only. NCEI's NDFD archive is unvalidated |

The model therefore runs on any subset of members. Missing members are renormalised, never imputed.

## Method (frozen; full constants in `protocol.json`)

**Admission.** A training day counts only if:
- its outcome was published before the anchor of the day being forecast;
- it has the same anchor;
- the same station.

The window is the 30 most recent such days. At least **30** are required (the existing minimum).

**Member selection.** For each member, use the latest cycle available by the anchor, at most 30 h old. Availability is the cycle time plus a fixed latency:

| Member | Available at |
|---|---|
| NBM | cycle + 2 h |
| GFS MOS | cycle + 5 h |
| HRRR | cycle + 3 h |
| NWS | capture time |

**Bias.** `g_i = f_i + mean(obs − f_i)` over the window.

**Weights.** Half equal weights, half inverse-MSE weights of `g_i`.

**Mean.** `μ = Σ w_i g_i`.

**Variance.** `σ² = a + b·s2`, with `(a, b)` chosen by minimum CRPS over the window on a fixed grid.
- `s2` = weighted member variance around `μ`, plus `XND²` when NBM is present.
- Floor: σ ≥ 1 °F.

**Distribution.** Gaussian, discretised to whole degrees over μ ± 25 with open tail cells, in integer ppm. This is the same output form as `nws-empirical-error-pmf-v1`, so the existing `contract-math` strike rules price every Kalshi strike.

## Evaluation (chronological)

**Walk-forward.** Every scored day uses only its own trailing window. Nothing is refit on later days.

**Split.** Scored days in date order: the first half is **BACKTEST**, the second half is **HOLDOUT**.
- The best single corrected member is chosen on BACKTEST only.
- The decision is made on HOLDOUT only.

**Compared on the same days and anchor:**
- each member raw;
- each member bias-corrected;
- NBM's own distribution `N(TXN, XND)`;
- trailing climatology;
- the combination.

**Metrics.**
- **Primary:** CRPS over whole degrees.
- **Secondary:** MAE, log loss, event Brier on the existing independent ladder, 80% coverage, PIT.

**Uncertainty.** 7-day moving-block bootstrap of paired daily CRPS differences, 2,000 replicates, seed 20261126.

**Decision (per anchor, on HOLDOUT)**

| Outcome | Conditions |
|---|---|
| `PROMISING` | ≥ 50 holdout days, **and** combined CRPS below the best corrected member, below NBM native and below climatology, **and** the bootstrap 95% upper bound of (combined − best member) < 0, **and** 80% coverage in [0.70, 0.90] |
| `REJECTED` | ≥ 50 holdout days and the bootstrap 95% lower bound > 0 |
| `NO_CLEAR_EFFECT` | anything else, including fewer than 50 holdout days |

This is **retrospective** evidence. The learning engine caps it at `PROMISING`. `READY_FOR_REVIEW` needs forward frozen evidence.

## Forecast accuracy is not profitability

No Kalshi price, quote, fee or fill is read. A better CRPS against CLI reports means better forecasts of the reported high. It does not mean a trading edge, because:
- prices may already reflect NBM;
- Kalshi settles on the first non-preliminary report (TWC first);
- fees and fills are unmodelled.

Profitability needs authorised market data and forward paper testing, both owner decisions.

## Path to automated paper testing (not enabled)

1. **Forward capture of NBM and GFS MOS,** frozen before each anchor. This belongs to the collector owner (ChatGPT); this PR does not build or change a collector.
2. **≥ 30 forward-frozen days per anchor.**
3. **≥ 50 forward holdout days** meeting the decision rule.
4. **Owner approval.**

`paperReadiness()` reports which of these are missing and returns `NOT_READY` until all hold. Exchange access stays disabled.
