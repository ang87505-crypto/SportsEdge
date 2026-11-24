# Independent candidate review — 2026-11-24

Reviewed parent: `d981585a65127bf1dd62cad5a3d43bcea88ebdc1`. Main inspected: `ebffeb95b7e360380d4ca2c372a7856227ca7084`. The #203 archive guard is on main, outside this PR's changed paths. Do not replace main with the candidate tree; use the reviewed integration result.

Three bounded fixes:
- Stored-line replay deduplicates qualifying rows by receipt time and observation ID, independent of the presentation sort. Global totals and grade kinds now use the same first receipt. Platform and threshold-specific views retain their existing eligibility rules.
- Penny virtual ledger equity walks all grade revisions by receipt time, applying only the delta from the previous booked profit. A later unknown payout reverses the booked amount and re-reserves the stake. Final realized cents and sizing rules are unchanged; historical peaks are no longer lost.
- Read-only database readiness requires correctly shaped append-only triggers and enabled chronology/freeze/grade insert guards calling the expected functions. It is a configuration check, not proof of actual hosted writes. Disposable database regression cases cover disabled freeze, replica-only chronology and missing delete protection.

Independently recomputed JSON.stringify SHA-256:
- Baseline: 4ca4be3779f188c3aa5dc6ccd2b24ceabf9cd07d1dfac0b534b59d26918298be (same Git blob as main).
- Forward calibrator: 8b84007d37b9084a7cd486fe3f387bf6d2ac0062d6b230d48f79310924f4a633.
No refit, new forecasts, policy, sample minimum, budget or scheduler changes.

New regression tests are included. Full checkout and PostgreSQL execution are unavailable in the current local environment; final-head PR CI and hosted read-only SQL must be checked independently. Do not infer hosted readiness from CI. No migration, worker dispatch, merge or order authorized by this review.
