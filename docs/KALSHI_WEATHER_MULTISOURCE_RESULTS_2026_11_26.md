# Multi-source weather challenger: first historical evaluation (2026-11-26)

**Model:** `knyc-multisource-emos-v1-research`.

**Method:** exactly as pre-registered in `docs/KALSHI_WEATHER_MULTISOURCE_PREREG_2026_11_26.md`. The protocol sha256 `23762ccab292…df77` was committed in `e54f08d`, before this data was read.

**Run:** CI [45753962096](https://github.com/ang87505-crypto/SportsEdge/actions/runs/45753962096) on code `ef076f7`.
- **Data:** PR #226's retrieval run [45752083379](https://github.com/ang87505-crypto/SportsEdge/actions/runs/45752083379), checked against #226's SHA-256 receipt.
- **Summary:** `research/kalshi_weather_multisource_v1_20261126/eval-2025-09-to-11-knyc.json`.

## Verdict (pre-registered rule): `NO_CLEAR_EFFECT` at both horizons

There are only **29** (day-ahead) and **30** (same-day) holdout days. The registered review minimum is **50**, so no conclusion can be drawn, whatever the scores. The learning-engine result is retrospective `NO_CLEAR_EFFECT`.

## Data

| Item | Value |
|---|---|
| **Outcomes** | 91 Central Park CLI next-morning reports, 2025-08-31 to 2025-11-30. The parser refused 91 evening interim reports, as it should |
| **NBM (NBS TXN/XND) and GFS MOS (X)** | 92 days at each horizon. Three duplicate NBS rows were dropped (first kept) |
| **NWS official and HRRR** | no historical archive admitted, so absent |
| **Burn-in** | the first 30 days of each horizon. Scored: 58 (day-ahead) and 60 (same-day) |

## Holdout scores (whole-degree CRPS, lower is better; Nov 2025)

| Model | Day-ahead (n=29) | Same-day (n=30) |
|---|---|---|
| **Combined** | 1.317 | 1.091 |
| NBM raw | **1.313** | 1.109 |
| NBM bias-corrected | 1.314 | **1.034** |
| NBM native `N(TXN, XND)` | 1.394 | 1.108 |
| GFS MOS bias-corrected (chosen on backtest) | 1.521 | 1.299 |
| GFS MOS raw | 1.594 | 1.279 |
| Trailing climatology | 5.107 | 4.819 |

**Other holdout metrics**

| Metric | Day-ahead | Same-day |
|---|---|---|
| Combined MAE | 1.86 °F | 1.50 °F |
| Combined 80% coverage | 0.76 | 0.83 |
| Combined − GFS MOS corrected, CRPS (block bootstrap 95%) | −0.20 [−0.32, −0.04] | −0.21 [−0.49, −0.01] |

## What this does and does not show

1. **The combination beat GFS MOS,** the backtest-chosen best member, on the holdout at both horizons. It also beat NBM's own published distribution and climatology, with calibrated 80% intervals.
2. **It did not beat NBM.** On the holdout, NBM alone (raw or bias-corrected) was as good or better: 1.313 vs 1.317 day-ahead, and 1.034 vs 1.091 same-day.
   - GFS MOS led on the October backtest and fell behind in November.
   - The pre-registered rule compares against the backtest-chosen member. On this sample that rule is flattering, so the comparison that matters is against NBM.
   - This sample therefore gives **no evidence that combining beats NBM**. That is consistent with NBM already blending GFS and HRRR.
3. **NBM's native `XND` spread is too narrow day-ahead:** 80% coverage 0.66 and log loss 2.79. Recalibrating NBM's uncertainty may matter more than combining models.
4. **The sample is one autumn at one station.**
   - Seasonal bias, horizon behaviour and station-specific errors cannot be judged from 3 months.
   - Trailing climatology is weak here because of the autumn cooling trend.
5. **Forecast accuracy is not profitability.** No Kalshi price, fee, fill or settlement (TWC-first, first non-preliminary report) was used.

## What would make the evidence decision-grade

- **Longer history, ≥ 50 holdout days per horizon:** at least one full year of KNYC NBS, GFS MOS and CLI (for example 2024-09 to 2025-11). This needs a larger retrieval in **#226 (ChatGPT owns retrieval)**. The evaluation workflow reruns on any such run ID unchanged.
- **NWS official forecasts:** forward only, from the existing collector.
- **HRRR:** needs a validated grid-point extraction before it can enter.
- **Forward paper testing:** remains `NOT_READY` (`paperReadiness()`) until:
  - NBM/GFS MOS are captured forward before each anchor;
  - 30 forward-frozen days and 50 forward holdout days exist;
  - the owner approves.

None of these steps changes a parameter. Any change to the method needs a new model ID.
