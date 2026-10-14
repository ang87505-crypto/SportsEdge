"""Fictional identity transitions; never evidence of historical coverage."""
from copy import deepcopy
from decimal import localcontext, Inexact
import unittest
from analytics.test_stock_candidate_adapter_v1 import ranked_account
from analytics.test_stock_universe_readiness_v1 import sharded, economic_trades
from analytics.test_stock_accounting_v2 import opening, options
from analytics.stock_identity_bridge_v1 import IdentityRegistry, normalize_evidence, checkpoint, plan_identity
from analytics.stock_universe_account_v1 import plan_universe
from analytics.stock_universe_scoring_v1 import score_universe
from analytics.stock_accounting_v2 import close_session
from analytics.stock_readiness_pipeline_v1 import reconcile
from analytics.stock_momentum_v1 import VERSION as BASELINE
from analytics.stock_rank_buffer_candidate import VERSION as CANDIDATE


def inputs():
    f = ranked_account(); e = sharded(f['model']); rows = []
    # Existing fixtures deliberately contain a future bar. The source bridge
    # must receive prior observations only; tests separately exercise rejection.
    for shard in e['shards']:
        shard['payload']['bars'] = [b for b in shard['payload']['bars']
                                    if b['session_date'] < f['session']['date']]
        for b in shard['payload']['bars']:
            b['security_id'] = shard['security_id']
    for u in e['context']['universe']:
        listing = e['listings'][u['security_id']]
        rows.append(dict(**u, effective_from=listing['first_traded_on']+'T00:00:00Z',
            effective_until=None, available_at=e['context']['universe_available_at'],
            source_id='SYNTHETIC-mapping-'+u['security_id'],
            first_traded_on=listing['first_traded_on'],
            first_trade_available_at=listing['available_at'], first_trade_source_id=listing['source_id']))
    return f, e, rows


def rename(e, rows, sid='id-FFF', old='FFF', new='ZZZ'):
    start = e['context']['sessions'][-10]['date']+'T00:00:00Z'
    row = next(r for r in rows if r['security_id'] == sid)
    row['effective_until'] = start
    rows.append(dict(row, symbol=new, effective_from=start, effective_until=None, source_id='SYNTHETIC-rename'))
    for u in e['context']['universe']:
        if u['security_id'] == sid: u['symbol'] = new
    for shard in e['shards']:
        if shard['security_id'] == sid:
            for b in shard['payload']['bars']:
                if b['completed_at'] >= start: b['symbol'] = new


class IdentityTests(unittest.TestCase):
    def test_no_change_matches_existing_scores_and_orders_for_both_strategies(self):
        f, e, rows = inputs(); original = sharded(f['model'])
        normalized, scored, receipt = normalize_evidence(e, rows)
        self.assertEqual(scored['scores'], score_universe(**original)['scores'])
        for strategy in (BASELINE, CANDIDATE):
            actual = plan_identity(f['account'], e, rows, opening(f['session']), selection_strategy=strategy, **options(f))
            expected = plan_universe(f['account'], original, opening(f['session']), selection_strategy=strategy, **options(f))
            self.assertEqual(economic_trades(actual), economic_trades(expected))
            self.assertEqual(actual['open_nav_after'], expected['open_nav_after'])
        self.assertFalse(receipt['source_independently_verified'])

    def test_missing_new_member_mark_admitted_and_reconciled(self):
        f, e, rows = inputs(); original = deepcopy(f['account'])
        f['account']['symbols'].pop('id-AAA'); f['account']['marks'].pop('id-AAA')
        with self.assertRaises(ValueError):
            plan_universe(f['account'], sharded(f['model']), opening(f['session']), selection_strategy=BASELINE, **options(f))
        plan = plan_identity(f['account'], e, rows, opening(f['session']), selection_strategy=BASELINE, **options(f))
        closed = close_session(plan, f['session'])
        self.assertTrue(reconcile(f['account'], dict(state=closed['state'], sessions=[closed]))['all_receipts_reconciled'])
        self.assertEqual(plan['identity_checkpoint']['changes'], [dict(kind='admit_identity', security_id='id-AAA')])
        reference = plan_universe(original, sharded(f['model']), opening(f['session']), selection_strategy=BASELINE, **options(f))
        self.assertEqual(economic_trades(plan), economic_trades(reference))

    def test_held_rename_keeps_permanent_id_shares_cash_and_nav(self):
        f, e, rows = inputs(); before = deepcopy(f['account']); rename(e, rows)
        normalized, scored, _ = normalize_evidence(e, rows)
        state, receipt = checkpoint(f['account'], normalized, scored, rows)
        self.assertEqual(state['symbols']['id-FFF'], 'ZZZ')
        self.assertEqual(state['positions'], before['positions'])
        self.assertEqual(receipt['nav_before'], receipt['nav_after'])
        for q in f['session']['quotes'] + f['session']['close_marks']:
            if q['security_id'] == 'id-FFF': q['symbol'] = 'ZZZ'
        plan = plan_identity(before, e, rows, opening(f['session']), selection_strategy=CANDIDATE, **options(f))
        closed = close_session(plan, f['session'])
        self.assertTrue(reconcile(before, dict(state=closed['state'], sessions=[closed]))['all_receipts_reconciled'])
        self.assertEqual(f['account'], before)

    def test_ticker_reuse_requires_disjoint_intervals(self):
        f, e, rows = inputs(); row = rows[0]; end = row['effective_from']
        retired = dict(row, security_id='old-issuer', effective_from='2000-01-01T00:00:00Z',
                       effective_until=end, first_traded_on='2000-01-01')
        rows.append(retired)
        reg = IdentityRegistry(rows, decision_at=e['decision_at'])
        self.assertEqual(reg.resolve('id-AAA', end)['security_id'], 'id-AAA')
        with self.assertRaises(ValueError): reg.resolve('old-issuer', end)
        rows[-1]['effective_until'] = None
        with self.assertRaisesRegex(ValueError, 'ticker ownership'): IdentityRegistry(rows, decision_at=e['decision_at'])

    def test_retire_unexposed_old_alias_allows_new_issuer_without_transfer(self):
        f, e, rows = inputs(); row = rows[0]
        rows.append(dict(row, security_id='old-issuer', effective_from='2000-01-01T00:00:00Z',
                         effective_until=row['effective_from'], first_traded_on='2000-01-01'))
        f['account']['symbols'].pop('id-AAA'); f['account']['marks'].pop('id-AAA')
        f['account']['symbols']['old-issuer'] = 'AAA'
        normalized, scored, _ = normalize_evidence(e, rows)
        state, receipt = checkpoint(f['account'], normalized, scored, rows)
        self.assertNotIn('old-issuer', state['symbols'])
        self.assertEqual(state['positions'], f['account']['positions'])
        self.assertEqual(receipt['changes'][0]['kind'], 'retire_unexposed_identity')

    def test_adversarial_sources_fail_atomically(self):
        cases = ('wrong_id', 'wrong_ticker', 'late_metadata', 'same_cutoff', 'overlap', 'gap',
                 'exchange', 'sector', 'listing', 'missing_shard', 'future_bar', 'wrong_price',
                 'missing_existing_mark', 'changed_listing', 'future_close')
        for case in cases:
            f, e, rows = inputs()
            if case == 'wrong_id': e['shards'][0]['payload']['bars'][0]['security_id'] = 'id-BBB'
            if case == 'wrong_ticker': e['shards'][0]['payload']['bars'][0]['symbol'] = 'BBB'
            if case in ('late_metadata', 'same_cutoff'): rows[0]['available_at'] = e['decision_at']
            if case == 'overlap': rows.append(deepcopy(rows[0]))
            if case == 'gap':
                rename(e, rows)
                rows[-1]['effective_from'] = e['context']['sessions'][-9]['date']+'T00:00:00Z'
            if case == 'exchange': rows[0]['exchange'] = 'OTC'
            if case == 'sector': rows[0]['sector'] = 'Different'
            if case == 'listing': rows[0]['first_traded_on'] = '1990-01-01'
            if case == 'missing_shard': e['shards'].pop()
            if case == 'future_bar': e['shards'][0]['payload']['bars'][-1]['completed_at'] = e['decision_at']
            if case == 'wrong_price': f['account']['marks']['id-AAA']['price'] = '999'
            if case == 'missing_existing_mark': f['account']['marks'].pop('id-AAA')
            if case == 'changed_listing':
                rename(e, rows); rows[-1]['first_traded_on'] = '1990-01-01'
            session = f['session'] if case == 'future_close' else opening(f['session'])
            snapshot = deepcopy((f, e, rows))
            with self.subTest(case=case), self.assertRaises(ValueError):
                plan_identity(f['account'], e, rows, session, selection_strategy=BASELINE, **options(f))
            self.assertEqual((f, e, rows), snapshot)

    def test_held_delisted_security_cannot_be_dropped(self):
        f, e, rows = inputs()
        e['context']['universe'] = [u for u in e['context']['universe'] if u['security_id'] != 'id-FFF']
        e['shards'] = [s for s in e['shards'] if s['security_id'] != 'id-FFF']; e['listings'].pop('id-FFF')
        normalized, scored, _ = normalize_evidence(e, rows)
        with self.assertRaisesRegex(ValueError, 'position/claim'):
            checkpoint(f['account'], normalized, scored, rows)

    def test_unsupported_terminal_events_still_fail(self):
        for kind in ('delisting', 'merger', 'spinoff'):
            f, e, rows = inputs()
            f['session']['events'] = [dict(type=kind, event_id='SYNTHETIC-terminal', security_id='id-FFF',
                effective_at=f['session']['open_at'], available_at='2026-09-30T22:00:00Z')]
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'Unsupported corporate event'):
                plan_identity(f['account'], e, rows, opening(f['session']), selection_strategy=BASELINE, **options(f))

    def test_fractional_split_and_combined_events_still_fail(self):
        for mode in ('fractional', 'combined'):
            f, e, rows = inputs()
            event = dict(type='split', event_id='SYNTHETIC-split', security_id='id-FFF',
                effective_at=f['session']['open_at'], available_at='2026-09-30T22:00:00Z',
                numerator=1, denominator=3 if mode == 'fractional' else 1)
            f['session']['events'] = [event]
            if mode == 'combined': f['session']['events'].append(dict(event, event_id='SYNTHETIC-second'))
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, 'Fractional|Combined'):
                plan_identity(f['account'], e, rows, opening(f['session']), selection_strategy=BASELINE, **options(f))

    def test_security_conversion_cannot_be_hidden_as_a_rename(self):
        f, e, rows = inputs(); rename(e, rows)
        rows[-1]['type'] = 'preferred_stock'
        with self.assertRaisesRegex(ValueError, 'conversion'): normalize_evidence(e, rows)

    def test_registry_order_and_decimal_context_do_not_change_result(self):
        f, e, rows = inputs(); expected = normalize_evidence(e, rows)
        rows.reverse()
        with localcontext() as ctx:
            ctx.prec = 6; ctx.traps[Inexact] = True
            self.assertEqual(normalize_evidence(e, rows), expected)


if __name__ == '__main__': unittest.main()
