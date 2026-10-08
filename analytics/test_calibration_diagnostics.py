"""Synthetic probability and result pairs; no actual sports outcomes included."""
import math
import unittest

from calibration_diagnostics import ScoredProbability, diagnose_binary, wilson_interval


def series(probs, results):
    return [ScoredProbability(f"synthetic-game-{i}", p, o)
            for i, (p, o) in enumerate(zip(probs, results))]


class CalibrationDiagnosticsTests(unittest.TestCase):
    def test_wilson_extremes_are_bounded(self):
        lower, upper = wilson_interval(0, 10)
        self.assertEqual(lower, 0)
        self.assertGreater(upper, 0)
        lower, upper = wilson_interval(10, 10)
        self.assertLess(lower, 1)
        self.assertEqual(upper, 1)

    def test_wilson_known_symmetry(self):
        a, b = wilson_interval(3, 20)
        c, d = wilson_interval(17, 20)
        self.assertAlmostEqual(a, 1 - d)
        self.assertAlmostEqual(b, 1 - c)

    def test_wilson_rejects_invalid_parameters(self):
        for a, b in [(-1, 10), (11, 10), (1, 0), (True, 3), (1, 3.3)]:
            with self.assertRaises(ValueError):
                wilson_interval(a, b)
        for c in [0.0, 1.0, float("nan"), 0.95, "95%"]:
            if c == 0.95:
                self.assertEqual(len(wilson_interval(1, 3, c)), 2)
            else:
                with self.assertRaises(ValueError):
                    wilson_interval(1, 3, c)

    def test_perfectly_calibrated_bins(self):
        report = diagnose_binary(series([0.5, 0.5], [0, 1]), bins=2)
        self.assertAlmostEqual(report["expected_calibration_error"], 0)
        self.assertAlmostEqual(report["brier_score"], 0.25)
        self.assertAlmostEqual(report["log_loss"], math.log(2))
        self.assertEqual(report["sample_size"], 2)

    def test_boundary_values_and_last_bin(self):
        report = diagnose_binary(series([0.0, 1.0], [0, 1]), bins=10)
        self.assertEqual(report["calibration_bins"][0]["sample_size"], 1)
        self.assertEqual(report["calibration_bins"][-1]["sample_size"], 1)
        self.assertTrue(report["calibration_bins"][-1]["upper_bound_inclusive"])
        self.assertAlmostEqual(report["brier_score"], 0.0)
        self.assertTrue(math.isfinite(report["log_loss"]))

    def test_repeated_wrong_confident_forecasts_score_badly(self):
        report = diagnose_binary(series([0.95, 0.95], [0, 0]), bins=10)
        self.assertGreater(report["log_loss"], 2.0)
        self.assertGreater(report["brier_score"], 0.9)
        self.assertGreater(report["expected_calibration_error"], 0.9)
        self.assertEqual(report["classification_accuracy"], 0.0)

    def test_binned_calibration_is_weighted_by_sample_size(self):
        report = diagnose_binary(series([0.1, 0.1, 0.8], [0, 0, 1]), bins=2)
        self.assertAlmostEqual(report["expected_calibration_error"], (2 / 3) * 0.1 + (1 / 3) * 0.2)

    def test_permutation_invariance(self):
        rows = series([0.1, 0.2, 0.8], [0, 1, 1])
        first = diagnose_binary(rows, bins=4)
        second = diagnose_binary(list(reversed(rows)), bins=4)
        self.assertEqual(first, second)

    def test_empty_bins_are_not_undefined_numbers(self):
        report = diagnose_binary(series([0.05], [0]), bins=10)
        self.assertEqual(report["bins_populated"], 1)
        self.assertIsNone(report["calibration_bins"][1]["observed_frequency"])
        self.assertEqual(report["calibration_bins"][1]["sample_size"], 0)

    def test_duplicate_game_id_rejected(self):
        with self.assertRaisesRegex(ValueError, "unique"):
            diagnose_binary([ScoredProbability("same", 0.1, 0), ScoredProbability("same", 0.9, 1)])

    def test_invalid_probabilities_or_outcomes_rejected(self):
        bad = [(float("nan"), 1), (float("inf"), 1), (-0.1, 0), (1.01, 1), (True, 1), ("0.9", 0), (0.5, True), (0.5, 2), (0.5, 0.0)]
        for p, o in bad:
            with self.assertRaises(ValueError):
                diagnose_binary([ScoredProbability("x", p, o)])

    def test_invalid_bin_counts_rejected(self):
        for b in (0, 1, 51, 2.5, "10", True):
            with self.assertRaises(ValueError):
                diagnose_binary(series([0.5], [1]), bins=b)

    def test_empty_input_or_missing_id_rejected(self):
        with self.assertRaises(ValueError):
            diagnose_binary([])
        with self.assertRaises(ValueError):
            diagnose_binary([ScoredProbability("", 0.1, 0)])

    def test_report_does_not_claim_profitability(self):
        report = diagnose_binary(series([0.1, 0.9], [0, 1]))
        self.assertFalse(report["roi_available"])
        self.assertFalse(report["source_independently_verified"])
        self.assertTrue(report["warnings"])


if __name__ == "__main__":
    unittest.main()
