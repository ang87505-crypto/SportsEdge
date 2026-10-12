# SportsEdge integration and release lanes — 2026-10-12

This is a **review map, not a merge request**. Every PR listed below was open when inspected. No existing PR, including Astra's work, was merged, closed, or rebased to produce this document.

## Owner paper-control / website lane

A chain of stacked PRs underpins the current preview:

```
main
  #16 stock as-of data contract
    #18 stock research baseline (research only)
      #19 stock paper execution planner (planning; not a live stock engine)
        #20 paper readiness UI
          #21 owner-authenticated NBA paper controls (execution disabled)
            #22 sports stale/superseded market guard
              #23 read-only NBA game analysis
                #24 pending-only NBA score reconciliation
                  #25 bounded/selective odds refresh previews
                    #26 saved quote freshness UI
                      #35 polished website, chart, browser QA
                        [this PR] NBA owner-command receipt guard
```

**Important:** This is Git ancestry/dependency, not evidence of strategy readiness. The proposed receipt SQL is a staging-only artifact. The new owner run route fails closed if the schema is absent. No run flag should be enabled without the entire safe chain plus a validated private command table.

## Separate Astra-owned lanes — DO NOT MODIFY

Stock research and execution accounting: `#16 → #18 → #19 → #27 → #29 → #30 → #34`. Astra is repairing the after-cost accounting/execution contract downstream of #34. Do not move, merge, tune, or rewrite the stock research/execution code from this review.

NBA quantitative analysis: `#17 → #28 → #33`, with a distinct independent integrity review in #31. No demonstrated profitable betting advantage, and no reason to promote an algorithm as part of this engineering PR.

## Other PRs / overlapping features

- #11: older standalone Alpaca paper shortcut plus Stocks page. **Do not merge the old Stocks page wholesale**: the safe external shortcut was selectively ported in #35 and the newer manual journal would otherwise be overwritten.
- #13: earlier UI audit, not a substitute for actual browser QA. #35 includes an automated Chrome smoke gate.
- #14 and #15: proposed experimental studies, not authorization to activate NBA 100×$10 or a stock $1,000 execution account.
- #32: independent release dependency documentation / production safety gate. Must be reviewed when preparing a final integration candidate.
- #34 and #33: keep separate from this paper-command guard and any production rollout.

## Proposed merge discipline

1. Confirm each dependency is still current against main; do not force/squash arbitrary mid-chain PRs or overwrite intervening branch changes.
2. Review migration history and confirm an isolated **staging** Supabase project before applying a private NBA receipt migration. No live database changes performed in this milestone.
3. Verify database uniqueness for concurrent distinct IDs, replayed IDs, and lost-response conditions. Confirm ordinary `anon`/`authenticated` have no access to the receipt table.
4. Verify auth, owner binding, origin policy, enabled flag and 409/503 error behavior over HTTPS on protected staging. Run no real wager.
5. Review separate PRs for partial overlap and close/retarget only after provenance is documented and merged behavior is confirmed.
6. Require passing CI, verified preview SHA, browser smoke QA, and explicit approval before any release-flag change.

The actual strategy calculations, stock accounting and NBA edge evaluation are not part of this lane.
