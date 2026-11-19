# Props learning model: sportsbook signal, learning layer and learning loop

Date: 2026-11-08 · Status: design for owner review · Scope: NBA player props paper test

## 1. What the owner asked for

- A model that **learns from its graded results** and gets better over time, built here,
  not a chatbot or outside AI service.
- It should **track what professional sportsbooks are pricing** so picks favour the best lines.
- The owner can **start and stop** picking and learning, and each layer improves from past results.
- **Free:** no paid data plan, no model API, no subscription. Runs on GitHub Actions, Supabase and Vercel.
- Later (separate spec): a free conversational command bot on top of this model.

Not in scope, by decision:

- **Placing real entries.** PrizePicks has no public entry API; automating it breaks its terms.
  The site stays paper-only. A later "copy lineup" view is allowed.
- **A neural network now.** Data is far too small. The layer stack in §4 is the upgrade path.
- **Paid odds plans.** Revisit only if the owner changes the budget.

Success, in order:

1. Probability quality on real PrizePicks lines beats the current model under the existing
   registered review gate (§6.3).
2. Recorded-pick hit rate stays above the 57.7% two-pick break-even over a meaningful sample.
3. Every change to the active model is explainable and reversible by the owner.

## 2. Current system (unchanged by this design unless stated)

- Model `props-nb-minutes-rate-v1` (`src/lib/props/model.ts`): minutes × per-minute rate, negative binomial.
- Selection `props-select-v1` (`src/lib/props/rules.ts`): record 0.60–0.80 side probability, tie < 0.05,
  2-pick entries from different games and players, ≤ 3 entries/platform/day, $5 virtual.
- Daily worker `scripts/props-worker.ts` via `.github/workflows/props-daily.yml`; budget `props-budget-v2`
  (≤ 2 games per collection, 7 credits/24 h, 200/30 days, provider floor 60).
- Research candidate `props-temperature-v2` under the gate in `src/data/props/research_v2.json`.
- Append-only `props_*` ledger; predictions are unique per `(observation_id, model_version)`, so several
  model versions can already score the same line before lock.

## 3. Data: free sportsbook signal (layer 2 input)

### 3.1 Collection change

The Odds API documents: *"If both `bookmakers` and `regions` are both specified, `bookmakers` takes
priority … specifying up to 10 bookmakers counts as 1 region."* The collect request therefore adds
sportsbooks to its `bookmakers` list at **no extra credit cost**:

`prizepicks, pick6, draftkings, fanduel, betmgm, williamhill_us` (6 of 10 allowed)

- Same markets (`player_points`, `player_rebounds`, `player_assists`), same events, same schedule.
- Cost per event stays `3 markets × 1 region = 3`; budget `props-budget-v2` is unchanged.
- The moneyline refresh is **not** affected.
- Which books actually return NBA props on the free plan is verified by the first real collect;
  an absent book is recorded as absent, never filled in.

### 3.2 Storage (new append-only tables, `database/props/props_market_v1.sql`)

`props_book_quotes`: one row per sportsbook Over/Under pair received:

- `observation_ref` (provider event + player + stat), `bookmaker_key`, `line`, `over_price`, `under_price`
- `provider_last_update`, `ingested_at`, `response_sha256`

Same chronology triggers as `props_observations`: refused at/after lock or when older than 2 h.

`props_market_views`: one row per PrizePicks/Pick6 observation, computed at collect time before lock:

- `books_at_same_line`, `p_more_books` (margin-free, averaged across books at the same line), or NULL
- `nearest_book_line` and `line_gap` (book line − platform line) when no book has the same line
- `flags`: `lagging_line` (|line_gap| ≥ 1.0), `pros_disagree` (books' side ≠ model side with
  books ≥ 0.55 on their side)

Margin removal: per book, `p = (1/o) / (1/o + 1/u)` from decimal odds; average across books at the same line.
Pure functions in `src/lib/props/market.ts`.

## 4. Model stack

| Layer | What it is | Status |
|---|---|---|
| 1 Stats | `props-nb-minutes-rate-v1`: expected minutes × rate, NB spread | exists, unchanged |
| 2 Market | margin-free book probability and line gap (§3) | new input |
| 3 Learning | per-stat regularised logistic layer combining 1, 2 and matchup features | new |
| 4 Trees | gradient-boosted trees on the same features | future, only at ≥ 5,000 graded real lines |
| 5 Neural | — | not planned at current data size |

### 4.1 Learning layer (`props-learn-vN`, `src/lib/props/learn.ts`)

Per stat, conditional on no tie:

```
logit P(More) = w0
              + w1 · logit(p_stats_more_given_no_tie)
              + w2 · m · logit(p_books_more)      m = 1 when books exist at the same line, else 0
              + w3 · m
              + w4 · line_gap_books                 (0 when no book line)
              + w5 · opp_allowed_ratio              opponent's allowed stat per minute / league, last 15 games
              + w6 · home
              + w7 · rest_days_capped (0..3)
              + w8 · back_to_back
```

- `P(tie)` is carried from layer 1 unchanged, as in `props-temperature-v2`; output is
  `P(More) = (1 − P(tie)) · σ(…)` and `P(Less)` likewise.
- Weights are L2-regularised (ridge); λ is chosen by time-ordered cross-validation only.
- A weight table is published with every version (§7), so the owner can read it.
- Features use only games that finished before the line's lock. A test asserts this (§9).

### 4.2 Training data

- **Matchup weights (w0, w1, w5–w8):** from the pinned 2024-25 and 2025-26 SportsDataverse box scores,
  using the existing proxy lines (floor of last-10 median + 0.5) and walk-forward layer-1 predictions,
  as in `scripts/props-model-fit.ts`. Tens of thousands of player-games.
- **Market weights (w2–w4):** only from forward, graded real-line observations with book data.
  Fixed at 0 until ≥ 150 such graded lines exist, so the market signal is never guessed.
- All history is used at every retrain, with recency weighting (half-life 60 days) on forward data.

## 5. Learning loop

### 5.1 Weekly cycle (GitHub Actions, Sundays ~10:00 UTC; also on demand)

1. **Retrain** a challenger `props-learn-vN+1` on all data available at that moment.
2. **Replay check:** score it on both historical seasons and on all graded forward lines it was not
   trained on. If it is worse than the active model on Brier, it is dropped with a recorded reason.
3. **Shadow:** a surviving challenger is published as a model artifact. From then on the collect run
   scores every new line with it **before lock** (stored as an extra `props_predictions` row).
   It records no picks or entries. At most 3 challengers shadow at once; the oldest is retired.
4. **Mistake review** (§5.3) is generated from the past week's graded lines.

Model artifacts are not committed to the repository. The workflow writes each one to a new
`props_model_artifacts` table (append-only, SHA-256 of canonical JSON), so training needs no
repository write access.

### 5.2 Switching the active model

The active model is a row in new table `props_model_control` (append-only log, latest row wins):
`active_model_version`, `previous_model_version`, `learning_enabled`, `auto_switch_enabled`, `changed_by`, `reason`.

A challenger becomes eligible under the **existing registered gate** (`research_v2.json`), measured on its
own forward shadow predictions only (data it never trained on), against the active model on the same lines:

- ≥ 500 graded unique lines, ≥ 14 NBA slate dates, ≥ 50 games, ≥ 100 challenger qualifying decisions
- paired game-level bootstrap (1,000 replicates, fixed seed): upper 95% of Brier difference ≤ −0.002
- log loss no worse

When eligible:

- **Auto-switch on:** the next collect uses it; the switch is logged.
- **Auto-switch off:** the page shows **Approve switch** with before/after numbers.

**Roll back** restores `previous_model_version` immediately.

Selection rule `props-select-v2` = v1 bands applied to the active model's probabilities, plus:
skip when `pros_disagree` is set. Selection version changes only through a reviewed release, like v1.

`props_record_entry` requires each pick's selection version to match its account's. So v2 picks go
into **new virtual accounts** (`props-prizepicks-v2`, `props-pick6-v2`, $500 each). The v1 accounts and
their record stay intact and stop receiving entries once v2 is released. The dashboard shows the
current accounts by default, with v1 history one tab away.

### 5.3 Mistake review (`src/lib/props/review.ts`, weekly, stored in `props_learning_reports`)

Each graded recorded-pick miss of the active model is assigned to one cause, first match wins:

| Cause | Rule | Layer it points to |
|---|---|---|
| Did not play / void | outcome void | none (excluded) |
| Minutes collapse | actual minutes < 0.6 × layer-1 expected minutes (`inputs.expMinutes`) | layer 1 minutes |
| Books were right | books' side ≠ model side and books' side won | layer 2 weight |
| Matchup | `opp_allowed_ratio` against the pick by > 1 SD | layer 3 matchup weights |
| Overconfidence | pick's confidence band hit rate below its mean prediction by > 2 SE this period | calibration |
| Other | none of the above | — |

The report also gives **layer scorecards** on all graded lines this period:

- Brier, log loss and directional hit rate for layer 1 alone, books alone (where present),
  and the active combined model
- the challenger's numbers

The review explains; the retrain does the adjusting. Retraining on all data naturally lowers the
weight of a layer that stops helping.

### 5.4 Safety brake

After every settle run, over the active model's last 150 graded recorded picks (minimum 50):

- If the Wilson 95% **upper** bound of the hit rate is below 0.577, set props control to `PAUSED`
  with reason `SAFETY_BRAKE`.
- That pause blocks collection (existing control); settlement continues.
- The owner resumes manually. The brake never resumes anything itself.

## 6. Owner controls

All controls are owner-only (existing owner session, same-origin, JSON-only, strict body), extending
`src/lib/server/props-owner.ts` and `/api/internal/props/control`:

| Control | Effect |
|---|---|
| Picking Start / Pause / Stop | existing `props_set_control` |
| Learning On / Off | `learning_enabled`; when off, the weekly workflow exits before training |
| Auto-switch On / Off | `auto_switch_enabled` |
| Approve switch | promotes an eligible challenger, rechecking eligibility server-side |
| Roll back | restores the previous model version |
| Retrain now | dispatches the training workflow, reusing the GitHub dispatch pattern in `paper-auto-start.ts` |

Each control is one database RPC or one workflow dispatch, idempotent, with refusal codes as today.
GitHub workflow dispatch inputs mirror every control for use without the site.

## 7. What the owner sees

**PrizePicks page:**

- **Model panel**
  - active version, last retrain, status (`Learning on/off`, `Auto-switch on/off`)
  - challengers with their state: replaying / shadowing (n of 500 lines) / eligible / dropped (reason)
  - the controls from §6
- **Layer scorecards:** the table from §5.3.
- **Weights table** per stat, in words, e.g. "trusts the sportsbooks 0.6".
- **Why line** under each pick: stats expectation, books' margin-free probability, matchup note,
  and the `lagging line` / `pros disagree` flags.
- **Weekly mistake review card.**
- **Safety-brake banner** when triggered.

**Elsewhere:**

- Automation and Overview pages: one learning-status line each.
- `docs/OWNER_RUNBOOK.md` gains the new controls.

## 8. Error handling

- Missing book data → `m = 0`; the layer falls back to stats and matchup terms. Never imputed.
- Training failure or invalid artifact (hash mismatch, NaN weight, schema error) → no new challenger;
  the active model is untouched; the run is recorded as failed.
- The collect run can't load the active artifact → use layer 1 (`props-nb-minutes-rate-v1`) and record the fallback.
- All new tables are append-only with the same chronology rules; no update or delete of evidence.

## 9. Testing

**Unit tests (`node --test`, added to `props-verify.yml`):**

- margin removal
- line matching across books
- each feature builder
- the trainer recovering known weights on synthetic data
- gate math
- Wilson brake
- mistake classifier
- owner control parsing and handlers

**Leakage tests:** every feature for a line is computed from rows with `game_start < lock_at`, asserted
over the historical replay, like the existing 10,909 checks.

**SQL contract tests** on disposable PostgreSQL (`scripts/verify-props-sql.sh`): new tables, triggers,
append-only enforcement, control RPCs.

**Historical replay** of the full stack on both seasons before launch, written up in
`docs/PROPS_LEARNING_REPLAY_<date>.md`, with Brier and log loss against layer 1 per stat.

**Browser smoke:** the props page renders the Model panel in configured and not-configured states.

## 10. Rollout

1. **Build and replay:** this spec's code, with the historical replay report. No live change.
2. **Shadow:** sportsbook collection on, `props-learn-v1` shadows. Active model stays `props-nb-minutes-rate-v1`.
3. **Eligible:** about 4 weeks at 2 games a night for the gate (500 lines, 14 dates, 50 games). Then
   auto-switch or owner approval.

Rollback at any stage: Learning Off plus Roll back. Turning off sportsbook collection is a one-line
bookmaker list change.

## 11. Risks and open items

- **Book coverage on the free plan:** verified on the first collect; the design works with zero books.
- **Same line availability:** books often post 0.5–1.0 different lines; the gap feature covers this, but
  margin-free probability exists only at matching lines.
- **Small forward sample:** 2 games a night limits graded lines. The first real collect receipts set the
  actual rate; promotion is slow by design.
- **Proxy-line training for matchup weights:** proxy lines are easier than real lines; weights are
  re-estimated on real lines as they accumulate.
- **Free tier limits:** about 200 Odds API credits/month for props (unchanged), Supabase free-tier
  pausing, and GitHub schedule delays.
- **The chat bot is a separate spec**, written after this ships.
