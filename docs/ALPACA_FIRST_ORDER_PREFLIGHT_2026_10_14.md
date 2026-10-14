# SportsEdge — first PAPER order read-only preflight (2026-10-14)

This milestone adds an owner-only, on-demand broker preflight inside the private
Alpaca PAPER dashboard. **It is not an order, quote guarantee, approval, or
a release of the broker writer.**

- Requires the existing short-lived owner cookie. Strictly checks exactly one
  uppercase 1–5 letter ticker and one share at a 1–2500 cent limit.
- Checks read-only broker account/positions, fully enumerated order history,
  paper asset eligibility, official paper US market clock, and current IEX
  top-of-book bid/ask.
- Requires fresh quote within 60 seconds, verified clock, cash/exposure bound,
  regular market session with a 20-minute close buffer and price tolerance.
- A market data feed permission error, missing price, stale quote, interrupted
  pagination or confusing response fails closed. IEX is limited market coverage;
  quotes are NOT a composite national NBBO or a guaranteed execution price.
- Reads staging safety RPC when configured; missing staging service credentials
  produce an explicit blocker rather than falling back to Production.
- Always reports STOP engaged, lacking approved order transaction and lacking
  durable writer release. This endpoint does not create broker or DB orders.
- The server never discloses Alpaca credentials, account ID, raw broker order
  IDs or staged secret keys to the browser.

Next work: transactional approve-and-claim RPC, actual operational STOP for a
released writer, crash-safe reconciliation, independently verified full owner
approval, and live Preview acceptance. A *manual* staging draft is not a
reviewed stock signal. Existing permanently HALTED staging schema cannot
legitimately be unhalted by this milestone.

**No live trading, recurring schedule, paid services or PAPER order occurred.**
