"""SYNTHETIC ONLY: fictional IDs, tickers, vendor codes and calendar.

Vendor codes below are invented placeholders, NOT real Morningstar codes; the
real mapping is a reviewed input. Every built registry is re-validated by the
unchanged frozen IdentityRegistry.
"""
from datetime import date, timedelta
import unittest
from analytics.stock_identity_bridge_v1 import IdentityRegistry
from integrations.quantconnect.qc_identity_registry_v1 import (
    IdentityBlocked, build_records, left_censor_is_harmless)

MAPPING = dict(reference='SYNTHETIC-mapping-review',
               exchange={'SYN-NY': 'NYSE', 'SYN-NQ': 'NASDAQ'},
               security_type={'SYN-COMMON': 'common_stock'},
               sector={1: 'Synthetic Sector A', 2: 'Synthetic Sector B'})
DECISION = '2000-03-01T08:00:00-05:00'
START = [('1998-01-02T00:00:00-05:00', 'AAA')]


def row(symbol='AAA', *, exchange='SYN-NY', kind='SYN-COMMON', adr=False, sector=1, ipo=None):
    return dict(symbol=symbol, exchange_code=exchange, security_type_code=kind,
                is_depositary_receipt=adr, sector_code=sector, ipo_date=ipo)


def snap(day, value):
    # asof = vendor EndTime at the prior close; observed = midnight read.
    return dict(asof_at=f'{day}T16:00:00-05:00',
                observed_at=(date.fromisoformat(day) + timedelta(days=1)).isoformat() + 'T00:00:00-05:00',
                row=value)


def build(snaps, history=START, first='1998-01-02', **kwargs):
    kwargs.setdefault('decision_at', DECISION)
    return build_records('SYN-ID-1', sid_first_date=first, coverage_start='1998-01-02',
                         ticker_history=history, snapshots=snaps, mapping=MAPPING,
                         dataset_revision='SYNTHETIC-rev', **kwargs)


MONTHS = ['1999-11-30', '1999-12-31', '2000-01-31', '2000-02-29']


class IdentityRegistryBuilderTests(unittest.TestCase):
    def blocked(self, code, fn, *args, **kwargs):
        with self.assertRaises(IdentityBlocked) as caught:
            fn(*args, **kwargs)
        self.assertEqual(str(caught.exception), code)

    def test_stable_member_is_one_open_censored_record(self):
        records = build([snap(d, row()) for d in MONTHS])
        self.assertEqual(len(records), 1)
        r = records[0]
        self.assertEqual((r['effective_from'], r['effective_until']), ('1999-11-30T16:00:00-05:00', None))
        self.assertEqual(r['first_trade_source_id'], 'qc-sid-first-mapfile-date:left_censored')
        self.assertTrue(r['source_id'].endswith(':vendor_asof_unverified'))
        registry = IdentityRegistry(records, decision_at=DECISION)
        self.assertEqual(registry.resolve('SYN-ID-1', '2000-02-29T16:00:00-05:00')['sector'], 'Synthetic Sector A')

    def test_block_policy_refuses_lookback_before_first_observation(self):
        registry = IdentityRegistry(build([snap(d, row()) for d in MONTHS]), decision_at=DECISION)
        with self.assertRaises(ValueError):
            registry.continuous('SYN-ID-1', '1999-03-01T16:00:00-05:00', '2000-02-29T16:00:00-05:00')

    def test_carry_back_is_explicit_and_tagged(self):
        records = build([snap(d, row()) for d in MONTHS], policy='carry_back_first_observation')
        self.assertEqual(records[0]['effective_from'], '1998-01-02T00:00:00-05:00')
        self.assertTrue(records[0]['source_id'].endswith(':carried_back_unverified'))
        IdentityRegistry(records, decision_at=DECISION).continuous(
            'SYN-ID-1', '1999-03-01T16:00:00-05:00', '2000-02-29T16:00:00-05:00')
        self.blocked('UNKNOWN_POLICY', build, [snap(d, row()) for d in MONTHS], policy='guess')

    def test_rename_boundary_is_map_file_date_not_snapshot(self):
        history = START + [('1999-12-15T00:00:00-05:00', 'BBB')]
        records = build([snap(MONTHS[0], row()), *[snap(d, row('BBB')) for d in MONTHS[1:]]], history)
        self.assertEqual([r['symbol'] for r in records], ['AAA', 'BBB'])
        self.assertEqual(records[0]['effective_until'], '1999-12-15T00:00:00-05:00')
        self.assertEqual(records[0]['available_at'], '2000-01-01T00:00:00-05:00')
        registry = IdentityRegistry(records, decision_at=DECISION)
        self.assertEqual(registry.resolve('SYN-ID-1', '1999-12-14T16:00:00-05:00')['symbol'], 'AAA')
        self.assertEqual(registry.resolve('SYN-ID-1', '1999-12-15T16:00:00-05:00')['symbol'], 'BBB')

    def test_ticker_conflicts_block(self):
        self.blocked('TICKER_HISTORY_DISAGREES_WITH_SNAPSHOT', build,
                     [snap(MONTHS[0], row()), snap(MONTHS[1], row('BBB'))])
        history = START + [('1999-12-10T00:00:00-05:00', 'CCC'), ('1999-12-20T00:00:00-05:00', 'BBB')]
        self.blocked('TICKER_CHANGE_NOT_UNIQUELY_DATED', build,
                     [snap(MONTHS[0], row()), snap(MONTHS[1], row('BBB'))], history)
        self.blocked('TICKER_HISTORY_INVALID', build, [snap(MONTHS[0], row())],
                     [('1998-02-02T00:00:00-05:00', 'AAA')])

    def test_exit_ends_interval_and_terminal_date_must_fall_in_window(self):
        snaps = [snap(MONTHS[0], row()), snap(MONTHS[1], row()), snap(MONTHS[2], None)]
        r = build(snaps)[0]
        self.assertEqual((r['effective_until'], r['available_at']),
                         ('2000-01-31T16:00:00-05:00', '2000-02-01T00:00:00-05:00'))
        r = build(snaps, terminal_at='2000-01-14T16:00:00-05:00')[0]
        self.assertEqual(r['effective_until'], '2000-01-14T16:00:00-05:00')
        self.blocked('TERMINAL_DATE_OUTSIDE_EXIT_WINDOW', build, snaps,
                     terminal_at='1999-12-01T16:00:00-05:00')

    def test_reappearance_after_gap_leaves_frozen_continuity_gap(self):
        snaps = [snap(MONTHS[0], row()), snap(MONTHS[1], None), snap(MONTHS[2], row()), snap(MONTHS[3], row())]
        records = build(snaps, policy='carry_back_first_observation')
        self.assertEqual(len(records), 2)
        registry = IdentityRegistry(records, decision_at=DECISION)
        with self.assertRaises(ValueError):
            registry.continuous('SYN-ID-1', '1999-11-30T16:00:00-05:00', '2000-02-29T16:00:00-05:00')

    def test_out_of_scope_rows_are_not_members_but_unmapped_sector_blocks(self):
        self.blocked('NO_IN_SCOPE_OBSERVATION', build, [snap(d, row(adr=True)) for d in MONTHS])
        self.blocked('NO_IN_SCOPE_OBSERVATION', build, [snap(d, row(kind='SYN-PREF')) for d in MONTHS])
        moved = build([snap(MONTHS[0], row()), snap(MONTHS[1], row(exchange='SYN-OTC'))])
        self.assertEqual(moved[0]['effective_until'], '1999-12-31T16:00:00-05:00')
        self.blocked('SECTOR_UNMAPPED_FOR_IN_SCOPE_MEMBER', build, [snap(MONTHS[0], row(sector=99))])

    def test_classification_change_starts_at_vendor_asof(self):
        records = build([snap(MONTHS[0], row()), snap(MONTHS[1], row(sector=2))])
        self.assertEqual([r['sector'] for r in records], ['Synthetic Sector A', 'Synthetic Sector B'])
        self.assertEqual(records[0]['effective_until'], records[1]['effective_from'])
        self.assertEqual(records[0]['available_at'], '2000-01-01T00:00:00-05:00')

    def test_snapshots_at_or_after_decision_are_never_read(self):
        future = dict(snap('2000-03-01', row(sector=2)), observed_at=DECISION)
        records = build([snap(d, row()) for d in MONTHS] + [future])
        self.assertEqual([r['sector'] for r in records], ['Synthetic Sector A'])

    def test_first_trade_conflicts_block(self):
        history = [('1999-03-01T00:00:00-05:00', 'AAA')]
        ok = build([snap(d, row(ipo='1999-03-01')) for d in MONTHS], history, first='1999-03-01')
        self.assertEqual(ok[0]['first_trade_source_id'], 'qc-sid-first-mapfile-date')
        self.blocked('FIRST_TRADE_DATE_CONFLICT', build, [snap(MONTHS[0], row(ipo='1999-02-26'))],
                     history, first='1999-03-01')
        self.blocked('FIRST_TRADE_DATE_CONFLICT', build, [snap(MONTHS[0], row(ipo='1999-06-01'))])

    def test_mapping_is_a_reviewed_input(self):
        for bad in (dict(MAPPING, reference=''), dict(MAPPING, sector={}), {k: MAPPING[k] for k in ('exchange',)}):
            self.blocked('REVIEWED_MAPPING_REQUIRED', build_records, 'SYN-ID-1', sid_first_date='1998-01-02',
                         coverage_start='1998-01-02', ticker_history=START, snapshots=[], mapping=bad,
                         decision_at=DECISION, dataset_revision='r')
        bad = dict(MAPPING, exchange={'SYN-OTC': 'OTC'})
        self.blocked('MAPPING_TARGET_INVALID', build_records, 'SYN-ID-1', sid_first_date='1998-01-02',
                     coverage_start='1998-01-02', ticker_history=START, snapshots=[], mapping=bad,
                     decision_at=DECISION, dataset_revision='r')

    def test_left_censoring_harmless_only_with_full_lookback(self):
        days, d = [], date(1998, 1, 2)
        while d <= date(2000, 2, 1):
            if d.weekday() < 5:
                days.append(d.isoformat())
            d += timedelta(days=1)
        self.assertTrue(left_censor_is_harmless('1998-01-02', days, '2000-02-01'))
        self.assertFalse(left_censor_is_harmless('1999-06-01', days, '2000-02-01'))
        self.blocked('CALENDAR_INVALID', left_censor_is_harmless, '1998-01-02', days[::-1], '2000-02-01')


if __name__ == '__main__':
    unittest.main()
