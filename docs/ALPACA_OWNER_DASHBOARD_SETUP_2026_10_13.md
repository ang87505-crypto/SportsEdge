# SportsEdge: private read-only Alpaca paper dashboard

This development branch adds `/stocks/alpaca` (linked from the stock workspace). It reads the
existing, successfully authenticated Alpaca PAPER API connection on the server.
**It cannot place, amend, or cancel broker orders, and is not a trading strategy.**

## Owner setup — required before viewing balances

SportsEdge's normal public website has no account login. Vercel Preview protection alone
is not suitable as the sole owner authorization for a production broker dashboard.
Consequently, this feature **fails closed** without an independent dashboard owner key.

1. In Vercel project settings > Environment Variables, create:
   `SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY`.
   Its value must be **exactly 64 cryptographically random hexadecimal characters**
   (32 random bytes), unique to this dashboard. Restrict it to **Preview** while reviewing.
   Never use the Alpaca API ID, API secret, Vercel bypass or existing
   `SPORTSEDGE_ALPACA_PAPER_READ_TOKEN` as this value.
2. Generate the key with a password manager configured for 64 random hex characters, or
   locally in PowerShell (copy to clipboard, not command output):

   ```powershell
   $bytes = New-Object byte[] 32
   [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   $ownerKey = -join ($bytes | ForEach-Object { $_.ToString('x2') })
   Set-Clipboard -Value $ownerKey
   ```

   Paste the secret into Vercel and save it securely in a password manager.
   Don't paste it into ChatGPT, GitHub, source code or a support screenshot.
   If the key is lost, replace the Vercel value and redeploy; previous sessions
   will be invalidated.
3. Let Vercel build a **new Preview** from
   `feature/alpaca-paper-readonly-readiness-20261013`.
   Wait for `Ready`; code and newly added env vars are loaded only by that deployment.
4. Open the branch's protected Preview site, navigate to Stocks > **View private paper
   account**, and enter the **dashboard owner key**. It is sent via HTTPS and cleared
   from the input; it is not saved in localStorage. Server issues a signed 30-minute
   HttpOnly, Secure, SameSite=Strict cookie. Hit Refresh to load a new snapshot;
   use Lock dashboard to clear the cookie.

No Alpaca, SportsEdge diagnostic bearer or Vercel bypass credentials should be
entered into the dashboard login.

## What the dashboard shows

- Paper cash, equity, buying power, account state, current stock positions,
  latest 25 orders and warnings from the read-only broker reader.
- Clear snapshot capture time; manual refresh only.
- Broker reported equity is **not a proven strategy P&L**. No automatic trading,
  historical backtest results, automated refresh, real-money order routing, or
  account reconciliation is claimed.

### Security and operational boundaries

- This feature has no unauthenticated broker-data endpoint. GET
  `/api/internal/alpaca-paper/view` requires a valid owner cookie; there are no
  broker writes anywhere in the dashboard.
- Incomplete/invalid key: viewer responds `owner_access_not_configured`.
- Browser cookie expires after 30 minutes, and changing the owner key invalidates it.
  Cookies are not bound to an identity provider; this shared secret is a
  **single-owner stopgap**, not multi-user login or scalable session management.
- Owner key is in Vercel **server-side env only**. The key is not in
  `NEXT_PUBLIC_*`, browser localStorage, query strings or logs.
- Responses are `private, no-store`, and login is same-origin only. Vercel
  Deployment Protection should remain on for Preview.
- Production rollout requires explicit review of this owner-access mechanism,
  deployment protection, user roles, logs, and service-key scopes. Do **not**
  promote a working Preview or merge blindly.
- If enabling scheduled or automated *paper orders* later, implement separate
  risk controls, strategy gates, human authorization, idempotency, order
  reconciliation, account monitoring, and a kill switch. Do not weaken this
  strictly read-only code path to add execution.
