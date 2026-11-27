# Unattended research evidence connections — November 26, 2026

Base: production main `436eaca450091cf5b0b8658c2a16fab0c7a28442` (#232). This milestone connects existing aggregate results to the learning engine. It does not change a model, research protocol, minimum, budget, collection cadence, database, order path or release switch.

## Existing results now connected

### Gap-shrink props experiment

The existing `props-research-snapshot.ts` already runs the frozen `props-gap-shrink-v1` scorer. Its output previously existed only as a 90-day workflow artifact. The same workflow now publishes an immutable aggregate receipt under `research-data/props-research/runs/` through the existing append-only Git helper.

- A receipt contains the run ID, source commit, observation time, active baseline, frozen protocol fingerprint and aggregate sample/score fields. Player rows, rankings and credentials are excluded.
- The filename encodes the recorded UTC observation time and run ID. Repeating a publication is idempotent; changing or retiming that run is refused. The existing Git guard also refuses edits to an archived receipt.
- The engine reads the newest receipt, validates its schema, baseline, protocol and digest, and rejects future or older-than-48-hour evidence. A missing first receipt is explicitly pending, not zero progress or a connected producer.
- A stale or invalid receipt fails the evaluation and retains the previously accepted registry. It never silently falls back to older evidence.
- The scorer does not supply the registered 100-decision count or family correction. The adapter records prospective sample progress with `NO_CLEAR_EFFECT`; even a scorer-level `ready_for_review` label cannot waive these missing requirements or promote anything.
- Research-data writers use the existing shared concurrency group. A successful main-branch props-research workflow completion triggers the existing engine evaluation. This adds no provider requests or prediction writes.

### QMOM disclosure-following experiment

The engine already reads the nightly stock research `summary.json`. It now also reads its existing `qmom-disclosure-follower-v1` forward block.

- Session counts are reported as sessions, never divided by five or treated as graded weeks.
- If graded weeks are absent, no weekly observations are credited toward the registered 26-week gate. The missing weekly count remains explicitly unknown in the explanation.
- Only an explicit valid weekly count is accepted; it cannot exceed the session count. The adapter always reports `NO_CLEAR_EFFECT` and never activates a strategy.
- Duplicate candidate IDs and invalid forward counts are refused. Failed and rejected experiments remain terminal.
- Repeated identical evidence changes no lifecycle history. A new receipt timestamp alone does not count as learning a new result.

## What a deployed connection proves

Code and CI establish that a path can work. Automatic coverage must be claimed only after an actual main-branch producer receipt is consumed in a successful archived engine evaluation. Before that, the existing four automatic paths remain the last verified count. These two connections can increase that count to six; they do not make all 20 active experiments automatic or validate any strategy.

## Remaining research requirements

- Four sports ablation variants need their forward schema/readiness and prospective producers.
- Four v2 sports challenger registrations refer to research code introduced in commit `035625f`; that scorer is not present on current main. Its frozen fitted artifacts and forward-input contract must be verified before wiring it. Existing research is retained, not replaced or refitted here.
- Injury/rotation research requires an owner-authorized licensed source.
- The two stock v3 variants depend on the separate #165 decision.
- Opponent-rate and low-minutes experiments need prospective frozen producers, not retrospective scores relabelled as forward evidence.
- Holdrank10 and psychology research must receive the next genuine weekly freeze and subsequent grades. An empty or pending week cannot be manufactured to meet a deadline.

## Release and owner boundaries

- #229 remains separate: its corrected BIGINT/NULL slot contract is reviewed, but its migration and daily refresh are not applied or activated by this milestone.
- A fresh read-only check of the research project confirmed that dispatch uses `net.http_post`, claim is bound to the requested ID and hash, requires queued state and expires after ten minutes, and finish writes the summary for the requested running ID. These are verified code facts, not new owner approvals or actual dispatch receipts. Anonymous/authenticated execute access remains denied.
- The active props project `vfyzbliksooljxrlfadp` is outside the connected Supabase account's permissions. Do not substitute the research project for #216's hosted readiness. That readiness and the additive frozen-file approval remain outstanding.
- #102 stays gated on a genuine supervised stock PAPER session. Real-money and exchange access remain disabled.
- Preserve the Nov 29 6 PM Mountain through Nov 30 stock-gate deployment freeze.

## Verification commands

```sh
node --experimental-strip-types --test src/lib/lab/engine/props-research.test.mjs src/lib/lab/engine/stock-research.test.mjs
node --experimental-strip-types --test src/lib/lab/engine/*.test.mjs src/lib/server/research-engine-load.test.mjs scripts/data-branches.test.mjs
npm run lint
npm run build
```

All synthetic fixtures are labelled and remain engineering evidence only. Production acceptance requires the immutable producer receipt, a successful engine receipt naming that source, unchanged control/model settings and the corresponding public learning coverage.
