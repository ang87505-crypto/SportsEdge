"""Re-run the pinned, public-domain source backtest and verify every frozen game."""
import json
from pathlib import Path
from elo_walkforward import run

SNAPSHOT = Path(__file__).resolve().parents[1] / "src" / "data" / "research" / "elo_2026_10_08.json"

def main():
    original = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    replay = run()
    assert replay["sourceCommit"] == original["sourceCommit"], "Source commit mismatch"
    assert replay["historicalTrainingGames"] == original["trainingGames"], "Training sample mismatch"
    assert len(replay["games"]) == len(original["games"]) == 579, "Evaluation sample mismatch"
    metric_names = {
        "accuracy": "accuracy", "baseline_accuracy": "baselineAccuracy",
        "log_loss": "logLoss", "baseline_log_loss": "baselineLogLoss",
        "brier": "brier", "baseline_brier": "baselineBrier",
    }
    for from_field, frozen_field in metric_names.items():
        a = replay["overall"][from_field]
        b = original["overall"][frozen_field]
        assert abs(a - b) < 1e-9, f"{from_field}: {a} != {b}"
    for a, b in zip(replay["games"], original["games"]):
        for k in ("date", "league", "home", "away", "actual", "score", "prediction", "correct"):
            assert a[k] == b[k], f"{k} mismatch in {a['date']} {a['home']}"
        assert all(abs(x-y) < 1e-8 for x, y in zip(a["probabilities"], b["probabilities"])), "Probability mismatch"
    print(f"REPRODUCED: {len(replay['games'])} matches; source={replay['sourceCommit']}; accuracy={replay['overall']['accuracy']:.6f}; log_loss={replay['overall']['log_loss']:.6f}")

if __name__ == "__main__":
    main()
