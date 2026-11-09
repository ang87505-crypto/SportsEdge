"""Corporate-action entity checks. Synthetic TEST-ONLY bars modelled on the real META/METV ticker reuse
found in the first evaluation run (Alpaca keys actions by ticker; a ticker can belong to different
companies at different times)."""
from __future__ import annotations
import unittest

from analytics.research import data as rdata


def bars(days, closes, factors):
    """Raw closes and a back-adjustment factor per day (adjusted = raw * factor)."""
    return {'d': days, 'o': list(closes), 'c': list(closes), 'v': [1e6] * len(days),
            'ao': [c * f for c, f in zip(closes, factors)], 'ac': [c * f for c, f in zip(closes, factors)]}


DAYS = [f'2022-01-{d:02d}' for d in (24, 25, 26, 27, 28, 31)] + ['2022-02-01', '2022-02-02', '2022-02-03']


class EntityChecks(unittest.TestCase):
    def test_name_change_of_another_company_using_the_ticker_is_dropped(self):
        b = {'META': bars(DAYS, [300] * 9, [1] * 9), 'METV': bars(DAYS, [11] * 9, [1] * 9)}
        acts = [{'kind': 'name_change', 'symbol': 'META', 'new_symbol': 'METV', 'date': '2022-01-31', 'ratio': 1.0}]
        kept, dropped = rdata.validate_actions(b, acts)
        self.assertEqual(kept, [])
        self.assertEqual(dropped[0]['why'], 'OLD_SYMBOL_STILL_TRADES')

    def test_a_real_rename_is_kept(self):
        b = {'MMC': bars(DAYS[:5], [200] * 5, [1] * 5)}
        acts = [{'kind': 'name_change', 'symbol': 'MMC', 'new_symbol': 'MRSH', 'date': '2022-01-31', 'ratio': 1.0}]
        self.assertEqual(rdata.validate_actions(b, acts)[0], acts)

    def test_self_rename_is_dropped(self):
        b = {'XOM': bars(DAYS, [100] * 9, [1] * 9)}
        kept, dropped = rdata.validate_actions(b, [{'kind': 'name_change', 'symbol': 'XOM', 'new_symbol': 'XOM', 'date': '2022-01-31'}])
        self.assertEqual((kept, dropped[0]['why']), ([], 'SAME_SYMBOL'))

    def test_dividend_with_a_matching_adjustment_footprint_is_kept(self):
        # $2 dividend on 2022-01-31 with a $100 prior close: earlier prices are scaled by 0.98
        b = {'KO': bars(DAYS, [100] * 9, [0.98] * 5 + [1] * 4)}
        acts = [{'kind': 'cash_dividend', 'symbol': 'KO', 'rate': 2.0, 'date': '2022-01-31'}]
        self.assertEqual(rdata.validate_actions(b, acts)[0], acts)

    def test_dividend_of_another_entity_without_a_footprint_is_dropped(self):
        b = {'META': bars(DAYS, [300] * 9, [1] * 9)}
        kept, dropped = rdata.validate_actions(b, [{'kind': 'cash_dividend', 'symbol': 'META', 'rate': 0.05, 'date': '2022-01-31'}])
        self.assertEqual((kept, dropped[0]['why']), ([], 'NO_ADJUSTMENT_FOOTPRINT'))

    def test_split_footprint(self):
        b = {'NVDA': bars(DAYS, [400] * 5 + [100] * 4, [0.25] * 5 + [1] * 4)}
        good = [{'kind': 'split', 'symbol': 'NVDA', 'ratio': 4.0, 'date': '2022-01-31'}]
        self.assertEqual(rdata.validate_actions(b, good)[0], good)
        bad = [{'kind': 'split', 'symbol': 'NVDA', 'ratio': 10.0, 'date': '2022-01-31'}]
        self.assertEqual(rdata.validate_actions(b, bad)[1][0]['why'], 'NO_ADJUSTMENT_FOOTPRINT')

    def test_cash_merger_of_a_still_trading_symbol_is_dropped(self):
        b = {'ABC': bars(DAYS, [50] * 9, [1] * 9)}
        kept, dropped = rdata.validate_actions(b, [{'kind': 'cash_merger', 'symbol': 'ABC', 'rate': 60, 'date': '2022-01-25'}])
        self.assertEqual((kept, dropped[0]['why']), ([], 'OLD_SYMBOL_STILL_TRADES'))

    def test_actions_on_symbols_without_bars_on_the_day_are_kept_but_marked(self):
        b = {'GONE': bars(DAYS[:3], [50] * 3, [1] * 3)}
        acts = [{'kind': 'cash_merger', 'symbol': 'GONE', 'rate': 60, 'date': '2022-01-31'},
                {'kind': 'cash_dividend', 'symbol': 'GONE', 'rate': 1, 'date': '2022-01-31'}]
        kept, dropped = rdata.validate_actions(b, acts)
        self.assertEqual(len(kept), 2)
        by_kind = {a['kind']: a for a in kept}
        self.assertTrue(by_kind['cash_dividend'].get('unvalidated'))
        self.assertFalse(by_kind['cash_merger'].get('unvalidated'))


if __name__ == '__main__':
    unittest.main()
