"""Synthetic evidence only: no historical outcomes or market-data export."""
import copy
import unittest
from datetime import date, datetime, timedelta
from decimal import Decimal as D
from types import SimpleNamespace as NS
from zoneinfo import ZoneInfo

try:
    from .selection import BASELINE, CANDIDATE, SourceNotReady, evaluate_month
    from .source_bridge import REQUIRED_REVIEWS, normalize_member, research_decision
    from .test_selection import fixture
except ImportError:
    from selection import BASELINE, CANDIDATE, SourceNotReady, evaluate_month
    from source_bridge import REQUIRED_REVIEWS, normalize_member, research_decision
    from test_selection import fixture


def source_fixture():
    original = fixture()
    days, day = [], date(2011, 8, 31)
    while len(days) < 253:
        if day.weekday() < 5:
            days.append(day)
        day -= timedelta(days=1)
    days.reverse()  # Deliberately synthetic calendar, not source verification.
    ny = ZoneInfo('America/New_York')
    def stamp(day, minute=0):
        return datetime(day.year, day.month, day.day, 16, minute, tzinfo=ny).isoformat()
    original['sessions'] = [dict(date=d.isoformat(), close_at=stamp(d)) for d in days]
    original['decision_at'] = '2011-09-01T08:00:00-04:00'
    original['next_session'] = dict(date='2011-09-01', open_at='2011-09-01T09:30:00-04:00')
    for member in original['universe']:
        member['first_trade_available_at'] = '1999-01-01T00:00:00Z'
        for row, d in zip(member['bars'], days):
            row.update(date=d.isoformat(), completed_at=stamp(d), available_at=stamp(d, 1))
    members = []
    for member in original['universe']:
        symbol = NS(id=member['security_id'], value=member['symbol'])
        metadata = {k: v for k, v in member.items() if k not in ('bars', 'first_trade_available_at')}
        metadata.update(effective_from='1999-01-01T00:00:00Z', lifecycle_status='ordinary',
                        evidence={k: dict(reference='synthetic', available_at='1999-01-01T00:00:00Z')
                                  for k in ('membership', 'sector', 'exchange', 'type', 'first_trade')})
        observations = [dict(bar=NS(symbol=symbol, close=D(b['close']), volume=b['volume'], is_fill_forward=False),
                             session_date=b['date'], completed_at=b['completed_at'],
                             available_at=b['available_at'], availability_evidence='synthetic',
                             action=dict(kind='none', evidence='synthetic', available_at=b['available_at']))
                        for b in member['bars']]
        members.append(dict(symbol=symbol, metadata=metadata, observations=observations))
    manifest = dict(dataset_vintage='SYNTHETIC', lean_version='mock', reviewer='test only',
                    snapshot_sha256='a'*64, normalization='RAW', volume_basis='CONSOLIDATED',
                    runtime_scope='separately_licensed_local', complete_membership=True,
                    reviews={k: 'synthetic' for k in REQUIRED_REVIEWS},
                    expected_security_ids=[m['security_id'] for m in original['universe']])
    args = {k: v for k, v in original.items() if k not in ('universe', 'source_complete')}
    args.update(manifest=manifest, members=members)
    return args, original


class SourceBridgeTests(unittest.TestCase):
    def test_full_pipeline_parity_both_frozen_strategies(self):
        for strategy in (BASELINE, CANDIDATE):
            args, original = source_fixture()
            args.update(strategy_version=strategy, incumbent_ids=('id-F',))
            original.update(strategy_version=strategy, incumbent_ids=('id-F',))
            actual, expected = research_decision(**args), evaluate_month(**original)
            for key in ('scores', 'targets', 'cash_target_cents', 'known_short_history'):
                self.assertEqual(actual[key], expected[key])
            self.assertFalse(actual['historical_study_ready'])
            self.assertFalse(actual['source_independently_verified'])
            self.assertIsNone(actual['performance'])

    def test_split_factor_is_inverse_share_ratio(self):
        args, _ = source_fixture()
        member = args['members'][0]
        for factor, ratio in [('0.5', D(2)), ('5', D('0.2'))]:
            member['observations'][100]['action'].update(kind='split_occurred', lean_split_factor=factor)
            result = normalize_member(**member, sessions=args['sessions'], decision_at=args['decision_at'])
            self.assertEqual(D(result['bars'][100]['split_ratio']), ratio)

    def test_dividend_does_not_become_payable_cash(self):
        args, _ = source_fixture()
        args['members'][0]['observations'][100]['action'].update(
            kind='dividend', distribution='1.25', share_basis='pre_event_share')
        member = normalize_member(**args['members'][0], sessions=args['sessions'], decision_at=args['decision_at'])
        self.assertEqual(member['bars'][100]['cash_dividend_per_old_share'], '1.25')
        self.assertNotIn('payable_at', member['bars'][100])

    def test_fail_closed_adversarial_evidence(self):
        def mutate(args, case):
            m = args['members'][0]; obs = m['observations'][-1]
            if case == 'missing_security': args['members'].pop()
            elif case == 'duplicate_security': args['members'].append(copy.deepcopy(m))
            elif case == 'adjusted': args['manifest']['normalization'] = 'ADJUSTED'
            elif case == 'iex': args['manifest']['volume_basis'] = 'IEX'
            elif case == 'review': del args['manifest']['reviews']['calendar']
            elif case == 'vintage': args['manifest']['dataset_vintage'] = ''
            elif case == 'bar_missing': m['observations'].pop()
            elif case == 'fill_forward': obs['bar'].is_fill_forward = True
            elif case == 'metadata_future': m['metadata']['evidence']['sector']['available_at'] = args['decision_at']
            elif case == 'metadata_expired': m['metadata']['effective_until'] = args['decision_at']
            elif case == 'listing': del m['metadata']['first_traded_on']
            elif case == 'identity': obs['bar'] = NS(symbol=NS(id='wrong'), close=D(10), volume=100, is_fill_forward=False)
            elif case == 'bar_future': obs['available_at'] = args['decision_at']
            elif case == 'action_future': obs['action']['available_at'] = args['decision_at']
            elif case == 'action_missing': del obs['action']
            elif case == 'no_evidence': obs['availability_evidence'] = ''
            elif case == 'negative_volume': obs['bar'].volume = -1
            elif case == 'fractional_volume': obs['bar'].volume = D('1.1')
            elif case == 'nan_volume': obs['bar'].volume = D('NaN')
            elif case == 'nan_price': obs['bar'].close = D('NaN')
            elif case == 'lifecycle': m['metadata']['lifecycle_status'] = 'delisted'
            elif case == 'validation': args['decision_at'] = '2012-01-03T08:00:00-05:00'
            elif case == 'sealed': args['decision_at'] = '2017-01-03T08:00:00-05:00'
            elif case == 'dividend_basis': obs['action'].update(kind='dividend', distribution='1', share_basis='unknown')
            else: obs['action']['kind'] = case
        for case in ('missing_security', 'duplicate_security', 'adjusted', 'iex', 'review', 'vintage',
                     'bar_missing', 'fill_forward', 'metadata_future', 'metadata_expired', 'listing',
                     'identity', 'bar_future', 'action_future', 'action_missing', 'no_evidence',
                     'negative_volume', 'fractional_volume', 'nan_volume', 'nan_price', 'lifecycle',
                     'validation', 'sealed', 'dividend_basis', 'split_warning', 'merger', 'spinoff',
                     'split_and_dividend', 'delisting'):
            args, _ = source_fixture(); mutate(args, case)
            with self.subTest(case=case), self.assertRaises(SourceNotReady):
                research_decision(**args)


if __name__ == '__main__':
    unittest.main()
