import unittest
from analytics.stock_report_statistics_v1 import monthly_statistics,summarize_equity

class ReportStatisticsTests(unittest.TestCase):
    def test_hand_calculated_nav_loss_drawdown_and_no_risk_free(self):
        r=summarize_equity(['2000-01-01','2000-02-01','2000-03-01'],[1000,1200,900],monthly_returns=[.2,-.25])
        self.assertEqual(r['net_profit_dollars'],-100);self.assertAlmostEqual(r['maximum_drawdown'],.25)
        self.assertIsNone(r['sharpe']);self.assertTrue(r['terminal_drawdown_unrecovered'])
    def test_recovery_duration(self):
        r=summarize_equity(['2000-01-01','2000-02-01','2000-03-01'],[1000,900,1000],monthly_returns=[-.1,1/9])
        self.assertEqual(r['drawdown_duration_days'],60);self.assertFalse(r['terminal_drawdown_unrecovered'])
    def test_fixed_year_block_bootstrap(self):
        months=[f'{y}-{m:02d}' for y in (2000,2001) for m in range(1,13)]
        r=monthly_statistics(months,[0]*24,[.01]*12+[-.02]*12)
        self.assertAlmostEqual(r['mean_monthly_difference'],-.005);self.assertEqual(r['interval'],[-.02,.01])
        self.assertEqual(r,monthly_statistics(months,[0]*24,[.01]*12+[-.02]*12))
    def test_insufficient_and_partial_blocks(self):
        months=[f'2000-{m:02d}' for m in range(1,13)]
        self.assertIsNone(monthly_statistics(months,[0]*12,[0]*12)['interval'])
        with self.assertRaises(ValueError):monthly_statistics(months[:-1],[0]*11,[0]*11)
    def test_nonfinite_duplicate_and_misaligned_data_fail(self):
        with self.assertRaises(ValueError):summarize_equity(['2000-01-01']*2,[1000,1000],monthly_returns=[])
        with self.assertRaises(ValueError):summarize_equity(['2000-01-01','2001-01-01'],[1000,float('nan')],monthly_returns=[])
        with self.assertRaises(ValueError):monthly_statistics(['2000-01'],[0],[])
