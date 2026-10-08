alter table public.research_results
  add constraint research_final_scores_required
  check (status <> 'final' or (home_score is not null and away_score is not null));
