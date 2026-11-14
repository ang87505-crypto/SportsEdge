# SportsEdge read-only source freshness research prototype — November 13, 2026

This PR adds a **pure, unconnected diagnostic function** in `research/ops/source-health-v1.mjs`. It is not a deployed monitor, not a schedule, and not a reason to enable or restart any collector. No production source, API, account, model or release code changes.

## What the checker can and cannot say

Given a caller-supplied snapshot of a provider's **existing** last-success receipt, last-attempt receipt, last outcome, expected cadence, delay allowance, domain and enablement, `inspectSource` returns one of:
- `fresh`: a successful capture within a known time window; **not** proof of accurate picks or profits
- `stale`: last confirmed capture is overdue beyond cadence and grace
- `failed`: a recorded failure with no verified recovery, or no confirmed successful run
- `disabled`: source intentionally off; not an error and not evidence of zero results
- `awaiting_first_capture`: missing initial evidence; not zero results
- `unverified_clock`: malformed, inconsistent or future timestamps; don't make an inference

`readOnlyHealthSummary` groups at most 50 sources, validates unique IDs, reports known freshness and actionable failures, and never conflates a source outage with losing predictions or the absence of betting opportunities. The module reads **no data by itself**; all snapshots are supplied by a trusted caller.

## Security and integration requirements

1. Read **existing** public collector receipts with a read-only adapter. For owner-only Alpaca PAPER evidence use existing server authorization; do **not** reveal stock account balances or keys in public health reports.
2. Validate that source schedules may be delayed (GitHub Actions), skip certain dates by design, and use correct cadences before issuing alerts. Do not equate a missed expected attempt with a model failure.
3. Disable automatic retries or repair actions from this report. The owner can inspect `/automation`, `/stocks/paper-auto`, `/paper-betting/props`, and GitHub Actions manually.
4. Do not use `fresh` as proof of result finality, forward predictions, accurate models, settled virtual bets or Kalshi prices.
5. Integrate only after the read-only command center is reviewed; add fixture-driven regression tests for real receipts and high-cardinality inputs. This prototype has **no** route, workers, fetcher, database migration or deployment flag.

Run `node --test research/ops/source-health-v1.test.mjs` on Node 24. Tests are synthetic only.
