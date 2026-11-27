# Saved sports data clarity — November 26, 2026

Base: production main `7af4bf6f79a18caafce46a1bd382844d55b407e9` (UI/reporting releases #230 and #231).

## Display contract

The Sports AI board reads saved NBA and EPL moneyline records through the existing `/api/sports` endpoint. A successful page read is not a provider refresh. Player props use their separate existing ledger and collectors.

- Classify every displayed quote, across every game and book. One recent quote cannot hide older books or another stale game.
- The 24-hour cutoff is a display label only. It does not change paper-bet freshness, complete-market checks, model rules or release gates. A quote within 24 hours is not necessarily executable.
- Distinguish an empty fixture read, fixtures without prices, mixed ages, all-stale prices, missing price coverage and unverified quote times. An empty saved feed does not establish that there are no real-world games.
- Invalid timestamps or a clock more than one minute in the future cannot receive a recent label. The one-minute allowance covers the existing rounded display clock.
- Show the client read time separately from the newest/oldest sportsbook quote times. Reloading only reads saved records.
- Per-game badges use the same rules. Best price and market probability columns explicitly describe saved prices; their calculations are unchanged.
- A pending response belongs to its URL and request attempt. Switching sports hides the previous sport's response immediately; an aborted late response cannot replace the active board.
- The shared rounded display clock now ticks each minute and on window focus. This makes ages advance without collecting data or starting a worker.

## Soccer archive

`/research/epl` preserves the existing October 10–12, 2026 forecast artifact, its probabilities, pinned source, coverage limits and absence of validated betting returns. The title and panel now explicitly identify an archive. Its source results end on September 20, 2026. The unsupported capture-date label was replaced with the fixture period and recorded source cutoff. Current saved prices remain a separate link to Sports AI.

## Verification

- Deterministic display-age tests: `node --experimental-strip-types --test src/lib/sports-feed-health.test.mjs`.
- Existing parsing/probability contracts: `node --experimental-strip-types --test src/lib/dashboard-details.test.mjs`.
- Production build/TypeScript and ESLint.
- Existing browser suite, including synthetic saved-feed responses for mixed ages, no prices, future times, empty feed, failed read, delayed sport switching, and age advancement on focus; populated layouts at 320, 390 and 1440 pixels.

Synthetic browser records are engineering fixtures only. They are not published performance, provider data, owner authentication or database writes.

## Release boundary

No collector, database, provider request, schedule, engine registry, model, stake, budget, order path or release switch changes. Claude's PR #229 remains a separate disabled backend repair. Its proposed schedule must not be represented as a deployed job until its contract correction and owner-approved release are verified. #216 hosted readiness and #102's supervised first stock session remain gated. Preserve the November 29 6 PM Mountain through November 30 stock-gate deployment freeze.
