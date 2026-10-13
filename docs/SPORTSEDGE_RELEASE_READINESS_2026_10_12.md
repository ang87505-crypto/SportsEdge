# SportsEdge Release Readiness — Rebuilt from current GitHub

**Snapshot:** 2026-10-12. **Repository:** `ang87505-crypto/SportsEdge`. **Main HEAD:** `261b03ccc78e0fb3f62fdfa85effcb1e4e9f2f72`. **Finding:** 21 open pull requests, mostly draft, on several independent and stacked branches. **No production deployment is authorized by this document.**

The release plan is machine-readable at `docs/SPORTSEDGE_RELEASE_TRAIN_2026_10_12.json`. The offline validator `analytics/release_train_gate.py` plus `analytics/test_release_train_gate.py` checks its dependency DAG, PR coverage, unactioned migration, cross-branch changes and explicit NO-LAUNCH flags. It does not query live GitHub, Supabase or Vercel and does not imply the combined release will work without review.

## 1. Actual PR topology, as inspected

The PR relationships below describe **base branches** (not instructions to merge automatically):

- Standalone changes from main: **#11** Alpaca access link (non-draft), **#12** manual stock journal regression QA, **#13** UI accessibility audit, **#14** 100×$10 NBA prospective paper-study design, **#15** separate $1,000 stock paper-study design, **#16** as-of stock data contract, **#17** NBA quant audit.
- Stock research line: **#16 → #18** momentum baseline **→ #19** pure execution planner **→ #27** historical portfolio replay **→ #29** read-only optional Alpaca history archiver **→ #30** model-to-ledger parity/tamper audit. All these are draft, additive and unpromoted.
- NBA research line: **#17 → #28** archived-price stress test **→ #31** Astra package integrity gate. The Astra **eight-file** research patch itself is NOT imported into GitHub; #31 checks the external ZIP and promotion veto, not the actual candidate implementation.
- Owner-controlled sports / UX line: branch **#19 → #20** run-control UI **→ #21** auth-gated owner paper controls **→ #22** revised quote-selection RPC plus **unapplied SQL migration** **→ #23** game analysis **→ #24** settlement worklist **→ #25** quote refresh cost controls **→ #26** odds freshness UX. All are draft.

GitHub currently reports individual PRs can merge cleanly into their **declared parent branches**. This does NOT mean the disconnected stacks collectively merge cleanly into main; nor does it validate actual live database configuration.

## 2. Explicit collision / integration issues

**Stock UI conflict:** #11 and #20 independently change `src/app/stocks/page.tsx` while both originated from different branches. Neither depends on the other. Choose one Stocks-page composition and **manually reconcile both diffs**, preserving the manual journal and adding Alpaca access only if it remains safe. Do not blindly auto-merge #11 just because GitHub marks it non-draft.

**Paper-system vs research:** #20–#26 inherit #19's non-executing stock planner, but only owner-commanded NBA paper simulation is considered for later activation. The Stock account remains separate; #15's virtual account is not the browser-local $10,000 journal, and neither is a live Alpaca brokerage.

**NBA research:** #28 and #31 are explanatory, reproducible research artifacts. No ROI demonstrated as executable. The Astra ZIP is based on exactly #28, and requires separate add-only import with independent tests and historical archive reproduction. It must NOT replace the production algorithm or unlock wagers.

**Stock data:** #29's credentials are optional only when the owner runs the CLI; no licensed historical feed, delisted firm universe or trustworthy as-of event record is connected. No actual investment returns have been established.

## 3. Proposed acceptance order

**Stage A — Audit-only, lowest operational risk.** Review independent #12 and #13; evaluate research-only #14 and #15, then #16 and #17. Run full Python and Node/Next test suites on the final **combined** branch, not merely each separate PR. Check licensing of bundled/snapshot data. Keep model selection and betting disabled.

**Stage B — Research improvements without site activation.** Add #18 and #19 in dependency order; then stock research #27 → #29 → #30. Separately add NBA #28 → #31 after #17. Import the eight-file Astra NBA research ZIP in its **own** audited PR onto PR #28 or its reviewed successor. Rerun the complete source-based audit and protect the negative/no-edge conclusion. Do not change site odds/picks. If staged on a single candidate release branch, test branch integration and ensure independent PR bases remain recoverable.

**Stage C — Preview-only UI.** Reconcile #11 with #20 before accepting either. Prepare #20, #21, and read-only #23/#26 functionality on a staging preview. The #22 safety logic must be deployed only with its SQL migration after separately approved staging database testing. Never silently switch to the old RPC. Respect #24 settlement and #25 provider request-budget logic. **Leave `SPORTSEDGE_PAPER_RUNS_ENABLED` missing/false**. Verify navigation, responsive UI and read-only status in an authenticated test environment.

**Stage D — Staging operational approval.** Test real Supabase Auth positive/negative paths, exact origins and session expiry, RLS/grants, PostgREST RPC signatures, idempotent accounting, security controls and concurrent quote insertion/placement. Reconcile #22 migration locks with the actual collector. Existing docs identify missing **durable per-command receipts**, so current code cannot honestly claim exactly-once whole-batch paper execution. Test the changed SQL with real staging transactions and owner/non-owner accounts. Review provider quotas and timestamped odds source reliability. Separate the new NBA research outcome from any approved paper-betting rule.

**Stage E — Production separately authorized.** Rebase/reconcile a final candidate branch against main, run combined Python/Node/lint/typecheck/build/DB/browser checks, obtain explicit owner approval for both schema and production deploy, then observe a safe staging run and only consider authorizing bounded paper simulation in a later step. Nothing automatically activates when the code merges; paper runs must remain disabled until separately permitted. Live-money trading is entirely out of scope.

## 4. Known release blockers (not solved by green unit tests)

- **No verified NBA betting edge.** Archived odds lack observation timestamps; exposed historical ROI cannot be reported as actual realized profitability. No new model promoted.
- **Unapplied database migration:** #22 `database/migrations/20261011193330_quote_current_market_guard.sql` declares `research_place_current`, service-role-only grants, stale-market rejection and broad SHARE locks. Production/staging application and concurrency under the real ingestion service have not been verified. Do not enable placing without the reviewed migration and its integration tests.
- **No exactly-once entire paper batch:** runner stops after uncertain writes and avoids obvious double positions, but durable per-command receipts still need implementation; returned IDs must never be labeled guaranteed newly created bets.
- **No authenticated positive-path staging E2E:** mock tests and isolated SQL tests are not substitutes for real owner-only authorization and audit trail.
- **Historical stock data not yet usable for ROI:** missing point-in-time survivorship-free universe, corporate-action/venue timing and delistings.
- **Cross-branch UI conflict:** #11 vs #20 Stocks page; and sequential edits to shared server files #20–#24 must be integrated in dependency order.
- **Astra NBA ZIP is external:** #31's gate is not the complete model test suite or actual import. Preserve the original package, checksum and base commit before applying.

## 5. Verification before any authorization

Execute from an approved fully reconciled candidate branch (not merely main or one standalone PR):

    python -m unittest discover -s analytics -p 'test_*.py' -q
    node --test src/lib/ingestion/*.test.mjs src/lib/research-math.test.mjs src/lib/result-validation.test.mjs src/lib/stocks/*.test.mjs
    npm run lint
    npx tsc --noEmit
    npm run build
    python analytics/release_train_gate.py

When #22 is included, also execute disposable PostgreSQL integration plus a true multi-session, authenticated **staging** Supabase check; never apply migration based only on unit tests. All provider calls or billing and all environment edits require separate owner approval. Check Vercel preview routing and real responsive browser behavior.

## 6. What this specific release-audit PR changed

Only the **four new files** below on an isolated branch based on main:

1. `docs/SPORTSEDGE_RELEASE_TRAIN_2026_10_12.json` — 21-PR verified-structure snapshot, dependencies and immutable safety flags.
2. `analytics/release_train_gate.py` — read-only topology and fail-closed safety checks.
3. `analytics/test_release_train_gate.py` — synthetic tampering / omission / approval-flip tests.
4. This file.

No old source file was modified, no PR was merged, no Supabase DB changed, no deployed site changed, no market API credits used. This milestone makes the release decision **auditable**; it does not falsely declare that the platform is ready for production.

**Policy:** Inspect → review dependencies → implement one branch at a time → test combined branch/staging → document evidence → request explicit approval before merge, migration, deployment and any paper/live trade automation.
