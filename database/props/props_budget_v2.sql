-- SportsEdge props budget v2 (owner-approved 2026-11-07). Additive: one new append-only
-- policy row; v1 stays in place for audit. props_reserve_credits uses the newest row whose
-- active_from has passed, so this takes effect at 2026-11-08 16:00 UTC (after the first
-- verified settle) even if applied earlier. Safe to re-run.
INSERT INTO public.props_budget_policy(version,daily_credits,monthly_credits,provider_floor,active_from)
VALUES('props-budget-v2',7,200,60,'2026-11-08T16:00:00Z')
ON CONFLICT (version) DO NOTHING;
SELECT version,daily_credits,monthly_credits,provider_floor,active_from FROM public.props_budget_policy ORDER BY active_from;
