# Availability challenger integration review — 2026-11-19

The primary result remains **NO_CLEAR_EFFECT**. Its Brier difference interval crosses zero; the descriptive variance-only ablation does not override the registered primary comparison. Production activation is not supported by this result. The code is research only, and the registry proposal/result files remain unapplied.

The proposal originally stamped registration at `2026-11-19T00:00:00Z`. GitHub commit metadata for the actual pre-registration, `9c0212918afeda374ffb5f048e7c3085e19815c7`, gives author and committer time `2026-11-19T23:48:33Z`. The proposal's registration and initial history timestamps are corrected to that recorded time. This correction does not edit the pre-registration, fitted parameters, source fingerprints, evaluation outputs or verdict. The fit was subsequently committed in `14c8dc16e58a0145a91697f9807e12472af5efc2` at 23:51:26 UTC; results were committed in `e03a53945d7a14098f6ad445bca676fc9fbac57d` at 23:55:10 UTC.

One labeling caveat matters if this module is reused: under the frozen protocol, an empty earlier-team window belongs to `CLEAR` (the default category). This means the absence rule was not triggered; it is not evidence that pre-game injury status is known or that a player is medically available. Both `CLEAR` and `UNKNOWN` retain the unchanged baseline. A future change to this definition needs its own version and fresh evaluation.

The combined tree of this research PR and the separate forward-learning/penny-paper PR passed 966 JavaScript tests (1,013 discovered, 47 database-dependent skips) with zero failures and merged cleanly in an isolated checkout. The shared CSV parser change adds an optional stated DNP reason. The new availability predictor is referenced by its research evaluator only; no production worker imports it.

Independent review and combination tests do not establish improved accuracy or returns. Official pre-game injury collection remains disabled. Live forward-lab and penny-study activation still requires the separate database setup from PR #192.
