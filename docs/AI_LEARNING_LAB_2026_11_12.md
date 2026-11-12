# AI Learning Lab, variable PAPER staking, and the chat-first command center (2026-11-12)

**Research only.** Nothing in this change records a pick, enters a lineup, changes a stake, moves a threshold,
switches the active model, places an order or contacts an account. Real-money execution stays off. The live
$5 flat virtual stake, the props pick rules, the production promotion gate (500 graded lines, 14 dates,
50 games, 100 candidate decisions, a supported Brier improvement and no worse log loss), the three-shadow limit,
the weekly stock strategy and the supervised Alpaca PAPER release (PR #102) are unchanged.
No AI service and no new paid service is used.

## What was built

| Piece | Where |
|---|---|
| Versioned feature, layer and model-family registry; frozen experiment specs (SHA-256 of canonical JSON); feature dependency closure; bounded ablation generator | `src/lib/lab/registry.ts` |
| Cluster bootstrap, Holm–Bonferroni, calibration error, Wilson intervals | `src/lib/lab/stats.ts` |
| Comparison report: every variant on the same lines; layer added and layer removed; Holm across the whole family | `src/lib/lab/compare.ts` |
| Immutable forward ledger (pure mirror of the SQL rules) | `src/lib/lab/ledger.ts` |
| Sports adapter: the production ridge-logistic learning layer (`src/lib/props/learn.ts`) with excluded layers pinned at exactly zero | `src/lib/lab/sports/variants.ts`, `spec.ts` |
| Pre-lock risk flags (research only) and their effectiveness test | `src/lib/lab/sports/risk.ts` |
| Mistake intelligence: measured miss patterns, lift vs hits, pre-lock availability, what a skip rule would also reject | `src/lib/lab/sports/attribution.ts` |
| Variable PAPER staking research (shadow only) | `src/lib/lab/staking.ts`, `staking-view.ts` |
| Database: frozen forecasts, flags, shadow stakes, reports, events — append-only, refused at/after lock and after a result, database-computed hash, tampering view | `database/props/props_lab_v1.sql` (+ tests) |
| Forward worker (freeze before lock / daily report) — zero provider requests | `src/lib/server/lab-sports-worker.ts`, `scripts/lab-sports.ts`, step in `.github/workflows/props-tick.yml` (continue-on-error) |
| Retrospective runs on the pinned box scores | `scripts/lab-sports-ablation.ts`, `scripts/lab-staking-backtest.ts`, `research/lab_*_20261112/` |
| Stock psychology ablation (registered, tested on fictional prices; manual workflow) | `analytics/stock_psychology_v1.py`, `.github/workflows/stock-psychology-research.yml` |
| AI Learning Lab page | `/lab` |
| Chat-first homepage, chat tables/charts, lab and staking answers | `/`, `src/components/command-strip.tsx`, `src/lib/assistant/lab-answer.ts` |

## Registered sports experiment: `lab-sports-ablation-v1`

Spec SHA-256 `552023777e55b436ed180965e8391c05bf39f9b5595ad2eb372b72cf26c77c58`; forward artifact SHA-256
`cb270daf6a11b5a9c9b1d75e5caf2330f9f708ee68388012b0fb8fc7e7912c86` (`src/data/lab/sports_ablation_v1.json`,
trained on 2025-26 only). Forward evidence starts 2026-11-13.

Layers: recalibration (intercept/slope on the stats model), role/minutes (`props-nb-role-minutes-v1` rule),
matchup/rest/opponent, sportsbook market (pre-registered 50/50 log-odds blend, only when books quote the same
line — no weights are fit on forward data), injury/rotation (**not tested**: no reliable timestamped pre-lock
feed is collected). Nine variants: base; base + recalibration; base + recalibration + each other layer;
combined; combined minus each layer. They are frozen in their own ledger and never use the three production
shadow slots.

### Retrospective results (proxy lines; they rank hypotheses and cannot promote anything)

0 leakage violations in 92.8 million input checks.

| Variant | Brier 2025-26 H2 (45,216 lines) | Brier 2026-27 to date (6,867 lines) | Calibration error H2 |
|---|---|---|---|
| Base (`props-nb-minutes-rate-v1`) | 0.23946 | 0.23151 | 3.0% |
| + recalibration | 0.23692 | 0.23054 | 1.5% |
| + recalibration + role/minutes | 0.23652 | 0.23058 | 1.3% |
| + recalibration + matchup/rest | 0.23657 | 0.23057 | 1.4% |
| Combined (available layers) | 0.23615 | 0.23058 | 1.3% |

- 2025-26 second half: recalibration, role/minutes and matchup each **help**, and the gain survives Holm
  correction (largest: recalibration, −0.00254 Brier, 95% CI −0.00319 to −0.00190).
- 2026-27 to date (weights trained before the season): **no layer is distinguishable from zero yet.**
- Mistakes (2025-26 H2, 21,686 picks): minutes surges hurting Less picks are 3.4× as common among misses as among
  hits; minutes collapses 1.6×. "Production per minute" misses are *not* distinctive (0.88×) — ordinary variance.
- Warnings: picks after a long absence hit 57.1% (below the 57.7% break-even) vs 64.3% otherwise, but skipping
  them avoids 709 misses while also rejecting 943 good picks. None of the flags shows an effect in 2026-27 yet.

### Variable staking (retrospective, proxy lines)

The same entries (live builder, live pick rule) were sized by every method. On proxy lines the estimated edge is
large, so B, C and E staked exactly the flat $5 every time; quarter-Kelly declined most entries because stated
confidence ran 5–8 points above observed accuracy. **No method beats flat.** Proxy-line edges overstate real
platform lines, so forward shadow stakes calibrate on real graded picks only — with today's small real sample
every research method sizes $0.

## Owner steps (nothing below happens without you)

1. **Apply `database/props/props_lab_v1.sql`** in the props Supabase project (SQL editor). Until then the freeze
   step reports `NOT_MIGRATED` and does nothing; the paper tick is unaffected either way.
2. Merge the pull requests (Vercel deploys `main`). The tick workflow then freezes every variant, flags and shadow
   stakes before each lock, and writes the forward report once a day after the morning settle.
3. Optional: dispatch **Stock psychology research (lab, manual)** with an end date to produce the first stock
   psychology result (read-only market data with the existing paper key).
4. Any layer that passes forward evidence becomes a *candidate* for the existing props-learn shadow path; promotion
   still needs that gate and, with auto-switch off, your approval.

## Rollback

Every piece is additive. Revert the PRs; the lab tables are append-only and independent of every paper table
(dropping them affects nothing else). The tick step is `continue-on-error` and can be deleted alone.
