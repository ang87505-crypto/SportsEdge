# Props assistant: a free, conversational command bot

Date: 2026-11-09 · Status: design for owner review · Builds on: the props learning model (PR #108)

## 1. What the owner asked for

- A chat box that **feels like a conversation but runs like a command bot**.
- It should answer questions about the PrizePicks paper test in plain sentences:
  - "how did we do last night", "who should I take tonight", "why Booker", "what about rebounds?"
- It tells odds, results, records and what the system will do next.
- **Free:** no AI service, no model API, no subscription. It runs inside the existing Next.js site.

Out of scope, by decision:

- **Placing entries or bets.** PrizePicks has no public entry API, and automating it breaks its terms.
  The bot can show a **copy-ready lineup** for the owner to enter by hand.
- **Changing anything.** The bot only reads. Pause, resume and the learning controls stay on the
  PrizePicks page behind owner sign-in.
- **Open-ended chat** about anything outside SportsEdge's own data.

Success:

1. Common questions get a correct, sourced answer from the ledger, worded naturally, with no exact
   command syntax needed.
2. Unknown or ambiguous questions get a helpful "here's what I can do" or a clarifying question, never a
   made-up answer.
3. Every number matches what the PrizePicks page shows for the same data.

## 2. How it works (no AI)

Three pure, tested steps, plus a thin API route and a chat page:

```
message + last context ──► understand() ──► intent + entities
                                   │
           ledger data (server) ──►└──► answer() ──► reply text + optional cards + suggestions
```

### 2.1 Understanding (`src/lib/assistant/understand.ts`)

- **Normalize:** lower-case, strip punctuation, expand contractions ("how'd" → "how did").
- **Intent** is scored by keyword and phrase lists; the highest score wins. Below a minimum score, the
  intent is `unknown`.

| Intent | Example phrasings |
|---|---|
| `picks` | who should I take tonight · best picks · today's picks · what do you like |
| `why` | why booker · how come · explain that pick · what makes you like it |
| `results` | how did we do last night · did my picks hit · results yesterday · how'd it go |
| `record` | what's my record · balance · am I up · how are we doing this week · ROI |
| `player` | jokic rebounds · what's the line on brunson · odds for tatum points |
| `entries` | show my entries · open entries · lineup · what's riding |
| `lineup` | give me a lineup · copy lineup · build me an entry |
| `status` | is it running · when's the next run · paused? · did it collect today |
| `model` | which model is active · is it learning · how's the new model doing · challengers |
| `mistakes` | what went wrong · why did we lose · mistakes this week |
| `future` | what will it do tonight · what's next · plans |
| `help` | help · what can you do |
| `smalltalk` | hi · thanks · cool |
| `bet` | place a bet · put $20 on · enter this for me |

- **Entities:**
  - **Player:** matched against players in the loaded data. It uses `playerKey`, then the last name,
    then a known nickname, then an edit distance of 2 or less ("jokic", "the joker", "nikola", "brunsen").
    Several close matches → a clarifying question.
  - **Stat:** pts/points/scoring → points; reb/boards/rebounds → rebounds; ast/dimes/assists → assists.
  - **Side:** over/more · under/less.
  - **Platform:** prizepicks/pp · pick6/dk.
  - **Time range** in New Mexico days: today/tonight · yesterday/last night · this week/last 7 days ·
    all time · a date like "Nov 7".
- **Follow-ups:** the client sends back the previous turn's context (intent, player, stat, range).
  A message with no intent but new entities inherits the last intent: "what about rebounds?"
  re-asks `player` or `picks` for rebounds.
  "why that one?" or "why?" uses the last answer's first pick.

### 2.2 Answering (`src/lib/assistant/answer.ts`)

Pure: (parsed request, data) → `{text, cards, suggestions, context}`.

- **Wording:** sentences built from templates with a few phrasings each, chosen deterministically per
  question so tests are stable. Numbers use the existing formatters (money, percent, Mountain time).
- **Examples:**
  - `results` (yesterday): "Last night went 2–1 on entries: #7 won +$10, #8 lost −$5, #9 won +$10.
    Picks hit 9 of 14 (64%). Balance $515."
  - `picks`: "Top two for tonight: Booker More 11.5 rebounds (74%) and Trae Young More 9.5 assists (68%).
    Different games, so they fit one entry."
  - `why`: uses the same "why" line as the PrizePicks page (stats expectation, sportsbooks' read,
    matchup), plus the model's honesty note above 70%.
  - `player`: the line on each platform, the model estimate, sportsbook odds, pick or skip, and the
    result if graded.
  - `future`: the next collection and grading times, the current model, and the picks already queued.
- **Unknown, out of scope, or no data:** says so plainly and offers 3–4 tappable suggestions. Never
  invents a number. "Not graded yet" is distinct from "no data".
- **`bet`:** explains it can't place entries and offers the copy-ready lineup.
- **Cards** (optional, rendered by the page): pick list, entry list, lineup (copy button).

### 2.3 Data (`src/app/api/assistant/route.ts`)

- **Request:** `POST` with `{message, context}`.
  - JSON only, message ≤ 300 characters, context validated against a strict shape; otherwise 400.
- **Reads** the same props data the PrizePicks page reads (`loadPropsDashboardFrom`, 14 days, plus the
  model and report).
  - A 60-second in-memory cache per server instance avoids re-reading on every message.
  - "All time" and "this week" come from the entries and settlements already loaded (latest 500 entries).
- **Read-only:** no RPC, no insert. The same public visibility as the PrizePicks page.
- **Not connected or the ledger is down:** the reply says the records can't be read right now. No numbers.
- **Messages are not stored or logged.**

### 2.4 Chat page (`/assistant`, `src/components/assistant-chat.tsx`)

- **Chat thread:**
  - The owner's messages on the right and the bot's on the left.
  - Suggestion chips under each reply.
  - The input box with Enter to send.
- **Session memory:** kept in `sessionStorage` (the per-viewer convenience); cleared with "New chat".
- **Cards:** pick lists, entries, and a copy-lineup button that copies "Booker More 11.5 rebounds;
  Young More 9.5 assists".
- **Opening message:** "Ask me about tonight's picks, last night's results, a player, or the model."
  Four starter chips.
- **Navigation:** linked from the sidebar (PrizePicks → "Ask") and from a button on the PrizePicks page.
- **Usability:** works at phone width with no horizontal scroll.

## 3. Error handling

- An unparseable or too-long message gets a gentle "try something like…".
- A player with no line in the last 14 days gets "I don't see a line for X in the last two weeks."
- Several player matches get "Did you mean Jalen Brunson or Jalen Williams?" with each as a chip.
- If the ledger is unreachable, the reply says so; the page shows a retry chip.

## 4. Testing

- **`understand.test.mjs`:** a table of more than 80 phrasings → intent and entities, including
  misspellings, nicknames, follow-ups and ambiguity.
- **`answer.test.mjs`:** fixed synthetic views → exact reply text for each intent.
  - Includes not-graded vs no-data, empty days, and the `bet` refusal.
  - Numbers match `propsSummary` and `buildView` on the same data.
- **Route handler tests:** strict body, size limit, context validation, not-configured, ledger
  failure → honest reply.
- **Browser smoke:** `/assistant` renders, a starter chip produces a reply, no horizontal overflow at 390 px.

## 5. Rollout

Ships as one change after PR #108. No database change, no new secret, no workflow. Works on the stats
model today and picks up the learning model's answers once `props_learning_v1.sql` is applied.

## 6. Limits

- It is a rule-based bot. Phrasings far from the lists get the help reply instead of a guess.
  The lists can grow later from real questions (not stored automatically).
- Answers cover the last 14 days of lines and the latest 500 entries, the same window as the
  PrizePicks page.
- Results appear only after the grading run, which GitHub can start hours late.
