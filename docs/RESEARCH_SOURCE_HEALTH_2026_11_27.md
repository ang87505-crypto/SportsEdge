# Research source health repair — November 27, 2026

Base: production main `f3a575b69f5ba38d2617036bec621e52a08bc941`. This milestone repairs public research collection and truthful source reporting. It does not change a strategy, fitted artifact, prediction, sample requirement, order path or exchange gate. The files changed are disjoint from the inspected #216 candidate at `affe4cb`.

## SEC diagnosis and repair

The archived Nov 10 manifest records 404 failures for `2026q2` and `2026q3` under `/files/structureddata/data/insider-transactions-data-sets/`. Neither is retried by the existing nightly collector. The SEC's current official index lists both archives under `/files/datastandardsinnovation/data/insider-transactions-data-sets/`.

The new adapter discovers exact published quarter URLs from the fixed SEC index. It accepts only the SEC HTTPS host and the two documented archive-directory forms, rejects ambiguous quarter links and refuses redirects. It selects only the two latest closed quarters, requires the existing contact User-Agent secret and performs at most three GETs with no automatic retry: index plus two missing archives. Verified cached archives need zero requests and create no retimed observation.

An HTTP 200 is insufficient: ZIP member limits, safe names, all CRCs and the eight documented table headers must validate. HTML/WAF responses, truncated ZIPs, malformed tables, duplicate quarter bodies and corrupt/future cache records remain failures. Limits are 2 MiB for the discovery page, 32 MiB per ZIP and 256 MiB uncompressed. No file is extracted onto the filesystem.

New snapshots preserve the original ZIP bytes, SHA-256, discovery HTML/digest, exact URL and collection-time availability through the existing append-only SnapshotStore and shared research-data writer. Availability is recorded after downloads complete and is never set to quarter end. Older snapshots contain normalized JSON; they remain untouched and are not silently recertified as raw ZIP archives.

The adapter explicitly records `pointInTimeUsable=false`: bulk filing dates do not establish EDGAR acceptance chronology. Archive availability is not transaction-level validity, strategy evidence or a performance claim. No production strategy uses this source. Historical failures and negative findings remain in place.

The existing research workflow collects only missing archives during normal nightly work. A source-code repair merged to main runs a separate source-only job, without the stock market-data simulations. Pull requests run synthetic contracts only and receive no write credentials. Failed source attempts are still archived and reported. An optional source failure does not stop unrelated nightly ledgers.

The shared summary now reports a failed item from a batch even when the last item succeeded. This closes a second route to a misleading green source label.

## NOAA diagnosis — no frozen capture change

Fresh saved receipts cover forecasts for Nov 22–28 and preliminary outcomes for Nov 20–26. For example, the Nov 28 forecast was actually captured at `2026-11-27T09:39:41.745Z`; the Nov 26 outcome at `2026-11-27T09:39:41.487Z`. The same run preserved both phases through the existing prior-outcome recovery. These are records, not inferred schedule firings.

The generic operations job currently judges all four primary/backup cron firings. It does not by itself prove that an underlying research day lacks a forecast or outcome. GitHub delays are real, and first-wins archive coverage and capture-horizon comparability are separate facts. Retiming the frozen v1 collection could change its horizon cohort; this milestone does not move its schedule, rewrite captures or fill historical forecast gaps. A later receipt-aware monitoring change should preserve actual timing and distinguish missing evidence from missed backup firings.

## Verification and release acceptance

Production repair #237 merged as `3291c653d289c8e141d9e84c969892939311273f`, after six hosted workflows and 453 analytics tests passed. Source-only run `46044893157` succeeded and appended research-data commit `8d4eec3a0522a9ab8db0256fa20ef641b74cad0f`:

| Quarter | Original ZIP bytes | SHA-256 |
| --- | ---: | --- |
| 2026q2 | 11,498,860 | `11f1b2bbbdcbe6347a34437c02d04202fda0eca1dbb023726e4b56504b802e27` |
| 2026q3 | 8,660,776 | `a4e6a681cfcfa43a3d9e4ca9cfec1fd26a59d0a01eac7e9f7b5a0122092c90f3` |

Both validate all eight tables and CRCs. Conservative availability is `2026-11-27T17:50:18Z`; `pointInTimeUsable=false` remains explicit. Independent saved-byte verification matched both manifest hashes, preserved the 305,061-byte original manifest prefix and both old SEC failures, and replayed the actual cache with zero requests and zero retimed receipts. The production run made exactly three GETs. The source summary and operations snapshot at `17:50:37.323Z` report SEC `OK`, with no failed quarter or SEC-source blocker. Production deployment `dpl_FNVJoMtAn5EQ1kjPNknqmegA4Mc8` is READY at the merge SHA.

Acceptance also caught the generic workflow monitor counting that source-only main-push success as a full nightly stock-research run. The follow-up restricts the nightly job's evidence to `schedule` and `workflow_dispatch`; source-only failures and successes remain visible in source health. Event filtering is enforced in the tested job evaluator. A repair cannot cover a nightly slot, refresh an old forward-ledger success or hide a full-run failure. Manual full runs remain eligible. No cron or collection horizon changes.

Run synthetic source/summary tests and the complete analytics suite. Hosted checks must run on the exact candidate head. A successful code check is not a successful download: final acceptance requires new real archive receipts for both closed quarters, their hashes and conservative availability, a research summary without the old unresolved-quarter warning, and a refreshed operations snapshot. All broker/exchange and scientific release controls remain unchanged.

Primary sources inspected Nov 27:

- SEC official download index: https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets
- SEC table/format documentation (tables 5.1–5.8): https://www.sec.gov/files/insider_transactions_readme.pdf

Commands:

```sh
python -m unittest analytics.research.test_sec_form345 analytics.research.test_summary -v
python -m unittest discover -s analytics -p 'test_*.py'
# Hosted source-only repair and normal nightly collection both use the existing SEC contact secret:
python -m analytics.research.sec_form345 --data research-data
```
