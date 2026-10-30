# SportsEdge UI/UX redesign (October 18, 2026)

Frontend-only. No API contract, trading algorithm, risk limit, order safeguard, emergency-stop semantic, Supabase policy or credential handling changed.

## Initial audit (before)

| Area | Finding |
| --- | --- |
| Styling | Six overlapping stylesheets (`globals`, `polish`, `experience`, `performance`, `journal-ledger`, `testing-center`), mostly minified, with conflicting rules for the same classes. |
| Navigation | Two flat groups ("Workspaces", "Insights & tools"). Paper Betting sat beside Sports instead of being a primary section; `/research/backtest` was not linked anywhere; "Research" pointed only to NBA. Mobile used a horizontally scrolling strip of eight links. |
| Overview | Marketing hero ("Find the signal"), a single accuracy ring, and workspace cards with little information. No system status, activity or alerts. |
| Sports | Game list with odds hidden in a disclosure. Model probabilities lived on a different page, so model and market were never compared. |
| Paper Betting | Four tiles, a chart and a table; owner tools above the results. No outcome breakdown or drawdown view. |
| Stocks | One page mixing an Alpaca promo, research status, the browser-local journal and backup. No portfolio view, automation status or evidence separation. |
| Copy | Tracked all-caps eyebrows on every section, `→`/`↗` glyphs on every link, stale references (PR #47 "in review"). |

Reusable: `research-db.ts` loaders, `/api/research`, `/api/sports`, `/api/internal/alpaca-paper/view`, `performance-series.ts`, `journal.ts`, the owner safety panels, committed research JSON (including calibration bins with Wilson intervals).

## Information architecture

| Section | Route | Purpose |
| --- | --- | --- |
| Overview | `/` | Command center: system status, section summaries, recent activity, alerts |
| Sports AI | `/sports` | Today's board: model vs. market probability per game |
| | `/research/nba` | NBA model: calibration, rolling accuracy, seasons, ratings, forward forecasts |
| | `/research/epl` | Soccer model: archived three-way forecasts |
| | `/research/backtest` | Soccer accuracy history by league |
| Paper Betting | `/paper-betting` | Virtual bankroll, outcomes, drawdown, bet history, owner tools |
| Stocks | `/stocks` | Dashboard: three separate books, paper portfolio, automation status, evidence |
| | `/stocks/research` | Quant research: evidence tracks, spec sheet, windows, costs, gates |
| | `/stocks/alpaca` | Paper account & orders (owner-only) |
| | `/stocks/journal` | Practice journal (moved from `/stocks`; same storage key) |
| Platform | `/progress`, `/testing`, `/guide` | Research status, test center, guide & methodology |

One config (`src/lib/navigation.ts`) drives the sidebar, tablet icon rail, mobile tab bar and drawer, breadcrumbs, back links and the command palette, so no menu can point at a route that does not exist.

## Design system

* Tokens in `src/app/globals.css`: near-black ink `#070C0A`, frosted panels, emerald `#20C978` / mint `#82E8B0` accent, text `#F4F8F5` / `#A2B5AA` / `#7F9488` (all ≥ 4.5:1 on panels).
* Status colours are reserved for meaning: positive, negative, warning, unknown, info.
* Chart slots `#1FA866`, `#5A88E0`, `#B98328` pass the dataviz validator for dark mode (lightness band, chroma, CVD ΔE ≥ 19, contrast ≥ 3:1). Reference lines are neutral and dashed.
* Type: IBM Plex Sans for UI, IBM Plex Sans Condensed for page titles and figures, tabular numerals throughout.
* Provenance labels (`Evidence` in `src/components/ui.tsx`): Verified, Historical study, Recorded, Broker-reported, Simulated, Synthetic test, Unverified, Not measured, Unavailable, This browser. Each has a glyph so meaning never depends on colour.
* Components: `Panel`, `Metric`/`MetricGrid`, `Badge`, `Callout`, `Segmented`, `KeyValues`, `Skeleton`/`Loading`, `Empty`, `OperatorStates`. Legacy `PageHeading`, `Stat`, `Empty`, `Details`, `Action` keep their props, and the legacy classes (`glass`, `panel`, `pill`, `notice`, `stats-grid`, `data-table`, …) stay styled for the owner panels and open branches.
* Charts (`src/components/charts.tsx`, no new dependencies): `LineChart` (crosshair tooltip, arrow-key inspection, gap breaks), `CalibrationChart`, `ProbabilityCompare`, `StackedBar`, `PairedBars`. Format presets keep them usable from server components.

## Data sources per screen

| Screen | Source | Unavailable behaviour |
| --- | --- | --- |
| Overview status, activity | `/api/research`, `/api/sports?sport=nba` (validated by `snapshotDetails` / `parseSportsFeed`) | Status rows show Unavailable; figures hidden, never zero |
| Sports board | `/api/sports` joined with forecasts from `/api/research` by game id | Empty state with retry |
| NBA model | Committed `nba_recent_summary.json`, `nba_recent_predictions.json`; forecasts from Supabase | Forecast panel shows Unavailable; study unaffected |
| Paper Betting | `paperPerformance()` (server) | Empty state with reload; owner tools still shown |
| Stocks portfolio | `/api/internal/alpaca-paper/view` (GET, owner cookie) | Owner sign-in required / Not connected / Unavailable |
| Automation panel | `PAPER_AUTOMATION_RELEASE` manifest | No operator state is highlighted |
| Quant research | Committed `protocol.json`, `stock_1000_forward_study.json` | Every result cell reads Not measured |

## Missing backend support (shown as honest empty states)

* **Rejected wagers**: the paper ledger only records won, lost, void and open bets. There is no rejected status to display.
* **Paper portfolio history**: the Alpaca viewer returns one snapshot, so there is no equity-over-time, drawdown or benchmark chart for the broker account. PR #73 adds daily marks and verified P&L.
* **Automation operator state**: STOPPED / PAUSED / READY / BLOCKED / EXECUTING come from the recurring PAPER ledger in PRs #70–73, which is not on `main`.
* **Historical backtest results**: none are verified; PRs #53 and #78 add the gated report loader.
* **Soccer model vs. market**: forward forecasts store only a home probability, so the board shows market probabilities for EPL games.
* **Historical market prices for NBA**: unavailable, so calibration is model-only and no historical ROI is shown.

## Integration with concurrent work

* **PR #73** (`/stocks/paper-auto`): its page uses `PageHeading`, `Stat`, `Empty` and legacy classes, which all remain styled. After it merges, add `{href:'/stocks/paper-auto',label:'Automation',description:'Recurring PAPER operator state and STOP'}` to the Stocks children in `src/lib/navigation.ts`, add the route to `scripts/browser-smoke.mjs`, and pass the ledger state to `OperatorStates` on `/stocks`.
* **PRs #53 / #78** (`StockBacktestReport`): `src/app/stocks/research/page.tsx` will conflict. Resolve by making the page `async`, loading `loadBacktestReport()`, and rendering `<StockBacktestReport view={reportView}/>` in place of the "Backtest results" panel. The evidence-track label for the backtest should then follow `reportView.status`.
* **PR #67** and **PRs #70–72**: no UI files touched by this redesign overlap.

## Verification

* `node --test` on all JavaScript tests, `npm run lint` (0 errors), `npm run build`.
* `scripts/browser-smoke.mjs`: 13 routes, 38 route/viewport combinations at 320–1440 px, no horizontal overflow, one active navigation item, plus drawer, command palette, honest status, unconfigured broker and journal backup interactions.
* Data-filled layouts were reviewed with synthetic fixtures injected only in a local screenshot harness; no fixture ships in the app.
