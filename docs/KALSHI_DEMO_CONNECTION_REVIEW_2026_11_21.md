# Kalshi demo: separate a credential check from trading/data access

Review date: November 21, 2026 (Mountain time). Base main:
`1c6f05d94899e3d34f5a3a0cc7ff0c6b997f5f56`.

## Finding

The owner has prepared a demo account and saved the two credential fields. The
existing **Check demo account** action constructs the full trading/data client,
reads orders and positions, reconciles history and writes an account snapshot.
That action correctly requires its broader access review. It cannot serve as a
minimal check that a demo key can authenticate.

The candidate adds an explicit **Test demo connection** owner action. This is a
separate, bounded capability; no existing permission check is removed or relaxed.
The old full account check, market reads, reconciliation, arming and order methods
still use the unchanged `kalshiDemoConfig` approval/reference gate.

## Official sources and scope of the review

- Kalshi's [authenticated-request quickstart](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests)
  explicitly demonstrates a signed GET of a member's own demo portfolio balance.
- The [demo guide](https://docs.kalshi.com/getting_started/demo_env) documents the
  separate demo credentials and demo API host, and cautions that demo prices and
  behavior do not establish real-market execution quality.
- The [balance schema](https://docs.kalshi.com/api-reference/portfolio/get-balance)
  defines `balance_dollars` as fixed-point dollars. It also documents a separate
  balance endpoint rate bucket; the check runs only on an owner's explicit click,
  once per action, with no polling or automatic retry.

This candidate implements only that documented credential/balance workflow. It is
not a permission letter from Kalshi or a finding that every broader SportsEdge
data use is authorized. The [general developer agreement](https://kalshi-public-docs.s3.amazonaws.com/Kalshi-Developer-Agreement.pdf)
and [data terms](https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf)
do not establish a blanket right to retain quotes, redistribute data, or train AI
on exchange data. Demo-specific treatment of those broader uses remains unresolved.
No support message was sent and no access reference was invented.

This dated note narrows the earlier blanket discussion about requiring a support
reply before a basic demo connection test. It does not supersede the market-data
and research restrictions recorded in the earlier setup documentation.

## Implemented boundary

- Existing owner-cookie authentication and same-origin checks run before body
  parsing, credentials or requests. Extra action parameters are refused.
- The helper accepts no URL, path, method, ticker or order arguments. Its only
  destination is GET
  `https://external-api.demo.kalshi.co/trade-api/v2/portfolio/balance`.
- Ed25519 and RSA-PSS signatures use only server-side credentials. Redirects are
  rejected. Timeout is eight seconds; the JSON response is bounded to 16 KiB.
- The reply contains only a fixed status/source, read-only marker, request clock
  and validated integer-microdollar cash. It contains no key ID, private key,
  signature, headers, raw body, quotes, orders or positions. Failures are sanitized
  codes; invalid data cannot become an invented zero balance.
- The action makes no database calls, writes no snapshot, changes no control,
  starts no worker, and offers no order method. The scheduler never invokes it.
- The owner panel displays the checked mock cash separately from stored account
  history. A successful check does not enable order controls or certify the model.
  Its private notice is hidden after sign-out or a failed owner read.
- Neither approval environment variable is set. No model, sample minimum, source
  schedule, existing trading client, SQL schema, bankroll or stock file changes.

## Actual hosted baseline, distinct from test fixtures

Read-only verification against the general app database in this review found:
demo state STOPPED; `checked_at` null; zero demo intents; zero account snapshots.
The latest stored platform forecast targets November 21 and has two training and
two matched days, with AWAITING_VERIFIED_HISTORY. That is a stored platform receipt,
not a fresh calculation of the separate NOAA archive's current pair count.

Vercel metadata confirms the two credential fields are Sensitive in Production
and Preview and a subsequent Production deployment is READY. No credential value
was read or decrypted. Metadata does not verify key validity. No actual Kalshi
API call, connected balance result or demo order is claimed by this candidate.

## Verification

The new owner regression fails on the original handler (400 instead of the new
bounded check) and passes after implementation. Twelve focused tests verify actual
Ed25519/RSA signatures, exact host/path/method, one request, no retry, sanitized
errors, bounded replies, fixed-point amounts, malformed keys, fixture refusal,
owner/origin boundaries, absence of database/trading calls, scheduler isolation
and preservation of the broader approval gate.

Local checks:

```sh
node --experimental-strip-types --test src/lib/server/kalshi-demo-balance-check.test.mjs
# 12 pass; synthetic keys and intercepted transport
node --experimental-strip-types --test src/lib/prediction-markets/kalshi/*.test.mjs src/lib/server/kalshi-*.test.mjs scripts/kalshi-independent-weather-collect.test.mjs scripts/kalshi-weather-contract-eval.test.mjs
# 163 pass; zero skips/failures
npm run lint
# zero errors; six existing warnings
npm run build
node scripts/owner-sign-in-smoke.mjs
npx tsc --noEmit
git diff --check
```

The built HTTP smoke test removes every inherited KALSHI credential before starting
its isolated server. It verifies owner/origin enforcement and a disconnected
credential result independent of the unavailable test database. Client bundles
are checked for credential-reader names and signing headers.

The browser fixture intercepts the new action with clearly synthetic cash, checks
the success message, confirms order controls stay disabled and clears the private
notice on sign-out. GitHub must verify that fixture and the full existing checks
at the published head; consult the PR for actual hosted receipts. Synthetic
success is never a real account connection or performance result.

## Release, owner acceptance and rollback

Keep this candidate separate from #203, #208 and #209. Require independent review,
final-head CI and owner release approval before merging. Nothing in this review
authorizes a merge, deployment, credential read, account request or demo/live order.

After an approved release, verify the production SHA, sign into SportsEdge as owner,
open Kalshi paper, expand **Demo account and automation controls**, then select
**Test demo connection** once. Require a fresh success result and the actual mock
cash value; zero cash is valid. Preserve STOPPED. A key/authentication failure is
reported rather than silently falling back to another environment or credential.

The existing account-history and trading access review remains separate. Nothing
is armed by a balance check, and the model still requires its unchanged history
minimum. Code rollback is a reviewed revert; no database or credential rollback,
balance rewrite or archived-evidence change is required.
