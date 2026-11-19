# Shared SportsEdge assistant

The existing /assistant now covers sports, stock paper accounts, stock strategy research and automation in one conversation. It remains a free, deterministic reader of recorded evidence.

## User behavior

- Sports questions retain the existing picks, player matching, entry results, learning-model and schedule answers.
- Stock questions use the signed owner session already used by the Paper account dashboard. Current positions use the existing read-only Alpaca snapshot reader; strategy P&L uses the existing verified ledger calculation.
- Research questions use a public versioned summary produced by Claude's research runner. The research page reads the same summary.
- Follow-ups retain the selected domain, symbol and candidate. An explicit domain switch clears incompatible sports context.
- Combined questions display separate sections. One source failure does not suppress other sources.
- Generic questions such as “How are we doing?” offer topic choices rather than assigning all money questions to sports.
- Private replies are kept only in React state, cleared on session loss/expiry, and hidden while access is uncertain. An in-flight reply cannot restore private content after logout. The old sports-only browser cache is removed.
- Chat questions cannot submit bets, stock orders, start workflows, resume gates or change model parameters. Controls are links to the existing authenticated dashboards.

Examples: “Tonight's picks”, “Stock results”, “What stocks do I hold?”, “Stock picks”, “Why did the Berkshire strategy fail?”, “Why?”, “Is everything running?”

## Read models and publication

analytics/research/summary.py produces summary.json during the existing report command. Snapshot history and result files stay append-only. summary.json and reports/LATEST.md are derived latest views and may be refreshed by the existing research-data publisher.

The web reader fetches the fixed public research-data/summary.json location, validates it and caches only public research data for one minute. No owner-account response enters this cache. Invalid or missing live summaries fall back to the dated saved report with an explicit saved-report label.

The initial saved summary is derived from research-data commit a713084937d2aee9761ddce5b997c60aa81510dd and its November 9, 2026 results/manifest/run log. It is not hand-entered performance. Historical continuous and halted results, failed checks and forward evidence stay separate. Zero forward sessions means no measured return.

This integration builds on the research system merged in PR #111 (main commit ed76351ac218ee19c3be8fcc68b11d33aa01c014). It does not activate a candidate or enable a schedule itself. After this integration's release review and merge, the existing default-branch research jobs will also refresh the public summary. Until that happens the saved report is explicitly identified.

## Verification

- 73 Node tests passed: the existing sports assistant, new routing/answer/isolation cases, stock accounting, owner sessions and navigation.
- All 83 research Python tests passed, including the new public-summary tests.
- Production build passed.
- ESLint passed with the repository's three existing warnings.
- scripts/assistant-http-smoke.mjs exercises the actual production routes with a generated synthetic owner key, no database/broker/odds credentials, and read-only questions.
- Browser regressions for domain switching and private-history/in-flight logout are added to the existing CI browser suite. Local Chromium execution is blocked by the host's socket permissions, so those browser checks require CI.

## Account and evidence limits

A current account snapshot is not a strategy return. Targets are not purchases. Recent intent records are not a complete position inventory.

Date-range P&L names the actual recorded mark boundaries, states gaps/coverage limits and refuses unreconciled ranges. Missing marks never become zero profit. The existing accounting contamination boundary is preserved.

Historical simulations never become account profit or forward results. No new strategy has qualified merely because it earned a positive historical return.
