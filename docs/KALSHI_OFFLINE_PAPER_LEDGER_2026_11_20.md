# Kalshi offline paper ledger — November 20, 2026

This milestone implements account bookkeeping and a reproducible lifecycle replay before any owner account setup. It reuses the existing frozen paper-forecast and official-result grading functions. The only accepted account mode is `OFFLINE_FIXTURE`.

The code makes no network request and needs no API credential, database migration or Kalshi account. Its generated market, model probability, book and results are **synthetic test fixtures**, not market observations. Its allocations are hypothetical reservations, not observed demo or live orders or fills. Fees retain the existing provisional label.

## Contents and ownership

- `src/lib/prediction-markets/kalshi/paper-ledger.ts`: typed command journal, deterministic projection, reservation limits, pause and settlement revisions.
- `src/lib/prediction-markets/kalshi/paper-ledger.test.mjs`: hand-calculated account and lifecycle contracts, corruption and temporal checks, and saved replay verification.
- `scripts/kalshi-paper-replay.ts`: complete synthetic registration → start → forecast → reservation → win → corrected loss replay. Optional exclusive file creation; existing files are refused.

Claude's independent weather-model work can use `LedgerForecastInput`, which omits `predictedAt`. The ledger sets decision time from its receipt clock. The forecast retains the model ID, data timestamp/digest, market rules, book timestamp and probability. Changes to that interface should be coordinated rather than replacing this ledger or the existing forecast/grading functions.

## Accounting contract

The account starts paused. Forecasts are always recorded, including no-liquidity/no-edge forecasts and candidates blocked by pause or budgets. Only an allocated candidate reserves cash. The reserve includes quoted whole-contract cost, provisional fees and explicit slippage.

The configured per-position cost, aggregate open-cost, available cash and open-position count are checked independently. One forecast per market is allowed in this version; replaying a market with a fresh request ID is refused. Identical request IDs and payloads are idempotent. Reusing a request ID with another payload is an error.

Balance is initial funds plus the latest hypothetical net return on allocated, graded positions. Available funds are balance minus open reservations. An unallocated forecast can receive an accuracy result but cannot change account money. A first settlement releases its original reserve once. A later correction appends a revision and adjusts balance by the difference from the previous booked result. It does not rewrite the original decision, stake or result.

If a correction consumes funds already reserved elsewhere, the projection shows the full deficit and blocks new allocations. It does not invent funds or clamp available cash to zero.

## Integrity and time

Every event carries a sequence, unique request ID, receipt time, previous checksum and deterministic content checksum. Replay recomputes forecasts and grades from the recorded commands instead of trusting supplied monetary totals. Sorted inputs preserve the original book digest after JSON round trips.

The decision receipt time overrides an input's backdated `predictedAt`; existing quote-freshness and pre-lock guards apply at that time. Result fetch time must be no later than receipt time; future, stale, contradictory and rule-mismatched results are refused. Views as of a timestamp expose only grades and corrections received by that timestamp, while validating the entire journal.

Checksums detect corruption; they are not signatures or proof that an external source is authentic. An authorized database adapter must enforce access, append-only writes, serialized reservations, authoritative server time and source provenance. The optional local file is a development artifact, not production storage or a substitute for those controls.

## Run without owner setup

```sh
node --experimental-strip-types --test src/lib/prediction-markets/kalshi/*.test.mjs scripts/kalshi-independent-weather-collect.test.mjs
node --experimental-strip-types scripts/kalshi-paper-replay.ts
node --experimental-strip-types scripts/kalshi-paper-replay.ts --output /tmp/kalshi-synthetic-replay.json
```

The last command requires a new filename. It writes with owner-only permissions, syncs the file and refuses replacement. Reopen its `journal` and call `replayPaperLedger` to reproduce the corrected projection.

The two-contract fixture reserves 924,500 integer microdollars: 880,000 price + 34,500 provisional fee + 10,000 slippage. From a 10,000,000-microdollar initial account, a hypothetical winning result gives 11,075,500; the appended losing correction gives 9,075,500. These are accounting examples, not reported returns or a tested trading edge.

Local verification on this milestone: all 87 Kalshi/NOAA tests pass, including 22 new ledger/replay tests. TypeScript passes after generating the standard Next.js route types; targeted ESLint passes with no errors or warnings. The CLI test verifies private file permissions, a saved-journal replay and refusal to overwrite an existing file. Exact-commit repository CI remains a separate check on publication.

## Remaining milestones

1. Claude verifies independent historical weather inputs, forecast horizons, station matching, contract boundaries and probability calibration. The existing 30 valid training-day requirement remains authoritative.
2. Add a private transactional persistence adapter and a worker with explicit source/permission readiness, before connecting any exchange data. The current module is not imported by a live route or scheduled job.
3. Verify the applicable demo/data terms, then configure the owner's separate demo account for a supervised connected test. Production exchange-data access remains disabled under the current project boundary.
4. Observe actual demo order acknowledgements, partial/no fills, cancellations and final settlement separately from this hypothetical ledger. Only that connected stage can claim a working exchange-demo lifecycle.
5. Continue independent forward scoring. A functioning ledger, synthetic replay or demo return does not establish a predictive advantage or profitable strategy.
