# SportsEdge first-party command intelligence — native-first integration (Nov 14, 2026)

**Branch** `feature/command-center-unified-20261114`, **draft PR #181**, stacked on **#177 → #174 → main**. This is not deployed. No bank, broker, sportsbook, paid odds, Kalshi trading, or production state change is authorized by this branch.

## What "build our AI ourselves" means

SportsEdge owns and can test its **prediction engines**, **stored sports-stat observations**, **point-in-time forecast and grade history**, **stock backtest/forward research**, **independent NOAA evidence**, and **the command center that asks read-only questions of those sources**. These core components have no per-message language-model token expense. The command center is a bounded first-party query engine, not a general GPT-like pretrained neural network. Training a competitive general-purpose LLM from zero would require separately licensed training data, specialized accelerator capacity, substantial operational funding, and major evaluation work. It is **not required** for the SportsEdge domain assistant.

## New unified native behavior

- `/api/command`: first-party deterministic planner (read-only tools), strict schemas, session-bounded followups, and source-linked results. Unrecognized, mixed-domain, natural-language navigation, data-freshness, NOAA, betting/stock control, or detailed domain questions fall back to the already-tested `handleSiteAssistant` pipeline.
- `/assistant` and homepage chat: preserve the 300-character per-message cap, React request cancellation gate, owner session refresh, and private-answer hiding on logout. Send a bounded transcript and validated previous tool calls; the server drops unverifiable assistant turns before optional model use.
- The built-in tools read last-two-weeks PrizePicks paper results, time-period comparisons, scheduled jobs, research strategies, lab experiments, and private stock PAPER status only when signed in. It is essential not to call a **paper recorded pick** a real wager, a **workflow success** a verified database grade, or an **independent NOAA forecast** a Kalshi quote or win.
- `src/components/command-insights.tsx` adds research/ops evidence panels to the existing command center without requiring new provider calls.
- Sensitive owner actions never flow through a language model. They can only be proposed by the fixed allowlist from the existing assistant and require an independent owner confirmation via protected endpoints. Chat cannot Start stock order trading, create a real wager, expand a betting limit, promote a model, or enable Kalshi exchange access.
- Native period routing must NEVER answer an independent weather/Kalshi, stock, or mixed-domain question using sports-betting accuracy; those go to source-aware legacy paths.

## Zero paid inference by default

`llmConfig()` returns `null` unless **all** the following are explicitly set: `COMMAND_LLM_ENABLED=true`, `COMMAND_LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `COMMAND_LLM_LEDGER=supabase`, a supported model, and a positive daily budget under $50. Without the separately applied database budget migration, the model also fails closed. **This PR sets no such variables, applies no database migration, and enables no provider account.**

The optional language-model adapter is a possible *future interface enhancement*, not the intelligence or memory behind SportsEdge. A later self-hosted open-weight model could replace it, but would require separate infrastructure, privacy, model quality and licensing evaluation. GPU/hosting costs are not zero.

## Sign-off before releasing anything

1. Existing SportsEdge `#174` and `#177` need review/merge in correct stacked order; **#181 cannot be treated as independently deployable on main**.
2. GitHub Actions must pass command unit/integration tests, synthetic owner-auth tests, production build, desktop/mobile browser QA, NBA props verification, and stock-research foundation tests. Credentialed real-records smoke is **manual only**; no added prod provider requests in PR testing.
3. Manually inspect these exact user flows (without using private real account data in screenshots): `How did our picks do yesterday?`, `which ones missed?`, `and today?`, `How does that compare with last week?`, `why aren't you working?`, `are NBA lines up to date?`, `Compare NBA and stock results`, `What did our NOAA research record?`, and `Please stop the stock bot`. Owner control inquiries must never execute without the separate confirmation. Stock-only data must never appear to public visitors.
4. Assess `#168` overlap carefully: code is staged on this new branch instead of merging the old PR over `#177`'s more recent UI. In particular, **do not overwrite** `src/components/assistant-chat.tsx` from `#168`.
5. Verify stock paper Monday Nov 16 owner-supervised release remains frozen: no change to order execution flags, broker session, collector credit policy, auth cookies, research models, Supabase production schema or cron schedule.
6. `#179` Watch Only is separately reviewed and can be added through source-specific read-only tooling later. Do not tell users the native command engine covers 90-day Watch Only stats until those integrations exist and have actual recorded data.

The *finished command center* means tested domain-specific conversations with truthful data, clear provenance, strict auth, safe controls, and reliable operation. It does not imply profitable sports or stocks forecasts, licensed exchange prices, or a trained foundation model.
