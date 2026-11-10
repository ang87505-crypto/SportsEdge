# Props Learning Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free sportsbook signal, a per-stat learning layer over the current props model, and a weekly
learning loop with shadow scoring, gated promotion, mistake review, safety brake and owner controls.

**Architecture:** Pure, tested functions in `src/lib/props/` (market, features, learn, promotion, brake, review).
They are wired into the existing worker (`src/lib/server/props-cycle.ts`, `scripts/props-worker.ts`) and a new
weekly worker (`scripts/props-learn.ts`). New append-only Postgres tables live in two additive SQL files.
The dashboard reads them through the existing loader; owner actions extend `src/lib/server/props-owner.ts`.

**Tech Stack:** TypeScript (Node 24 `--experimental-strip-types`), `node:test`, PostgreSQL/Supabase via
PostgREST (`props-store.ts`), Next.js 16 App Router (read `node_modules/next/dist/docs/` before UI work, per
AGENTS.md), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-08-props-learning-model-design.md`

## Global Constraints

- Free only: no paid odds plan, no model API, no new paid service. Budget policy stays `props-budget-v2`.
- Collect request: `bookmakers=prizepicks,pick6,draftkings,fanduel,betmgm,williamhill_us` (≤ 10 books = 1 region);
  markets `player_points,player_rebounds,player_assists`; worst-case cost per event stays 3.
- Paper only: nothing contacts a DFS or sportsbook account; `PROPS_RELEASE.realMoneyEnabled` stays `false`.
- Append-only evidence: every new table gets the existing `props_append_only` trigger. Chronology triggers refuse
  rows at or after lock, as on `props_observations` and `props_predictions`.
- Model versions match `^props-[a-z0-9-]+-v[0-9]+$`: learning layer `props-learn-v<N>`; layer 1 stays `props-nb-minutes-rate-v1`.
- Constants (from spec):

  | Name | Value |
  |---|---|
  | `LAGGING_LINE_GAP` | 1.0 |
  | `PROS_DISAGREE_MIN` | 0.55 |
  | `MARKET_MIN_LINES` | 150 |
  | `RECENCY_HALF_LIFE_DAYS` | 60 |
  | `MAX_SHADOWING` | 3 |
  | `BRAKE_WINDOW` | 150 |
  | `BRAKE_MIN` | 50 |
  | `BREAK_EVEN` | 0.577 |
  | `MINUTES_COLLAPSE` | 0.6 |
  | `OPP_WINDOW_GAMES` | 15 |
  | `REST_CAP` | 3 |
  | `LAMBDA_GRID` | `[0.01, 0.1, 1, 10]` |

- Promotion gate is the registered gate in `src/data/props/research_v2.json` (`reviewGate`): 500 lines, 14 dates,
  50 games, 100 candidate decisions, Brier difference upper95 ≤ −0.002, 1,000 replicates, seed 20261108, log loss no worse.
- Seed control row: active `props-nb-minutes-rate-v1`, `learning_enabled=true`, `auto_switch_enabled=true`.
  The spec leaves the default to the plan; on was chosen because the owner asked for automatic learning,
  and the gate and Roll back limit the risk.
- Owner endpoints: existing owner session cookie, same-origin check, `application/json` only, strict bodies;
  refusal → 409, unknown outcome → 503 with `retrySafe:true`.
- Times shown to the owner are Mountain time via `mtShort` (`src/lib/props/summary.ts`).
- Every new `*.test.mjs` is added to the unit-test step of `.github/workflows/props-verify.yml`; every new SQL
  file and its test is added to `scripts/verify-props-sql.sh`.

## Review Focus

1. **A sportsbook spells the player differently** ("Nic Claxton" vs "Nicolas Claxton"): there must be no market
   view for that line (books absent), never another player's odds. Test in Task 3.
2. **The active model's artifact is missing or fails its hash** at collect time: collect must fall back to layer 1,
   record `active_model_fallback` in the run summary, and still record picks. Test in Task 11.
3. **The safety brake trips while the owner has already Stopped or Paused:** it must not change a non-RUNNING
   control. Test in Task 9.
4. **The same line on PrizePicks and Pick6** must count once in the gate, the review and the brake
   (dedupe key `event|playerKey|stat|line`, as in `research.ts`). Tests in Tasks 8, 9 and 10.
5. **Approve or Roll back with nothing to act on** (version not eligible, no previous version): the database
   refuses with a code, and the UI shows it. Test in Task 7 (SQL) and Task 13 (handler).

---

## Milestone A: free sportsbook signal (shippable alone; no model change)

### Task 1: Request sportsbook props in the same call

**Files:**
- Modify: `src/lib/props/contract.ts`, `src/lib/server/props-odds-client.ts:24-27`
- Test: `src/lib/props/normalize.test.mjs` (append)

**Interfaces:**
- Produces:
  - `export const SPORTSBOOKS=['draftkings','fanduel','betmgm','williamhill_us'] as const`
  - `export type Sportsbook=typeof SPORTSBOOKS[number]`
  - `export const SPORTSBOOK_LABEL:Record<Sportsbook,string>` = DraftKings, FanDuel, BetMGM, Caesars
  - `eventOddsParams().bookmakers` = platforms then sportsbooks, comma-joined

- [ ] **Step 1: Failing test** `eventOddsParams lists platforms then sportsbooks, at most 10 books`:
  `bookmakers.split(',')` deep-equals `['prizepicks','pick6','draftkings','fanduel','betmgm','williamhill_us']`;
  `regions` still `'us_dfs'`; `eventOddsWorstCost()` still `3`.
- [ ] **Step 2:** Run `node --experimental-strip-types --test src/lib/props/normalize.test.mjs`; expect FAIL on the bookmakers list.
- [ ] **Step 3:** Add the constants to `contract.ts`; build `bookmakers` from `[...PLATFORMS.map(p=>PLATFORM_BOOKMAKER[p]),...SPORTSBOOKS]`.
- [ ] **Step 4:** Re-run; expect PASS.
- [ ] **Step 5:** Commit `props: request sportsbook props in the existing collect call (no extra credits)`.

### Task 2: Normalize sportsbook quotes separately

**Files:**
- Modify: `src/lib/props/normalize.ts`
- Test: `src/lib/props/normalize.test.mjs`

**Interfaces:**
- Consumes: `SPORTSBOOKS`, `ListedEvent`, `OBSERVATION_RULES` (same freshness/lock rules)
- Produces:
  - `normalizePropEvent` skips sportsbook keys silently; they are not counted as `unknown_bookmaker`.
  - `export type BookQuote={bookmakerKey:Sportsbook;providerEventId:string;playerName:string;stat:Stat;marketKey:string;line:number;overPrice:number;underPrice:number;providerLastUpdate:string;ingestedAt:string;lockAt:string;responseSha256:string}`
  - `export function normalizeBookQuotes(raw:unknown,listed:ListedEvent,ingestedAt:string):{quotes:BookQuote[];rejected:{bookmakerKey:string;reason:ObservationReject}[]}`

- [ ] **Step 1: Failing tests** on one fixture event holding prizepicks, draftkings and fanduel markets:
  - `sportsbooks are not rejected by the platform normalizer`: no `unknown_bookmaker` for draftkings or fanduel.
  - `normalizeBookQuotes keeps complete over/under pairs with American prices`: 2 quotes.
  - `normalizeBookQuotes rejects stale, after-lock, missing-price and duplicate pairs`: reasons
    `stale_quote`, `quote_after_lock`, `incomplete_pair`, `duplicate`; and a book posting two lines for one
    player/stat → `ambiguous_line`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement by sharing the group/validate logic with `normalizePropEvent`.
  Extract a private `collectGroups(event, now, lockMs, accept:(key)=>boolean)`. Do not duplicate it.
  Book quotes require both prices to be non-null integers; multipliers are ignored.
- [ ] **Step 4:** Run the whole `normalize.test.mjs`; expect PASS, including the existing tests.
- [ ] **Step 5:** Commit `props: normalize sportsbook prop quotes`.

### Task 3: Market view (margin-free probability, line gap, flags)

**Files:**
- Create: `src/lib/props/market.ts`
- Test: `src/lib/props/market.test.mjs`

**Interfaces:**
- Consumes: `BookQuote`, `playerKey` from `identity.ts`
- Produces:
  - `export function noVigMore(overAmerican:number,underAmerican:number):number`
  - `export type MarketView={booksAtSameLine:number;pMoreBooks:number|null;nearestBookLine:number|null;lineGap:number|null;flags:('lagging_line'|'pros_disagree')[]}`
  - `export function marketView(obs:{providerEventId:string;playerName:string;stat:Stat;line:number},quotes:BookQuote[],modelSide:'more'|'less'|null):MarketView`
  - `export const LAGGING_LINE_GAP=1.0, PROS_DISAGREE_MIN=0.55`

- [ ] **Step 1: Failing tests:**
  - `noVigMore(-110,-110)` = 0.5; `noVigMore(-150,130)` ≈ 0.57983 (±1e-5).
  - Two books at the same line → `booksAtSameLine` 2 and `pMoreBooks` = mean of their values.
  - No same-line book, nearest at 25.5 vs line 24.5 → `pMoreBooks` null, `lineGap` 1, flags include `lagging_line`.
  - Books 0.58 More, modelSide `'less'` → `pros_disagree`. Books 0.53 → no flag. `modelSide` null → no flag.
  - **Review Focus 1:** a quote for "Nicolas Claxton" never matches observation "Nic Claxton" → `booksAtSameLine` 0, all nulls, no flags.
  - Quotes from another event or stat are ignored.
- [ ] **Step 2:** Run `node --experimental-strip-types --test src/lib/props/market.test.mjs`; expect FAIL.
- [ ] **Step 3:** Implement. Decimal odds: `o>0 ? 1+o/100 : 1+100/-o`; `p=(1/dOver)/((1/dOver)+(1/dUnder))`.
  Match on `providerEventId`, `stat` and `playerKey(name)` equality. "Nearest" is the smallest |gap|; on a tie, the line closest to the median.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `props: market view from sportsbook quotes`.

### Task 4: Market tables

**Files:**
- Create: `database/props/props_market_v1.sql`, `database/props/tests/props_market_v1_test.sql`
- Modify: `scripts/verify-props-sql.sh`

**Interfaces:**
- Produces:
  - `props_book_quotes(id, run_id → props_runs, raw_response_id → props_raw_responses, bookmaker_key CHECK IN (the 4 books), provider_event_id, player_name, stat, market_key, line, over_price int, under_price int, provider_last_update, ingested_at, lock_at, response_sha256, UNIQUE(bookmaker_key,provider_event_id,market_key,player_name,line,provider_last_update))`
  - `props_market_views(id, observation_id UNIQUE → props_observations, run_id, books_at_same_line int, p_more_books numeric CHECK 0..1 or NULL, nearest_book_line numeric, line_gap numeric, flags text[] CHECK ⊆ {lagging_line,pros_disagree}, computed_at default props_now())`

- [ ] **Step 1: Failing SQL test** (style of `props_v1_test.sql`, ending in one summary line). It asserts:
  - an insert works from a live run before lock
  - an insert at/after lock or with `provider_last_update` older than 2 h raises `PROPS_…`
  - UPDATE and DELETE raise (append-only)
  - `anon` and `authenticated` have no privileges; `service_role` can insert and select
  - a second market view for the same observation conflicts
- [ ] **Step 2:** Add both files to `verify-props-sql.sh` after budget v2. Run `sudo -E bash scripts/verify-props-sql.sh`; expect FAIL (tables missing).
- [ ] **Step 3:** Write `props_market_v1.sql`. Reuse `props_require_running`, a chronology trigger function mirroring
  `props_check_observation`, the `props_append_only` loop and the grants block.
- [ ] **Step 4:** Run; expect PASS (existing v1 and v2 lines unchanged).
- [ ] **Step 5:** Commit `props: append-only sportsbook quote and market view tables`.

### Task 5: Store quotes and market views during collect

**Files:**
- Modify: `src/lib/server/props-cycle.ts` (`runCollect`, `predictAndPick`)
- Test: `src/lib/server/props-cycle.integration.test.mjs` (extend the fixture reply with DraftKings and FanDuel markets)

**Interfaces:**
- Consumes: `normalizeBookQuotes`, `marketView`
- Produces:
  - Run summary keys `bookQuotes:{inserted:number;byBook:Record<Sportsbook,number>}` and `marketViews:{withBooks:number;without:number;flags:Record<string,number>}`
  - Rows in both new tables

- [ ] **Step 1: Failing integration assertions** (PG test): after a collect on the fixture:
  - `props_book_quotes` has the fixture's quote count
  - each observation has exactly one `props_market_views` row, using the v1 recorded side as `modelSide`
  - credits reserved for the event are still 3
- [ ] **Step 2:** Run `sudo -E bash scripts/verify-props-sql.sh`; expect FAIL.
- [ ] **Step 3:** Implement. Insert quotes right after observations, with the same `onConflict`/`ignoreDuplicates` pattern.
  Compute views after picks are decided (side known) and insert in chunks of 200.
  Quote-insert failure must not lose observations: catch it, set `bookQuotes.error`, and continue.
- [ ] **Step 4:** Run; expect PASS. Also run `node --experimental-strip-types --test src/lib/props/*.test.mjs`.
- [ ] **Step 5:** Commit `props: record sportsbook quotes and market views each collect`.

## Milestone B: learning layer and historical replay (no live change)

### Task 6: Matchup features without leakage

**Files:**
- Create: `src/lib/props/features.ts`
- Test: `src/lib/props/features.test.mjs`

**Interfaces:**
- Produces:
  - `export type TeamGameRow={espnEventId:string;teamAbbr:string;opponentAbbr:string;gameStart:string;minutes:number|null;points:number|null;rebounds:number|null;assists:number|null;didNotPlay:boolean}`
  - `export type Matchup={oppAllowedRatio:number;home:0|1;restDays:number;backToBack:0|1}`
  - `export function matchupFeatures(i:{teamAbbr:string;opponentAbbr:string;home:boolean;lockAt:string;stat:Stat;rows:TeamGameRow[]}):Matchup`
- Definitions:
  - `oppAllowedRatio` = (sum of `stat` ÷ sum of minutes by players whose `opponentAbbr` is the opponent, over the
    opponent's last `OPP_WINDOW_GAMES` games before lock) ÷ the league per-minute rate over all rows before lock in the
    prior 60 days. Fewer than 5 opponent games → 1.0.
  - `restDays` = `clamp(floor((lock − team's previous gameStart) / 24 h) − 1, 0, REST_CAP)`; `backToBack` = 1 when `restDays` is 0.
    No previous game → `restDays` 3, `backToBack` 0.

- [ ] **Step 1: Failing tests:**
  - A strong-defence fixture gives ratio < 1, a weak one > 1.
  - Back-to-back gives restDays 0 and b2b 1; two days off gives 2.
  - **Leakage:** a row with `gameStart` ≥ `lockAt`, if included, does not change any output (compare with/without).
  - Under 5 opponent games → ratio 1.0.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Filter `Date.parse(gameStart) < Date.parse(lockAt)` once at entry.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `props: leakage-safe matchup features`.

### Task 7: Learning layer (ridge logistic) and artifact

**Files:**
- Create: `src/lib/props/learn.ts`
- Test: `src/lib/props/learn.test.mjs`

**Interfaces:**
- Consumes: `Probabilities` from `research.ts`, `MarketView`, `Matchup`
- Produces:
  - `export const FEATURES=['bias','stats_logit','books_logit','books_present','line_gap_books','opp_allowed_ratio','home','rest_days','back_to_back'] as const`
  - `export const MARKET_FEATURES=[2,3,4]` (indices)
  - `export type LearnInput={base:Probabilities;market:MarketView|null;matchup:Matchup}`
  - `export function featureVector(x:LearnInput):number[]`:
    - `stats_logit` = logit of `pMore/(1−pTie)` clamped to [1e-6, 1−1e-6]
    - the books terms are 0 when `pMoreBooks` is null
    - `line_gap_books` = `lineGap ?? 0`
    - `opp_allowed_ratio` enters as `ratio − 1`
  - `export function fitRidgeLogistic(rows:{x:number[];y:0|1;w:number}[],lambda:number,fixedZero:number[]):number[]`
    (Newton/IRLS, ≤ 50 iterations, bias unpenalised, deterministic)
  - `export function chooseLambda(rows:{x:number[];y:0|1;w:number;at:string}[],fixedZero:number[]):number`
    (4 time-ordered folds over `LAMBDA_GRID`, minimise mean log loss)
  - `export type LearnArtifact={modelVersion:string;baseModelVersion:'props-nb-minutes-rate-v1';trainedAt:string;dataCutoff:string;features:typeof FEATURES;weights:Record<Stat,number[]>;lambda:Record<Stat,number>;marketWeightsActive:boolean;counts:Record<Stat,{historical:number;forward:number;forwardWithBooks:number}>}`
  - `export function predictLearn(a:LearnArtifact,stat:Stat,x:LearnInput):Probabilities`:
    `pMore=(1−pTie)·σ(w·x)`, `pLess=(1−pTie)−pMore`, with `pTie` from the base
  - `export function artifactSha256(a:LearnArtifact):string` (`canonicalJson` + `sha256` from `normalize.ts`)

- [ ] **Step 1: Failing tests:**
  - **Recover known weights:** 20,000 synthetic rows from a seeded LCG with true weights
    `[0.1, 1.0, 0.6, 0, 0.2, -0.5, 0.05, 0.02, -0.1]`, λ = 0.01 → every recovered weight within 0.1.
  - **`fixedZero` holds:** with `fixedZero=MARKET_FEATURES`, those weights are exactly 0.
  - **`predictLearn` is a valid distribution:** sums to 1 (±1e-9) and keeps `pTie`; with all weights 0 except `stats_logit=1`, it reproduces the base `pMore` (±1e-9).
  - **Hash stability:** `artifactSha256` is stable under key reordering.
  - **No forward data:** 0 forward rows → the fit still returns weights and the market weights stay 0.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. L2 penalty `lambda·Σw²` over non-bias, non-fixed weights; solve the Newton step by
  Gaussian elimination (9×9). Training weights `w`: historical 1; forward `0.5^(ageDays/60)`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `props: per-stat ridge logistic learning layer`.

### Task 8: Historical replay and report

**Files:**
- Create: `scripts/props-learn-replay.ts`, `scripts/lib/box-csv.ts` (CSV loader and proxy line moved from `props-model-fit.ts`)
- Modify: `scripts/props-model-fit.ts` and `scripts/props-calibration-study.ts` (import the shared loader; outputs unchanged)
- Output: `research/props_learn_replay_20261108/report.json`, `docs/PROPS_LEARNING_REPLAY_2026_11_08.md`
- Test: `scripts/box-csv.test.mjs`

**Interfaces:**
- Consumes: `predictLine`, `matchupFeatures`, `fitRidgeLogistic`, `chooseLambda`, `summarize`, `pairedInterval`
- Produces: `report.json` = `{protocol, sources:{file,sha256}[], train:{from,to}, test:{from,to}, byStat:Record<Stat,{layer1:Summary;learn:Summary;interval:{lower95,upper95,games}}>}`

- [ ] **Step 1: Failing test:** `box-csv` parses a 3-row fixture CSV, applies the regular-season and team
  filters, and gives the same proxy line as the current `proxyLine`. Move the existing logic; do not rewrite it.
- [ ] **Step 2:** Run `node --experimental-strip-types --test scripts/box-csv.test.mjs`; expect FAIL.
- [ ] **Step 3:** Extract the loader. Re-run `props-model-fit.ts backtest` on 2025-26 and confirm the output is
  byte-identical to `research/props_backtest_20261107/backtest_2025-26.json`.
- [ ] **Step 4:** Write `props-learn-replay.ts`:
  - fixed split: train on 2024-25 plus 2025-26 through 2025-12-31; test 2026-01-01 → season end
  - walk-forward layer-1 predictions and matchup features (no books in history, so `market:null`)
  - dedupe key as in Review Focus 4
  - a leakage counter in the report (feature rows checked, rows with any input at/after lock); the run fails if
    the second number is not 0
  - source hashes pinned to the SportsDataverse files and hashes already in `research/props_calibration_20261108/protocol.json`
- [ ] **Step 5:** Run it (locally, or via a `workflow_dispatch` job if the CSV hosts are blocked). Commit `report.json`
  and a 1-page doc with the per-stat Brier and log loss table and a plain verdict. A negative result is reported as such.
- [ ] **Step 6:** Commit `props: historical replay of the learning layer`.

## Milestone C: learning loop

### Task 9: Safety brake

**Files:**
- Create: `src/lib/props/brake.ts`
- Test: `src/lib/props/brake.test.mjs`

**Interfaces:**
- Produces:
  - `export function wilsonUpper(k:number,n:number,z=1.96):number`
  - `export function safetyBrake(picks:{key:string;correct:boolean;gradedAt:string}[],control:string|null):{trip:boolean;n:number;hitRate:number|null;upper:number|null}`:
    newest `BRAKE_WINDOW` after dedupe by `key`; no trip under `BRAKE_MIN`; trips only when `control==='RUNNING'`
    and `upper < BREAK_EVEN`.

- [ ] **Step 1: Failing tests:**
  - 20 of 50 → trip (upper ≈ 0.538)
  - 80 of 150 → no trip (upper ≈ 0.611)
  - 49 picks → no trip
  - a 151st, older pick is ignored
  - duplicate keys count once
  - **Review Focus 3:** 20/50 with control `'STOPPED'` or `'PAUSED'` → `trip:false`
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `props: safety brake on recent hit rate`.

### Task 10: Promotion gate and mistake review

**Files:**
- Create: `src/lib/props/promotion.ts`, `src/lib/props/review.ts`
- Test: `src/lib/props/promotion.test.mjs`, `src/lib/props/review.test.mjs`

**Interfaces:**
- Consumes: `EvaluationRow`, `summarize`, `pairedInterval` from `research.ts`; `reviewGate` from `research_v2.json`
- Produces:
  - `export function evaluateChallenger(rows:EvaluationRow[],gate:ReviewGate):{eligible:boolean;failed:string[];baseline:Summary;candidate:Summary;interval:{lower95:number;upper95:number;games:number}|null;dates:number;games:number}`.
    `failed` uses the codes `min_lines`, `min_dates`, `min_games`, `min_decisions`, `brier_interval`, `log_loss`.
  - `export type MissCause='minutes_collapse'|'books_were_right'|'matchup'|'overconfidence'|'other'`
  - `export function classifyMiss(m:{expMinutes:number|null;actualMinutes:number|null;side:'more'|'less';outcome:'more'|'less';booksSide:'more'|'less'|null;oppAllowedRatio:number;overconfidentBand:boolean;stat:Stat}):MissCause`.
    First match wins, in the spec §5.3 order. "Matchup against the pick" = more-pick with ratio < 1 − 1 SD, or
    less-pick with ratio > 1 + 1 SD, with SD = 0.08.
  - `export type Summary=ReturnType<typeof summarize>`; `export type ReviewGate=typeof researchV2.reviewGate`
  - `export type ReviewLine={key:string;eventId:string;date:string;stat:Stat;outcome:'more'|'less'|'tie'|'void';layer1:Probabilities;active:Probabilities;books:number|null;challengers:Record<string,Probabilities>;recorded:boolean;side:'more'|'less'|null;expMinutes:number|null;actualMinutes:number|null;oppAllowedRatio:number}`
    (`actualMinutes` comes from `props_player_games` joined on athlete and game; `expMinutes` from the layer-1 prediction's `inputs`)
  - `export function weeklyReview(lines:ReviewLine[],period:{from:string;to:string}):LearningReport`.
    `LearningReport={period;misses:Record<MissCause,number>;voidsExcluded:number;scorecards:{layer1:Summary;books:Summary|null;active:Summary;challengers:Record<string,Summary>};overconfidentBands:string[]}`.

- [ ] **Step 1: Failing tests (promotion):**
  - A synthetic set meeting every count with the candidate clearly better → eligible.
  - Each threshold broken in turn → that code appears in `failed`.
  - **Review Focus 4:** the same line on two platforms counts once toward `min_lines`.
- [ ] **Step 2: Failing tests (review):**
  - One fixture per cause, plus precedence: a minutes collapse with books also right → `minutes_collapse`.
  - Voids are excluded and counted.
  - The overconfident band is flagged when its hit rate is below its mean prediction by > 2 SE.
- [ ] **Step 3:** Run both files; expect FAIL.
- [ ] **Step 4:** Implement both.
- [ ] **Step 5:** Run; expect PASS.
- [ ] **Step 6:** Commit `props: promotion gate and weekly mistake review`.

### Task 11: Learning tables, active model and shadow scoring in collect

**Files:**
- Create: `database/props/props_learning_v1.sql`, `database/props/tests/props_learning_v1_test.sql`
- Modify:
  - `src/lib/server/props-store.ts` (RPCS list)
  - `src/lib/props/contract.ts` (`SELECTION_VERSION_V2='props-select-v2'`)
  - `src/lib/props/rules.ts` (`decidePickV2`)
  - `src/lib/server/props-cycle.ts`
  - `scripts/verify-props-sql.sh`
- Test: `src/lib/props/model-rules.test.mjs` (v2 rule), `props-cycle.integration.test.mjs`

**Interfaces:**
- Produces, SQL:
  - `props_model_artifacts(version PK CHECK '^props-learn-v[0-9]+$', sha256, artifact jsonb, created_at)`
  - `props_model_events(id, version, event CHECK IN ('created','dropped','shadow_start','eligible','promoted','rolled_back','retired'), reason, actor, detail jsonb, at)`
  - `props_model_control_log(id, active_model_version, previous_model_version, learning_enabled, auto_switch_enabled, changed_by, reason, at)`,
    plus view `props_model_control` = the latest row; seed row as in Global Constraints
  - `props_learning_reports(id, period_from, period_to, model_version, report jsonb, at)`
  - RPCs:
    - `props_set_learning(p_learning bool, p_auto bool, p_actor text, p_reason text) → jsonb`
    - `props_promote_model(p_version text, p_actor text, p_reason text) → jsonb`:
      refuses `PROPS_MODEL_NOT_ELIGIBLE` unless the latest event for the version is `eligible`;
      refuses `PROPS_MODEL_ALREADY_ACTIVE`
    - `props_rollback_model(p_actor text, p_reason text) → jsonb`: refuses `PROPS_NO_PREVIOUS_MODEL`
  - Accounts `props-prizepicks-v2` and `props-pick6-v2` ($500, $5, 3/day, 2 picks, `props-select-v2`).
    `props_accounts` is append-only, so activation is a separate append-only table
    `props_account_activations(id, account_id → props_accounts, active_from, actor, at)`:
    - v1 accounts are seeded active from `2026-11-07`
    - v2 accounts get their row from `props_promote_model` on the first promotion of a learn version
    - `props_record_entry` is replaced (`CREATE OR REPLACE`, same signature) to refuse an account with no
      activation at or before `props_now()` (`PROPS_ACCOUNT_INACTIVE`)
    - the cycle chooses v1 accounts while layer 1 is active and v2 accounts while a learn version is active
- Produces, TS:
  - `decidePickV2(p, market:MarketView|null)` = `decidePick(p)` plus a skip with reason `pros_disagree` when that flag is set
  - `loadActiveModel(store):Promise<{version:string;artifact:LearnArtifact|null;fallback:boolean}>`
  - collect writes, per observation:
    - the layer-1 prediction (unchanged)
    - one prediction per shadowing challenger (≤ `MAX_SHADOWING`)
    - when the active model is a learn version, the learn prediction
  - Picks come from the active model's prediction: `SELECTION_VERSION` while v1 is active; `SELECTION_VERSION_V2` with v2 accounts once a learn model is active.

- [ ] **Step 1: Failing SQL test:**
  - promote refuses a non-eligible version and succeeds after an `eligible` event
  - the first learn promotion activates the v2 accounts; a second does not add another activation
  - rollback restores the previous version and refuses when there is none
  - every table is append-only
  - an entry into an inactive account is refused
  - v1 SQL tests still pass
- [ ] **Step 2: Failing TS tests:**
  - `decidePickV2` skips `pros_disagree` and otherwise equals v1.
  - **Review Focus 2:** an integration case where the active artifact's sha256 mismatches gives
    `summary.activeModel.fallback === true`, layer-1 picks are recorded, and the run is still `COMPLETED`.
  - Shadow rows exist for each `shadow_start` version and have no picks.
- [ ] **Step 3:** Run SQL and unit tests; expect FAIL.
- [ ] **Step 4:** Implement the SQL, then the cycle changes. Learn features need `TeamGameRow`s: load the two teams'
  rows from `props_player_games` for the prior 60 days once per collect.
- [ ] **Step 5:** Run `sudo -E bash scripts/verify-props-sql.sh` and the props unit tests; expect PASS.
- [ ] **Step 6:** Commit `props: model control, shadow scoring and v2 selection in collect`.

### Task 12: Weekly learning worker and safety brake in settle

**Files:**
- Create: `scripts/props-learn.ts`, `.github/workflows/props-learn.yml`
- Modify: `src/lib/server/props-cycle.ts` (`runSettle` end), `scripts/props-worker.ts` (no change to kinds)
- Test: `scripts/props-learn.test.mjs` (fake store, as in `props-owner.test.mjs`)

**Interfaces:**
- Consumes: everything in Milestone B and Tasks 9–11
- Produces:
  - `props-learn.ts <train|evaluate|review>`, one JSON line out, exit 1 when the owner must look:
    - `train`:
      - exits `LEARNING_DISABLED` when `learning_enabled` is false
      - builds rows (historical CSVs, hash-checked, plus graded forward lines)
      - market weights active only when forward-with-books ≥ `MARKET_MIN_LINES`
      - replays against the active model on held-out data; worse → `dropped`
      - otherwise inserts the artifact plus `created` and `shadow_start` events, and retires the oldest when over `MAX_SHADOWING`
    - `evaluate`: for each shadowing version, builds `EvaluationRow`s from its own shadow predictions vs the active
      model's on the same lines, runs `evaluateChallenger`, records `eligible` (with detail), and calls
      `props_promote_model` with actor `system:auto-switch` when `auto_switch_enabled`
    - `review`: inserts a `props_learning_reports` row for the past 7 days
  - `runSettle`, after settlement: compute `safetyBrake`; on trip, call `props_set_control('PAUSED','SAFETY_BRAKE: …','system:safety-brake')`
    and set `summary.safetyBrake`
  - `props-learn.ts` also takes the owner kinds `learning_on|learning_off|auto_on|auto_off|approve --version V|rollback`
    with `--reason`, each one RPC with actor `owner:<github actor>`, refused from a schedule (as in `props-worker.ts`).
    This is the spec's "GitHub inputs mirror every control".
  - Workflow: cron `0 10 * * 0` (train → evaluate → review) and `workflow_dispatch` kind ∈
    {train, evaluate, review, learning_on, learning_off, auto_on, auto_off, approve, rollback} with inputs `version` and `reason`;
    same secrets and concurrency group `props-paper` as `props-daily.yml`; downloads the pinned CSVs and checks their sha256

- [ ] **Step 1: Failing tests** with a fake store:
  - `train` with learning off → `LEARNING_DISABLED`, no inserts
  - with 0 forward lines → artifact `marketWeightsActive:false`
  - a worse replay → `dropped`, no `shadow_start`
  - a fit producing a non-finite weight → run `FAILED_INVALID_ARTIFACT`, no artifact row, active model unchanged
  - owner kinds from a schedule → `OWNER_ACTION_NOT_SCHEDULABLE`
  - a fourth shadow retires the oldest
  - `evaluate` with an eligible challenger and auto on → `props_promote_model` called once; auto off → only an `eligible` event
  - the settle brake test: a tripped fixture calls `props_set_control` once with `PAUSED`; a STOPPED control → not called
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the script and the workflow; add the brake to `runSettle`.
- [ ] **Step 4:** Run the tests plus `sudo -E bash scripts/verify-props-sql.sh`; expect PASS.
- [ ] **Step 5:** Commit `props: weekly learning worker, auto-switch and safety brake`.

## Milestone D: owner controls and dashboard

### Task 13: Owner learning controls (API)

**Files:**
- Modify: `src/lib/server/props-owner.ts`, `src/app/api/internal/props/control/route.ts` (no change beyond the handler)
- Create: `src/lib/server/props-learn-dispatch.ts`
- Test: `src/lib/server/props-owner.test.mjs` (extend), `src/lib/server/props-learn-dispatch.test.mjs`

**Interfaces:**
- Produces:
  - Action body variants (exact keys, nothing else):
    - existing: `{action:'pause'|'resume'|'stop', reason}`
    - learning: `{action:'learning_on'|'learning_off'|'auto_on'|'auto_off', reason}`
    - `{action:'approve', version, reason}`
    - `{action:'rollback', reason}`
    - `{action:'retrain', reason}`
  - GET adds `model:{active, previous, learningEnabled, autoSwitchEnabled, challengers:{version, state, detail}[]}`
  - `dispatchPropsLearn(kind:'train',env,fetcher?)` → `{result:'dispatched'|'not_configured'|'refused'|'unknown';code?}`.
    It mirrors `paper-auto-start.ts`: same token pattern `SPORTSEDGE_GITHUB_DISPATCH_TOKEN`, a fixed URL for
    `props-learn.yml`, ref `main`, no retry.

- [ ] **Step 1: Failing tests:**
  - Each new action maps to exactly one RPC (or one dispatch for `retrain`), with actor `owner:dashboard`.
  - `approve` with a version not matching `^props-learn-v[0-9]+$` → 400 before any call.
  - **Review Focus 5:** the database refusing `PROPS_MODEL_NOT_ELIGIBLE` → 409 with that code; rollback refusing `PROPS_NO_PREVIOUS_MODEL` → 409.
  - `retrain` without a token → 503 `learn_dispatch_not_configured`.
  - The existing auth, origin and body tests still pass.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Extend the parser with a per-action field table, like `paper-auto-owner.ts` `FIELDS`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `props: owner learning controls`.

### Task 14: Dashboard, Model panel, why-lines, review card, brake banner

**Files:**
- Modify:
  - `src/lib/server/props-dashboard.ts` (load model control, events, latest report, market views for listed observations)
  - `src/lib/props/dashboard-view.ts` (`Raw` and the view gain `model`, `report`, and `market` per line)
  - `src/app/paper-betting/props/page.tsx`
  - `src/components/props-owner-controls.tsx`
  - `src/components/props-home.tsx`
  - `src/app/automation/page.tsx`
  - `src/app/pages.css`
  - `docs/OWNER_RUNBOOK.md`
  - `scripts/browser-smoke.mjs` (no route change; assert the Model panel heading on `/paper-betting/props`)
- Create: `src/components/props-model-panel.tsx` (server component)
- Test: `src/lib/props/dashboard-view.test.mjs` (extend)

**Interfaces:**
- Consumes: Task 13 GET shape (client controls); `LearningReport`; `MarketView`
- Produces, UI copy (exact):
  - Model panel title `Model`
  - control labels `Learning`, `Auto-switch`, `Retrain now`, `Approve switch`, `Roll back`
  - challenger states `Replaying`, `Shadowing (n of 500 lines)`, `Eligible`, `Dropped: <reason>`, `Retired`
  - why-line format `Stats: <mean> expected · Books: <pct> More (<k> books) · <matchup note>`
  - flag badges `Lagging line`, `Pros disagree`
  - banner `Paused by the safety brake: last <n> picks hit <pct>, confidently below the 57.7% break-even.`
  - review card title `This week's mistakes`

- [ ] **Step 1: Failing view tests:**
  - A line with a market view exposes `market.pMoreBooks` and its flags.
  - A line without one has `market:null`, never zeros.
  - The view's `model.challengers` are ordered newest first, with the shadow progress count from deduped graded lines.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the loader, view, panel and copy. Weights render in words per stat:
  "trusts the stats model 0.8, the sportsbooks 0.6 …", from the `stats_logit` and `books_logit` weights.
- [ ] **Step 4:** Run the view tests, `npm run lint` and `npm run build`; expect PASS (lint warnings only where they existed before).
- [ ] **Step 5:** Visual check with a temporary fixture loader (do not commit it), as done for the PrizePicks redesign:
  1440 px and 390 px, no horizontal overflow, controls signed in and signed out.
- [ ] **Step 6:** Update the runbook control table and the "When something looks wrong" rows for the brake and the model switch.
- [ ] **Step 7:** Commit `props: model panel, why-lines, review card and safety-brake banner`.

## Release checklist (after Task 14)

- [ ] Apply `props_market_v1.sql` and `props_learning_v1.sql` to Supabase (owner, SQL editor), then run `props-worker.ts status`.
- [ ] First real collect: confirm `summary.bookQuotes.byBook`. Record which books the free plan returns in the spec's §11.
- [ ] First Sunday `props-learn.yml` run: `train`, `evaluate` and `review` receipts; a challenger in `Shadowing`.
- [ ] Do not activate the v2 accounts by hand. The first promotion adds their `props_account_activations` rows via `props_promote_model`.
