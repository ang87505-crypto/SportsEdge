# SportsEdge additive expansion roadmap — 2026-11-13

**This is a planning/safety PR, not a feature rollout.** Its only runtime deliverable is a standalone offline validation script; no app route, live scheduler, database, deployment setting, paid API, order permission, model selection, or bankroll changes. Development must proceed by **small, separately reviewed draft PRs**. The owner has requested improvement *on top of* the existing system, never replacement of functioning production logic.

Machine-readable dependency graph and acceptance criteria: [sportsedge-safe-expansion-v1.json](../research/planning/sportsedge-safe-expansion-v1.json). The graph distinguishes **existing on main**, **implemented in an unmerged draft**, **proposed**, and **blocked**; do not mistake draft PR code for deployed capability.

## Verified baseline and invariants

Checked against `main` and PR metadata on Nov 13 (Mountain time). Recheck immediately before implementation:

- NBA props is a **running virtual-only** system with established collect/settle schedules, data budgets, grading, all-candidate prediction memory and a learning loop. The source file `src/lib/props/schedule.ts` currently has `PROPS_RELEASE.scheduledRunsEnabled: true` and `PROPS_COLLECTION_V2.tickEnabled: true`. **Do not touch either.**
- Stock PAPER `src/lib/stocks/paper-auto-release.ts`: `scheduledRunsEnabled: true`, **`brokerWritesEnabled: false`**, **`realMoneyEnabled: false`**. Do not touch the release manifest, controller, broker, worker, weekly strategy, or PR #102. Monday, **Nov 16**, is still owner-supervised, not an automatic orders date.
- Kalshi exchange orders and live market/quote access are **out of scope**. Public NOAA/BLS observations are research, not a substitute for exchange quotes.
- No real-money betting or trading, no DFS/browser automation, no new paid API, no secrets in commits, no model promotion, no silent deployment, and no overwrite of append-only evidence.
- A source-reported result is **not** an independently verified settlement. A historical table fetched today is **not** a historical point-in-time forecast.
- Data may be missing, delayed, revised or unusable: present **unavailable/unknown**, never silently convert it into zero wins, zero bets, or zero opportunities.
- Sports, stocks, Kalshi and chat remain separate **decision domains**. Shared abstractions are timestamps, provenance, experiments and read-only explanations; never share the same execution path.

## What already exists, what still needs review

| Area | Branch / PR | Current disposition | Next conservative action |
|---|---|---|---|
| NFL/NHL schedules and result memory | [#172](https://github.com/ang87505-crypto/SportsEdge/pull/172) | Draft, synthetic CI passes; source compatibility not certified | Run explicit read-only one-GET preflight for each public provider, verify schema/license, only then consider owner activation |
| Free CPI revision memory | [#173](https://github.com/ang87505-crypto/SportsEdge/pull/173) | Draft, provider live contract unverified | Verify real BLS response and record availability; keep workflow disabled |
| Stock decision-to-fill evidence | [#171](https://github.com/ang87505-crypto/SportsEdge/pull/171) | Draft, read-only | Check owner Monday diagnostic; do not enable orders or merge into release logic automatically |
| Conversational command center | [#168](https://github.com/ang87505-crypto/SportsEdge/pull/168) | Draft; optional paid model off | Audit access control, read-only tool schema, prompt injection, privacy, spending caps; integrate carefully |
| Natural-language/Kalshi questions | [#174](https://github.com/ang87505-crypto/SportsEdge/pull/174) | Draft, overlaps #168 | Preserve existing assistant and add colloquial routing/source links without dropping #168 tool authorization |
| Sports research challengers | [#164](https://github.com/ang87505-crypto/SportsEdge/pull/164) | Draft, no variant qualifies yet | Keep frozen challengers in forward-only shadow evaluation; fix documented rest defect without live strategy change |
| Stock research v3 | [#165](https://github.com/ang87505-crypto/SportsEdge/pull/165) | Draft, no qualifying strategy | Preserve negative results, costs, exposure benchmark and 26-week forward requirements |
| Experiment engine C | [#166](https://github.com/ang87505-crypto/SportsEdge/pull/166) | Draft | Validate experiment lifecycle and no automatic promotion |
| Source intake D | [#167](https://github.com/ang87505-crypto/SportsEdge/pull/167) | **Stacked on #166**, not independent | Review C before D; port any workflow changes deliberately, preserve attribution/availability gates |
| Stock PAPER broker release | [#102](https://github.com/ang87505-crypto/SportsEdge/pull/102) | Draft; **not approved** by this roadmap | Leave it untouched pending actual owner-supervised session evidence |

All the above are *separate* draft changes, not a merged product. The status of a check is not the status of a product feature.

## Explicit collision and dependency register

1. **#168 + #174** both edit `src/app/page.tsx` and `src/components/assistant-chat.tsx`. Do **not** merge one into main and assume the other will apply cleanly. Build a temporary integration branch, manually reconcile behavior, retain the existing assistant fallback and the owner-only boundary.
2. **#166 → #167**: D's PR base is C's `ai2/learning-engine` branch. Merge/rebase in that order. The registry, lifecycle tests and new intake collector require an integrated review.
3. **#168 + #167** both edit `.github/workflows/verify.yml`. Consolidate existing checks; avoid replacing a CI matrix or running unnecessary duplicate expensive builds.
4. **#168 + #171** have a schema/type dependency: command tools access `PaperAutoLedger` while #171 changes its read-only decision→fill lineage. Validate the ledger shape, authorization, no-account default and unknown/failed state handling after integration.
5. **#172, #173, #171** are largely file-disjoint, but **not deployment-independent**: each needs source/owner evidence and the overall main branch freeze before activation. Do not group their toggles into a single release.

## Architecture sketch (unchanged execution layer)

```text
                  Public research feeds (license/permission checked)
                    NFL/NHL/MLB/etc     NOAA/BLS      SEC/stock bars
                              \            |            /
                         bounded, timestamped source adapters
                                        |
                        append-only + source/availability checks
                                        |
                +-----------------------+----------------------+
                |                       |                      |
          Sports shadow lab       Stock shadow lab       Public event lab
         pregame probabilities    no-order strategies    no market/quote API
                |                       |                      |
        frozen decisions           frozen decisions       frozen forecasts
                |                       |                      |
         verified game grades    reconciled paper fills  released observations
                +-----------------------+----------------------+
                                        |
                             Read-only evidence API
                                        |
                     Ask SportsEdge / command center / dashboard
                       source links, sample N, data age, uncertainty
                                        |
                    Proposals ONLY; owner review outside this pipeline

  Existing NBA props schedules, PAPER ledger, Alpaca broker adapter,
  Kalshi permissions, Odds API budget and production deployment are NOT
  replaced by or imported into a new research execution path.
```

## Shared read-only evidence contract — proposal, not a migration

Implement as pure types and adapters in a later PR; **do not** add a live database migration just for this sketch.

- `sourceId`, `sourceUrl`, `license`, `attribution`, `payloadSha256`, `observedAt` (fetch time).
- `availableAt` (first provable public availability; may be null), `eventAt`, `revisionId`, `qualityState` (`verified`, `source_reported`, `unavailable`, `revised`, `rejected`).
- `forecastId`, `modelVersion`, `createdAt`, `lockAt`, `probability`, `featureCutoff`, `decision` (`candidate_only`, `paper_entry`, `abstain`), `forecastFingerprint`.
- `outcomeAt`, `outcomeSource`, `settlementState` (`pending`, `graded`, `void`, `unverified`), `netVirtualCents` **only** when a paper entry was settled; never infer payouts from accuracy.
- One event may have many source observations/forecast revisions, but one immutable forecast fingerprint is graded against a later verified outcome. For a live evaluation, require `availableAt < featureCutoff <= createdAt < lockAt`. Missing `availableAt` makes retrospective *point-in-time* claims ineligible.

## Small, safe work packages (in dependency order)

### A. Baseline integrity (first, before feature integration)
- Pin current `main` SHA and current release-switch values in the PR review report.
- Compare touched paths against `protectedFiles` in the manifest. Add fake-provider and fake-broker negative tests, not real orders.
- Re-run repository verification, Python tests, desktop/mobile browser QA and SQL test harness if relevant.
- Capture reversibility: each additive read-only tool and schedule has a disabled state, owning PR, and rollback.
- No policy of “fix it by changing the release switch” is acceptable.

### B. Independent source validation
- #172: actual one-request read-only NFL and NHL release preflight, license verification, schema fixtures, bound volume, idempotent commit, correct season and result states; no claim of live compatibility before successful checks.
- #173: one-request BLS CPI data contract and revision tests; verify fields, release timing and one Wednesday collection only **after** approval.
- Maintain separate source adapters for later MLB, WNBA, college and soccer additions. Add only one league per small PR. Do not use paid Odds API for independent free result history.
- Keep each provider's terms/source type in `src/lib/research/sources.ts` once the research intake stack is integrated. No hypothetical feed should be labeled connected.

### C. Sports forecast learning without affecting NBA live picks
- Start with the actual recorded-line confidence error and the existing `#164` experiment.
- Validate NFL/NHL data-quality only initially; creating a collector does **not** create a reliable NFL/NHL probability model.
- Add pre-lock rest/expected-minutes/line-gap feature experiments only after a frozen preregistration. Grade ALL candidate forecasts separately from the limited virtual entry list.
- Report graded N, game-night N, Brier, log loss, calibration bins, game-clustered uncertainty, line availability, same-event correlations, and exposure.
- Keep shadow variable-stake tests at $0 when calibration/sample requirements are insufficient. Flat live PAPER stake stays unchanged.

### D. Stock PAPER and quantitative research
- Before Nov 16 owner session: review #171 as **read-only**. Show decision intent, fill quantity, fill time, reconciled cash and verified close mark. Unknown evidence cannot be represented as return.
- Treat #102 as independently gated; no push to `brokerWritesEnabled`.
- Evaluate #165 research v3 and #133/#134 evidence with SPY and exposure-matched SPY, pre-registered splits, costs, turnover, delistings and transaction timing.
- Any day-trading idea is a separate simulated strategy with realistic liquidity, costs and conservative slippage, not an automatic trade.

### E. Kalshi-related event forecasting (independent research)
- Finish NOAA and #173 BLS public evidence archives without exchange/market-price access.
- Build frozen weather/economic predictions and verify them against later releases, with source versions and revision history.
- Market edge requires comparable permitted prices and user/legal eligibility; probability alone is not an actionable Kalshi opportunity.

### F. Chat, dashboard and learning architecture
- Reconcile #168 and #174 on a dedicated integration branch after reviewing both diffs; preserve public/owner separation, bounded data payload, no tool writes, prompt-injection resistance, signed assistant state and source links.
- Merge #166 C before #167 D; integrate learning-engine view after validating its registry and provenance tests. Keep engine suggestions research-only.
- Add read-only cross-domain reports for yesterday/today, confidence vs observed success, virtual money separated from stock equity, source age and “why no picks.”
- Keep deterministic, offline-capable answers as fallback; optional LLM budget, provider configuration and owner-only feature remain off absent separate approval.

### G. Monitoring and polish
- Add no-cost read-only checks for stale research jobs, data gaps, duplicates, failed grades, provider request consumption and owner-required actions.
- Keep mobile dark-green design and accessibility; run the current browser smoke suite after UI changes.
- Monitoring and chat must not drive mutation, collection, or trading indirectly.

## Review gates / do-not-merge conditions

- `main` behavior diff affects any betting/trading/controller/model-release file without independent review.
- Any API credential enters a log, prompt, JSON fixture or commit.
- A new schedule or remote download is enabled by merging, rather than owner-approved activation.
- A synthetic success is described as a real-source contract verification.
- Historical results are represented as forward predictions; look-ahead validation lacks explicit source availability time.
- Assistant/tool code can mutate accounts, release models, or expose owner-only data anonymously.
- Any evidence report silently changes `unavailable` into numeric zero.
- A stock model is promoted because a backtest appears profitable despite weak forward evidence.

## Verification commands for the standalone planning PR

```sh
node --test scripts/sportsedge-expansion-guard.test.mjs
node scripts/sportsedge-expansion-guard.mjs
node scripts/sportsedge-expansion-guard.mjs --diff # optional after fetching main; planning branch only
```

The planning PR must contain **only the six allowlisted documentation/manifest/test/workflow paths**. A passing planning guard **does not** prove new research collectors, UI, models, or release decisions work. Every later implementation PR needs its own domain tests and owner sign-off for activation.
