# Paper testing integration — November 20, 2026 (Mountain time)

This release joins existing reviewed work and connects the frozen NBA recalibration to genuine future platform
predictions. It does not promote a model or enable an exchange/broker order path. Keep the PR draft until the active
props database setup is verified and the owner approves release.

## Reused source milestones

| PR | Imported head | Purpose |
|---|---|---|
| #192 | `30db05c21d92903ae1ceb4ed472d2b58c417662e` | Resumable forward lab, separate penny study, exact setup bundle |
| #195 | `c25e4838c426ee55f72c5dda620871a94614a172` | Frozen monotone NBA calibrator and its original research evidence |
| #199 | `1b97cfd4ffb5688ab5d40f5de4095ebbb696fac4` | Stock data audit, duration-aware SEC parser and forward scorecard |

The integration base is production `1c6f05d94899e3d34f5a3a0cc7ff0c6b997f5f56` (#197). Original artifacts and
retrospective verdicts are preserved. #196 and #198 are separate research findings, not trading-policy changes.

## NBA real-line shadow

- The normal capture worker records `props-nb-monotone-cal-v1` alongside newly saved baseline forecasts. It never
  substitutes its probabilities into picks, entries, sizing or the active-model control, and uses none of the three
  learning-model shadow slots. No new provider call is made.
- Only the forward map from #195 is used. Its digest is
  `8b84007d37b9084a7cd486fe3f387bf6d2ac0062d6b230d48f79310924f4a633`; the production artifact's JSON digest is
  `4ca4be3779f188c3aa5dc6ccd2b24ceabf9cd07d1dfac0b534b59d26918298be`. Either changing blocks shadow writes.
- The conditional non-tie probability is recalibrated; baseline tie mass is preserved on integer lines. The stored
  row includes the exact source prediction ID and both digests. The database sets its actual receipt time, requires a
  running capture, and refuses any prediction at or after lock. Historical observations are never backfilled.
- The integration contract's `notBefore` is `2026-11-21T03:37:17Z`. That is a lower bound, not an assertion that
  production was recording then. Real recording starts only after release and a successful future capture.
- Writes use bounded batches. A definite after-lock rollback may be split to preserve still-open rows. An uncertain
  write is reported and never retried. Shadow failures remain explicit and do not replace the already-recorded picks.
- The learning engine registers this experiment only after seeing a correctly reproduced forward receipt. No absent
  candidate is prematurely marked stale. It pairs each forecast to its exact saved baseline, uses the existing
  500-line / 14-date / 50-game / 100-candidate-decision gate, and cannot promote it. The independent proxy-line arm
  retains its own 150-game / 5,000-line minimum and is never pooled with real lines.

## Stock research and SEC intake

The already-approved SEC intake runs v2 on each existing response: quarter/annual durations, repeated comparatives vs
restatements, strict filing availability and thin/mismatched CIK history. This adds no endpoint or request. The same
eight tags as v1 are retained as a hashed source subset, with reproducible v2 facts, inside the existing immutable
research objects. Existing v1 output remains present. Diagnostic failures remain visible; no guessed CIK history or
fundamental feature is introduced.

The manual stock backtest now uploads `audit.json` and `forward.json` after generating them, alongside its original
results. Previously the artifact step ran before those files existed. No stock data schedule, execution code, cap,
universe, release flag or November 23 session is changed. Weekly decision captures already include raw corporate-action
pages in their compressed workflow artifacts (30-day retention); a durable historical action archive remains separate.

## Active props database setup and release

The connected management account still cannot query `vfyzbliksooljxrlfadp`. A browser check reaches Supabase sign-in.
No migration was applied by this integration. The accessible older project `fzyjazhvkstvwwzjhlrr` is not a substitute.

1. In the owner account, open the SQL editor for **`vfyzbliksooljxrlfadp`** and apply the full, unchanged
   [`database/props/forward_studies_setup.sql`](../database/props/forward_studies_setup.sql) from this reviewed branch.
   The bundle creates missing complete study schemas atomically and refuses a wrong or partial setup.
2. Verify all ten study relations exist. This query is read-only:

   ```sql
   select name, to_regclass('public.' || name) is not null as installed
   from unnest(array[
     'props_lab_experiments','props_lab_events','props_lab_predictions','props_lab_flags','props_lab_reports','props_lab_stakes',
     'props_penny_cohorts','props_penny_entries','props_penny_settlements','props_penny_tampering'
   ]) as names(name);
   ```

3. After owner release approval, merge the integration PR and verify its exact production commit. Do not merge #102.
4. Run **Forward paper studies** on `main`. Require `readiness.state = READY` and inspect each task's receipt. A
   successful no-eligible-entry run is valid; fixtures and historical backfills cannot substitute for future records.
5. Confirm a later real capture writes this recalibration's rows, then verify its separate engine progress on `/lab`.
   Source collection can continue independently if study readiness is blocked.

## Kalshi verification boundary

Production #197 is READY. The hosted database's earlier owner-transport worker run stored a November 21 forecast at
`2026-11-20T22:00:42Z`, using two matched history days, null model probabilities and zero demo orders. It is not an
HTTP cron receipt. The scheduled worker is nominally 8:35 PM MST; inspect a durable run receipt before calling the
deployed schedule verified. At the `2026-11-21T03:49:03Z` read, no new scheduled run had been recorded, demo remained
`STOPPED`, and demo attempts were zero. Do not infer a failed schedule from an empty early scheduling window.

Demo connection still needs the owner setup and access review in
[`KALSHI_PAPER_PLATFORM_2026_11_20.md`](KALSHI_PAPER_PLATFORM_2026_11_20.md). The connected one-contract test, model
readiness and real-money execution remain different stages. No credentials were read or changed here.

## November 23 supervised stock session

The pinned release head remains `9e23e6305eb04bc20ea7e393bd2c49da4bd2a811`, with all eight recorded check runs successful.
The latest operations receipt (`2026-11-21T03:18:19Z`) reports `STOCK_SUPERVISED_EXECUTE_REQUIRED`. Frozen stock files
have zero changes in this integration. No supervised order, fill or close mark is claimed.

Use the existing [session checklist](AUTOMATION_OPERATIONS_2026_11_10.md#steps-on-the-session-day): owner Start before
the session, verify that day's TARGETS decision, execute once on the pinned release branch between 7:31 AM and about
1:00 PM Mountain, inspect real PAPER fills, then Stop/Start before the 2:00 PM close. Unknown orders must be reconciled
before any repeat. After the same-session close mark and verified release gate, the owner reviews #102 separately.

## Verification

- Full local JavaScript suite: 1,139 discovered, 1,091 passed, 48 PostgreSQL-dependent skips, zero failures.
- Full Python analytics suite: 441 passed.
- TypeScript and production build pass. ESLint: zero errors, six existing warnings.
- Owner sign-in HTTP smoke passes, including Kalshi read/write/scheduler authentication boundaries.
- Added tests cover frozen-artifact tampering, tie conservation, source identity, duplicate/late/uncertain writes,
  exact-baseline pairing, unchanged review gates, SEC duration/filing availability, and real collector wiring with
  synthetic network replies and unchanged request counts.
- The exact owner SQL bundle is unchanged from #192. Its disposable PostgreSQL and responsive browser checks must
  also pass on the final integration head in GitHub CI before release. Live schema readiness and future records
  remain separate acceptance checks.
- PostgreSQL CI also exercises the new shadow writer against the real schema: one durable row, duplicate refusal,
  source ID and tie preservation, database-clock lock crossing, immutability, and no picks or entries.

Reproduce the local checks:

```sh
node --experimental-strip-types --no-warnings --test $(rg --files src scripts -g '*.test.mjs')
python -m unittest discover -s analytics -p 'test_*.py'
npm run lint
npm run build
npx tsc --noEmit
node scripts/owner-sign-in-smoke.mjs
node scripts/assistant-http-smoke.mjs
```
