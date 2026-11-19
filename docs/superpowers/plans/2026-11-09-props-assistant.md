# Props Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free, rule-based chat assistant at `/assistant` that answers questions about the PrizePicks paper test from the ledger in plain sentences.

**Architecture:** Two pure modules do the work:
- `understand()` turns a message plus the last turn's context into an intent and entities.
- `answer()` turns that and the loaded props data into reply text, cards and suggestions.

A read-only API route loads the same data as the PrizePicks page (60-second cache) and calls both. A client chat component renders the thread.

**Tech Stack:** TypeScript (Node 24 `--experimental-strip-types`), `node:test`, Next.js 16 App Router (read `node_modules/next/dist/docs/` before route/page work, per AGENTS.md).

**Spec:** `docs/superpowers/specs/2026-11-09-props-assistant-design.md`

## Global Constraints

- No AI service, model API or new dependency. Read-only: no RPC and no insert anywhere in the assistant path.
- Messages ≤ 300 characters; they are never stored or logged.
- Days are New Mexico days (`America/Denver`). Money, percent and time use the existing helpers (`usdCents`, `pct`, `mtShort`).
- Numbers must equal what `buildView` and `propsSummary` give for the same data.
- Never invent a number: "not graded yet" (lines exist, no result) differs from "no data" (no lines).
- A `bet` request is always refused, with the copy-ready lineup offered instead.
- New tests go into `.github/workflows/props-verify.yml`'s unit step. `/assistant` goes into `scripts/browser-smoke.mjs` routes.

## Review Focus

1. **Follow-up with only a stat** ("and assists?") after a results or picks question: keep the previous intent and filter by the stat. Test in Task 1.
2. **"Last night" asked just after midnight** (00:30 MT on Nov 9): it means Nov 8's games. Test in Task 2.
3. **A name matching two players** ("jalen"): ask which one; never silently pick one. Tests in Tasks 1 and 3.
4. **"Tonight" before today's collection ran:** "no picks yet; the next collection is at X", not "there are no picks". Test in Task 2.
5. **Hostile or odd input** ("<script>", emoji only, 301 characters): handled without echoing raw input. Over-long input → 400 at the route; otherwise the help reply. Tests in Tasks 1 and 4.

---

### Task 1: Understanding

**Files:**
- Create: `src/lib/assistant/understand.ts`
- Test: `src/lib/assistant/understand.test.mjs`

**Interfaces:**
- Produces:
  - `export type Intent='picks'|'why'|'results'|'record'|'player'|'entries'|'lineup'|'status'|'model'|'mistakes'|'future'|'help'|'smalltalk'|'bet'|'unknown'`
  - `export type RangeKey='today'|'yesterday'|'week'|'all'|`date:${string}`` (`date:` carries `YYYY-MM-DD`)
  - `export type AssistantContext={intent?:Intent;player?:string;stat?:Stat;range?:RangeKey;lastPickIds?:number[]}`
  - `export type Parsed={intent:Intent;player:{name:string}|{ambiguous:string[]}|{unknown:string}|null;stat:Stat|null;side:'more'|'less'|null;platform:Platform|null;range:RangeKey|null;followUp:boolean}`
  - `export function understand(message:string,context:AssistantContext|null,knownPlayers:string[],nowIso:string):Parsed`
  - Constants:
    - `MIN_INTENT_SCORE=1`
    - `NICKNAMES:Record<string,string>`, e.g. `joker`→Jokic, `greek freak`→Antetokounmpo, `sga`→Gilgeous-Alexander, `ad`→Anthony Davis, `kd`→Durant, `lebron`/`bron`→James

- [ ] **Step 1: Failing tests.** A table test, `phrasings map to intents`, with more than 80 rows, using the spec §2.1 table's examples plus variants. It includes contractions ("how'd we do") and typos ("rebunds" → rebounds via the stat synonyms), and checks:
  - Entities:
    - "jokic boards over" → player Nikola Jokic, stat rebounds, side more
    - "pp" → prizepicks; "dk" → pick6
    - "nov 7" → `date:2026-11-07`
    - "this week" → `week`; "all time" → `all`
  - Players:
    - fuzzy "brunsen" → Jalen Brunson (edit distance ≤ 2)
    - nickname "the joker" → Nikola Jokic
    - "jalen" with Jalen Brunson and Jalen Williams known → `{ambiguous:[both]}`
    - "zzzz smith" → `{unknown:'zzzz smith'}` only when the intent is `player`
  - Follow-ups (Review Focus 1):
    - context `{intent:'results'}` + "and assists?" → intent `results`, stat assists, `followUp:true`
    - context `{intent:'picks',lastPickIds:[4]}` + "why?" → intent `why`
  - Hostile input (Review Focus 5): "<script>alert(1)</script>" → `unknown`; "🔥🔥" → `unknown`; "" → `help`.
- [ ] **Step 2:** Run `node --experimental-strip-types --test src/lib/assistant/understand.test.mjs`; expect FAIL (module missing).
- [ ] **Step 3: Implement.**
  - **Normalize:** NFD and strip accents, lower-case, punctuation → space, contractions map.
  - **Intents:** score by phrase (×2) and keyword (×1) lists per intent; ties broken in the spec table order.
  - **Players:**
    - compare `playerKey` of the known names with n-grams of the message (full name, then last name)
    - then nicknames
    - then Levenshtein ≤ 2 on tokens of length ≥ 4
  - **Ranges:** relative to `nowIso` in America/Denver.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `assistant: understand questions without an AI service`.

### Task 2: Answering, part 1: picks, results, record, player, entries, lineup, why

**Files:**
- Create: `src/lib/assistant/answer.ts`, `src/lib/assistant/fixtures.mjs` (synthetic TEST-ONLY `Raw` builder reused by the tests)
- Test: `src/lib/assistant/answer.test.mjs`

**Interfaces:**
- Consumes:
  - `Parsed` and `AssistantContext` (Task 1)
  - `buildView`, `PropsView` (`dashboard-view.ts`)
  - `propsSummary`, `whyLine`, `mtShort` (`summary.ts`)
- Produces:
  - `export type AssistantData={nowIso:string;pp:PropsView;p6:PropsView;control:{state:string;reason:string}|null;nextCollect:string|null;nextSettle:string|null}`
  - `export type Card={kind:'picks';items:{id:number;text:string;detail:string}[]}|{kind:'entries';items:{id:number;text:string;detail:string}[]}|{kind:'lineup';text:string}`
  - `export type Reply={text:string;cards:Card[];suggestions:string[];context:AssistantContext}`
  - `export function answer(p:Parsed,d:AssistantData):Reply`
  - `export function rangeBounds(r:RangeKey,nowIso:string):{from:string;to:string;label:string}` (Mountain day bounds as ISO; `week` = the last 7 days, today included)

- [ ] **Step 1: Failing tests** on fixture data, with exact strings for the spec §2.2 examples:
  - `results` for yesterday: "Last night went 2–1 on entries: #7 won +$10.00, #8 lost −$5.00, #9 won +$10.00. Picks hit 9 of 14 (64%). Balance $515.00."
  - `results` while lines are ungraded: "Last night's games aren't graded yet. Results usually appear after the morning grading run." No numbers.
  - `picks` tonight: the top two by probability, from different games, plus "Different games, so they fit one entry." `context.lastPickIds` is set.
  - `picks` before any collection today (Review Focus 4): "No picks for tonight yet. The next line collection is Mon, Nov 9, 12:10 PM MST."
  - `why` on `lastPickIds[0]`: contains `whyLine` output; a probability above 0.70 adds the honesty note.
  - `record` all time: equals `propsSummary` balance, net, won–lost and hit rate.
  - `player` with a stat: each platform's line, estimate, decision and result.
  - `entries`: open entries first, each with its legs.
  - `lineup`: a `lineup` card with the copy text "Booker More 11.5 rebounds; Young More 9.5 assists".
  - Review Focus 2: `rangeBounds('yesterday','2026-11-09T07:30:00Z')` (00:30 MST) gives a label for Nov 8 and covers locks on the evening of Nov 8 MT.
  - Every reply has 2–4 suggestions.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement these intents. Phrasing variants are picked by a stable hash of the message, so tests are deterministic. Entries count for a day by the Mountain day of their earliest leg's lock.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `assistant: answers for picks, results, record, players, entries and lineups`.

### Task 3: Answering, part 2: status, model, mistakes, future, help, smalltalk, bet, unknown, ambiguity

**Files:**
- Modify: `src/lib/assistant/answer.ts`
- Test: `src/lib/assistant/answer.test.mjs` (append)

**Interfaces:**
- Consumes: Task 2's `answer`, and `PropsView.model` and `.report` (from PR #108).
- Produces: no new exports.

- [ ] **Step 1: Failing tests:**
  - `status`: RUNNING/PAUSED/STOPPED in words, the next collection and grading times, and the last collection time. A safety-brake reason is quoted in plain words.
  - `model`:
    - the active model name, learning and auto-switch on/off, and each challenger's state, as on the Model panel
    - model `null` → "The learning layer isn't set up yet; the stats model makes every pick."
  - `mistakes`: the latest report's top causes with counts; no report → "No weekly review yet; the first comes after a Sunday learning run."
  - `future`: the next runs, the active model, and any queued unlocked picks.
  - `help`/`unknown`: lists what it can answer and offers 4 starter suggestions; the reply never contains the raw message (Review Focus 5).
  - `bet`: "I can't place entries — PrizePicks doesn't allow apps to, and SportsEdge is paper-only. Here's a lineup you can enter yourself:" plus a lineup card.
  - Ambiguous player (Review Focus 3): "Did you mean Jalen Brunson or Jalen Williams?", with both as suggestions.
  - Unknown player: "I don't see a line for zzzz smith in the last two weeks."
  - `smalltalk`: a short friendly reply plus suggestions.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole `answer.test.mjs` and `understand.test.mjs`; expect PASS.
- [ ] **Step 5:** Commit `assistant: status, model, mistakes, plans, help and the no-bets reply`.

### Task 4: Read-only API route

**Files:**
- Create: `src/lib/server/assistant-handler.ts`, `src/app/api/assistant/route.ts`
- Test: `src/lib/server/assistant-handler.test.mjs`

**Interfaces:**
- Consumes:
  - `understand`, `answer`
  - `loadPropsDashboardFrom` (`props-dashboard-load.ts`), `propsStore`, `buildView`, `nextPlannedRuns`
- Produces:
  - `export async function handleAssistant(req:{contentType:string|null;text:()=>Promise<string>},env:Env,load:(nowIso:string)=>Promise<Raw>,nowIso:string):Promise<Response>`
  - Route: `POST /api/assistant` → `{status:'ok',reply:Reply}`; `GET` → 405.
  - `CACHE_MS=60_000`; module-level cache keyed by nothing (one ledger).

- [ ] **Step 1: Failing tests** with a fake `load`:
  - Not `application/json` → 400.
  - Body > 2,000 bytes, or `message` > 300 characters (Review Focus 5) → 400.
  - Extra keys, or a bad context shape (wrong types, `lastPickIds` not ≤ 10 integers) → 400.
  - Valid request → 200, and `reply.text` is a non-empty string.
  - Calls within 60 s reuse the cached data; `load` is called once.
  - `load` throws → 200 with "I can't read the records right now. Try again in a minute." and a retry suggestion.
  - Not configured (no props env) → the same honest reply. `SPORTSEDGE_PREVIEW_FIXTURES=1` counts as not configured.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Response headers: `Cache-Control: private, no-store`. Read the docs in `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` first.
- [ ] **Step 4:** Run; expect PASS. Then `npx tsc --noEmit -p .`.
- [ ] **Step 5:** Commit `assistant: read-only API route with a short cache`.

### Task 5: Chat page, navigation and docs

**Files:**
- Create: `src/app/assistant/page.tsx`, `src/components/assistant-chat.tsx`
- Modify:
  - `src/lib/navigation.ts` (PrizePicks child `{href:'/assistant',label:'Ask',description:'Ask about picks, results and the model'}`)
  - `src/lib/navigation.test.mjs`
  - `src/app/paper-betting/props/page.tsx` (header button "Ask")
  - `src/app/pages.css`
  - `scripts/browser-smoke.mjs` (route `/assistant`; click the first starter chip; expect a bot reply)
  - `docs/OWNER_RUNBOOK.md` (one row: "Ask a question → Ask page")

**Interfaces:**
- Consumes: `POST /api/assistant`; the `Reply` and `Card` types.

- [ ] **Step 1: Failing test:** `navigation.test.mjs` asserts `crumbsFor('/assistant')` is `['/paper-betting/props','/assistant']` and that the sidebar child exists.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement.** The chat thread:
  - user bubbles right, bot bubbles left
  - `aria-live="polite"` on the thread
  - suggestion chips
  - picks and entries cards
  - a lineup card with a Copy button (`navigator.clipboard`, falling back to selecting the text)
  - "New chat"
  - session history in `sessionStorage` key `sportsedge-assistant-v1`, wrapped in try/catch

  Opening message and four starter chips:
  - "Tonight's picks"
  - "How did last night go?"
  - "What's my record?"
  - "Is it running?"

  Input `maxLength={300}`; Enter sends. While waiting, show "Thinking…" (no fake typing delay).
- [ ] **Step 4:** Run `navigation.test.mjs`, then `npm run lint` and `npm run build`; expect PASS.
- [ ] **Step 5:** Visual check at 1440 and 390 px against a temporary fixture loader (not committed): no horizontal overflow, the chips wrap, and the copy button works.
- [ ] **Step 6:** Commit `assistant: chat page, navigation and runbook`.
