# SportsEdge research evidence contract v1 — isolated prototype

**Status: draft research-only scaffold; not imported by the site, workers, production models or broker.** Adds two tiny pure exports in `research/contracts/evidence-v1.mjs` and negative unit tests. There are **no providers, network calls, API keys, storage writes, scheduled jobs, migrations, or order capabilities** in this module. It implements one dependency from the larger safe-expansion blueprint in [draft PR #175](https://github.com/ang87505-crypto/SportsEdge/pull/175); it does not require #175 to merge.

## Problem solved in code

Existing sports, stocks and public-event forecasting have different settlement conventions, but share a common failure mode: a source published or fetched **after** a decision can appear in a retrospective dataset, producing fake confidence. The read-only prototype requires a provable pre-decision public availability time **and** pre-decision observation time, plus a strictly pre-lock frozen forecast.

`sourceAtDecision(source, cutoff)` determines whether a source can be used for point-in-time features. Missing source, missing `availableAt`, missing `observedAt`, unapproved rights, missing SHA/attribution, observations fetched late or release at/after cutoff all fail closed with distinct reason codes.

`auditFrozenForecast(forecast, sources, outcome, receipt)` checks:
- domain (`sports`, `stocks`, `public_events`), IDs, source domain, timestamp chronology, probability and duplicate source fingerprint;
- `featureCutoff <= createdAt < lockAt`, and each `availableAt < featureCutoff`, `observedAt <= featureCutoff`;
- verified outcome **after** lock with matching event ID; earlier or unavailable outcomes remain **pending**, not losses;
- **only** a verified, settled, pre-lock paper entry receipt can yield virtual net cents. Candidate-only predictions and paper entries without receipts show **null**, never assumed $0 or guessed payout;
- returns only audit metadata, not raw source contents or personal/account details.

`summarizeReadOnlyAudit(records)` reports N, eligible, graded, pending, excluded, accuracy (or **null** without graded cases), and virtual net only with valid paper settlement. An empty or unknown P/L field is **not** the same as a settled $0 outcome.

## How Claude should integrate it (future, separate PRs)

1. Review source availability convention separately for NFL/NHL, NBA props, NOAA/BLS and stock bars/SEC filings. Do **not** assume provider record `observedAt` means original public `availableAt` is known. All inputs are still injected synthetic records in this prototype.
2. Add domain-specific read-only adapters only after source schemas/rights have been validated and original ledger contracts inspected. Do not migrate the DB or overwrite active row types. Unknown source rights must stay blocked.
3. First integrate an **explanatory dashboard/report** that displays the audit reason codes. Do not use this module to choose stakes, auto-promote strategies, change picks or drive order execution.
4. Add no-lookahead and tamper tests based on each real domain's event states, revisions, missing-value cases and lock semantics. Include actual source timestamps in a frozen fixture, with attribution.
5. Ensure this remains an independent testable library; never export any `execute`, `bet`, `trade`, `promote`, `fetch`, `write` or `dispatch` action.

## Run checks (Node 24)

```sh
node --test research/contracts/evidence-v1.test.mjs
```

This is intentionally **not** an end-to-end test of NBA, stocks, Kalshi, real providers, or production releases. No live source has been downloaded to validate this prototype.

## Safety boundaries

- No changes to `src/`, `database/`, `analytics/`, `config/`, existing `.github/workflows/`, or `vercel.json`.
- The only workflow added here verifies synthetic tests for this library on PR events; it has read-only repository permissions and no schedules.
- A green check does not establish a profitable forecasting edge or legal trading eligibility.
