"""SYNTHETIC ONLY: fake LEAN corporate-action objects, fictional securities.

Proves mapped events are accepted unchanged by frozen accounting v2 and that
every terminal, rounded, undeclared or combined event blocks with a fixed code.
"""
from decimal import Decimal as D
from types import SimpleNamespace as NS
import unittest
from analytics.test_stock_accounting_v2 import fixture, run
from integrations.quantconnect.qc_lifecycle_mapper_v1 import (
    LifecycleBlocked, map_delisting, map_dividend, map_session, map_split,
    map_symbol_change, scoring_action, split_ratio)


def split(factor, kind=1): return NS(type=kind, split_factor=factor)
def dividend(amount): return NS(type=None, distribution=amount)
def declared(amount='0.0625', pay='2026-10-05T10:00:00-04:00'):
    return dict(per_old_share=amount, pay_at=pay, currency='USD', due_bill=False)


def timing(f, eid='SYNTHETIC-qc-1'):
    return dict(event_id=eid, effective_at=f['session']['open_at'], available_at='2026-09-30T22:00:00Z')


class LifecycleMapperTests(unittest.TestCase):
    def blocked(self, code, fn, *args, **kwargs):
        with self.assertRaises(LifecycleBlocked) as caught:
            fn(*args, **kwargs)
        self.assertEqual(str(caught.exception), code)

    def test_lean_divides_holdings_so_half_factor_is_two_for_one(self):
        self.assertEqual(split_ratio('0.5'), (2, 1))
        self.assertEqual(split_ratio('2'), (1, 2))
        self.assertEqual(split_ratio('0.4'), (5, 2))
        self.assertEqual(split_ratio(D('1.5')), (2, 3))

    def test_rounded_factor_is_never_guessed(self):
        self.blocked('SPLIT_FACTOR_ROUNDED_DECLARED_TERMS_REQUIRED', split_ratio, '0.3333333')
        self.assertEqual(split_ratio('0.3333333', dict(numerator=3, denominator=1)), (3, 1))
        self.blocked('SPLIT_FACTOR_CONFLICTS_WITH_DECLARATION', split_ratio, '0.3333333',
                     dict(numerator=2, denominator=1))
        self.blocked('SPLIT_FACTOR_CONFLICTS_WITH_DECLARATION', split_ratio, '0.5',
                     dict(numerator=3, denominator=1))

    def test_invalid_or_unsupported_factors_block(self):
        for bad in ('0', '-0.5', 'nan', 'inf', None, 'x'):
            self.blocked('SPLIT_FACTOR_INVALID', split_ratio, bad)
        self.blocked('SPLIT_RATIO_UNSUPPORTED', split_ratio, '1')
        self.blocked('SPLIT_FACTOR_ROUNDED_DECLARED_TERMS_REQUIRED', split_ratio, '0.0001')
        self.blocked('DECLARED_SPLIT_SCHEMA', split_ratio, '0.5', dict(numerator=2.0, denominator=1))
        self.blocked('DECLARED_SPLIT_SCHEMA', split_ratio, '0.5', dict(numerator=2, denominator=1, x=1))

    def test_mapped_split_and_rename_match_frozen_accounting_receipts(self):
        f = fixture(positions={'id-AAA': 2}, cash=90960, fee=0, slip='0', bid='22.6', ask='22.6')
        self.assertIsNone(map_split(split('0.5', kind=0), security_id='id-AAA', **timing(f)))
        event = map_split(split('0.5'), security_id='id-AAA', **timing(f))
        self.assertEqual(event, dict(event_id='SYNTHETIC-qc-1', security_id='id-AAA', type='split',
                                     numerator=2, denominator=1, effective_at=f['session']['open_at'],
                                     available_at='2026-09-30T22:00:00Z'))
        f['session']['events'] = [event]
        for m in f['session']['close_marks']:
            m['price'] = '22.6'
        r = run(f, [dict(session=f['session'])])
        self.assertEqual(r['state']['positions'], {'id-AAA': 4})
        self.assertEqual(D(r['sessions'][0]['close_nav']), 1000)
        rename = map_symbol_change(NS(old_symbol='AAA', new_symbol='XYZ'), security_id='id-AAA', **timing(f))
        self.assertEqual((rename['type'], rename['old_symbol'], rename['new_symbol']), ('rename', 'AAA', 'XYZ'))

    def test_mapped_split_with_fractional_entitlement_still_fails_accounting(self):
        # LEAN would credit cash-in-lieu at the latest price; frozen v2 must refuse.
        f = fixture(positions={'id-AAA': 3}, cash=90960, fee=0, slip='0', bid='22.6', ask='22.6')
        f['session']['events'] = [map_split(split('2'), security_id='id-AAA', **timing(f))]
        with self.assertRaisesRegex(ValueError, 'Fractional entitlement'):
            run(f, [dict(session=f['session'])])

    def test_dividend_needs_reviewed_terms_and_is_cross_checked(self):
        f = fixture()
        self.blocked('DIVIDEND_TERMS_NOT_SUPPLIED_BY_LEAN', map_dividend, dividend('0.06'),
                     security_id='id-AAA', **timing(f), declared=None)
        event = map_dividend(dividend('0.06'), security_id='id-AAA', **timing(f), declared=declared())
        self.assertEqual((event['type'], event['per_old_share'], event['pay_at']),
                         ('ordinary_cash_dividend', '0.0625', '2026-10-05T10:00:00-04:00'))
        self.blocked('DIVIDEND_AMOUNT_CONFLICT', map_dividend, dividend('0.09'),
                     security_id='id-AAA', **timing(f), declared=declared())
        self.blocked('DIVIDEND_CONVENTION_UNSUPPORTED', map_dividend, dividend('0.06'),
                     security_id='id-AAA', **timing(f), declared=dict(declared(), due_bill=True))
        self.blocked('DECLARED_DIVIDEND_SCHEMA', map_dividend, dividend('0.06'),
                     security_id='id-AAA', **timing(f), declared=dict(declared(), record_at='x'))
        self.blocked('LEAN_DISTRIBUTION_INVALID', map_dividend, dividend('nan'),
                     security_id='id-AAA', **timing(f), declared=declared())

    def test_mapped_dividend_is_accepted_by_frozen_accounting(self):
        f = fixture(fee=0, slip='0')
        f['session']['events'] = [map_dividend(dividend('1'), security_id='id-AAA', **timing(f),
                                               declared=declared('1'))]
        r = run(f)
        self.assertEqual(r['sessions'][0]['events'][0]['kind'], 'dividend_entitlement')

    def test_terminal_events_always_block_never_last_price(self):
        self.assertIsNone(map_delisting(NS(type=0)))
        self.blocked('TERMINAL_EVENT_RECOVERY_NOT_SUPPLIED', map_delisting, NS(type=1))
        self.blocked('EVENT_TYPE_UNREADABLE', map_delisting, NS(type=7))
        self.blocked('EVENT_TYPE_UNREADABLE', map_delisting, NS())

    def test_session_rejects_combined_mismatched_and_terminal_events(self):
        f = fixture(); t = timing(f)
        self.assertEqual(map_session('id-AAA', timing=t), [])
        self.assertEqual(map_session('id-AAA', splits=[split('0.5', 0)], timing=t), [])
        self.assertEqual(len(map_session('id-AAA', splits=[split('0.5')], timing=t)), 1)
        self.blocked('COMBINED_SAME_SESSION_EVENTS', map_session, 'id-AAA', splits=[split('0.5')],
                     dividends=[dividend('0.06')], declared_dividends=[declared()], timing=t)
        self.blocked('DIVIDEND_DECLARATION_MISMATCH', map_session, 'id-AAA',
                     declared_dividends=[declared()], timing=t)
        self.blocked('DIVIDEND_DECLARATION_MISMATCH', map_session, 'id-AAA',
                     dividends=[dividend('0.06')], timing=t)
        self.blocked('SPLIT_DECLARATION_MISMATCH', map_session, 'id-AAA',
                     declared_splits=[dict(numerator=2, denominator=1)], timing=t)
        self.blocked('TERMINAL_EVENT_RECOVERY_NOT_SUPPLIED', map_session, 'id-AAA',
                     delistings=[NS(type=1)], timing=t)
        self.blocked('EVENT_TIMING_SCHEMA', map_session, 'id-AAA', timing=dict(t, extra=1))
        self.blocked('AVAILABLE_AT_REQUIRED', map_session, 'id-AAA', splits=[split('0.5')],
                     timing=dict(t, available_at=''))

    def test_scoring_projection_is_exact_or_blocks(self):
        f = fixture(); t = timing(f)
        two = scoring_action(map_split(split('0.5'), security_id='id-AAA', **t), symbol='AAA',
                             session_date='2026-10-01')
        self.assertEqual((two['split_ratio'], two['cash_dividend_per_old_share']), ('2', '0'))
        self.assertEqual(scoring_action(map_split(split('0.4'), security_id='id-AAA', **t), symbol='AAA',
                                        session_date='2026-10-01')['split_ratio'], '2.5')
        self.blocked('SPLIT_RATIO_NOT_EXACT_DECIMAL', scoring_action,
                     map_split(split('1.5'), security_id='id-AAA', **t), symbol='AAA', session_date='2026-10-01')
        cash = scoring_action(map_dividend(dividend('0.06'), security_id='id-AAA', **t, declared=declared()),
                              symbol='AAA', session_date='2026-10-01')
        self.assertEqual((cash['split_ratio'], cash['cash_dividend_per_old_share']), ('1', '0.0625'))
        rename = map_symbol_change(NS(old_symbol='AAA', new_symbol='XYZ'), security_id='id-AAA', **t)
        self.assertIsNone(scoring_action(rename, symbol='XYZ', session_date='2026-10-01'))

    def test_block_messages_contain_no_vendor_values(self):
        with self.assertRaises(LifecycleBlocked) as caught:
            map_dividend(dividend('0.0917'), security_id='id-SECRET', event_id='e', effective_at='x',
                         available_at='y', declared=declared('0.5'))
        self.assertNotIn('0.0917', str(caught.exception))
        self.assertNotIn('SECRET', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
