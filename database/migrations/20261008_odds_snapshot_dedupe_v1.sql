-- SportsEdge: additive uniqueness protection for collected sportsbook snapshots.
-- PostgreSQL 17 supports NULLS NOT DISTINCT, so moneyline rows whose line
-- is NULL cannot be inserted repeatedly at the same observed price/time.
--
-- This migration does not delete or update records, alter RLS, or replace tables.
-- If previously stored duplicates exist, stop with an explicit error so they
-- can be investigated rather than silently deleted.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.odds_snapshots
    GROUP BY game_id, provider, sportsbook, market, selection,
             observed_at, american_odds, line
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'odds_snapshots contains duplicate captures: review data before adding uniqueness';
  END IF;
END $$;

ALTER TABLE public.odds_snapshots
  ADD CONSTRAINT odds_capture_dedupe_v1
  UNIQUE NULLS NOT DISTINCT (
    game_id,
    provider,
    sportsbook,
    market,
    selection,
    observed_at,
    american_odds,
    line
  );
