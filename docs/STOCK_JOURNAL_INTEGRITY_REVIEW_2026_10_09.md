# Stock Journal Integrity Review — 2026-10-09

**Scope:** stock-side low-cost QA only; no API credits, live market prices, privileged credentials, order execution, or existing-file modifications.

## Source-of-truth inspection

Inspected current `main` at commit `261b03ccc78e0fb3f62fdfa85effcb1e4e9f2f72`. The stock workspace already exists at `/stocks`, is reachable from the shared navigation, and stores a watchlist and manually priced long-stock virtual trades in the current browser's localStorage. It is **not connected to any price feed, broker, personal cloud account, or autonomous stock algorithm**.

The repository already had `src/lib/stocks/journal.test.mjs` with basic virtual cash/P&L tests. This review adds `src/lib/stocks/journal.regression.test.mjs` to check seven independent scenarios without changing `journal.ts` or `page.tsx`.

### Regression coverage

1. Ticker normalization and malformed-symbol rejection.
2. Exact integer-cent conversion, large price cap, and malformed-price rejection.
3. Opening/closing trades, cash balances, realized P&L, immutable prior state and duplicate-close protection.
4. Separate open cost and realized losses; no invented mark-to-market valuation.
5. Full-cash use, insufficient-funds rejection, and invalid-share rejection.
6. Saved-journal schema validation, duplicate position IDs, invalid dates, overlong notes, and negative cash.
7. 500-position cap and 100-symbol watchlist cap.

**Local preview:** Seven tests passed using Node 22's experimental TypeScript-stripping flag. The repository CI config runs Node 24 and includes `src/lib/stocks/*.test.mjs`. A green CI run for this branch is required before treating integration as verified. Production build and typecheck should also pass.

### Audit concerns reserved for a separately approved code change

- `openTrade()` checks quantity/price/cash but does not independently reject reused IDs or validate trade timestamps and notes at write time. `parseJournal()` rejects duplicate position IDs and malformed stored values later, but a future API or UI caller could insert an invalid record before validation.
- `closeTrade()` checks exit price, but accepts an invalid or pre-entry `closedAt`; that can cause `parseJournal()` to refuse to load the resulting saved journal.
- `parseJournal()` enforces watchlist length and ticker syntax but does not reject duplicate ticker entries. The current UI prevents duplicate additions.
- The ledger sums JavaScript numbers; future expansion beyond present limits must explicitly guard safe-integer arithmetic and consider corporate actions, slippage, fees and verified timestamps.
- Browser-local journal data is per device. Clearing localStorage removes it unless the user exports a backup. No financial performance claim can be based on manually entered, unverified fills.

**Do not silently change old journal records.** Any hardening must preserve schema v1, test backwards compatibility and add non-destructive migration/export fallback.

## Next low-cost engineering milestone (requires review and approval to modify existing files)

Tighten `src/lib/stocks/journal.ts` validation at write time, add tests reproducing the specific failure cases above, and preserve existing version-1 journals. Separately design a provider-agnostic equities observation schema with strict source attribution and `as_of` timestamps; do not connect or bill a data provider yet.

## Handoff to the advanced-model session

Keep routine UI/database plumbing outside the expensive model session. Reserve advanced effort for chronological holdout design; fair-odds baseline comparisons; signal validation under realistic slippage/transaction costs; data leakage audit; and statistically justified evaluation of both NBA/EPL betting and later stock models. Request reproducible code and test output, not a promised profitable strategy.
