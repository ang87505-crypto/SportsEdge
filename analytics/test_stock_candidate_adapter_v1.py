"""SYNTHETIC fixtures only. No market history or performance evidence."""
from copy import deepcopy
from decimal import Decimal as D, Inexact, ROUND_DOWN, localcontext
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from analytics.test_stock_independent_audit import ranked_fixture
from analytics.test_stock_accounting_v2 import fixture, session_row, opening, options
from analytics.stock_accounting_v2 import new_account, close_session
from analytics.stock_momentum_v1 import VERSION as BASELINE
from analytics.stock_rank_buffer_candidate import VERSION as CANDIDATE, generate_buffer
from analytics.stock_baseline_replay_v2 import plan_baseline
from analytics.stock_buffer_replay_v1 import signal_from_account, plan_buffer, replay
from analytics.stock_candidate_comparison_v1 import compare_synthetic


def ranked_account(held=('FFF',)):
    """Fictional eleven-name market; initial NAV exactly $1,000 by construction."""
    f = fixture(fee=0, slip='0')
    args = ranked_fixture()
    f['model'] = dict(strategy_version=CANDIDATE, **args)
    prior = args['context']['sessions'][-2]
    symbols = {u['security_id']: u['symbol'] for u in args['context']['universe']}
    prices = {b['symbol']: b['close'] for b in args['payload']['bars']
              if b['session_date'] == prior['date']}
    positions = {sid: 2 for sid, sym in symbols.items() if sym in held}
    cash = 100000 - sum(int(D(prices[symbols[sid]]) * 100) * n for sid, n in positions.items())
    marks = {sid: dict(symbol=sym, price=prices[sym], completed_at=prior['close_at'],
                       available_at='2026-09-30T20:01:00Z') for sid, sym in symbols.items()}
    f['account'] = new_account(as_of=prior['close_at'], settled_cash_cents=cash,
                               positions=positions, symbols=symbols, marks=marks)
    f['session'] = session_row(f['calendar'], f['account'], '2026-10-01')
    for q in f['session']['quotes']:
        q['bid'] = q['ask'] = prices[q['symbol']]
    for m in f['session']['close_marks']:
        m['price'] = prices[m['symbol']]
    return f


def pair_input(f):
    evidence = {k: deepcopy(v) for k, v in f['model'].items() if k != 'strategy_version'}
    return dict(initial_account=f['account'], rows=[dict(session=f['session'], model_evidence=evidence)], **options(f))


def two_month_input():
    f = ranked_account()
    data = pair_input(f)
    prices = {m['security_id']: m['price'] for m in f['session']['close_marks']}
    previous = deepcopy(f['account'])
    for cal in f['calendar']['sessions']:
        if '2026-10-01' < cal['date'] <= '2026-11-02':
            previous['as_of'] = data['rows'][-1]['session']['close_at']
            row = session_row(f['calendar'], previous, cal['date'])
            for q in row['quotes']:
                q['bid'] = q['ask'] = prices[q['security_id']]
            for m in row['close_marks']:
                m['price'] = prices[m['security_id']]
            data['rows'].append(dict(session=row))
    evidence = deepcopy(data['rows'][0]['model_evidence'])
    evidence['decision_at'] = '2026-11-02T13:00:00Z'
    evidence['payload']['retrieved_at'] = '2026-11-02T14:00:00Z'
    context = evidence['context']
    context['sessions'] = deepcopy(f['calendar']['sessions'])
    context['universe_session'] = '2026-10-30'
    context['actions_coverage_end'] = '2026-10-30'
    evidence['payload']['bars'] = [b for b in evidence['payload']['bars'] if b['session_date'] < '2026-10-01']
    for item in data['rows'][:-1]:
        row = item['session']
        for m in row['close_marks']:
            price = m['price']
            evidence['payload']['bars'].append(dict(symbol=m['symbol'], session_date=row['date'],
                status='complete', completed_at=row['close_at'], available_at=row['close_at'],
                open=price, high=price, low=price, close=price, volume=2000000))
    data['rows'][-1]['model_evidence'] = evidence
    return data


class CandidateAdapterTests(unittest.TestCase):
    def test_frozen_selection_recomputed_from_actual_account(self):
        f = ranked_account()
        a = signal_from_account(f['account'], f['model'], f['calendar'])
        expected = generate_buffer(f['model']['payload'], f['model']['context'],
            decision_at=f['model']['decision_at'], equity_cents=100000, held_symbols=['FFF'])
        self.assertEqual(a['signal'], expected)
        self.assertEqual(a['holdings'], {'id-FFF': 2})
        self.assertEqual(a['equity_cents'], 100000)
        self.assertEqual({s for s, b in a['targets'].items() if b}, {'id-AAA','id-BBB','id-CCC','id-DDD','id-FFF'})

    def test_rank_ten_retained_rank_eleven_exited(self):
        for sym, retained in [('JJJ', True), ('KKK', False)]:
            f = ranked_account((sym,))
            a = signal_from_account(f['account'], f['model'], f['calendar'])
            self.assertEqual(a['targets']['id-' + sym] > 0, retained)

    def test_candidate_planner_and_replay_identical(self):
        f = ranked_account()
        p = plan_buffer(f['account'], f['model'], opening(f['session']), **options(f))
        r = replay(f['account'], [dict(session=f['session'], model=f['model'])], **options(f))
        self.assertEqual(p['trades'], r['sessions'][0]['trades'])
        self.assertEqual(close_session(p, f['session']), r['sessions'][0])
        self.assertEqual(p['candidate_adapter']['signal']['strategy_version'], CANDIDATE)

    def test_empty_account_paths_have_same_economics_distinct_identity(self):
        f = ranked_account(())
        p = compare_synthetic(**pair_input(f))
        b, c = p['baseline']['sessions'][0], p['candidate']['sessions'][0]
        self.assertEqual(b['close_nav'], c['close_nav'])
        self.assertEqual(b['state']['positions'], c['state']['positions'])
        self.assertEqual(b['state']['settled_cash_cents'], c['state']['settled_cash_cents'])
        self.assertNotEqual(b['baseline_adapter']['decision_id'], c['candidate_adapter']['decision_id'])
        self.assertIsNone(p['performance'])

    def test_same_market_different_selection_uses_own_positions_next_month(self):
        data = two_month_input()
        p = compare_synthetic(**data)
        b = p['baseline']['sessions']
        c = p['candidate']['sessions']
        self.assertIn('id-EEE', b[0]['state']['positions'])
        self.assertNotIn('id-FFF', b[0]['state']['positions'])
        self.assertIn('id-FFF', c[0]['state']['positions'])
        self.assertNotIn('id-EEE', c[0]['state']['positions'])
        self.assertEqual(c[-1]['candidate_adapter']['holdings'], c[-2]['state']['positions'])
        self.assertEqual(b[-1]['baseline_adapter']['holdings'], b[-2]['state']['positions'])
        self.assertNotEqual(c[-1]['candidate_adapter']['holdings'], b[-1]['baseline_adapter']['holdings'])
        self.assertEqual(c[-1]['candidate_adapter']['account_state_digest'],
                         c[-1]['prior_state_digest'])

    def test_overrides_and_versions_fail_closed(self):
        for key, value in [('equity_cents', 1), ('held_symbols', []), ('signal', {}), ('targets', {})]:
            f = ranked_account(); f['model'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                signal_from_account(f['account'], f['model'], f['calendar'])
        f = ranked_account(); f['model']['strategy_version'] = BASELINE
        with self.assertRaises(ValueError): signal_from_account(f['account'], f['model'], f['calendar'])
        f = ranked_account()
        with self.assertRaises(ValueError): plan_baseline(f['account'], f['model'], opening(f['session']), **options(f))

    def test_identity_substitution_rejected(self):
        f = ranked_account(); f['model']['context']['universe'][0]['security_id'] = 'another-company'
        with self.assertRaisesRegex(ValueError, 'identity'): signal_from_account(f['account'], f['model'], f['calendar'])

    def test_wrong_prior_mark_and_unavailable_mark_rejected(self):
        for key, value in [('price', '999'), ('available_at', '2026-10-01T12:00:00Z')]:
            f = ranked_account(); f['account']['marks']['id-FFF'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                signal_from_account(f['account'], f['model'], f['calendar'])

    def test_missing_and_late_bars_rejected(self):
        for remove in (True, False):
            f = ranked_account()
            bars = f['model']['payload']['bars']
            if remove: bars.pop(0)
            else: bars[0]['available_at'] = f['model']['decision_at']
            with self.subTest(remove=remove), self.assertRaises(ValueError):
                signal_from_account(f['account'], f['model'], f['calendar'])

    def test_future_closes_do_not_change_candidate_open_trades(self):
        f = ranked_account(); data = pair_input(f); a = compare_synthetic(**data)
        for m in data['rows'][0]['session']['close_marks']: m['price'] = '999'
        b = compare_synthetic(**data)
        for name, adapter in [('baseline', 'baseline_adapter'), ('candidate', 'candidate_adapter')]:
            self.assertEqual(a[name]['sessions'][0]['trades'], b[name]['sessions'][0]['trades'])
            self.assertEqual(a[name]['sessions'][0][adapter], b[name]['sessions'][0][adapter])
        with self.assertRaisesRegex(ValueError, 'future close'):
            plan_buffer(f['account'], f['model'], f['session'], **options(f))

    def test_month_boundary_requires_decision_and_daily_gaps_fail(self):
        f = ranked_account()
        with self.assertRaisesRegex(ValueError, 'Monthly candidate'):
            replay(f['account'], [dict(session=f['session'])], **options(f))
        data = two_month_input(); data['rows'].pop(2)
        with self.assertRaisesRegex(ValueError, 'Missing/repeated'): compare_synthetic(**data)

    def test_liquidity_recomputed_from_model(self):
        f = ranked_account(); f['session']['quotes'][5]['prior_adv20_shares'] = 123
        with self.assertRaisesRegex(ValueError, 'liquidity disagrees'):
            plan_buffer(f['account'], f['model'], opening(f['session']), **options(f))

    def test_delisting_invalidates_entire_pair(self):
        f = ranked_account()
        f['session']['events'] = [dict(type='delisting', event_id='SYNTHETIC-delisting',
            security_id='id-FFF', effective_at=f['session']['open_at'],
            available_at='2026-09-30T22:00:00Z')]
        before = deepcopy(f)
        with self.assertRaisesRegex(ValueError, 'Unsupported corporate event'): compare_synthetic(**pair_input(f))
        self.assertEqual(f, before)

    def test_historical_mode_and_per_strategy_inputs_blocked(self):
        f = ranked_account(); data = pair_input(f)
        data['rows'][0]['session']['kind'] = 'historical_price_proxy'
        with self.assertRaisesRegex(ValueError, 'Historical comparison blocked'): compare_synthetic(**data)
        data = pair_input(f); data['rows'][0]['candidate_account'] = {}
        with self.assertRaises(ValueError): compare_synthetic(**data)
        data = pair_input(f); data['rows'][0]['model_evidence']['strategy_version'] = CANDIDATE
        with self.assertRaises(ValueError): compare_synthetic(**data)

    def test_determinism_decimal_context_and_input_preservation(self):
        data = pair_input(ranked_account()); before = deepcopy(data)
        a = compare_synthetic(**data)
        with localcontext() as ctx:
            ctx.prec = 6; ctx.rounding = ROUND_DOWN; ctx.traps[Inexact] = True
            b = compare_synthetic(**data)
        self.assertEqual(a, b); self.assertEqual(data, before)

    def test_dividend_cash_not_available_before_payment(self):
        f = ranked_account(); f['session']['events'] = [dict(type='ordinary_cash_dividend',
            event_id='SYNTHETIC-div', security_id='id-FFF', effective_at=f['session']['open_at'],
            available_at='2026-09-30T22:00:00Z', currency='USD', due_bill=False,
            per_old_share='1', pay_at='2026-10-05T09:00:00-04:00')]
        p = compare_synthetic(**pair_input(f))
        for name in ('baseline', 'candidate'):
            s = p[name]['state']
            self.assertEqual(s['receivables'][0]['entitled_shares'], 2)
            self.assertEqual(D(s['receivables'][0]['amount']), D(2))
        self.assertNotIn('id-FFF', p['baseline']['state']['positions'])
        self.assertIn('id-FFF', p['candidate']['state']['positions'])

    def test_cli_exclusive_output_and_no_partial_result(self):
        data = pair_input(ranked_account())
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp)/'input.json', Path(tmp)/'output.json'
            source.write_text(json.dumps(data))
            cmd = [sys.executable, '-m', 'analytics.stock_candidate_comparison_v1',
                   '--input', str(source), '--output', str(output)]
            r = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            saved = output.read_bytes()
            self.assertEqual(json.loads(saved), compare_synthetic(**data))
            self.assertNotEqual(subprocess.run(cmd, capture_output=True).returncode, 0)
            self.assertEqual(saved, output.read_bytes())
            data['rows'][0]['session']['kind'] = 'historical_price_proxy'
            source.write_text(json.dumps(data)); cmd[-1] = str(Path(tmp)/'blocked.json')
            self.assertNotEqual(subprocess.run(cmd, capture_output=True).returncode, 0)
            self.assertFalse(Path(cmd[-1]).exists())


if __name__ == '__main__':
    unittest.main()
