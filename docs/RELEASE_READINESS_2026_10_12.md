# SportsEdge — pre-release dependency and owner-approval plan

Status: **REVIEW-ONLY**, October 12, 2026. Production code is still at `261b03ccc78e0fb3f62fdfa85effcb1e4e9f2f72`. None of PRs #11–31 has been merged at this snapshot. Do not construe successful draft CI or READY Vercel previews as a completed live website. This milestone does **not** grant merge, database-migration, paid provider call, deployment, or paper-run activation permission.

## Inspection record

Checked GitHub main, 21 open PRs, their current base/head refs and per-PR changed files, existing three Actions workflows, the prepared SQL migration in PR #22, the owner-login code in PR #21, and the market-collection route in PR #25. No private DB data, provider APIs, brokerage accounts, or credentials were accessed. PR #11 is *open and not draft*, but must still be reviewed; it must not be interpreted as release-approved.

New files on a main-based isolated review branch only:

- `docs/release-dependency-manifest-2026-10-12.json`: a pinned snapshot of all 21 open PRs, parent refs, separate release targets, conflicting paths and owner-gated blockers.
- `analytics/release_dependency_audit.py`: no-network, read-only DAG check and fail-closed release-state report.
- `analytics/test_release_dependency_audit.py`: synthetic ancestry, missing migration, branch cycle, overlap and unsafe-flag tests.
- This document.

Existing code, models, ledgers, SQL, CI workflows, provider settings and deployments remain unchanged. This is an additional small, independently testable stage; a future release attempt MUST refresh the dated snapshot before deciding whether to merge.

## Exact dependency ordering / meaningful release scopes

**Research-only NBA** (not a promoted model):

`#17 -> #28 -> #31`

PR #31 contains a checksum and non-promotion gate for Astra's uploaded October 12 ZIP; it does **not** import the eight original audit files. Those require a new dedicated draft integration, full inherited test suite, frozen-source replay and owner review. The reported best candidate is not proven profitable. Do not promote its model or alter paper-bet selection rules.

**Research-only stocks** (no trade execution, no measured real returns):

`#16 -> #18 -> #19 -> #27 -> #29 -> #30`

These include as-of data validation, frozen momentum stock targets, proposed virtual execution, historical cash replay, optional Alpaca raw archive, and end-to-end synthetic parity checks. PR #29 defaults to *zero-network planning*. PR #30's historical profitability fixtures are synthetic and cannot support any investment-return claim. Astra stock research is in progress independently.

**Website / owner-paper UI path** (review only; do not enable new bets):

`#16 -> #18 -> #19 -> #20 -> #21 -> #22 -> #23 -> #24 -> #25 -> #26`

This branch chain shares #16/#18/#19 with stock research but NOT #27/#29/#30. A finished GitHub preview of #26 is not evidence of a safe production release. The SQL migration in #22 is a strict prerequisite for the new placement RPC; do not run the newer runner against a schema missing `research_place_current`. PR #21's `SPORTSEDGE_PAPER_RUNS_ENABLED` must stay false or unset. PR #25's provider network path requires an explicit token and collect=1; no durable server-side provider-spend quota is established. No new collection cron should be enabled.

**Other independent PRs**:

- #11 adds Alpaca navigation and modifies `src/app/stocks/page.tsx`. #20 also modifies that file. This is a *verified overlap*, not yet a proven textual merge conflict; inspect the combined difference and test the actual merged result before releasing #11 with the website chain.
- #12 stock journal regression tests and #13 UI/accessibility audit: review independently against the chosen combined candidate.
- #14 proposed 100 x $10 NBA prospective virtual experiment and #15 separate $1,000 stock virtual study: preserve distinct accounts/cohorts; neither is an activated trading plan or proof of results.

## Recommended release stages (one verified stage before the next)

### Stage A: recover reviewability, zero operational changes

1. Keep production at its current pinned main; retain all 21 open PRs and existing study histories.
2. CI-check this new manifest and dependency report. Run the offline audit.
3. Review the completed Astra NBA ZIP: the original eight files must be imported via a distinct PR if approved. Check hash, patch base, integrity, tests and archived research-source availability. **Never activate the reported candidate automatically.**
4. When Astra stock research completes, review its outputs separately on a new draft branch; do not replace or silently edit original strategy code.

### Stage B: build one combined staging candidate, without runtime activation

1. After reviewer approval, integrate the stable prerequisite PR chain in topological order. Do NOT merge the tips of #26 and #30 blindly; their ancestry overlaps and their tips branch apart from #19.
2. Run **combined** Python, Node and TypeScript suites, lint and production build on the exact combined commit. PR-scoped green workflows are not enough.
3. Verify that the combined source still blocks virtual trading when the owner flag is absent, no new betting model is promoted, and stock paper execution remains disabled.
4. Manually test desktop/mobile navigation (including return-home paths), old stock journal preservation, error states, read-only NBA opportunities, quote freshness labels and keyboard accessibility on an HTTPS staging preview.
5. Resolve the overlapping Stocks-page changes in #11/#20 by inspection and combined UI tests.

### Stage C: database compatibility in an approved disposable/staging environment

1. Obtain **separate owner approval** for applying PR #22 SQL and choosing the target staging database. Never apply this audit manifest to the live Supabase instance.
2. Check migration order against the entire existing database/migrations directory, grants and row-level security, with a safe rollback plan and a dry-run database or snapshot.
3. Re-run quote guard tests, simulate concurrent collector and virtual placement transactions, test lock contention, validate idempotent placement, stale/future quotes and ambiguous/incomplete markets.
4. Test the owner-authenticated login, nonowner/expired sessions, origin restrictions and model-run denial across exact staging domains.
5. The paper owner control currently lacks durable per-command receipts. One click should not accidentally place an unbounded second batch after an uncertain write. Do NOT enable automatic/new on-demand bets until this is addressed and verified.

### Stage D: optional release, ONLY after fresh owner authorization

Request separate authorization to merge exact approved PRs and to deploy the pinned candidate. **Do not** infer approval from this manifest or from a general request to 'do it'. Production should default to *read-only*. Any later paid sportsbook quote collection, background schedule, virtual bet activation, Alpaca source fetch, stock paper trading or real-money order placement requires its own cost/security review and explicit authorization.

## Current known blockers and warnings

- Main still on old website; all numbered PRs above are draft except #11.
- The new PR #22 database function has not been established as applied to the production/staging target in this review.
- Current owner session uses Supabase access JWT in an HttpOnly/Secure cookie capped at 1 hour. Tests are mocked; live login, token expiration, staging origin, revocation and concurrency need browser/database verification.
- No durable exactly-once owner-run command receipts. The current virtual ledger's idempotency per forecast does not imply once-only *batch* processing.
- Provider expense guard is per explicit invocation and a limited request plan; persistent daily/monthly quota control is not proven. Price quotation at a recorded time is not automatically a price available for a wager.
- NBA backtests do not prove a profitable edge. Stocks lack a validated point-in-time universe and authenticated historical data.
- Green CI / successful Vercel build are necessary but not sufficient for actual UI, DB behavior, and account safety.

## Test commands

From the repository root:

    python analytics/release_dependency_audit.py
    python -m unittest analytics.test_release_dependency_audit -v
    python -m unittest discover -s analytics -p 'test_*.py' -q

The new validator is included in the existing `.github/workflows/verify.yml` Python unittest discovery; no existing workflow needs modification. It validates the pinned review-only manifest, **not** live PR freshness. Before every planned merge, re-check GitHub PR heads, bases and CI, and regenerate a reviewed snapshot in a separate new milestone. This document does not authorize deployment or change production behavior.
