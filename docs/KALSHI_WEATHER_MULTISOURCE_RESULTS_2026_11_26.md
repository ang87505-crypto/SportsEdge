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

## Full-year 2024 evaluation (added 2026-11-26)

**Run:** CI [45760830405](https://github.com/ang87505-crypto/SportsEdge/actions/runs/45760830405), code `63f13ca`.
- **Method:** the same pre-registered protocol, unchanged (`23762ccab292…df77`).
- **Data:** PR #226's run [45756206033](https://github.com/ang87505-crypto/SportsEdge/actions/runs/45756206033), receipt-verified.
- **Scope:** scored targets limited to the receipt's 2024-01-01 to 2024-12-31. #226 chose 2024 so the already-viewed autumn-2025 holdout is not reused as fresh evidence.
- **Summary:** `research/kalshi_weather_multisource_v1_20261126/eval-2024-knyc.json`.

**Verdict (pre-registered rule): `NO_CLEAR_EFFECT` at both horizons.** There are 166 holdout days each (2024-07-17 to 12-31). Every condition held except one: the bootstrap 95% upper bound of (combined − best corrected member) is not below 0.

| Holdout CRPS (lower is better) | Day-ahead | Same-day |
|---|---|---|
| **Combined** | **1.223** | **0.983** |
| NBM bias-corrected (best member on backtest) | 1.258 | 1.013 |
| NBM native `N(TXN, XND)` | 1.268 | 1.073 |
| NBM raw | 1.282 | 1.072 |
| GFS MOS bias-corrected | 1.436 | 1.291 |
| GFS MOS raw | 1.495 | 1.308 |
| Trailing climatology | 4.993 | 4.787 |

**Paired holdout differences, combined minus model** (mean [95% block-bootstrap interval]; descriptive):

| Versus | Day-ahead | Same-day |
|---|---|---|
| NBM corrected | −0.035 [−0.093, +0.021] | −0.030 [−0.101, +0.070] |
| NBM raw | −0.060 [−0.124, +0.018] | −0.089 [−0.168, +0.032] |
| NBM native | −0.045 [−0.128, +0.055] | −0.090 [−0.167, +0.029] |
| GFS MOS corrected | −0.213 [−0.302, −0.121] | −0.308 [−0.438, −0.209] |

**Calibration.** Combined 80% coverage is 0.84 (day-ahead) and 0.89 (same-day), inside the registered [0.70, 0.90]. NBM native is 0.77 and 0.81.

**Reading**
- **Against NBM:** on a full year, the combination is numerically the most accurate distribution at both horizons, about 3% lower CRPS than corrected NBM. The improvement is not statistically established, and the registered rule correctly does not call it PROMISING.
- **Against GFS MOS:** it clearly beats GFS MOS.
- **Combining vs NBM alone:** most of NBM's own gap is closed by bias correction plus spread calibration. The combination adds a small, uncertain amount on top.
- **No method change follows from this.** The challenger remains a shadow model. Evidence now accrues only through frozen forward forecasts; owner review needs 50 graded forward days per horizon.
- **Not profitability:** none of this is trading profitability.

**Data integrity (2024)**
- **Forecasts:** no conflicting duplicate forecast rows.
- **Outcomes:** 362 valid next-morning reports for 366 days. Refused:
  - 365 evening interim reports;
  - 3 with a WMO-header/printed-issuance mismatch;
  - 3 missing a high;
  - 2 wrong product;
  - 1 wrong station/date;
  - 1 not a next-morning report.
- **Repeated reports:** 4 later or duplicate reports; the first one counts.
- **Repeated zip entries:** the CLI zip repeats one entry name. The two differing copies were both kept and parsed, and nothing was overwritten.

**Sep–Nov 2025 re-run** with conflicting duplicates excluded: one NBS group, 2025-10-14 07Z for 10-16 (TXN 58 vs 59), was excluded. Results are identical to the original, because that 3-day-old cycle was never selected. Both files are kept: `eval-2025-09-to-11-knyc.json` (original, unchanged) and `eval-2025-09-to-11-knyc-rerun.json`.
