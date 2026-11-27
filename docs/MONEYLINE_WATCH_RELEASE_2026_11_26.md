# Moneyline collection and unattended health — owner release candidate

This candidate combines Claude's corrected #229 at `5c27473d496991e6fb5c8c0668dd11917d0d035d` with deployed main `87c013433197b29a3e71dc2a42592dde6929d9f2` and a read-only receipt monitor. **The daily schedule remains OFF. No hosted migration or provider refresh has been performed by this work.**

## What is prepared

- The reviewed private daily-slot migration and BIGINT/NULL dispatch correction from #229. NULL leaves the slot available; a positive recorded run spends it. No automatic retries are added.
- A fixed-project GET-only `/api/research/moneyline-health` endpoint. It reads only bounded slot/run metadata from the primary research project and returns an explicit whitelist of aggregate fields. Capabilities, keys, raw summaries, private accounts and provider URLs are excluded.
- A daily operations job based on the slot and its exact research run, rather than pretending the Vercel cron is a GitHub Actions execution. Existing owner alerts can surface a missed slot, incomplete or failed run, unavailable evidence, partial sport result, rejected source events, missing prices or stale/future source timestamps.
- The first planned slot is **Nov 27 at 11:00 UTC / 4:00 AM Mountain**, with a two-hour monitoring grace period. This is a plan until a real receipt exists. If approval arrives after that slot, update this operational first-slot date to the next approved 11:00 UTC firing before activation.
- Seven-day missed-slot counts use the actual rolling seven-day window and begin at the configured first slot. Unknown reads are unavailable, not successful runs.
- A further receipt correction: rejected provider events cannot be classified as a confirmed empty slate or fully verified coverage. Existing saved data stays visible; the run requires review.

All timing and quote-age checks here are operational diagnostics. They do not change prediction chronology, bet freshness rules, model parameters, stakes, sample minimums, provider reservations or stock/exchange controls.

## Approval requested

Approval is for **data collection only**:

1. Apply `database/migrations/20261126_research_refresh_slots_v1.sql` to research project `fzyjazhvkstvwwzjhlrr`, then verify the private table, RLS, function contract and grants. Existing research functions and caps must remain unchanged.
2. Merge this reviewed candidate with the switch still OFF and confirm the production deployment.
3. Run **one initial refresh** through the existing dispatcher, consuming at most two provider requests/reservations. A NULL/cooldown response is not success. Verify the exact returned run's completion, per-sport receipt and saved-feed readback. A failed or unverified result stops the release; do not retry automatically.
4. Apply the separately prepared `docs/MONEYLINE_DATA_ACTIVATION_2026_11_26.patch`, recheck the enabled-path contracts, then release it only after this owner approval. It changes only the daily data switch and the corresponding release-state assertions; the OFF-path tests remain in place.
5. Verify the first actual daily 11:00 UTC slot, matching run ID, both sport outcomes and public health/operations status. The daily schedule consumes at most two provider requests, about 60 per 30 days, plus the one-time initial two. The existing shared caps remain **8 per rolling 24 hours and 240 per rolling 30 days**.

The initial refresh uses the dispatcher directly and does not consume the first scheduled slot. If it happens within 25 minutes of that slot, the cooldown may produce `not_dispatched`; this is attention for review, never a successful refresh or an automatic retry.

## Verified existing research contract

A fresh read-only catalogue check confirmed:

- `research_dispatch(boolean)` returns BIGINT, has its 25-minute cooldown, uses transactional `net.http_post`, and targets `https://sports-edge-eta.vercel.app/api/internal/research-cycle`.
- Claim binds the requested ID and hash, requires queued state, changes it to running once and expires after ten minutes.
- Finish binds the requested running ID and stores its summary.
- Anonymous/authenticated roles cannot execute these functions. service_role cannot directly execute dispatch. The proposed wrapper is the restricted intended caller.
- The daily slot migration is not installed yet.

These are code/permission facts. They are not a provider refresh, a scheduled execution, owner authorization or performance evidence.

## What remains outside this approval

- No wagers, stock orders, demo/live exchange access, owner Start/Resume or risk-limit changes.
- #102's genuine supervised first stock PAPER session and #216's fresh 13-row hosted props readiness remain required. This Supabase connection cannot access the active props project; the research database is not a substitute.
- No algorithm promotion. Connected learning paths are evidence plumbing, not proof of profitability. Forward sample requirements remain unchanged.
- Preserve the Nov 29 6 PM Mountain through Nov 30 stock-gate deployment freeze.

Rollback for this data schedule is the reviewed release switch back to false. Leave accepted research and immutable receipts in place. A partial/failed run is reviewed by its saved ID, not repeated automatically.
