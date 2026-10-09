# Owner-commanded paper-trading controls — integration milestone 1

Date: October 9, 2026.

## Approval, scope and branch

The owner approved changes to three existing files after Astra PR #19 described the desired run-on-command behavior:

- `src/app/paper-betting/page.tsx`
- `src/app/stocks/page.tsx`
- `src/lib/server/research-operations.ts`

This milestone adds `src/components/paper-run-controls.tsx` (new) and this documentation (new) on a separate branch **stacked on PR #19**. **No live main-branch or production change, merge, provider call, Supabase write, balance adjustment, or betting transaction was made.**

## Exactly what was implemented

1. **Shared read-only controls**: Both Sports Paper Bets and Stocks present their separately labeled workflows, with a button to check readiness and a visibly disabled Run action.
2. **Sports readiness**: With a click, the browser reads the **existing public GET endpoints** `/api/research` and `/api/sports?sport=nba`, counting future NBA forecasts and recently observed displayed moneyline quotes (within one hour). It reports these as **observations**, never a guarantee of qualifying value bets or available executable quotes. No provider or paid Odds API refresh occurs.
3. **Stock readiness**: Explains that the isolated $1,000 study (draft PR #15), model and execution planner (stacked PRs #18–19), and real stock provider/owner ledger are not connected. Keeps the manual browser-local $10,000 journal intact and untouched.
4. **NBA server operation reporting**: Before invoking any `research_place` RPC, the server reads pre-existing positions. Existing forecast positions are skipped with a separate `alreadyRecordedPositionIds` array. Upcoming research opportunities that cannot be placed have deterministic skip categories: `no_fresh_quotes`, `no_qualifying_price`, or `game_not_upcoming`. The legacy `positionIds` and `skippedGames` fields remain available.
5. **No false claim of newly placed bets**: The existing database RPC can return a previously inserted ID, including under concurrent calls. `candidateRpcsReturned` is not an atomic new-position count. An authoritative transaction-level `created` outcome plus a persisted, unique run receipt is needed before displaying “N new bets placed”.

## Security reason Run is intentionally disabled

The website has **no authenticated owner login or owner-session binding**. The only existing mutating sports endpoint is `/api/internal/research`, protected by `SPORTSEDGE_INGEST_TOKEN` on the server. A public browser button calling it or storing the token in browser code would be unsafe. This milestone introduces **no public mutation endpoint**, accepts **no token in frontend inputs**, does not expose server secrets, and does not grant a public role any RPC capability. It does not activate either experiment or any scheduler.

The user intends each press to authorize one bounded **paper-only** run, separate from background settlement/stock valuation. The actual operation still requires: owner authentication, CSRF defenses, scoped one-run authorization, durable idempotency and account-revision locks, source-authenticated fresh market quotes, an independently approved financial accounting adapter and secure API route. This is a **security-gated intermediate implementation**, not the full on-site automation requested.

## Current experimental boundaries

- Existing NBA research ledger: separate legacy account with 1% **available** bankroll staking; proposed fixed $10 × 100 experiment (PR #14) is **not** implemented/activated by these controls.
- Draft $1,000 stock study (PR #15): not a funded/persisted production stock account and no verified transactions.
- Stock momentum model and planner: PRs #18 and #19, not merged and not connected to the live website. Those plans are not fills and do not constitute measured returns.
- No real-money orders or broker execution at any time.
- The readiness quote count does not validate opposing markets, selection criteria or bookmaker receipt of a wager. The database RPC remains the authoritative policy gate for the legacy NBA account.

## QA

Run the existing required CI suites on the draft PR:

```sh
python -m unittest discover -s analytics -p 'test_*.py' -v
node --test src/lib/ingestion/*.test.mjs src/lib/research-math.test.mjs src/lib/result-validation.test.mjs src/lib/stocks/*.test.mjs
npm run lint
npm run build
npx tsc --noEmit
```

Manual review after CI: confirm both pages render, Run remains disabled, Check readiness works and fails safely, the browser network tab shows **GET only** for the preview, no secrets are present in the page, and the manual stock journal retains its stored entries.

## Next milestone after owner approval to connect authenticated execution

Implement and verify the owner's authentication workflow first (for example, Supabase Auth with server-verified identities and least-privilege admin allowlist). Then introduce **one guarded, strictly paper-only POST** that proves user intent per run and records durable, deduplicated outcomes. Do not silently call `/api/internal/research` from a public page. Stock-side integration requires approved server-only quote ingestion, a trusted transactional adapter for PR #19 planner and PR #15 ledger, and corporate-action handling. Any automatic settlement/valuation schedule is separate and requires hosting/usage review.

**Merge path:** PR #16 → #18 → #19 → this branch, after review. PR #15 is a separate branch requiring compatibility review before a stock ledger adapter is designed.
