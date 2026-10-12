# SportsEdge staging candidate — website, paper display, and broker access

Date: October 12, 2026. Scope: **review-only**, stacked on PR #26 via PR #35. No production merge, live database migration, third-party provider call, secret change or trading activation.

## Integration decisions
- Preserve PR #26 and its inherited website chain (#16 → #18 → #19 → #20 → #21 → #22 → #23 → #24 → #25 → #26).
- Port only the `AlpacaAccess` present in PR #11 and wire it into the newer Stocks page. **Do not merge or overwrite PR #11's older Stocks page**, which lacks later controls. PR #11 remains independently open; its home/guide edits need separate diff review.
- Keep PR #35 draft and stacked until the entire chain is reviewed. Do not merge this branch directly into main or automatically merge Astra's PRs #33/#34.
- The UI operates on existing simulated NBA records and browser-local manual stock records. It does not create a stock execution connector or trade real money.

## Engineering changes in PR #35
1. More readable desktop/mobile navigation, 44px mobile tap targets and narrow viewport guards.
2. Paper account primer, realized profit/loss visibility and explicit pending/settled distinction sourced from existing `paperPerformance()`.
3. Homepage connection/data-source explanation. Label NBA paper win rate as *settled*, not *live*. Validate actual `/api/research` JSON shape before rendering summary; a failed/malformed response shows unavailability and a retry link instead of invented numerical balances.
4. Alpaca external paper-dashboard shortcut brought forward without authorizing data sync or paper orders. Preserve the $10,000 manual browser journal and disabled $1,000 automated stock study.
5. Optional sports result polling defaults OFF and requires the owner's deliberate opt-in. It never automatically initiates new virtual wagers or a paid sportsbook quote fetch.

## Checks completed
- Previous PR #35 head `f8f7c7f838a1b72109de3934dd788c3f7e6c3496` was verified by three successful GitHub Actions workflows. Subsequent code commits require fresh successful checks at the final head.
- GitHub integration metadata reports PR #35 mergeable with its **parent branch**, not with production main.
- No local checkout or authenticated browser/database end-to-end test was available from this workspace.
- The connected Vercel project is `sports-edge`, but its deployment-list API returned authorization error 403 for the team scope. Preview existence, actual browser rendering and deployment environment cannot currently be verified from here. Do not infer deployment readiness from GitHub Actions alone.

## Acceptance testing still required
- Fresh green tests on final PR head: Python suite, Node suite, lint, TypeScript, Next production build and provider contract checks.
- Browser and keyboard at 320/390/768/1024/1440 px for /, /sports, /stocks, /paper-betting, /research/nba, /research/epl, /guide.
- Confirm Home status when /api/research succeeds, times out, returns HTTP 503, returns invalid JSON/shape, and succeeds after retry.
- Stocks: manual journal watchlist, open/close, corrupted localStorage safe export and refresh persistence; ensure Alpaca links open only the external site, and no local ledger changes or brokerage orders occur.
- Paper controls: unauthenticated/owner/disabled states; explicit result-polling opt-in, no new bet on refresh; pending stakes are reserved rather than marked lost.
- Authenticated HTTPS staging with disposable Supabase: inspect #22 schema and RLS; concurrent run and quote guards; token expiry, non-owner refusal, duplicate POSTs.
- **Critical: no durable per-command receipt or once-only batch semantics exists yet.** Don't enable owner paper runs until this is implemented and verified separately. Existing per-forecast uniqueness does not prevent two requests from advancing into different forecast batches.
- Confirm owner model/market and data-provider costs before a schedule. No background cron or provider budget monitor is implemented in this UI PR.

## Explicit blockers not solved by this patch
- Stock engine accounting repairs and point-in-time market data are owned by Astra.
- Broker OAuth/paper-account sync, durable account/order storage and transactional stock ledger are not connected.
- Staging browser/deployment/DB authorization and durable paper command receipts are outstanding.
- Real-money trading remains unsupported. Profitability claims remain unverified.

## Follow-up UI milestone: settled-equity graph and read-only Connections

- Added `src/lib/paper-curve.ts` deterministic SVG geometry plus adversarial Node tests. The chart starts at the actual account's initial virtual bankroll, then uses **only** `performance().curve` settlement observations from `paperPerformance()`. It does not interpolate market prices, assert future results, or count pending stakes as losses. If there are no settlements, an explicit empty state is shown.
- Added a `Connections` page linked from the shell, home, and guide. It reads **existing** `/api/research`, `/api/sports?sport=nba`, and `/api/paper-control` only on an explicit Check action and checks browser-local storage availability. Tests check malformed and unavailable data fail closed.
- The Connections page reports *saved odds API availability* rather than sportsbook/exchange live connectivity. An HTTP 200 with stored observations is **not** an executable quote, fresh market, or an indication of return.
- Refined research breadcrumbs and mobile navigation to avoid duplicate/misleading Back links and give small-screen users a swipeable route strip.
- No research-algorithm, accounting, owner-run route, paid-provider, brokerage, DB mutation, live deployment or production flag changes.

### New acceptance checks
- Verify the paper chart against zero, one, and multiple settled outcomes; validate initial equity, endpoint, and pending stake messaging.
- Test /connections before and after a read-only check, with HTTP 503, malformed JSON, invalid response shape and restrictive browser storage settings. Confirm **no provider refresh and no mutation POST** is sent.
- Test keyboard navigation and mobile scroll affordance at 320, 390, 768, 1024 and 1440 CSS pixels.
- Complete fresh GitHub Actions and Vercel preview build on the exact final head. Browser E2E checks remain a separate acceptance requirement due to deployment protection.
