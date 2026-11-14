# Claude handoff — build on SportsEdge, never replace working systems

**Read first:** [Safe expansion roadmap](SPORTSEDGE_SAFE_EXPANSION_ROADMAP_2026_11_13.md) and [machine-readable dependency graph](../research/planning/sportsedge-safe-expansion-v1.json). The roadmap is an engineering plan, not evidence of deployed features. Current user requirement: *work on everything possible safely, preserve what has already been built, and make incremental improvements Claude can refine*.

## Ready-to-use instruction to Claude

> You are reviewing and improving `ang87505-crypto/SportsEdge` as an independent senior engineering and quantitative-research reviewer. Treat everything in production as potentially serving live PAPER workflows. **DO NOT** merge or deploy anything, change protected files or flags, enable a scheduled collector, activate a paper broker, call an exchange/account, purchase API data, or promote a model. Work in narrow, additive, isolated **draft PRs** with tests; never rewrite immutable decision and settlement evidence.
>
> Read `docs/SPORTSEDGE_SAFE_EXPANSION_ROADMAP_2026_11_13.md`, `research/planning/sportsedge-safe-expansion-v1.json`, `docs/OWNER_RUNBOOK.md`, the current `main` code, and all referenced PRs before editing. Treat draft PRs as unmerged; verify repository state anew. Preserve the existing NBA props collector/learning loop, all-candidate predictions, stock PAPER owner gate, main release switches, Kalshi rights controls, current Odds API budget and existing UI navigation.
>
> Start with a **read-only conflict and safety audit**. Then implement small, independently testable improvements in dependency order. Make no source claims without a real bounded read-only provider preflight. Make no performance claims without proper point-in-time and forward data. Distinguish unknown from zero, candidate predictions from paper entries, and research proposals from actions. If a fix requires changing a protected execution file, stop at an isolated analysis/recommendation rather than applying it.
>
> Use the phases and acceptance tests below. For each finished PR report: what changed, why, exact touched files, CI/test results, source rights, data usage, what remains disabled, any failed tests, rollback, and which owner decisions remain. **Do not claim completion of unimplemented or unverified items.**

## Phase 0 — preflight / no code changes yet

1. Inspect `main` and confirm exact release manifest fields:
   - `src/lib/props/schedule.ts`: `PROPS_RELEASE.scheduledRunsEnabled`, `PROPS_COLLECTION_V2.tickEnabled`.
   - `src/lib/stocks/paper-auto-release.ts`: `PAPER_AUTO_RELEASE.brokerWritesEnabled`, `scheduledRunsEnabled`, `realMoneyEnabled`.
   - `src/lib/server/site-assistant-handler.ts`, `src/components/assistant-chat.tsx`, `src/app/page.tsx`.
   - `docs/OWNER_RUNBOOK.md`, `.github/workflows/props-tick.yml`, `.github/workflows/paper-auto-worker.yml`.
2. Get full PR metadata/diffs for #102, #164–#168, #171–#174. Verify their bases/head SHAs and whether newly changed; never assume a passed CI from yesterday is current.
3. Run `node --test scripts/sportsedge-expansion-guard.test.mjs` in the planning branch. Its role is **plan integrity only**, not production certification.
4. Produce a collision table with action/owner per conflict. Label each candidate **main**, **draft**, **staged**, **blocked**, or **needs-real-evidence**. No merging in this phase.

## Phase 1 — source archive reliability: #172 and #173

**NFL/NHL (#172).** Audit `scripts/independent-sports-collect.mjs`, `scripts/independent-sports-preflight.mjs`, and `.github/workflows/independent-sports-memory.yml`.

- Verify the *actual* NFL `games.csv` and NHL asset response (path, media type, bounded size, license, genuine header and field formats) with one opt-in read-only source request per league. The existence of a release page does not guarantee the exact CSV URL. If wrong, fix source URL/parser on #172 branch and add a fixture derived from the actual public structure, with attribution. No paid API calls.
- Confirm scores from the event date are suppressed and only later, explicitly final source-reported outcomes appear. No historic leakage or retroactive false pregame records.
- Verify success of one league persists if the other fails, retries consume no new GET on an archived UTC date, and append-only commits never rewrite older captures.
- Keep `SPORTSEDGE_INDEPENDENT_SPORTS_COLLECT_ENABLED` **unset**; no scheduled/manual job is active.
- Run targeted Node tests, CI verification, and source preflight. Preserve real response report and SHA evidence, no secrets.
- Do **not** add MLB or college adapters until NFL/NHL source contract is correct.

**CPI (#173).** Audit `scripts/kalshi-independent-cpi-collect.ts`, mock tests, license/attribution, revision-history semantics and BLS timing. Do not infer last month's CPI was publicly available before release. Never activate `SPORTSEDGE_PUBLIC_CPI_MEMORY_ENABLED` or add Kalshi quote/order access. Keep public NOAA independent.

## Phase 2 — protect Monday 2026-11-16 supervised stocks: #171, #102

- Review `scripts/stock-monday-preflight.mjs`, `src/lib/stocks/paper-auto-learning-evidence.ts`, `src/lib/stocks/paper-auto-ledger.ts`, owner UI and SQL view contracts. Reconcile all intents/fills/marks by frozen decision ID.
- Use fake broker/fixture tests. Assert anonymous API calls never load owner accounts. Error or unknown account state must fail closed. Price/return and profit cannot appear without verified fills + reconciled mark.
- **No POST/DELETE, no environment key change, no release flip.** #102 stays draft. The owner-supervised session has its own acceptance procedure; do not simulate its completion.
- Only after owner acceptance and independent review may anyone separately propose release changes. This task cannot approve them.

## Phase 3 — combine existing command centers without losing work: #168 + #174

**Main danger:** both touch `src/app/page.tsx` and `src/components/assistant-chat.tsx`. On a new integration branch, select base PR order explicitly and reconcile differences line by line; a conflict-free Git merge is not proof of behavioral compatibility.

- Preserve #168 read-only tools, strict JSON schemas, 8KB bounds, owner authorization, signed/validated turn state, optional LLM off-by-default, budget reservation and deterministic fallback.
- Preserve #174 natural-language/typo recovery, domain-specific Kalshi evidence and source navigation, but reject any question that tries to coerce the assistant into placing a real trade/bet or inventing missing quotes.
- Avoid loading Alpaca owner account for public sessions; treat prompt-injection text from external records as untrusted. Add fake tool output injection tests.
- Tests must cover multi-turn contextual queries (`how did yesterday go?`, `what about stocks?`, `why no picks tonight?`, `what about Kalshi weather?`, `what did today's winners net?`), anonymous vs owner, missing vs zero, unknown confidence, no order-writing route, reduced mobile width.
- Existing free assistant must continue to answer even when no optional LLM key is configured. No database migration or paid API requirement may be silently introduced.
- Do not integrate #171 stock-ledger changes by overwriting #168 assumptions; add an adapter plus shape tests.

## Phase 4 — AI 2.0 engine C → research intake D: #166 then #167

- Review #166 data quality, frozen registry, preregistration, decision cutoffs, clustered confidence intervals and `REJECTED` terminal lifecycle. Reject future timestamps, duplicate/edited runs, and postlock source signals.
- #167 **is stacked on C**. Migrate in order, preserve source register/SEC filing time and do not overwrite the existing `.github/workflows/verify.yml` additions from #168.
- Literature/online research can only generate hypotheses; missing rights or provider connection is a blocker, not a feature.
- New models never promote themselves. `READY_FOR_REVIEW` is only a recommendation to an owner after pre-registered forward evidence; in-sample improvement is not sufficient.
- Add a read-only lab summary/command tool only after C+D pass isolated tests together.

## Phase 5 — prediction research: sports, stocks, public events

- **Sports (#164):** preserve production pick logic. Verify no look-ahead in More/Less, minutes volatility, rest, opponent matchup and line gap. Frozen shadow versions; report game-level confidence intervals, Brier/log loss, proper sample N and line confidence calibration. Negative/no-clear-effect evidence must remain visible.
- **Stocks (#165, #133, #134):** pre-register bounded variants, compare to passive and exposure-matched SPY, capture transaction costs, selection/corporate-action bias, realized PAPER fills and 26-week forward evidence where applicable. Day trading remains cost-aware simulated research, not broker execution.
- **Free sports expansion:** one permitted source at a time (MLB, WNBA, NCAAF/NCAAB, soccer). Preserve source URL/rights, when-known timestamp, bounded one-daily-fetch semantics, validated event IDs, finalized outcomes. Do not share paid Odds API credits with this history pipeline.
- **Kalshi-adjacent research:** NOAA/BLS forecast and observation memory first; study calibration separately. Quote or edge claims wait for permitted comparable prices, verified settlement rules and owner legal/eligibility approval.
- **Stake experiment:** research-only, report propensity/correlation/variance, keep current flat virtual stake unchanged, abstain if data inadequate.

## Phase 6 — read-only operator experience / reliability

- Add cross-domain dashboard panels only after data/assistant contracts exist: provenance/freshness, graded vs pending, calibrated probability vs actual, entry ROI vs accuracy, separate stock PAPER equity and cash, source credit usage and outstanding approvals.
- All panels show a timestamp, sample denominator, confidence limitations and clear paper/research labels. Remove fake “up to date” claims if collector failed; explicit unknown is required.
- Add cheap monitoring of *existing* workflows: duplicate fetches, missed collects, grading lag, stock reconciliation evidence, and stale free-source data. Alert only when actionable, without new paid service.
- Preserve accessible mobile/desktop and the existing green/dark design. Run repo's available browser smoke and regression tests.

## Practical PR breakdown Claude should create or review

| PR theme | Base / dependencies | Safe scope | Tests / evidence |
|---|---|---|---|
| Source preflight fixes | #172 branch | NFL/NHL parser, tests, docs only | Live **read-only** response + synthetic CI |
| CPI data contract fixes | #173 branch | BLS parser/tests only | One public-response contract + no write test |
| Monday PAPER audit | #171 branch | Read-only ledger/evidence UI | Fake broker, owner auth, 0 order requests |
| Command merge adapter | New integration branch off reviewed base | Assistant/UI/read-only tool adapters | Multi-turn, owner gate, responsive QA |
| C+D learning engine integration | C branch, then D | Engine/register/research read-only | No-lookahead, replay reproducibility |
| Sports next challenger | New research branch | Frozen model & calibration only | Preregistered forward eval, no prod diff |
| Stocks next challenger | New research branch | Non-broker model research only | Cost-aware historical/forward paper |
| Public source expansion | One league per branch | Source adapter, docs, tests | License/schema/call budget |
| Ops/UX | New read-only branch | Freshness, briefing, accessibility | Browser tests, no schedule changes |

Do not open one giant PR mixing the above. For any branch, fetch current main and analyze whether the previous drafts have been merged, closed or superseded.

## Report-back format (mandatory)

```text
SportsEdge independent review — <date> / <main SHA>
Workstream / PR and base SHA:
What was already built (main vs draft):
Files changed:
Data source and rights (including exact verified snapshot timestamp):
Synthetic tests (with commands and exit results):
Actual-source tests (with calls/bytes/status), or NOT RUN:
Negative tests (no orders, no secrets, no future leakage):
Existing subsystem regressions:
Production release flags / account access changed? (must be NO):
Remaining blockers / owner approvals:
Merge recommendation: DRAFT ONLY | REVIEW READY | BLOCKED
Next independent review:
```

**If short on time:** complete an honest audit and the smallest safe PR with a clear TODO/acceptance checklist. It is better to leave a verified additive slice than to claim multiple domains finished without tests.
