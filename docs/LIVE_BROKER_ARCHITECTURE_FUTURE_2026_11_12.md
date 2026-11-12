# Future live stock brokerage: architecture (design only, NOT active) — 2026-11-12

**Status: design document only.** Nothing here is built, enabled or configured. No live brokerage credentials
exist in this project and none were requested. Real-money execution is OFF everywhere. PAPER operations
(Alpaca `paper-api`) are unchanged. This is **stocks only**. SportsEdge will not place real-money sports wagers;
any gambling integration would need to be legal for the account holder, explicitly permitted by the provider, and
approved and designed separately.

## The intended experience

1. The owner asks Ask SportsEdge about an investment.
2. SportsEdge researches it from data it can verify: prices, filings and its own registered research.
3. It explains the reasoning, the uncertainty, the costs (spread, commission, slippage, taxes to consider) and the
   risk: position size, drawdown and concentration.
4. The owner asks for a proposed trade. The system creates an **inert draft**. A draft cannot become an order by itself.
5. Server-side checks run against the draft: broker connectivity, account identity, account restrictions,
   compliance rules, risk limits and buying power.
6. The owner opens a **separate confirmation page, outside the chat**, sees the exact order and confirms with
   **step-up authentication**.
7. The server re-runs every check, submits once (idempotently), then reconciles against broker records and writes
   an audit receipt.

Any later *standing* authorization (bounded automated live investing) would be a **separate opt-in release**. It
needs its own explicit scope, limits, expiry and emergency stop, and its own review.

## Separation from PAPER

| Concern | PAPER (today) | LIVE (future) |
|---|---|---|
| Credentials | `ALPACA_PAPER_*` secrets | Separate `ALPACA_LIVE_*` secrets in a separate Vercel environment/project. Never in GitHub Actions. Never readable by the chat path |
| Broker host | Pinned to `paper-api.alpaca.markets` | A separate module pinned to the live host. The PAPER module can never reach it, and the reverse also holds |
| Account identity | Ledger pins the paper account suffix; the reader refuses non-paper records | Live account number hash pinned in reviewed source **and** in the database. Mismatch = hard stop |
| Release flags | `PAPER_AUTO_RELEASE` (reviewed source) | Three independent switches, all default OFF: reviewed-source `LIVE_RELEASE`, a database flag only the owner can set, and an environment variable present only in the live deployment. All three must agree |
| Data | PAPER ledger tables | Separate schema (or project) with its own RLS. Live and paper rows are never mixed in one total |

## Account restrictions (enforced before any draft)

- No transfer, deposit or withdrawal capability: the key or OAuth scope used is trading-only. Funding stays a manual
  broker-website action.
- **Cash account.** No margin, no leverage, no short selling, no options, no crypto. The server reads the account
  configuration (buying-power multiplier 1, shorting disabled) and refuses anything else.
- US-listed equities and ETFs on an explicit allowlist. Limit orders only, with a bounded price collar against the
  current quote.

## Risk limits (owner-set, conservative defaults, server-enforced)

- Per-order notional cap, daily notional cap, maximum orders per day.
- Maximum position size as a share of equity. Maximum number of positions.
- Account drawdown stop: further buys are blocked until the owner reviews. Sells that reduce risk stay allowed.
- Cool-down after any rejected, uncertain or unreconciled order.
- An **emergency stop** that is always one action away. It cancels open orders and blocks new ones. It never
  liquidates without separate confirmation.

## Idempotency and uncertain responses

- Each draft has an immutable id. The broker `client_order_id` is derived from it, so a retry can never create a
  second order.
- Intents are written to the database **before** submission, under a unique constraint.
- After a timeout or other uncertain response, the system **queries by `client_order_id` first** and never resubmits
  blindly. If the state still can't be determined, the intent stays `UNRESOLVED` and blocks new orders until it is
  reconciled. This mirrors the PAPER controller.

## Reconciliation

- After each fill, and daily after the close: positions, cash and orders are compared with the ledger.
- Any unexplained position, external order or cash difference halts live activity until the owner reviews it.
- Reports keep realized and unrealized P&L, fees and benchmark comparisons apart, and never mix PAPER with LIVE.

## Step-up confirmation

- The owner session cookie alone is never enough for a live order.
- Confirmation needs a fresh second factor: a passkey/WebAuthn assertion, or TOTP as a fallback, less than 2 minutes old.
- The confirmation is a single-use token bound to the **hash of the exact draft**: symbol, side, quantity, limit
  price and account. It expires in 5 minutes. Any change to the draft invalidates it.
- At submit time the server recomputes every check. A stale quote, a moved price, changed buying power or a hit
  limit cancels the submission and shows the reason.

## No prompt-injection path to money

- The chat can only **explain** and **create drafts**, using a deterministic parser with an allowlist of fields. It
  has no tool, credential or endpoint that submits, confirms or changes limits.
- External content (filings, news, web pages, broker messages) is treated as data. It is never placed in an
  instruction position, and it never reaches the draft or confirmation path.
- If an optional language model is ever added, it runs with no credentials, has hard cost limits, and has a
  deterministic fallback. Its output is shown to the owner but never executed.
- The confirmation page is a separate route with its own CSRF protection and step-up. A link inside a chat answer
  can open it, but it cannot pre-confirm anything.

## Audit

- An append-only audit table with a hash chain records drafts, checks (with inputs), confirmations (factor type,
  time and draft hash), submissions, broker responses, fills, reconciliations and emergency stops.
- Ordinary roles cannot update or delete it. Daily digests can be exported.

## Legal and broker-terms review (before any build)

- The broker's customer agreement and API terms for personal automated trading, and whether programmatic trading of
  a personal account is permitted as designed.
- Cash-account settlement rules (good-faith and free-riding violations) and pattern-day-trader rules if a margin
  account is ever considered. The default is cash only.
- Tax reporting implications of frequent trading. Record-keeping.
- Wording that the platform gives research and decision support, not investment advice.
- Confirm that no regulated activity is being performed for anyone other than the account owner.

## Gates before a live release could even be proposed

1. The stock PAPER strategy passes its release gate, then produces at least 8 weeks of clean, reconciled forward
   PAPER results, reported against an exposure-matched benchmark, with costs.
2. An independent code review of the live module, and a red-team pass on the chat → draft → confirm path.
3. The owner signs off on limits, the allowlist and the review above.
4. First live release: one manual, confirmed order at a token size. No standing authorization.

Until all of that exists, real-money execution remains OFF and this document is a plan, not a capability.
