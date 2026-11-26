"""Corporate-action reconciliation tests. EVERY price, symbol and action below is SYNTHETIC (fictional symbols SYN*,
made-up dates and amounts). None of it is historical evidence; the real records come only from the archived
Alpaca responses and the backtest bars file, inside the manual research workflow."""
from datetime import date, timedelta
from decimal import Decimal as D
import json
import unittest

from analytics import stock_corporate_actions_recon_v1 as ca
from analytics import stock_weekly_backtest_v1 as bt
from analytics.stock_momentum_v1 import total_return_index
from analytics.stock_weekly_bridge_v2 import member_actions
from analytics.stock_forward_bridge_v1 import sha256 as page_sha256


# ---------------------------------------------------------------- synthetic fixture builder (not evidence)

def weekdays(start: str, end: str) -> list[str]:
    d, e, out = date.fromisoformat(start), date.fromisoformat(end), []
    while d <= e:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def synthetic_symbol(days, base, drift, events):
    """events: {day_index: (kind, amount, vendor_adjusts)}; kind 'div' (cash per share), 'split' (new/old),
    'spin' (fraction of value distributed). Raw closes move by the event; the vendor's adjusted series is
    back-adjusted only for events it adjusts."""
    raw = [float(base)]
    for t in range(1, len(days)):
        p = raw[-1] * (1 + drift)
        ev = events.get(t)
        if ev:
            kind, amount, _ = ev
            p = p / amount if kind == 'split' else p - amount if kind == 'div' else p * (1 - amount)
        raw.append(round(p, 6))
    factor = [1.0] * len(days)
    for t, (kind, amount, vendor) in events.items():
        if not vendor:
            continue
        f = (1 - amount / raw[t - 1]) if kind == 'div' else (1 / amount) if kind == 'split' else (1 - amount)
        for u in range(t):
            factor[u] *= f
    adj = [r * f for r, f in zip(raw, factor)]
    return {'d': list(days), 'o': raw[:], 'c': raw, 'v': [2_000_000.0] * len(days), 'ao': adj[:], 'ac': adj}


def archive(chunks_by_year: dict, failed_years=()):
    """chunks_by_year: {year: {kind: [rows]}}; failed years become incomplete chunks (as a provider error would)."""
    chunks = []
    for y, groups in sorted(chunks_by_year.items()):
        if y in failed_years:
            chunks.append({'start': f'{y}-01-01', 'end': f'{y}-12-31', 'symbols': ['SYNA'], 'complete': False,
                           'pages': [], 'page_sha256': [], 'error': ['PROVIDER_HTTP_500']})
        else:
            page = {'corporate_actions': groups, 'next_page_token': None}
            chunks.append({'start': f'{y}-01-01', 'end': f'{y}-12-31', 'symbols': ['SYNA'], 'complete': True,
                           'pages': [page], 'page_sha256': [page_sha256(page)]})
    return {'version': ca.ARCHIVE_VERSION, 'start': '2019-01-01', 'end': '2021-12-31', 'chunks': chunks}


DAYS = weekdays('2019-01-01', '2021-12-31')
UNIVERSE = {'securities': [{'symbol': 'SYNA', 'sector': 'S1', 'first_traded_on': '2015-01-02'},
                           {'symbol': 'SYNB', 'sector': 'S2', 'first_traded_on': '2015-01-02'},
                           {'symbol': 'SYNC', 'sector': 'S3', 'first_traded_on': '2015-01-02'}]}


def quarterly(year_days_from, every=63, amount=0.4, vendor=True, start=20):
    return {t: ('div', amount, vendor) for t in range(start, len(DAYS), every)}


def fixture(spin_vendor_adjusts=True, record_dividends=True, failed_years=()):
    a_events = quarterly(DAYS)
    b_events = {300: ('split', 2.0, True)}
    c_events = {450: ('spin', 0.3, spin_vendor_adjusts)}
    bars = {'SYNA': synthetic_symbol(DAYS, 50, 0.001, a_events),
            'SYNB': synthetic_symbol(DAYS, 60, 0.0012, b_events),
            'SYNC': synthetic_symbol(DAYS, 40, 0.0015, c_events)}
    groups = {y: {'cash_dividends': [], 'forward_splits': [], 'spin_offs': []} for y in (2019, 2020, 2021)}
    for t, (_, amount, _) in sorted(a_events.items()):
        if record_dividends:
            groups[int(DAYS[t][:4])]['cash_dividends'].append(
                {'id': f'div-{t}', 'symbol': 'SYNA', 'rate': amount, 'ex_date': DAYS[t]})
    groups[int(DAYS[300][:4])]['forward_splits'].append(
        {'id': 'split-1', 'symbol': 'SYNB', 'new_rate': 2, 'old_rate': 1, 'ex_date': DAYS[300]})
    groups[int(DAYS[450][:4])]['spin_offs'].append(
        {'id': 'spin-1', 'source_symbol': 'SYNC', 'source_rate': 1, 'new_symbol': 'SYNX', 'new_rate': 0.5,
         'ex_date': DAYS[450]})
    data = {'sessions': DAYS, 'bars': bars, 'feed': 'synthetic', 'asof': DAYS[-1]}
    return data, archive(groups, failed_years)


# ---------------------------------------------------------------- tests

class AccountingConservation(unittest.TestCase):
    def test_dividend_moves_value_from_price_to_cash_without_creating_or_losing_any(self):
        led = ca.Ledger(10)
        before = led.value(50.0)
        led.apply('cash_dividends', dividend=0.75)
        self.assertAlmostEqual(led.value(50.0 - 0.75), before, places=12)
        self.assertAlmostEqual(led.cash, 7.5, places=12)

    def test_forward_and_reverse_splits_conserve_value(self):
        led = ca.Ledger(7)
        led.apply('forward_splits', split_ratio=3.0)
        self.assertAlmostEqual(led.value(40.0 / 3), 7 * 40.0, places=9)
        led.apply('reverse_splits', split_ratio=0.1)
        self.assertAlmostEqual(led.shares, 2.1, places=12)
        self.assertAlmostEqual(led.value(40.0 / 3 * 10), 7 * 40.0, places=9)

    def test_unsupported_actions_are_refused_never_valued(self):
        for kind in ('spin_offs', 'cash_mergers', 'stock_mergers', 'name_changes', 'worthless_removals'):
            with self.assertRaises(ca.UnresolvedAction):
                ca.Ledger(1).apply(kind)
        with self.assertRaises(ValueError):
            ca.Ledger(1).apply('forward_splits', split_ratio=0)
        with self.assertRaises(ValueError):
            ca.Ledger(1).apply('cash_dividends', dividend=-1)

    def test_live_wealth_is_the_frozen_formula_and_a_reinvesting_ledger(self):
        days = weekdays('2020-01-01', '2020-02-28')[:30]
        closes = [20 + 0.1 * i for i in range(30)]
        acts = {days[5]: (1.0, 0.3), days[12]: (2.0, 0.0), days[20]: (1.0, 0.1)}
        closes[12] = closes[12] / 2
        for i in range(13, 30):
            closes[i] /= 2
        w = ca.live_wealth(closes, days, acts)
        splits = [D(str(acts.get(d, (1.0, 0.0))[0])) for d in days[1:]]
        divs = [D(str(acts.get(d, (1.0, 0.0))[1])) for d in days[1:]]
        frozen = total_return_index([D(str(c)) for c in closes], splits, divs)
        for x, y in zip(w, frozen):
            self.assertAlmostEqual(x, float(y), places=10)
        led = ca.Ledger(1.0)
        for t in range(1, 30):
            s, d = acts.get(days[t], (1.0, 0.0))
            if s != 1.0:
                led.apply('forward_splits', split_ratio=s)
            if d:
                led.apply('cash_dividends', dividend=d)
                led.shares += led.cash / closes[t]; led.cash = 0.0  # reinvest at that close
            self.assertAlmostEqual(led.value(closes[t]) / closes[0], w[t], places=10)


class RecordReconciliation(unittest.TestCase):
    def setUp(self):
        self.data, self.arch = fixture()
        self.sessions, self.series = bt.align(self.data)
        self.rows, _ = ca.flatten(self.arch)

    def test_adjusted_dividends_and_split_are_consistent(self):
        r = ca.reconcile_records(self.rows, self.sessions, self.series, {'SYNA', 'SYNB', 'SYNC'})
        self.assertEqual(r['by_kind_and_status']['forward_splits:CONSISTENT'], 1)
        self.assertEqual(r['by_kind_and_status']['cash_dividends:CONSISTENT'], len(quarterly(DAYS)))
        self.assertNotIn('cash_dividends:MAGNITUDE_MISMATCH', r['by_kind_and_status'])

    def test_spin_off_is_unsupported_and_reports_what_the_vendor_did(self):
        r = ca.reconcile_records(self.rows, self.sessions, self.series, {'SYNC'})
        spin = [e for e in r['not_consistent_or_unsupported'] if e['kind'] == 'spin_offs']
        self.assertEqual(spin[0]['status'], 'UNSUPPORTED_VENDOR_ADJUSTED')
        data, arch = fixture(spin_vendor_adjusts=False)
        s, ser = bt.align(data)
        r = ca.reconcile_records(ca.flatten(arch)[0], s, ser, {'SYNC'})
        spin = [e for e in r['not_consistent_or_unsupported'] if e['kind'] == 'spin_offs'][0]
        self.assertEqual(spin['status'], 'UNSUPPORTED_VENDOR_NOT_ADJUSTED')
        self.assertLess(spin['adjusted_day_return'], -0.25, 'the backtest would book the distribution as a loss')

    def test_vendor_not_adjusting_a_recorded_dividend_is_flagged(self):
        a = synthetic_symbol(DAYS, 50, 0.001, {100: ('div', 0.5, False)})
        data = {'sessions': DAYS, 'bars': {'SYNA': a}}
        rows = [{'kind': 'cash_dividends', 'row': {'id': 'd', 'symbol': 'SYNA', 'rate': 0.5, 'ex_date': DAYS[100]},
                 'date': DAYS[100]}]
        s, ser = bt.align(data)
        r = ca.reconcile_records(rows, s, ser, {'SYNA'})
        self.assertEqual(r['by_status'], {'VENDOR_NOT_ADJUSTED': 1})

    def test_split_magnitude_mismatch_and_step_without_record(self):
        b = synthetic_symbol(DAYS, 60, 0.001, {300: ('split', 2.0, True)})
        data = {'sessions': DAYS, 'bars': {'SYNB': b}}
        s, ser = bt.align(data)
        wrong = [{'kind': 'forward_splits', 'row': {'id': 'x', 'symbol': 'SYNB', 'new_rate': 3, 'old_rate': 1,
                                                    'ex_date': DAYS[300]}, 'date': DAYS[300]}]
        self.assertEqual(ca.reconcile_records(wrong, s, ser, {'SYNB'})['by_status'], {'MAGNITUDE_MISMATCH': 1})
        none = ca.reconcile_records([], s, ser, {'SYNB'})
        self.assertEqual(none['steps_without_record_total'], 1)
        self.assertEqual(none['steps_without_record'][0]['status'], 'STEP_WITHOUT_RECORD')
        self.assertEqual(none['steps_without_record'][0]['inferred'], 'split')


class MissingEvidence(unittest.TestCase):
    def test_a_failed_fetch_year_is_evidence_missing_not_no_action(self):
        data, arch = fixture(failed_years=(2020,))
        out = ca.reconcile(data, UNIVERSE, arch, start=DAYS[0])
        self.assertEqual(out['coverage_by_year']['2020']['status'], 'EVIDENCE_MISSING')
        self.assertEqual(out['coverage_by_year']['2021']['status'], 'COVERED')
        self.assertEqual(out['chunks']['failed'][0]['error'], ['PROVIDER_HTTP_500'])
        d = out['decisions']['momentum']
        self.assertGreater(d['evidence_missing'], 0)
        self.assertEqual(d['evidence_missing'] + d['reconciled'], d['decisions'])

    def test_a_complete_but_empty_year_that_vendor_steps_contradict_is_evidence_missing(self):
        data, arch = fixture(record_dividends=False)
        out = ca.reconcile(data, UNIVERSE, arch, start=DAYS[0])
        for y in ('2019', '2020', '2021'):
            self.assertEqual(out['coverage_by_year'][y]['status'], 'EVIDENCE_MISSING', y)
            self.assertEqual(out['coverage_by_year'][y]['explained_by_records'], 0)
        self.assertEqual(out['decisions']['momentum']['reconciled'], 0)
        steps = [e for e in out['records']['steps_without_record'] if e['symbol'] == 'SYNA']
        self.assertTrue(steps and all(e['year_evidence'] == 'EVIDENCE_MISSING' for e in steps))

    def test_a_case_without_records_is_never_reported_as_no_action(self):
        data, arch = fixture(failed_years=(2020, 2021))
        res = ca.investigate_cases([], DAYS, bt.align(data)[1], {'2020': {'status': 'EVIDENCE_MISSING'}},
                                   cases=(('SYNC', DAYS[450]),))
        self.assertEqual(res[0]['finding'], 'EVIDENCE_MISSING')


class LiveRulesAndTiming(unittest.TestCase):
    def test_unsupported_action_in_window_makes_the_live_rule_skip_a_member_the_backtest_scores(self):
        data, arch = fixture(spin_vendor_adjusts=True)
        out = ca.reconcile(data, UNIVERSE, arch, start=DAYS[0])
        d = out['decisions']['momentum']
        self.assertGreater(d['reconciled'], 0)
        self.assertGreater(d['live_skip_reasons'].get('UNSUPPORTED_CORPORATE_ACTION', 0), 0)
        # SYNC is held when its spin-off enters the window: the live bridge rejects those decisions outright
        # (HELD_SECURITY_SKIPPED) while the backtest keeps rebalancing on the vendor-adjusted series.
        self.assertGreater(d['live_frozen'], 0)
        self.assertTrue(set(d['cause']) <= {'skip_rule', 'price_treatment', 'both'})
        self.assertIn('divergence_return', d)
        self.assertTrue(all(r['held_but_skipped'] == ['SYNC'] for r in d['live_rejected']))
        # Steady stocks ranks SYNC differently; the hold-buffer variant too. At least one strategy must show either a
        # rejection or a pick difference involving SYNC; none may silently treat the spin-off as an ordinary day.
        self.assertTrue(all(out['decisions'][n]['live_frozen'] + len(out['decisions'][n]['symbols_differing']) > 0
                            for n in ca.STRATEGIES))

    def test_actions_apply_only_inside_the_window_ending_at_the_last_completed_session(self):
        k = 400
        lo, hi = DAYS[k - bt.WINDOW], DAYS[k - 1]
        rows = [{'kind': 'cash_dividends', 'row': {'id': f'd{t}', 'symbol': 'SYNA', 'rate': 0.4, 'ex_date': DAYS[t]},
                 'date': DAYS[t]} for t in (k - bt.WINDOW, k - 1, k, k + 5)]
        kept, skipped = member_actions(ca.WindowPages(rows).pages(lo, hi), {'SYNA'}, (lo, hi))
        self.assertEqual([a['session_date'] for a in kept], [DAYS[k - 1]],
                         'the window start is exclusive; the decision day and later are excluded')
        self.assertEqual(skipped, {})
        # A later action cannot change the decision's live scores.
        data, _ = fixture()
        ser = bt.align(data)[1]['SYNA']
        before = ca.live_scores(ser, DAYS, k, 252, kept)
        after = ca.live_scores(ser, DAYS, k, 252, kept + [{'session_date': DAYS[k + 5], 'split_ratio': '2',
                                                            'cash_dividend_per_old_share': '0'}])
        self.assertEqual(before, after)

    def test_same_day_split_and_dividend_is_ambiguous_and_skipped(self):
        rows = [{'kind': 'cash_dividends', 'row': {'id': 'a', 'symbol': 'SYNA', 'rate': 0.4, 'ex_date': DAYS[300]}, 'date': DAYS[300]},
                {'kind': 'forward_splits', 'row': {'id': 'b', 'symbol': 'SYNA', 'new_rate': 2, 'old_rate': 1,
                                                   'ex_date': DAYS[300]}, 'date': DAYS[300]}]
        kept, skipped = member_actions(ca.WindowPages(rows).pages(DAYS[200], DAYS[350]), {'SYNA'}, (DAYS[200], DAYS[350]))
        self.assertTrue(skipped['SYNA'].startswith('AMBIGUOUS_SAME_DAY_ACTIONS'))

    def test_an_event_counts_against_a_position_only_while_it_is_held(self):
        ev = [{'symbol': 'SYNC', 'date': DAYS[450], 'kind': 'spin_offs', 'status': 'UNSUPPORTED_VENDOR_NOT_ADJUSTED',
               'adjusted_day_return': -0.3, 'raw_day_return': -0.3}]
        held = ca.booked_returns(ev, DAYS, [(445, ['SYNC']), (455, ['SYNA'])])
        self.assertEqual(held['held_through_unresolved_events'], 1)
        self.assertAlmostEqual(held['sum_booked_effect_at_target_weight'], bt.WEIGHT * -0.3)
        self.assertEqual(held['events'][0]['true_return'], 'UNRESOLVED')
        bought_on_event_day = ca.booked_returns(ev, DAYS, [(450, ['SYNC']), (455, ['SYNA'])])
        self.assertEqual(bought_on_event_day['held_through_unresolved_events'], 0, 'bought at that open, after the gap')
        sold_at_next_open = ca.booked_returns(ev, DAYS, [(445, ['SYNC']), (450, ['SYNA'])])
        self.assertEqual(sold_at_next_open['held_through_unresolved_events'], 1, 'held through the overnight gap')

    def test_former_ticker_records_count_only_before_the_name_change(self):
        arch = {'chunks': [{'start': '2019-01-01', 'end': '2019-12-31', 'symbols': ['SYNOLD'], 'complete': True,
                            'alias_of': {'SYNOLD': ['SYNA', DAYS[200]]}, 'page_sha256': ['x'],
                            'pages': [{'corporate_actions': {'cash_dividends': [
                                {'id': 'old1', 'symbol': 'SYNOLD', 'rate': 0.4, 'ex_date': DAYS[100]},
                                {'id': 'old2', 'symbol': 'SYNOLD', 'rate': 0.4, 'ex_date': DAYS[250]}],
                                'spin_offs': [{'id': 'sp', 'source_symbol': 'SYNOLD', 'new_symbol': 'SYNX',
                                               'source_rate': 1, 'new_rate': 1, 'ex_date': DAYS[200]}]}}]}]}
        rows, _ = ca.flatten(arch)
        got = [(r['kind'], r['row'].get('symbol') or r['row'].get('source_symbol'), r['date'], r['row']['alias_from'])
               for r in rows]
        self.assertEqual(got, [('cash_dividends', 'SYNA', DAYS[100], 'SYNOLD'), ('spin_offs', 'SYNA', DAYS[200], 'SYNOLD')],
                         'mapped up to and including the change date; dropped after it')

    def test_same_day_dividends_are_compared_as_their_sum(self):
        a = synthetic_symbol(DAYS, 50, 0.001, {100: ('div', 0.9, True)})
        rows = [{'kind': 'cash_dividends', 'row': {'id': f'd{i}', 'symbol': 'SYNA', 'rate': r, 'ex_date': DAYS[100]},
                 'date': DAYS[100]} for i, r in enumerate((0.5, 0.4))]
        s, ser = bt.align({'sessions': DAYS, 'bars': {'SYNA': a}})
        r = ca.reconcile_records(rows, s, ser, {'SYNA'})
        self.assertEqual(r['by_status'], {'CONSISTENT': 1})

    def test_divergence_return_excludes_unresolved_weeks_and_never_fills_them(self):
        data, _ = fixture()
        ser = bt.align(data)[1]
        pairs = [(300, {'SYNA'}, {'SYNB'}), (310, {'SYNA'}, {'SYNC'}), (320, {'SYNA'}, {'SYNA'})]
        nxt = {300: 305, 310: 315, 320: 325}
        out = ca.divergence_return(pairs, nxt, ser, {'SYNC': {312}})
        self.assertEqual(out['weeks_measured'], 1)
        self.assertEqual(out['weeks_excluded_unresolved_or_missing'], 1)
        r = lambda s: bt.WEIGHT * (ser[s]['ao'][305] / ser[s]['ao'][300] - 1)
        self.assertAlmostEqual(out['sum_of_weekly_gaps'], r('SYNA') - r('SYNB'), places=12)

    def test_reconciliation_is_deterministic(self):
        data, arch = fixture()
        a = json.dumps(ca.reconcile(data, UNIVERSE, arch, start=DAYS[0]), sort_keys=True, default=str)
        b = json.dumps(ca.reconcile(data, UNIVERSE, arch, start=DAYS[0]), sort_keys=True, default=str)
        self.assertEqual(a, b)
        self.assertIn('synthetic', ca.SYNTHETIC_NOTE)


class RecordedRealRun(unittest.TestCase):
    """Locks the committed derived results of the real run (research/stock_corporate_actions_20261121) to the exact
    bars dataset PR #199 audited, and checks the file's own accounting. It reads results; it is not a fixture."""
    PATH = 'research/stock_corporate_actions_20261121/reconciliation.json'

    def setUp(self):
        import os
        if not os.path.exists(self.PATH):
            self.skipTest('recorded run not present')
        with open(self.PATH, encoding='utf-8') as fh:
            self.r = json.load(fh)

    def test_same_dataset_as_the_data_quality_audit(self):
        with open('research/stock_data_quality_20261120/audit.json', encoding='utf-8') as fh:
            audit = json.load(fh)
        self.assertEqual(self.r['dataset_sha256'], audit['dataset_sha256'])
        self.assertEqual(self.r['version'], ca.VERSION)

    def test_counts_add_up_and_no_year_is_silently_assumed(self):
        rec = self.r['records']
        self.assertEqual(sum(rec['by_status'].values()), rec['records_in_universe'])
        self.assertEqual(sum(rec['by_kind_and_status'].values()), rec['records_in_universe'])
        self.assertEqual(self.r['chunks']['complete'], self.r['chunks']['total'])
        for y, v in self.r['coverage_by_year'].items():
            self.assertEqual(v['status'] == 'COVERED', v['fetch_complete'] and (v['explained_share'] is None or
                                                                                 v['explained_share'] >= ca.COVERAGE_MIN), y)
        for name, d in self.r['decisions'].items():
            self.assertEqual(d['same_picks'] + d['different_picks'], d['reconciled'], name)
            self.assertEqual(d['reconciled'] + d['evidence_missing'], d['decisions'], name)
            self.assertEqual(sum(d['cause'].values()), d['different_picks'], name)

    def test_every_flagged_case_has_a_record_based_finding(self):
        found = {(c['symbol'], c['date']): c['finding'] for c in self.r['cases']}
        self.assertEqual(set(found), set(ca.CASES))
        self.assertTrue(all(f.startswith(('UNSUPPORTED_RECORD', 'ONLY_SUPPORTED', 'NO_RECORD', 'EVIDENCE_MISSING'))
                            for f in found.values()))


if __name__ == '__main__':
    unittest.main()
