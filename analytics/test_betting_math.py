import unittest
from decimal import Decimal
from betting_math import implied_probability, no_vig_probabilities, net_profit

class BettingMathTests(unittest.TestCase):
    def test_even_money(self):
        self.assertEqual(implied_probability(100), Decimal("0.5"))
        self.assertEqual(implied_probability(-100), Decimal("0.5"))
    def test_favorite(self):
        self.assertEqual(implied_probability(-150), Decimal("0.6"))
    def test_no_vig_two_way(self):
        result = no_vig_probabilities([-110, -110])
        self.assertEqual(result, [Decimal("0.5"), Decimal("0.5")])
    def test_three_way(self):
        result = no_vig_probabilities([100, 200, 300])
        self.assertEqual(sum(result), Decimal(1))
    def test_settlement(self):
        self.assertEqual(net_profit(Decimal("10"), 150, "won"), Decimal("15"))
        self.assertEqual(net_profit(Decimal("10"), -200, "won"), Decimal("5"))
        self.assertEqual(net_profit(Decimal("10"), -110, "lost"), Decimal("-10"))
        self.assertEqual(net_profit(Decimal("10"), -110, "push"), Decimal(0))
    def test_invalid(self):
        for value in [0, 99, -99, True]:
            with self.assertRaises(ValueError):
                implied_probability(value)
        with self.assertRaises(ValueError):
            no_vig_probabilities([100])
        with self.assertRaises(ValueError):
            net_profit(Decimal("-1"), 100, "won")

if __name__ == "__main__":
    unittest.main()
