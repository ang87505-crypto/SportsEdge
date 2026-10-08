# Historical data validation — milestone 2

Added `analytics/historical_validation.py` and `analytics/test_historical_validation.py`.
Validation checks provider-scoped event IDs, duplicate events and odds, nonnegative final scores, timezone-aware timestamps, odds captured strictly before game start, valid American odds, and selections matching teams/draw. Missing pregame odds are reported, not invented.

Verification: ten unit tests passed in isolated Python execution on 2026-10-08. The tests use synthetic fixtures **only** to verify validation logic; they are not real games or model results.

Run locally: `python -m unittest discover -s analytics -p 'test_*.py'`.

**Not yet implemented:** secure server ingestion, database persistence, final-score provider, scheduled collection, model training, historical sportsbook odds backfill. Existing Supabase RLS is enabled; no public write policies. Avoid adding provider or Supabase privileged keys to source control.

Next milestone: implement authenticated server-side ingestion with service-role credentials kept in Vercel, then verify stored provider records and rate limits before any training.
