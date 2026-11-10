"""Next-generation slate tests. All bars, filings and identifiers here are synthetic TEST-ONLY data."""
from __future__ import annotations
import io
import unittest
import zipfile

from analytics.research import engine, filings, nextgen
from analytics.research.test_engine_candidates import flat, sessions


def tsv(header, rows):
    return '\t'.join(header) + '\n' + ''.join('\t'.join(r) + '\n' for r in rows)


def form345_zip(subs, owners, trans, drop_column=None):
    sh = list(filings.REQUIRED['SUBMISSION.tsv']) + ['AFF10B5ONE']
    oh = list(filings.REQUIRED['REPORTINGOWNER.tsv'])
    th = list(filings.REQUIRED['NONDERIV_TRANS.tsv'])
    if drop_column:
        th.remove(drop_column)
        trans = [r[:th.index(th[-1]) + 1] for r in trans]
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w') as z:
        z.writestr('SUBMISSION.tsv', tsv(sh, subs))
        z.writestr('REPORTINGOWNER.tsv', tsv(oh, owners))
        z.writestr('NONDERIV_TRANS.tsv', tsv(th, trans))
    return b.getvalue()


SUBS = [['A1', '05-JAN-2024', '03-JAN-2024', '4', '111', 'AAA', '0'],
        ['A2', '05-JAN-2024', '03-JAN-2024', '4', '111', 'AAA', '0'],
        ['A3', '08-JAN-2024', '02-JAN-2024', '4/A', '111', 'AAA', '0'],      # amendment repeating A1's row
        ['A4', '05-JAN-2024', '04-JAN-2024', '4', '222', 'OLD', '1'],        # filed under an old symbol
        ['A5', '05-JAN-2024', '04-JAN-2024', '4', '999', 'ZZZ', '0']]        # issuer outside the universe
OWNERS = [['A1', 'o1', 'Director'], ['A2', 'o2', 'Officer'], ['A3', 'o1', 'Director'], ['A4', 'o3', 'Director']]
TRANS = [['A1', '03-JAN-2024', 'P', '100', '10.0', 'A', 'D'],
         ['A1', '03-JAN-2024', 'S', '50', '10.0', 'D', 'D'],
         ['A2', '03-JAN-2024', 'A', '1000', '0', 'A', 'D'],
         ['A2', '03-JAN-2024', 'M', '10', '5.0', 'A', 'D'],
         ['A2', '03-JAN-2024', 'F', '4', '10.0', 'D', 'D'],
         ['A3', '03-JAN-2024', 'P', '100', '10.0', 'A', 'D'],
         ['A4', '04-JAN-2024', 'P', '20', '50.0', 'A', 'I']]


class Form4(unittest.TestCase):
    def events(self):
        ex = filings.parse_form345(form345_zip(SUBS, OWNERS, TRANS), {111, 222})
        return filings.filing_events(ex, quarter='2024q1', raw_sha256='x', observed_at='2026-11-10T00:00:00Z',
                                     ticker_by_cik={111: 'AAA', 222: 'NEW'})

    def test_only_open_market_or_private_purchases_count_and_codes_are_kept(self):
        purchases, stats = filings.qualifying_purchases(self.events())
        self.assertEqual(stats['by_code'], {'P': 3, 'S': 1, 'A': 1, 'M': 1, 'F': 1})
        self.assertEqual(stats['excluded'], {'code_S': 1, 'code_A': 1, 'code_M': 1, 'code_F': 1})
        self.assertEqual(sorted(purchases), ['AAA', 'NEW'])
        self.assertTrue(all(e['venue'] == 'UNKNOWN_VENUE' for e in self.events() if e['code'] == 'P'))

    def test_amendment_repeat_is_deduplicated_and_the_first_filing_date_kept(self):
        purchases, stats = filings.qualifying_purchases(self.events())
        self.assertEqual(stats['duplicates'], 1)
        self.assertEqual([p['filed'] for p in purchases['AAA']], ['2024-01-05'])

    def test_identity_by_cik_not_filed_symbol_and_unknown_issuers_dropped(self):
        ev = self.events()
        self.assertEqual({e['ticker'] for e in ev if e['issuer_cik'] == 222}, {'NEW'})
        self.assertFalse(any(e['issuer_cik'] == 999 for e in ev))
        purchases, stats = filings.qualifying_purchases(self.events())
        self.assertEqual(stats['indirect'], 1)
        self.assertEqual(purchases['NEW'][0]['ownership'], 'I')

    def test_transaction_date_never_makes_a_filing_visible(self):
        purchases, _ = filings.qualifying_purchases(self.events())
        # Traded Wed 3 Jan, filed Fri 5 Jan: invisible at Fri's close, visible at Mon 8 Jan's close.
        self.assertEqual(nextgen.insider_window(purchases, 'AAA', '2024-01-05')['buyers'], 0)
        self.assertEqual(nextgen.insider_window(purchases, 'AAA', '2024-01-08')['buyers'], 1)
        # Outside the 90-day window it is gone.
        self.assertEqual(nextgen.insider_window(purchases, 'AAA', '2024-04-10')['buyers'], 0)

    def test_broken_column_contract_fails_closed(self):
        with self.assertRaises(filings.ContractError):
            filings.parse_form345(form345_zip(SUBS, OWNERS, [r[:-1] for r in TRANS], drop_column='DIRECT_INDIRECT_OWNERSHIP'), {111})
        with self.assertRaises(filings.ContractError):
            filings.parse_form345(b'not a zip', {111})

    def test_quarters_and_dates(self):
        self.assertEqual(filings.quarters('2025q3', '2026q2'), ['2025q3', '2025q4', '2026q1', '2026q2'])
        self.assertEqual(filings.last_complete_quarter('2026-11-10'), '2026q3')
        self.assertEqual(filings.last_complete_quarter('2026-02-01'), '2025q4')
        self.assertEqual(filings.sec_date('31-MAR-2024'), '2024-03-31')
        self.assertIsNone(filings.sec_date('garbage'))


class Identity(unittest.TestCase):
    def test_cik_map_share_classes_and_ambiguity(self):
        doc = {'0': {'cik_str': 1067983, 'ticker': 'BRK-B'}, '1': {'cik_str': 1, 'ticker': 'DUP'},
               '2': {'cik_str': 2, 'ticker': 'DUP'}, '3': {'cik_str': 320193, 'ticker': 'AAPL'}}
        m, missing = filings.cik_map(doc, ['BRK.B', 'AAPL', 'DUP', 'GONE'])
        self.assertEqual(m, {'BRK.B': 1067983, 'AAPL': 320193})
        self.assertEqual(missing, ['DUP', 'GONE'])


def fact(start, end, val, filed, form='10-K', accn='x'):
    return {'start': start, 'end': end, 'val': val, 'filed': filed, 'form': form, 'fp': 'FY', 'fy': 0, 'accn': accn}


FACTS = {'NetIncomeLoss': [fact('2022-01-01', '2022-12-31', 10, '2023-02-10'),
                           fact('2022-01-01', '2022-12-31', 8, '2023-06-01', '10-K/A'),     # restatement
                           fact('2023-01-01', '2023-03-31', 3, '2023-05-01', '10-Q')],     # quarterly: ignored
         'Assets': [fact(None, '2022-12-31', 100, '2023-02-10')],
         'Liabilities': [fact(None, '2022-12-31', 60, '2023-02-10')]}
for rows in FACTS.values():
    for r in rows:
        if r['start'] is None:
            del r['start']


class Fundamentals(unittest.TestCase):
    def test_no_value_before_its_filing_and_restatements_only_from_their_own_date(self):
        self.assertIsNone(filings.fundamentals_at(FACTS, '2023-02-10'))          # filed that day: not yet usable
        f = filings.fundamentals_at(FACTS, '2023-02-13')
        self.assertAlmostEqual(f['roa'], 0.10)
        self.assertAlmostEqual(f['safety'], 0.40)
        self.assertAlmostEqual(filings.fundamentals_at(FACTS, '2023-06-01')['roa'], 0.10)
        self.assertAlmostEqual(filings.fundamentals_at(FACTS, '2023-06-02')['roa'], 0.08)

    def test_stale_and_missing_are_unknown(self):
        self.assertIsNone(filings.fundamentals_at(FACTS, '2024-07-10'))          # fiscal year > 550 days old
        no_liab = {k: v for k, v in FACTS.items() if k != 'Liabilities'}
        self.assertIsNone(filings.fundamentals_at(no_liab, '2023-03-01'))
        eq = dict(no_liab, StockholdersEquity=[{'end': '2022-12-31', 'val': 30, 'filed': '2023-02-10', 'form': '10-K',
                                                 'fp': 'FY', 'fy': 0, 'accn': 'x'}])
        self.assertAlmostEqual(filings.fundamentals_at(eq, '2023-03-01')['safety'], 0.30)

    def test_extract_keeps_only_usd_registered_concepts(self):
        doc = {'facts': {'us-gaap': {'Assets': {'units': {'USD': [{'end': '2022-12-31', 'val': 1, 'filed': '2023-01-01'}],
                                                          'EUR': [{'end': '2022-12-31', 'val': 2, 'filed': '2023-01-01'}]}},
                                     'Revenues': {'units': {'USD': [{'end': '2022-12-31', 'val': 3, 'filed': '2023-01-01'}]}}}}}
        x = filings.extract_facts(doc)
        self.assertEqual([r['val'] for r in x['Assets']], [1])
        self.assertNotIn('Revenues', x)


class Recovery(unittest.TestCase):
    """V1: halt, 20-session cooldown, regime-gated partial re-entry, full weights after 3 partial decisions."""

    def setUp(self):
        self.n = 160
        self.ss = sessions(self.n)
        self.se = {'AAA': flat(self.n, 100.0)}
        for k in range(10, self.n):              # an 11% drop at session 10 triggers the halt
            for f in ('o', 'c', 'ao', 'ac'):
                self.se['AAA'][f][k] = 89.0
        self.decs = [{'signal_index': k, 'targets': {'AAA': 1.0}} for k in range(1, self.n - 1, 10)]

    def sim(self, regime, **kw):
        rec = dict(nextgen.RECOVERY, regime=regime) | kw
        return engine.simulate(self.ss, self.se, [], self.decs, start_index=1, end_index=self.n - 1, capital=10_000.0,
                               cost_bps=0.0, halt=True, recovery=rec)

    def test_no_recovery_is_the_original_rule(self):
        r = engine.simulate(self.ss, self.se, [], self.decs, start_index=1, end_index=self.n - 1, capital=10_000.0,
                            cost_bps=0.0, halt=True)
        self.assertEqual(r['halted_on'], self.ss[10])
        self.assertEqual(r['reentries'], [])
        self.assertTrue(all(t['side'] == 'sell' for t in r['trades'] if t['date'] > self.ss[10]))

    def test_cooldown_then_partial_then_full(self):
        r = self.sim([True] * self.n)
        self.assertEqual(len(r['halts']), 1)
        first = r['reentries'][0]['date']
        # liquidation at session 11's open; 20 completed sessions after it; first decision after that executes.
        self.assertGreater(self.ss.index(first), 11 + 20)
        buys = [t for t in r['trades'] if t['side'] == 'buy' and t['date'] >= first]
        self.assertAlmostEqual(buys[0]['shares'] * 89.0 / r['reentries'][0]['equity'], 0.5, delta=0.02)
        later = [t for t in buys if t['date'] > first]
        self.assertTrue(later, 'full weights after three partial decisions')
        self.assertAlmostEqual(r['exposure'][-1], 1.0, delta=0.02)

    def test_regime_off_keeps_cash(self):
        r = self.sim([False] * self.n)
        self.assertEqual(r['reentries'], [])
        self.assertEqual(r['exposure'][-1], 0.0)
        self.assertGreater(r['cash_sessions'], 100)

    def test_regime_turning_off_in_partial_goes_back_to_cash(self):
        regime = [True] * self.n
        first_dec_after_cooldown = next(d['signal_index'] for d in self.decs if d['signal_index'] > 11 + 20)
        for k in range(first_dec_after_cooldown + 1, self.n):
            regime[k] = False
        r = self.sim(regime)
        self.assertEqual(r['reentries'][1].get('exit'), 'regime')
        self.assertEqual(r['exposure'][-1], 0.0)

    def test_repeat_breach_starts_a_new_halt(self):
        for k in range(100, self.n):
            for f in ('o', 'c', 'ao', 'ac'):
                self.se['AAA'][f][k] = 70.0
        r = self.sim([True] * self.n)
        self.assertEqual(len(r['halts']), 2)
        self.assertTrue(all(h['exit_equity'] is not None for h in r['halts']))


class Weights(unittest.TestCase):
    def test_inverse_vol_caps_and_sums_to_one(self):
        ss = sessions(80)
        se = {}
        names = ['A', 'B', 'C', 'D', 'E']
        for i, s in enumerate(names):
            x = flat(80, 50.0)
            amp = [0.001, 0.02, 0.03, 0.03, 0.04][i]
            x['ac'] = [50.0 * (1 + (amp if j % 2 else -amp)) for j in range(80)]
            se[s] = x
        w = nextgen.inverse_vol_weights(se, names, 79)
        self.assertAlmostEqual(sum(w.values()), 1.0)
        self.assertAlmostEqual(w['A'], 0.30)
        self.assertGreater(w['B'], w['C'])
        self.assertTrue(all(x <= 0.30 + 1e-9 for x in w.values()))
        # With too few names the cap leaves cash rather than leverage.
        self.assertAlmostEqual(sum(nextgen.inverse_vol_weights(se, names[:3], 79).values()), 0.90)

    def test_buffer_keeps_a_held_name_inside_the_first_ten(self):
        ranked = [{'symbol': f'S{i}', 'sector': f'X{i}'} for i in range(20)]
        self.assertEqual(nextgen.pick(ranked, keep=['S8']), ['S8', 'S0', 'S1', 'S2', 'S3'])
        self.assertEqual(nextgen.pick(ranked, keep=['S2', 'S3'], n=2), ['S2', 'S3'])


class Benchmark(unittest.TestCase):
    def test_matched_v2_uses_only_exposure_known_before_each_bar(self):
        ss = sessions(4)
        spy = {'o': [100, 100, 110, 110], 'c': [100, 110, 110, 121], 'ao': [100, 100, 110, 110], 'ac': [100, 110, 110, 121]}
        # Fully invested from the first open: the first session's open-to-close +10% is earned...
        c = nextgen.exposure_matched_v2(ss, spy, [1.0, 1.0, 1.0], [1.0, 1.0, 1.0], 1, 3, 1000.0)
        self.assertAlmostEqual(c[1][1], 1100.0)
        # ...but if the candidate only bought at the second open, nothing is earned before it.
        c = nextgen.exposure_matched_v2(ss, spy, [0.0, 1.0, 1.0], [0.0, 1.0, 1.0], 1, 3, 1000.0)
        self.assertAlmostEqual(c[1][1], 1000.0)
        self.assertAlmostEqual(c[3][1], 1100.0)

    def test_original_matched_benchmark_uses_same_bar_exposure_on_the_first_session(self):
        # Half invested at the first open; the candidate's stock then doubles intraday, so its end-of-day
        # exposure (2/3) reflects that same bar's outcome. SPY rises 10% open-to-close that day.
        from analytics.research import evaluate as ev
        ss = sessions(2)
        spy = {'o': [100, 100], 'c': [100, 110], 'ao': [100, 100], 'ac': [100, 110]}
        old = ev.exposure_matched(ss, spy, [2 / 3], 1, 1, 1000.0)
        new = nextgen.exposure_matched_v2(ss, spy, [2 / 3], [0.5], 1, 1, 1000.0)
        self.assertAlmostEqual(new[1][1], 1050.0)            # known at the open: 50% of +10%
        self.assertNotAlmostEqual(old[1][1], 1050.0)        # original: 2/3 of +10% (same-bar information)
        self.assertAlmostEqual(old[1][1], 1000 * (1 + 0.1 * 2 / 3))

    def test_bootstrap_is_reproducible(self):
        r = [0.001 * ((i * 7) % 11 - 5) for i in range(500)]
        a = nextgen.block_bootstrap(r, nextgen.sharpe)
        self.assertEqual(a, nextgen.block_bootstrap(r, nextgen.sharpe))
        self.assertLessEqual(a['p05'], a['p95'])
        self.assertIsNone(nextgen.block_bootstrap(r[:50], nextgen.sharpe))


if __name__ == '__main__':
    unittest.main()


class PipelineSmoke(unittest.TestCase):
    """The evaluation pipeline end to end on synthetic trending prices (no network)."""

    def test_evaluate_candidate_all_paths_and_gates(self):
        from analytics.research import evaluate as ev, nextgen_cli
        from analytics.research import candidates as cand
        n = 420
        ss = sessions(n, start=date_(2022))
        se, members = {}, []
        for i in range(8):
            drift = 0.0004 * (i + 1)
            px = [20.0 * (1 + drift) ** k * (1 + 0.01 * ((k * (i + 3)) % 7 - 3)) for k in range(n)]
            se[f'S{i}'] = {'o': px[:], 'c': px[:], 'ao': px[:], 'ac': px[:], 'v': [5_000_000] * n}
            members.append({'symbol': f'S{i}', 'sector': f'X{i % 4}'})
        spy = [100.0 * 1.0003 ** k for k in range(n)]
        se['SPY'] = {'o': spy[:], 'c': spy[:], 'ao': spy[:], 'ac': spy[:], 'v': [1e8] * n}
        start_k, end_k = 300, n - 1
        spy_curve = ev.hold_curve(ss, se['SPY'], start_k, end_k)
        bench = {'spy-hold': ev.summarize(spy_curve, ss[start_k], ss[end_k]), 'weekly': {}}
        ctx = {'sessions': ss, 'series': se, 'actions': [], 'start_k': start_k, 'end_k': end_k, 'bench': bench,
               'spy_curve': spy_curve, 'spy_rets': nextgen.daily_returns(spy_curve)}
        kw = {'first_signal': ss[start_k - 1], 'last_exec': ss[end_k]}
        b0 = cand.momentum_quality_decisions(ss, se, members, **kw)
        self.assertTrue(b0 and any(d['targets'] for d in b0))
        r = nextgen_cli.evaluate_candidate('b0', b0, ctx)
        self.assertEqual(set(r['result']), {'decisions', *[f'bps{c}' for c in nextgen.COSTS]})
        self.assertIn(r['gates']['verdict'], ('FAILS', 'QUALIFIES FOR INDEPENDENT REVIEW'))
        ctx['b0_rets'] = nextgen.daily_returns(nextgen_cli._sim(ss, se, [], b0, start_k, end_k, cost=10, halt=False)['curve'])
        rec = nextgen_cli.evaluate_candidate('rec', b0, ctx, recovery=dict(nextgen.RECOVERY, regime=nextgen.spy_regime(se['SPY'], n)))
        self.assertEqual(rec['judged_path'], 'recovery')
        self.assertIn('every_halt_exit_within_15pct', rec['gates']['gates'])
        self.assertIsNotNone(rec['bootstrap_10bps']['sharpe_minus_b0'])
        for builder in (nextgen.buffer_decisions, nextgen.invvol_decisions, nextgen.wide_decisions):
            d = builder(ss, se, members, **kw)
            self.assertEqual(len(d), len(b0))
            self.assertTrue(all(sum(x['targets'].values()) <= 1.0 + 1e-9 for x in d))
        text = nextgen_cli.render({'window': [ss[start_k], ss[end_k]], 'prereg': nextgen.PREREG, 'overall': 'NONE QUALIFIES',
                                   'data': {'fingerprint': 'f' * 16}, 'fingerprints': {'code_commit': 'local'},
                                   'benchmarks': bench, 'results': {'b0': r, 'rec': rec}, 'status': {}})
        self.assertIn('| rec | recovery | 10 |', text)


def date_(y):
    from datetime import date
    return date(y, 1, 3)
