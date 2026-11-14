# SportsEdge → Kalshi: Data and API permission request (draft, not sent)
Prepared: 2026-11-13. Project: [SportsEdge](https://github.com/ang87505-crypto/SportsEdge), [Research Issue #169](https://github.com/ang87505-crypto/SportsEdge/issues/169), [Draft PR #170](https://github.com/ang87505-crypto/SportsEdge/pull/170).

## Where to ask
Kalshi's official help center advises using **in-app or web account support**: Menu → Get help → Chat with support, or use their official developer community for API questions and ask support to route the request to the API/data licensing team. Do not assume a Discord response is a binding data license. No contact has been made.

- Support: https://help.kalshi.com/en/articles/13823855-contact-kalshi-support
- API information: https://help.kalshi.com/en/articles/13823854-kalshi-api
- Developer agreement: https://kalshi-public-docs.s3.amazonaws.com/Kalshi-Developer-Agreement.pdf
- Data Terms: https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf

## Draft message to send
**Subject: Written clarification requested — private personal-use Kalshi API market data for forecast comparisons and paper research**

Hello Kalshi Developer/Data Licensing Team,

I'm building SportsEdge, a private, owner-operated research dashboard that independently models weather and economic outcomes using public NOAA/NWS and BLS information.

Before connecting the Kalshi API or using any Kalshi market data, I'd like written clarification on permissible activities under the Kalshi Developer Agreement, the Data Terms of Use, and any separate API license that applies.

**Proposed uses (please answer each separately):**
1. From my own verified, eligible Kalshi account, using officially documented API market and order-book endpoints strictly to compare **independently generated** forecasts with current bid/ask prices for my own decisions (no third-party order routing or public redistribution).
2. Saving minimal timestamped price/quantity observations, market identifiers, and contract resolution terms in a private database for audit and **paper-only** backtesting. Is storage allowed? For what duration and with what retention, attribution, deletion, security, and volume limits?
3. Evaluating my independent forecasts against Kalshi prices and settled market outcomes in a **private dashboard**, without publishing raw Kalshi quotes or redistributing them.
4. Using an AI assistant to summarize *derived metrics* from the user's private records, or training/optimizing models based on Kalshi quotes. Are these distinct permitted/prohibited categories? Would additional consent or a data license be required?
5. If my account and the specific market are eligible, placing **my own** algorithmically generated orders through Kalshi's authenticated official trading API. Is automated own-account trading permitted, and what controls or restrictions apply?
6. Providing an alternative arrangement or written permission for market-data use in private software/AI-assisted analysis, if the standard agreements do not cover the above.
7. Availability of **weather and economic event contracts** for eligible residents of New Mexico aged 18–20, given the separately contested status of sports-related contracts. We are not seeking any circumvention of state/market restrictions.

The system currently operates **offline with synthetic market fixtures**, has **no Kalshi API keys**, places **no orders**, and collects **no live Kalshi data**. The proposed first live stage would be explicitly owner-approved, private, read-only and tightly rate-limited.

Could you identify the controlling agreement(s), the precise categories Kalshi permits, any required registration/permission, and where I should send the technical specification for review? If permission is not covered by published terms, please refer the request to the appropriate legal/data licensing team.

Thank you.

## Decision ledger: must record real evidence before enabling use
Do not mark any of these as **approved** without an actual written response or applicable contract:
| Decision | Status now | Required evidence |
| --- | --- | --- |
| Account/product eligibility for NM 18–20 | Unknown/market-dependent | Verified current account and legal eligibility |
| Own-account market API requests | Unresolved agreement scope | Written terms/response |
| Historical price storage | Unresolved | Explicit duration and permitted data fields |
| Derived price/model comparisons | Unresolved | Written authorized research scope |
| AI assistant analysis of Kalshi-derived metrics | Unresolved | AI/ML clause clarification |
| Model training on Kalshi data | Not authorized | Specific written grant |
| Automated order execution | Not authorized in SportsEdge | Eligible account, exchange permission, independent security review and user approval |
| Public redistribution | Not authorized | Redistribution/data license |

The existing K0 network permission gate in PR #170 is deliberately **disabled**. Its environment flags are a safeguard, **not a substitute for actual permission**. No one should set them without recording the reviewed authoritative approval.

Until clarified, development may continue using independently sourced NWS and BLS data and **synthetic** Kalshi-shaped fixtures only. This document is not legal advice and does not establish market-specific New Mexico legality.
