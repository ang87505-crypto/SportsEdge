# Learning and independent NOAA activation — November 19, 2026

## Verified production milestone

PR #188 merged as `40aad6eb85d27dba88ce1848897e875d0cd3e4d2`. Vercel production `/api/version` serves that commit. The old release document describes the pre-merge preparation; this document records subsequent activation evidence.

The first engine job, [44600945891](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44600945891), completed successfully at 19:42 UTC (12:42 MST). Its immutable `research-data` receipt is `learning-engine/runs/44600945891-1`. It read 543 clean unique graded non-tie baseline lines, including 131 recorded picks with 78 correct: 59.54%, with a descriptive Wilson interval of 50.98%–67.56%. The picks' confidence-minus-hit-rate diagnostic was about 5.47 percentage points, with a game-clustered interval spanning zero. This is not a demonstrated profitable edge.

The second engine job, [44601374227](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44601374227), restored the first receipt and completed at 19:44 UTC (12:44 MST). It reported `registryChanged: false`, added no repeated experiment, and preserved registry digest `13691fe18a88e41a4eac6d40a4df534c1cc0a9cadd92d2546395ecffe813ee0d`. Production `/lab` displays the published evaluation, rather than the historical seed.

These runs were triggered by re-running an already completed, duplicate-protected settlement slot. The settlement remains idempotent; no odds collection, budget increase, broker order, active model change or model promotion was performed.

| Challenger | Paired lines | Dates | Games | Candidate pick decisions | Evidence status |
|---|---:|---:|---:|---:|---|
| props-learn-v1 | 422 / 500 | 8 / 14 | 15 / 50 | 49 / 100 | Insufficient data |
| props-learn-v2 | 169 / 500 | 3 / 14 | 6 / 50 | 14 / 100 | Insufficient data |

V1 paired Brier was 0.255969 against baseline 0.255387, with candidate-minus-baseline interval [-0.003011, 0.004269]. V2 paired Brier was 0.265390 against baseline 0.266789, with interval [-0.004009, 0.001900]. They concern different paired samples and must not be ranked directly against one another. Neither comparison establishes an improvement. The existing production review gate remains authoritative.

## Independent NOAA evidence

The merged collector was run against the official next-morning Central Park report. It created three new immutable files under `kalshi-independent/nyc-weather/` for November 18: the preliminary daily climate source, the independent grade, and the forward scorecard. They were published as data-only commit `d7a9796855c71856962d8be058b9f3f29b55f8e0`, with an expected-head lease and no file replacement.

The forecast was frozen November 17 at 09:11:29 UTC, before the target day. The government product was issued November 19 at 06:46 UTC. Forecast: 60°F; preliminary station maximum: 64°F; absolute error: 4°F. The independent 60–64°F band contained the observation. There was no trained probability, so Brier stayed null. A second collector invocation used no network and preserved all three files byte-for-byte.

Production `/prediction-markets/kalshi` now shows one evaluated climate day and 4.0°F mean absolute error, explicitly labelled insufficient history and not bets. This verifies collection, derivation, publication and reading of one genuine pair. The next scheduled outcome job still requires its own successful receipt. Kalshi market prices, settlement verification, exchange access and real-money trading remain outside this independent government-source research.

## Next probability-diagnostic milestone

The follow-up scorecard is descriptive. It adds binary Brier and log loss on admitted non-tie baseline lines, a fixed 50/50 Brier reference, and predeclared breakdowns by statistic, selected side, selected confidence, player history, minutes variability, and mean-to-line distance. Missing context stays unknown; duplicates do not increase sample size; zero-data groups have null scores. Brier-difference and confidence-gap intervals resample entire games. Hit-rate Wilson intervals are labelled descriptive because they do not account for game correlation. Groups below 40 lines or 10 games are flagged small.

These overlapping views cannot select or promote a model, and are not independent confirmations. Conditional binary scores exclude ties and should not be compared directly with the challengers' tie-aware multiclass scores above. Old archives remain readable without the optional scorecard. Failed or malformed optional reports cannot supply current diagnostics. Valid predictions before a challenger's original registration are counted separately from invalid predictions; neither is admitted to that forward comparison.

No model coefficient, capture budget, betting threshold, stake rule, production gate, stock code or database schema is changed by the scorecard.

Local verification: the JavaScript suite discovers 965 tests, with 918 passing, 47 database-dependent skips, and zero failures. The focused engine/reader suite passes all 39 tests, including hand-calculated proper scores, clustered intervals, duplicate exclusion, predeclared bins, empty and one-game samples, invalid archive refusal, backward compatibility, and the registration-window classification. TypeScript, production build and owner-sign-in HTTP smoke pass. Lint has zero errors and six existing warnings. CI and the preview must verify the exact published head before release; a subsequent live engine run must publish the new scorecard before the new production panel is called verified.
