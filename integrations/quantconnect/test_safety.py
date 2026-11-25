"""Synthetic safety-contract tests; never touch accounts or messaging."""
import unittest
try:
    from .safety import assess
except ImportError:
    from safety import assess

POLICY=dict(max_data_age_seconds=90,max_day_loss_bps=150,max_drawdown_bps=500,max_nav_gap_cents=1)


def good():
    return dict(as_of='2026-10-13T20:00:00Z',price_observed_at='2026-10-13T19:59:30Z',
                last_reconciled_at='2026-10-13T19:59:45Z',provider_ok=True,
                report_hash_approved=True,strategy_version_verified=True,
                unknown_order_count=0,unsettled_exception_count=0,
                nav_usd='1000',day_open_nav_usd='1000',peak_nav_usd='1000',
                cash_usd='500',position_value_usd='500',receivables_usd='0',unsettled_cash_usd='0')


class SafetyContractTests(unittest.TestCase):
    def test_no_issues_is_not_order_authorization(self):
        r=assess(good(),POLICY)
        self.assertEqual(r['codes'],[])
        self.assertEqual(r['status'],'NO_ALERT_FINDINGS_NOT_AUTHORIZATION')
        self.assertFalse(r['orders_placed'])
        self.assertFalse(r['notifications_sent'])
        self.assertFalse(r['future_live_approval'])

    def test_stale_and_failed_provider_halts(self):
        snap=good();snap['price_observed_at']='2026-10-13T19:00:00Z';snap['provider_ok']=False
        self.assertEqual(assess(snap,POLICY)['codes'],['PROVIDER_UNAVAILABLE','STALE_OR_FUTURE_MARKET_DATA'])

    def test_loss_and_drawdown(self):
        snap=good();snap.update(nav_usd='900',cash_usd='400',day_open_nav_usd='1000',peak_nav_usd='1200')
        self.assertEqual(assess(snap,POLICY)['codes'],['DAY_LOSS_LIMIT_BREACHED','DRAWDOWN_LIMIT_BREACHED'])

    def test_unreconciled_orders_and_nav(self):
        snap=good();snap.update(unknown_order_count=1,nav_usd='999',report_hash_approved=False)
        self.assertEqual(assess(snap,POLICY)['status'],'HALT_NEW_ORDERS')
        self.assertIn('ACCOUNT_NAV_MISMATCH',assess(snap,POLICY)['codes'])
        self.assertIn('UNCERTAIN_ORDER_STATE',assess(snap,POLICY)['codes'])

    def test_missing_data_fails_closed(self):
        snap=good();del snap['peak_nav_usd']
        self.assertIn('MISSING_OR_INVALID_SAFETY_EVIDENCE',assess(snap,POLICY)['codes'])

    def test_unknown_policy_does_not_default_silently(self):
        with self.assertRaises(ValueError):assess(good(),{})

    def test_deterministic_alert_identity(self):
        self.assertEqual(assess(good(),POLICY),assess(good(),POLICY))


if __name__=='__main__':unittest.main()
