# Ask SportsEdge language support v2 — research-first, no automatic execution

**Current status:** Draft PR stacked on #174, not on `main`. This does **not** deploy a new assistant or replace the existing production site. Follow-ups and typo repair are deterministic; a free rule-based parser cannot understand every possible sentence, spelling or intent. Unrecognized questions receive useful navigation instead of fabricated data.

## Questions this change is designed to handle

| User-style question | Expected safe behavior |
|---|---|
| "wer todays trdes good" | Stock PAPER performance question; requires owner sign-in before any private ledger access |
| "why no picks tonight" | Consult recorded NBA props receipts and status; distinguish no qualified pick, missing collection and unavailable evidence |
| "how is kalhsi weater acuracy" | Public NOAA/Kalshi-adjacent research only; do not invent exchange quote, market edge or real bet |
| "what commands can you follow" | Explain supported read-only questions and restricted owner proposals |
| "open stocks", "go to sports", "take me to predictions" | Return grounded internal destination links; do not pretend to navigate automatically |
| "where can i see every prediction" | Link to the all-candidate `/paper-betting/predictions` ledger |
| "how do i stop the bot?" | Explain controls and show owner page; no action is initiated |
| "please stop stock autopilot" | Existing owner-authenticated *proposal* only; must press **Confirm**, server revalidates |
| "stop autopilot tomorrow" | No scheduled action; respond with guidance, never create an automation |
| "don't pause prizepicks" | No action or proposal |
| "buy OXY" | No stock order; explain limits and link to PAPER account controls |
| "NHL picks tonight" | Say live NHL picks are not verified; research collector drafts do not constitute a deployed model |

## Implementation boundaries

- `src/lib/assistant/colloquial.ts`: bounded typo/slang aliases with conservative fuzzy matching of nonfinancial vocabulary. Original tickers, player names, amounts and numeric lines must not be mutated.
- `src/lib/assistant/domain.ts`: domain and topic routing. Stock account data remains distinct from sports props and public-event research.
- `src/lib/assistant/actions.ts`: only immediate explicit actions can propose the existing allowlisted owner controls. Negations, past-tense questions, conditionals, and scheduling instructions fail closed. Chat does not perform broker or exchange writes.
- `src/lib/assistant/knowledge-guide.ts`: grounded navigation, manual-operation guidance, truthful missing-source fallback, supported-commands catalog, and unreleased-league guard.
- `src/lib/server/site-assistant-handler.ts`: wires safe answers without new providers, keys, or writes.
- `src/lib/server/assistant-handler.ts`: accepts already-supported Learning Lab context in follow-up requests.
- `src/lib/assistant/understanding-benchmark.test.mjs` plus existing tests: representative language regressions, negative command tests, source-independent help, and real route links.

## What remains unsupported

Arbitrary unknown wording, unrestricted complex multi-step conversational planning, personal context across sessions, automatic self-learning from conversations, guaranteed perfect entity recognition, live market availability, stock broker execution, production model promotion, and automatic GitHub code deployment. The free deterministic assistant is limited to supported records and routes. **An optional hosted language model** is contemplated in [PR #168](https://github.com/ang87505-crypto/SportsEdge/pull/168), but it remains separately reviewed, disabled by default, potentially paid, and subject to owner authorization and tool restrictions.

## Review and verification

1. The source PR [#174](https://github.com/ang87505-crypto/SportsEdge/pull/174) must be reviewed before stacking this work; it is not merged.
2. Run `node --test src/lib/assistant/*.test.mjs src/lib/server/site-assistant-handler.test.mjs src/lib/server/assistant-handler.test.mjs` and the current broader CI.
3. Verify no anonymous owner-loader call, no control action card for question/hypothetical/negation, no unlicensed Kalshi/DFS calls, no altered active betting/stock switches, and no invented numerical values.
4. Validate actual desktop/mobile behavior on the reviewed integration branch, especially supported links, chips and safe fallback.
5. Integrate carefully with PR #168: both #168 and #174 modify homepage/chat. Do not overwrite either; use a separate, reviewed integration PR after the Monday stock PAPER acceptance window.

**Keep the PR draft and unmerged until current CI, browser QA, privacy and safety review pass.**
