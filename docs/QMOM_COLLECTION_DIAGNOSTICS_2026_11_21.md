# QMOM collection: preserve rejection evidence in the run log

User-facing date: November 21, 2026 (Mountain time). Base: main
`1c6f05d94899e3d34f5a3a0cc7ff0c6b997f5f56`.

## Finding and repair

The research collection run log printed only `"qmom": "PARSE_FAILED"`, although the
collector's manifest already contained a specific reason. If a later archive push
failed, that manifest and raw snapshot were not published, leaving the public run
log insufficient to distinguish bad markup from rejected future-effective holdings.

The focused change adds `qmom_detail` to the existing collect JSON and its run record:
`error`, `effective_date`, `retrieved_at`, `path`, and `content_sha256`. These fields
come directly from the same collection receipt. It makes no additional request and
logs no raw response, headers, credentials or account data. The existing `qmom`
status remains unchanged, as do the parser, freshness/admission checks, source
schedule, archive guard, forward decisions, models, stakes and trading controls.

This is an observability repair, not evidence that the QMOM parser was broken and
not a repair of the separate archive-publication failure addressed in #203.

## Evidence inspected

1. [Research collect run 44891899827](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44891899827),
   job 136809332302, checked out the pinned main above. It logged QMOM PARSE_FAILED
   and later failed publication with
   `APPEND_ONLY_VIOLATION: lab/stock-forward-ledger.jsonl`. Its failed QMOM raw page
   is not in the inspected archive. The exact cause of that particular attempt
   therefore remains unproven; the next receipt must expose it rather than guess.
2. The research-data manifest at
   `80f254428ef8b85cefc2c488a4233c0b28e7d42e` ends its QMOM observations on
   November 20. It contains two earlier, explicit future-effective rejections on
   November 14. The original gzip snapshots were read from that immutable Git
   commit, decoded, checked against their stored raw-body SHA-256, and replayed
   with the original retrieval clock:

   | Original retrieval (UTC) | Effective date | Rows | Weight sum | Recorded and replayed result |
   | --- | --- | --- | --- | --- |
   | 2026-11-14T04:43:41Z | 2026-11-16 | 52 | 100.01% | PARSE_FAILED / EFFECTIVE_DATE_IN_FUTURE |
   | 2026-11-20T10:08:47Z | 2026-11-20 | 52 | 100.02% | OK |

   Snapshot paths under that commit:
   - `snapshots/qmom-holdings/2026-11-14/20261114T044341Z_93704e9700789ebb.json.gz`
   - `snapshots/qmom-holdings/2026-11-20/20261120T100847Z_db23250a44d2b3e2.json.gz`

3. A fresh, single public GET of the already configured
   [official fund page](https://funds.alphaarchitect.com/qmom/) completed at
   `2026-11-22T02:30:46.286271Z` (November 21, 7:30 PM MST). HTTP 200, 791,720
   bytes, raw SHA-256
   `8233903eda2dcb526e32ffdb78cd8f9ab05a5dd80adb49bc06b6bfa624f3d9ca`.
   The unchanged parser reads 52 rows, weight sum 99.99%, effective date
   November 23. Validation at that capture clock returns PARSE_FAILED with
   EFFECTIVE_DATE_IN_FUTURE. This observation is separate from the lost earlier
   attempt; it does not establish what that earlier response contained. The raw
   diagnostic capture is transient and is not added to the research-data branch.

No stored timestamp was moved, failed snapshot relabelled, lost forward row
backfilled or rejected holding admitted. A later eligible collection must keep its
own actual retrieval time. This investigation uses no Odds API credits, stock
orders or exchange access; it does not dispatch the hosted research collector.

## Validation

Four new offline CLI tests exercise the actual argument parser, JSON output,
Fetcher with an intercepted transport, QMOM collector, snapshot store and forward
snapshot reader. They cover future holdings, missing dates, malformed numbers,
HTTP failure, preservation of prior good evidence and unchanged request counts.
The printed JSON must equal the persisted run result. The tests reproduced the
missing diagnostic field before the repair and pass afterward.

Local Python 3.12.14:

```sh
python3 -m unittest analytics.research.test_qmom_collection_diagnostics -v
# 4 tests pass
python3 -m unittest discover -s analytics -p 'test_*.py'
# 434 tests pass
git diff --check
```

Local suites use synthetic/intercepted transports; they do not certify hosted
publication, database readiness or strategy quality. The PR's GitHub checks are
the authority for validation on the published commit. The independent #208
release review and active database readiness check remain separate requirements.

## Release and rollback

This branch is research-only and excluded from Vercel deployment. No main merge,
hosted collection or activation is performed. Obtain review and owner release
approval before merging. When an approved collection eventually runs, require a
real receipt with the detailed reason and a separate successful archive push.
Reverting the small CLI change removes the extra logging; existing snapshots and
balances require no change. Preserve old logs and negative findings.
