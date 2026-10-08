# Model evaluation milestone

New files: `analytics/model_evaluation.py`, `analytics/test_model_evaluation.py`.
The evaluator accepts previously recorded binary predictions and final outcomes. It reports Brier score, log loss, sample size and, **only when contemporaneous odds were captured**, simulated profit and ROI. All monetary outputs are paper results, not real earnings.
It rejects duplicate game IDs, invalid probabilities, naive timestamps, and predictions timestamped at or after kickoff.
It does not train a model, retrieve historical games, independently verify provider odds, or prevent fabrication of input records. Store immutable pregame odds snapshots before treating ROI as a valid historical evaluation.
Run tests from the repository root: `python -m unittest discover -s analytics -p 'test_*.py'`.
Next: integrate verified historical results and time-split model training after data ingestion is independently verified.
