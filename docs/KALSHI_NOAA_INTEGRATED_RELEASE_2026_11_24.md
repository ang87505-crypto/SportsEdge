# Integrated NOAA research release candidate — November 24, 2026

This draft combines exact changed blobs from three separately verified candidates, all with parent ebffeb95b7e360380d4ca2c372a7856227ca7084:

- #211: 96563318b5d506c096fcb729d9c914748e18f4b4 — public archive heartbeat and operations monitoring (9 passed checks; main-only monitor skipped).
- #214: f419549ef692fbafecb59ecd847e2778fadaba43 — NOAA raw-evidence validation and completed receipt clocks (10 passed checks; 120 focused tests).
- #215: 57b95324531181f2c0be3bb7de1c7502d5bddfc7 — cutoff-stable evidence manifest and pinned archive CI replay (9 passed checks; 118 focused tests).

The 22 changed source paths are disjoint. This integration adds this handoff only, with no source edits. It does not include #208 or #213, and does not alter their branches. Source branch heads are pinned; any later modifications require explicit comparison and review before release. After integration tests and independent review, choose either this one combined release or the three individual PRs, never both. Leave originals open until the owner decides. No merge, deployment, data collection, order, configuration or migration is authorized by this candidate.

## Verified baseline and limits

Pinned NOAA research-data commit 8d2374af520bf6321e8262a9cc36b852d313c0c2: 11 pre-day forecasts, 6 matched preliminary outcomes, 24 more pairs required, zero model-scored holdouts. The #215 actual replay job (45483503499, job 138762626202) produced archive digest a29543a9fc457aac9d62f61d6c5b68217be6a209d7a0cbc17185f4c5a7a0eefd. Do not infer market results, profitability, or readiness to trade. The November 15–17 missing outcomes remain unrecovered. Preserve the 30-pair training requirement and 50 holdout review minimum.

## Release acceptance

1. Require final-head checks on the integrated PR, including the pinned archive replay with strengthened source verifiers, platform database/HTTP tests, browser checks, ops tests, and production build.
2. Independently review integrated diff and current main; require owner approval. If main moves, reverify merge tree and all changed paths. Respect any existing owner-approved release order.
3. Only after approval and deployment, compare production version with approved commit. Read GET /api/research/kalshi-health; verify current archive timestamps, separate missing/stale codes, and no private fields. Distinguish captured forecast training count from later graded-day count. Check the next actual operations monitor publication and existing NOAA archive capture receipt, not merely green scheduled workflow status.
4. Keep all demo/live controls and market-data approval gates unchanged, and do not launch any workers. If unexpected regression, use a reviewed code revert; never rewrite archived evidence.

The combined integration CI is pending at creation; individual green results do not prove the combined tree. No hosted state has been modified.

Independent review on 7a19828 confirmed all 17 archived records, matching replay digest and 12 passing checks. Follow-up adds the reviewer's two date-rollover regression tests and clarifies internal consistency versus authenticity. These are test/documentation-only changes; runtime files remain byte-identical. Final-head CI must pass before owner-approved release.
