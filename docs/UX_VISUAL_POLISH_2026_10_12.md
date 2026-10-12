# SportsEdge visual polish — 2026-10-12

**Scope:** Website presentation, information hierarchy and navigation on draft PR #35 (stacked on #26). No algorithm, stock accounting, paper-execution, paid data provider, credentials or database changes.

## Problems addressed

The prior interface presented too many similarly styled cards, mixed an available manual stock journal with unfinished automated stock controls, and relied on unicode symbols as navigation icons. Dense green effects and repeated notices made it harder to distinguish informational research results from actual simulated account history.

## Implementation

- `src/components/nav-icon.tsx`: consistent, stroke-based inline SVG icons, accessible hidden decorative graphics, no third-party icon dependency.
- `src/components/workspace-shell.tsx`: clearly separates primary Workspaces from Insights & Tools. Contextual breadcrumbs, help link, a permanent Simulation Only label, mobile horizontal navigation, consistent fallback links and skip-to-content.
- `src/app/page.tsx`: rebuilt dashboard hierarchy: mission + model/evidence process, model-vs-paper metrics with explicit scope, verified saved-data status, two user workspaces, clear connections/capability limitations. All displayed ledger figures continue to use the existing validated /api/research response. No fake portfolio growth or market quote is displayed.
- `src/app/sports/page.tsx`: game analysis first, compact shortcuts to research, clearer team search and sport filters, match cards with recorded quote timestamps and live-aging labels. Reload fetches only the stored database.
- `src/app/stocks/page.tsx`: the working browser-local manual journal, cash, and positions precede unready automation and external Alpaca paper access. All calculations and browser journal persistence stay unchanged.
- `src/app/polish.css` imported after existing CSS via layout: consistent spacing, high-contrast typography, readable cards, focus treatment, mobile navigation, responsive media queries, styled sport and stock sections. Existing globals preserved for compatibility.

## Verification requirements

1. GitHub: green full Python, Node tests, lint, TypeScript and production build at the exact final branch head.
2. Vercel: READY preview at matching SHA. `READY` is not browser usability certification.
3. Browser: review /, /sports, /stocks, /paper-betting, /connections, /guide, /research/nba, /research/epl and /opportunities at 320, 390, 768, 1024, 1440px. Confirm nav is horizontally scrollable on narrow devices, no clipped key controls, readable contrast and real keyboard focus.
4. Data honesty: historical accuracy ≠ profitable betting ROI; ledger outages use unavailable placeholders; pending bets never shown as settled losses; stock price and broker balances are not invented.
5. Existing quote freshness still expires in view. Loading and retry states remain accurate.
6. Manual stock journal watchlist, open/close, and export history remain unchanged; automated stock and NBA owner controls are not enabled by these visual changes.

## Remaining release blockers

PR #35 depends on PR #26's earlier stack; no main-branch merge without integration review. Authentication and live Supabase concurrency checks, reliable owner-command receipts, and actual mobile/browser screenshots remain separate release gates. Protected Vercel previews must be inspected by an authorized user or a properly authenticated test runner. This milestone cannot establish algorithm profitability.
