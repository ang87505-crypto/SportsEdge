# SportsEdge — UI/UX accessibility and maintainability audit
**Date:** October 9, 2026
**Base inspected:** main at commit `261b03ccc78e0fb3f62fdfa85effcb1e4e9f2f72`
**Scope:** read-only inspection of shared layout, CSS and page components. This file is an additive proposal, not a production UI change.

## User goal

Make SportsEdge look like a credible, coherent sports-analytics and finance-research product that people can navigate and maintain easily. Optimize usability on desktop and mobile, clarity of financial/statistical information, and component-level maintainability. Preserve working sports models, research tables, paper bets, stock-journal records, and API routes.

## Evidence from current source

- All main routes share `src/components/workspace-shell.tsx` and `src/app/globals.css`, including Home, Sports, Stocks, Paper Bets, Research and Guide. A shared `src/components/ui.tsx` supplies cards, stat blocks, calls to action and disclosure panels.
- The current palette is dark evergreen with mint accents. Keep it unless a redesign is explicitly approved; it provides a coherent brand.
- Desktop sidebar has six primary links. At `max-width:760px`, mobile navigation switches to a **three-column grid with six links**, consuming two rows; labels use **11px** text and `white-space:nowrap`. Likely layout pressure on narrow phones must be confirmed with actual screenshots/keyboard tests, not inferred as a measured failure.
- Base body font is 14px, data table cells 12px, table headings 11px, and many auxiliary labels 9–12px; some may be hard to read. Increase mobile and dense financial table readability with minimal layout changes.
- Tables have horizontal scrolling (`.table-wrap{overflow-x:auto}`), which is appropriate for the odds and research pages but requires an explicit visual cue and keyboard usability check on mobile.
- Navigation has `aria-current`, a skip link and focus-visible CSS; the site has a reduced-motion rule. Retain these accessibility basics.
- `/stocks` supports a browser-local watchlist and manual virtual journal, with export and no invented market prices. Preserve localStorage key `sportsedge-stock-journal-v1` and versioned data shape. The app is not a broker-connected or real-time stock execution system.
- `/sports` displays stored bookmaker prices, with a stale-prices notice. `/research/nba`, `/research/epl` and `/paper-betting` display different forms of estimates, experimental results and paper performance. Never visually imply prediction accuracy is measured financial ROI.
- `/dashboard` currently redirects to `/`. Avoid creating a second conflicting dashboard or duplicate navigation.
- Status: production deployment of main reported READY on Vercel, which establishes build/deployment status, **not** pixel-perfect responsive layout or an accessibility certification.

## Highest-value UX improvements (proposed — not yet implemented)

### P0 — Navigation, readability, and hierarchy

1. Replace the narrow-phone 3-by-2 primary-navigation grid with an accessible compact or horizontally-scrollable navigation pattern **without hiding key destinations**. Desktop can retain its existing sidebar. Ensure easy access to Home, Sports, Stocks, Paper Bets, Research and Guide.
2. Raise the smallest text sizes on data-dense tables and actionable controls; avoid 9–11px for primary information. Distinguish a number's label, value, source age, and definition at a glance. Aim for comfortable mobile touch targets around 44px.
3. Give active navigation and section tabs obvious selected states, preserve keyboard focus, and ensure in-page scrolling does not trap keyboard focus.
4. Improve spacing and alignment of filter bars at phone widths; let long labels wrap or scroll without clipping. Provide a visible horizontal-scroll affordance for dense tables.

### P1 — Trustworthy data UX

1. Put **Recorded at** and **Not live** beside odds, with a compact explanation of timestamps. Do not imply stored quotes are current.
2. Differentiate **historical model accuracy**, **forecast probabilities**, **pending paper wagers**, **settled ROI**, and **manual stock P&L** using consistent labeling. Avoid a generic green success status for unverified data.
3. Make empty, loading and failed-feed states actionable: tell users what is missing, why, and the safe next action.
4. Use consistent American odds formatting and local vs UTC timestamp labels across sports and research views.

### P1 — Stock workflow

1. Retain the watchlist/paper-trade two-tab structure, but surface a clear action hierarchy: Add a ticker, Record simulated buy, Close position, Export journal.
2. Keep **available cash**, **open cost basis**, and **realized P&L** separate from any future market-valued equity. Do not fabricate unrealized gains.
3. Ensure state/error messages do not persist as misleading success after a later action; browser-local data limitations should remain clear without dominating the screen.
4. Do not delete/reset/edit existing journal data implicitly. Avoid localStorage schema changes without migration, backup and tests.

### P2 — Design system maintainability

1. Gradually standardize spacing, type sizes, borders, radii and statuses in shared UI components and semantic CSS tokens.
2. Reuse `PageHeading`, `Stat`, `Details`, `Action`, `Empty` where appropriate; avoid introducing a second independent styling system.
3. Keep a concise design guideline and quality gate for every new page: mobile, desktop, keyboard, loading/error/empty, data-source disclosure.

## First *small* implementation milestone requiring explicit approval

**Only after owner approval to update existing files**, edit:
- `src/app/globals.css`: improve mobile nav responsiveness, tiny table typography, tappable spacing, and table scroll affordances. Keep current colors and overall visual design.
- `src/components/workspace-shell.tsx`: if CSS alone is insufficient, adjust mobile-navigation markup/accessibility and active navigation semantics, preserving all existing routes and desktop sidebar.

**Do not touch** models, Supabase schemas, API endpoints, `src/lib/stocks/journal.ts`, stock journal storage, or betting math in this milestone.

Before implementation, inspect local Next.js 16 documentation in `node_modules/next/dist/docs` per `AGENTS.md`, and use current frontend conventions. Do not modify production main directly; use a small PR and verify CI before merge.

## Verification/acceptance criteria

- No regression to route navigation: all six main destinations work and the current page is visibly marked.
- Desktop 1440px, laptop 1024px, tablet 768px, phones 390px and 320px: no clipped nav text, horizontal body overflow, floating controls outside the viewport or overlapping action elements.
- Keyboard: Tab/Shift+Tab, focus visibility, skip link, disclosure toggles, form errors; screen-reader labels remain semantic.
- Touch: key controls have comfortable target sizes and discernible labels.
- All core empty/error/loading states remain legible, without invented quotes, stats, fills, returns or status claims.
- `npm run lint`, `npm run build`, `npx tsc --noEmit`, `node --test src/lib/**/*.test.mjs` or the repository's verified explicit test glob; ensure unrelated regression suites remain green.
- Confirm production deploy after approved merge separately. Vercel READY does not substitute for a visual smoke test.

## Audit limitation

This audit inspected source code and a Vercel production READY result. A live browser screenshot or manual device testing was **not possible in this environment**, so no pixel-level inspection or WCAG conformity claim is made. The proposed fixes target observable source structure and should be confirmed on real rendered pages before merging.
