"""SYNTHETIC ONLY: the existing stream fixture rebuilt through the QC assembler.

The PR #50/#53 synthetic fixture is decomposed into the inputs QC would
supply (lookback-format raw bars, reviewed calendar, explicit availability,
identity records, mapper events) and reassembled. No LEAN, vendor data,
orders or network access.
"""
from copy import deepcopy
from decimal import Decimal
import re
from types import SimpleNamespace as NS
import unittest
from analytics.stock_accounting_v2 import amount
from analytics.stock_development_runner_v1 import run_bundle
from analytics.stock_universe_scoring_v1 import score_universe
from analytics.test_stock_identity_stream_v1 import fixture, source_rows, stream
from integrations.quantconnect import qc_stream_rows_v1 as qr
from integrations.quantconnect.qc_lifecycle_mapper_v1 import map_session, scoring_action
from integrations.quantconnect.qc_stream_rows_v1 import StreamRowBlocked

CODE = re.compile(r'[A-Z0-9_]+\Z')
PROVENANCE = sorted(qr.PROVENANCE)


def lookback_bar(b):
    return dict(session_date=b['session_date'], lean_history_index_time=b['session_date'] + 'T16:00:00',
                open=b['open'], high=b['high'], low=b['low'], close=b['close'], volume=b['volume'])


def lookback(sid, bars):
    return dict(security_id=sid, requested_ticker=bars[-1]['symbol'], bars=[lookback_bar(b) for b in bars],
                requested_raw_unadjusted=True, requested_fill_forward=False,
                historical_source_admitted=False, performance=None)


def decision_inputs(data, row):
    """build_evidence kwargs that a QC caller would hold for this decision."""
    e = row['evidence']; c = e['context']; meta = e['shards'][0]['payload']
    availability = {}
    for shard in e['shards']:
        for b in shard['payload']['bars']:
            assert availability.setdefault(b['session_date'], b['available_at']) == b['available_at']
    records = {}
    for r in row['identity_records']:
        records.setdefault(r['security_id'], []).append(r)
    return dict(calendar=data['calendar'], decision_at=e['decision_at'],
                members=[u['security_id'] for u in c['universe']],
                lookbacks={s['security_id']: lookback(s['security_id'], s['payload']['bars']) for s in e['shards']},
                identity_records=records, actions=[], bar_available_at=availability,
                source={k: meta[k] for k in qr.SOURCE}, provenance={k: c[k] for k in PROVENANCE})


def session_inputs(data, row, members, history):
    """build_session kwargs; history = the latest decision's per-member bars."""
    s = row['session']; q = s['quotes'][0]; m = s['close_marks'][0]
    marks = {x['security_id']: x for x in s['close_marks']}
    bars = {}
    for x in s['quotes']:
        o, c = x['bid'], marks[x['security_id']]['price']
        bars[x['security_id']] = dict(session_date=s['date'], lean_history_index_time=s['date'] + 'T16:00:00',
            open=o, high=max(o, c, key=Decimal), low=min(o, c, key=Decimal), close=c, volume=2000000)
    return dict(calendar=data['calendar'], session_date=s['date'], kind=s['kind'], members=members,
                symbols={x['security_id']: x['symbol'] for x in s['quotes']}, session_bars=bars,
                volume_history={sid: [b for b in history[sid] if b['session_date'] < s['date']] for sid in members},
                split_actions=[], events=deepcopy(s['events']), actions_available_at=s['actions_available_at'],
                execution=dict(observed_at=q['observed_at'], available_at=q['available_at'],
                               bid_size=q['bid_size'], ask_size=q['ask_size']),
                volume_available_at=q['volume_available_at'], close_available_at=m['available_at'])


def assemble(data):
    """Rows rebuilt only from QC-shaped inputs, in stream order."""
    expected = list(source_rows(data))
    decisions = [r for r in expected if 'evidence' in r]
    # Raw bars through the last pre-decision close, as a QC caller would retain.
    final = decision_inputs(data, decisions[-1])
    history = {sid: lb['bars'] for sid, lb in final['lookbacks'].items()}
    rows = []; built = None
    for row in expected:
        if 'evidence' in row:
            built = qr.build_evidence(**decision_inputs(data, row))
        members = [u['security_id'] for u in built['evidence']['context']['universe']]
        session = qr.build_session(**session_inputs(data, row, members, history))
        rows.append(qr.build_row(session, built if 'evidence' in row else None))
    return rows, expected


def blocked(test, code, fn, *args, **kwargs):
    with test.assertRaises(StreamRowBlocked) as caught:
        fn(*args, **kwargs)
    test.assertEqual((caught.exception.code, str(caught.exception)), (code, code))
    test.assertRegex(code, CODE)


class ParityTests(unittest.TestCase):
    def test_assembled_rows_equal_fixture_rows_exactly(self):
        rows, expected = assemble(fixture())
        self.assertEqual(len(rows), len(expected))
        for got, want in zip(rows, expected):
            self.assertEqual(got, want)

    def test_assembled_rows_reproduce_stream_fixture_statistics(self):
        data = fixture(); reference = run_bundle(data, synthetic=True); rows, _ = assemble(data)
        s = stream(data)
        for row in rows:
            s.accept(row)
        result = s.finish({}, None)
        self.assertEqual(result['kind'], 'SYNTHETIC_ENGINEERING_ONLY')
        self.assertIsNone(result['performance'])
        self.assertFalse(result['source_independently_verified'] or result['historical_study_approved'])
        for want, got in zip(reference['engineering_scenarios'], result['engineering_scenarios']):
            for name in ('baseline', 'candidate'):
                self.assertEqual(got[name]['statistics'], want[name]['statistics'])
                self.assertTrue(got[name]['all_receipts_reconciled'])
        expected = stream(data)
        for row in source_rows(data):
            expected.accept(row)
        self.assertEqual(result, expected.finish({}, None))

    def test_253_session_lookback_alone_gives_same_scoring_report(self):
        data = fixture(); row = [r for r in source_rows(data) if 'evidence' in r][-1]
        full = decision_inputs(data, row); short = deepcopy(full)
        for lb in short['lookbacks'].values():
            lb['bars'] = lb['bars'][-253:]
        a = score_universe(**qr.build_evidence(**full)['evidence'])
        b = score_universe(**qr.build_evidence(**short)['evidence'])
        self.assertEqual(a['report_id'], b['report_id'])
        self.assertEqual(a['prior_inputs'], b['prior_inputs'])


class AdversarialTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture()
        self.rows = list(source_rows(self.data))
        self.decision = decision_inputs(self.data, self.rows[0])
        self.members = self.decision['members']
        final = decision_inputs(self.data, self.rows[-1])
        self.history = {sid: lb['bars'] for sid, lb in final['lookbacks'].items()}

    def session(self, index=0):
        return session_inputs(self.data, self.rows[index], self.members, self.history)

    def test_missing_quote_bar_blocks_whole_session(self):
        args = self.session(3); args['session_bars'].pop(self.members[4])
        blocked(self, 'MISSING_SESSION_BAR', qr.build_session, **args)
        args = self.session(3); args['volume_history'].pop(self.members[0])
        blocked(self, 'MEMBER_VOLUME_HISTORY_MISSING', qr.build_session, **args)
        args = self.session(3); args['session_bars']['SYNTHETIC-not-member'] = args['session_bars'][self.members[0]]
        blocked(self, 'SESSION_BAR_FOR_NON_MEMBER', qr.build_session, **args)
        args = self.session(3); args['session_bars'][self.members[0]]['session_date'] = self.rows[2]['session']['date']
        blocked(self, 'SESSION_BAR_DATE_MISMATCH', qr.build_session, **args)

    def test_dropped_quote_for_held_security_rejected_by_unchanged_stream(self):
        rows, _ = assemble(self.data); s = stream(self.data); s.accept(rows[0])
        held = set().union(*(set(c['state']['positions']) for c in s.cases))
        row = deepcopy(rows[1])
        row['session']['quotes'] = [q for q in row['session']['quotes'] if q['security_id'] not in held]
        with self.assertRaisesRegex(ValueError, 'Missing held-security open'):
            s.accept(row)

    def test_bid_not_equal_ask_rejected_by_assembler_and_stream(self):
        session = qr.build_session(**self.session(1))
        bad = deepcopy(session); bad['quotes'][0]['ask'] = str(Decimal(bad['quotes'][0]['bid']) + Decimal('0.01'))
        blocked(self, 'QUOTE_NOT_UNSPREAD_RAW_OPEN', qr.validate_session, bad)
        blocked(self, 'QUOTE_NOT_UNSPREAD_RAW_OPEN', qr.build_row, bad)
        rows, _ = assemble(self.data); s = stream(self.data); s.accept(rows[0])
        row = deepcopy(rows[1]); row['session'] = bad
        with self.assertRaisesRegex(ValueError, 'Unspread raw-open'):
            s.accept(row)

    def test_fractional_era_open_blocks_before_frozen_precision_failure(self):
        args = self.session(1); bar = args['session_bars'][self.members[0]]
        bar.update(open='47.4375', high='99.99', low='47.4375')
        blocked(self, 'OPEN_PRICE_PRECISION_EXCEEDS_FROZEN_SPREAD_BOUND', qr.build_session, **args)
        # The unchanged stream spread would leave 8 decimals, which v2 rejects.
        with self.assertRaisesRegex(ValueError, 'precision'):
            amount(str(Decimal('47.4375') * Decimal('0.9995')))

    def test_late_or_missing_availability_blocks(self):
        last = self.rows[0]['evidence']['context']['universe_session']
        args = deepcopy(self.decision); args['bar_available_at'][last] = self.decision['decision_at']
        blocked(self, 'BAR_AVAILABLE_AT_OR_AFTER_DECISION', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['bar_available_at'].pop(last)
        blocked(self, 'BAR_AVAILABILITY_NOT_SUPPLIED', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['bar_available_at'][last] = last + 'T15:00:00-04:00'
        blocked(self, 'BAR_AVAILABLE_BEFORE_CLOSE', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['provenance']['universe_available_at'] = self.decision['decision_at']
        blocked(self, 'PROVENANCE_AVAILABLE_AT_OR_AFTER_DECISION', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['identity_records'][self.members[2]][0]['available_at'] = '2026-10-01T13:00:00Z'
        blocked(self, 'IDENTITY_RECORDS_REJECTED', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['source']['retrieved_at'] = '2026-10-01T11:00:00Z'
        blocked(self, 'RETRIEVED_BEFORE_DECISION', qr.build_evidence, **args)
        open_at = self.rows[1]['session']['open_at']
        for key, value, code in (('actions_available_at', open_at, 'ACTIONS_AVAILABLE_AT_OR_AFTER_OPEN'),
                                 ('volume_available_at', open_at, 'VOLUME_AVAILABLE_AT_OR_AFTER_OPEN'),
                                 ('volume_available_at', '2026-10-01T15:00:00-04:00', 'VOLUME_AVAILABLE_BEFORE_PRIOR_CLOSE'),
                                 ('close_available_at', '2026-10-02T15:59:00-04:00', 'CLOSE_MARK_AVAILABLE_BEFORE_COMPLETION')):
            with self.subTest(key=key, code=code):
                args = self.session(1); args[key] = value
                blocked(self, code, qr.build_session, **args)
        args = self.session(1); args['execution']['available_at'] = '2026-10-02T09:31:00-04:00'
        blocked(self, 'EXECUTION_PROXY_TIMING_INVALID', qr.build_session, **args)
        args = self.session(1); args['execution'].pop('bid_size')
        blocked(self, 'EXECUTION_PROXY_SCHEMA', qr.build_session, **args)

    def test_missing_or_extra_members_block(self):
        args = deepcopy(self.decision); args['lookbacks'].pop(self.members[5])
        blocked(self, 'MEMBER_LOOKBACK_MISSING', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['identity_records'].pop(self.members[5])
        blocked(self, 'MEMBER_IDENTITY_RECORDS_MISSING', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['members'] = self.members[:-1]
        blocked(self, 'LOOKBACK_FOR_NON_MEMBER', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['members'] = self.members + [self.members[0]]
        blocked(self, 'DUPLICATE_MEMBER', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['lookbacks'][self.members[1]]['security_id'] = self.members[2]
        blocked(self, 'LOOKBACK_SECURITY_MISMATCH', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['lookbacks'][self.members[1]]['historical_source_admitted'] = True
        blocked(self, 'LOOKBACK_NOT_RAW_UNADMITTED', qr.build_evidence, **args)

    def test_extra_missing_or_unreviewed_sessions_block(self):
        args = deepcopy(self.decision); bars = args['lookbacks'][self.members[0]]['bars']
        bars.insert(100, dict(bars[100], session_date='2026-02-14'))  # a Saturday; not reviewed
        blocked(self, 'BAR_DATES_DISAGREE_WITH_REVIEWED_CALENDAR', qr.build_evidence, **args)
        args = deepcopy(self.decision); del args['lookbacks'][self.members[0]]['bars'][100]
        blocked(self, 'BAR_DATES_DISAGREE_WITH_REVIEWED_CALENDAR', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['lookbacks'][self.members[0]]['bars'].pop()
        blocked(self, 'LOOKBACK_NOT_THROUGH_PRIOR_CLOSE', qr.build_evidence, **args)
        # A bar the reviewed calendar lacks is never accepted as a session.
        args = decision_inputs(self.data, self.rows[-1])
        args['calendar'] = dict(args['calendar'], sessions=[s for s in args['calendar']['sessions']
                                                            if s['date'] != '2026-03-10'])
        blocked(self, 'BAR_DATES_DISAGREE_WITH_REVIEWED_CALENDAR', qr.build_evidence, **args)
        args = self.session(1); args['session_date'] = '2026-10-03'
        blocked(self, 'SESSION_NOT_IN_REVIEWED_CALENDAR', qr.build_session, **args)
        args = deepcopy(self.decision); args['decision_at'] = '2026-10-02T12:00:00Z'
        blocked(self, 'DECISION_NOT_FIRST_MONTHLY_SESSION', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['decision_at'] = '2026-10-01T13:00:00Z'
        blocked(self, 'DECISION_NOT_0800_NEW_YORK', qr.build_evidence, **args)
        args = deepcopy(self.decision); args['calendar'] = dict(args['calendar'], coverage_complete=False)
        blocked(self, 'REVIEWED_CALENDAR_INVALID', qr.build_evidence, **args)
        rows, _ = assemble(self.data); s = stream(self.data)
        with self.assertRaisesRegex(ValueError, 'exchange session'):
            for row in rows + [deepcopy(rows[-1])]:
                s.accept(row)

    def test_decision_row_pairing(self):
        built = qr.build_evidence(**self.decision); session = qr.build_session(**self.session(1))
        blocked(self, 'DECISION_SESSION_MISMATCH', qr.build_row, session, built)
        self.assertEqual(set(qr.build_row(session)), {'session'})

    def test_codes_never_contain_identifiers_or_values(self):
        args = self.session(3); args['session_bars'].pop(self.members[4])
        with self.assertRaises(StreamRowBlocked) as caught:
            qr.build_session(**args)
        for secret in (self.members[4], 'EEE', '2026', '47.72'):
            self.assertNotIn(secret, str(caught.exception))


class Lean:  # fake LEAN corporate-action objects, synthetic values
    split = NS(type=1, split_factor=0.5)
    rename = NS(old_symbol='AAA', new_symbol='AAB')


class MapperInteropTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture(); self.rows = list(source_rows(self.data))
        final = decision_inputs(self.data, self.rows[-1])
        self.members = final['members']; self.history = {sid: lb['bars'] for sid, lb in final['lookbacks'].items()}

    def session(self, index, events):
        args = session_inputs(self.data, self.rows[index], self.members, self.history)
        args['events'] = events
        return args

    def timing(self, index, **override):
        s = self.rows[index]['session']
        return dict(dict(event_id='SYNTHETIC-event', effective_at=s['open_at'],
                         available_at=s['actions_available_at']), **override)

    def test_mapper_split_and_rename_enter_session(self):
        split = map_session('id-BBB', splits=[Lean.split], timing=self.timing(4))
        session = qr.build_session(**self.session(4, split))
        self.assertEqual(session['events'][0]['numerator'], 2)
        rename = map_session('id-AAA', symbol_changes=[Lean.rename], timing=self.timing(4))
        session = qr.build_session(**self.session(4, rename))
        self.assertEqual({q['symbol'] for q in session['quotes'] if q['security_id'] == 'id-AAA'}, {'AAB'})
        self.assertEqual(qr.apply_renames({'id-AAA': 'AAA'}, rename), {'id-AAA': 'AAB'})

    def test_mapper_event_timing_and_combination_guards(self):
        s = self.rows[4]['session']
        late = map_session('id-BBB', splits=[Lean.split], timing=self.timing(4, available_at=s['open_at']))
        blocked(self, 'EVENT_AVAILABLE_AT_OR_AFTER_OPEN', qr.build_session, **self.session(4, late))
        wrong = map_session('id-BBB', splits=[Lean.split], timing=self.timing(4, effective_at=s['close_at']))
        blocked(self, 'EVENT_NOT_EFFECTIVE_AT_SESSION_OPEN', qr.build_session, **self.session(4, wrong))
        two = (map_session('id-BBB', splits=[Lean.split], timing=self.timing(4))
               + map_session('id-BBB', symbol_changes=[NS(old_symbol='BBB', new_symbol='BBC')],
                             timing=self.timing(4, event_id='SYNTHETIC-event-2')))
        blocked(self, 'COMBINED_SAME_SESSION_EVENTS', qr.build_session, **self.session(4, two))
        other = map_session('SYNTHETIC-not-member', splits=[Lean.split], timing=self.timing(4))
        blocked(self, 'EVENT_FOR_NON_MEMBER', qr.build_session, **self.session(4, other))

    def test_adv20_with_split_action_matches_frozen_scorer(self):
        decision = decision_inputs(self.data, self.rows[-1])
        day = decision['lookbacks']['id-CCC']['bars'][-5]['session_date']
        cal = {x['date']: x for x in self.data['calendar']['sessions']}
        event = map_session('id-CCC', splits=[Lean.split], timing=dict(
            event_id='SYNTHETIC-split', effective_at=cal[day]['open_at'],
            available_at=decision['provenance']['actions_available_at']))[0]
        action = dict(scoring_action(event, symbol='CCC', session_date=day), security_id='id-CCC')
        decision['actions'] = [action]
        scored = score_universe(**qr.build_evidence(**decision)['evidence'])
        sessions = qr.reviewed_sessions(self.data['calendar'])
        last = decision['lookbacks']['id-CCC']['bars'][-1]['session_date']
        got = qr.prior_adv20('id-CCC', decision['lookbacks']['id-CCC']['bars'], sessions=sessions,
                             prior_session=last, split_actions=[action])
        self.assertEqual(got, scored['prior_inputs']['id-CCC']['prior_adv20_shares'])
        self.assertNotEqual(got, 2000000)
        bad = dict(action, symbol='ZZZ'); decision['actions'] = [bad]
        blocked(self, 'ACTION_TICKER_MISMATCH', qr.build_evidence, **decision)
        decision['actions'] = [dict(action, available_at=decision['decision_at'])]
        blocked(self, 'ACTION_AVAILABLE_AT_OR_AFTER_DECISION', qr.build_evidence, **decision)

    def test_short_history_member_has_mark_but_no_quote(self):
        args = session_inputs(self.data, self.rows[1], self.members, self.history)
        args['volume_history']['id-KKK'] = args['volume_history']['id-KKK'][-5:]
        session = qr.build_session(**args)
        self.assertNotIn('id-KKK', {q['security_id'] for q in session['quotes']})
        self.assertIn('id-KKK', {m['security_id'] for m in session['close_marks']})


if __name__ == '__main__':
    unittest.main()
