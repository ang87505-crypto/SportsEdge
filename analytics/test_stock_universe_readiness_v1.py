"""SYNTHETIC ONLY. Bounded-universe semantics and original-engine parity."""
from copy import deepcopy
from decimal import localcontext, Inexact, ROUND_DOWN
import unittest
from analytics.test_stock_momentum_v1 import fixture
from analytics.test_stock_candidate_adapter_v1 import ranked_account, two_month_input
from analytics.test_stock_accounting_v2 import opening, options
from analytics.stock_momentum_v1 import generate, VERSION as BASELINE
from analytics.stock_rank_buffer_candidate import generate_buffer, VERSION as BUFFER, choose
from analytics.stock_baseline_replay_v2 import plan_baseline
from analytics.stock_buffer_replay_v1 import plan_buffer
from analytics.stock_universe_scoring_v1 import score_universe
from analytics.stock_universe_account_v1 import decision_from_account, plan_universe, compare_synthetic


def sharded(args):
    context = deepcopy(args['context']); grouped = {u['symbol']: [] for u in context['universe']}
    for b in args['payload']['bars']:
        grouped[b['symbol']].append(deepcopy(b))
    metadata = {k: deepcopy(v) for k, v in args['payload'].items() if k != 'bars'}
    shards = [dict(security_id=u['security_id'], payload=dict(metadata, bars=grouped[u['symbol']]))
              for u in context['universe']]
    listings = {u['security_id']: dict(first_traded_on=context['sessions'][0]['date'],
        available_at=context['universe_available_at'], source_id='SYNTHETIC-first-trade-' + u['security_id'])
        for u in context['universe']}
    return dict(shards=shards, context=context, listings=listings, decision_at=args['decision_at'])


def economic_trades(plan):
    return [{k: v for k, v in t.items() if k != 'trade_id'} for t in plan['trades']]


class UniverseTests(unittest.TestCase):
    def test_scores_exactly_equal_original_on_valid_small_universe(self):
        args = fixture(('AAA','BBB','CCC','DDD','EEE','FFF'))
        scored = score_universe(**sharded(args))
        self.assertEqual(scored['scores'], generate(**args)['scores'])
        self.assertEqual(scored['declared_members'], 6)
        self.assertTrue(all(m['status']=='SCORED' for m in scored['members'].values()))

    def test_more_than_100000_aggregate_rows_without_truncation(self):
        args = fixture(tuple('S' + str(i).zfill(4) for i in range(400)))
        self.assertEqual(len(args['payload']['bars']), 101600)
        with self.assertRaisesRegex(ValueError, '100,000'): generate(**args)
        evidence = sharded(args)
        result = score_universe(**evidence)
        self.assertEqual(len(result['scores']), 400)
        self.assertEqual(result['processed_members'], 400)
        self.assertEqual({r['security_id'] for r in result['scores']}, set(evidence['listings']))

    def test_known_ipo_excluded_with_reason_without_missing_data_imputation(self):
        evidence = sharded(fixture())
        first = evidence['context']['sessions'][-11]['date']
        evidence['listings']['id-BBB']['first_traded_on'] = first
        evidence['shards'][1]['payload']['bars'] = [b for b in evidence['shards'][1]['payload']['bars'] if b['session_date'] >= first]
        r = score_universe(**evidence)
        self.assertEqual([s['symbol'] for s in r['scores']], ['AAA'])
        self.assertEqual(r['members']['id-BBB']['status'], 'INELIGIBLE_KNOWN_SHORT_HISTORY')
        self.assertEqual(r['members']['id-BBB']['completed_sessions'], 10)
        self.assertIsNone(r['prior_inputs']['id-BBB']['prior_adv20_shares'])

    def test_unknown_gap_not_misclassified_as_ipo(self):
        e = sharded(fixture()); e['shards'][0]['payload']['bars'].pop(0)
        with self.assertRaisesRegex(ValueError, 'Missing/unavailable'): score_universe(**e)

    def test_missing_recent_ipo_observation_fails(self):
        e = sharded(fixture()); first = e['context']['sessions'][-11]['date']
        e['listings']['id-BBB']['first_traded_on'] = first
        e['shards'][1]['payload']['bars'] = [b for b in e['shards'][1]['payload']['bars'] if b['session_date'] >= first]
        e['shards'][1]['payload']['bars'].pop(3)
        with self.assertRaisesRegex(ValueError, 'Missing/unavailable'): score_universe(**e)

    def test_listing_cannot_be_inferred_from_truncated_download(self):
        e = sharded(fixture()); e['listings']['id-BBB']['first_traded_on'] = e['context']['sessions'][10]['date']
        with self.assertRaisesRegex(ValueError, 'contradicts'): score_universe(**e)

    def test_omitted_duplicate_extra_and_mislabeled_shards_rejected(self):
        for mode in ('omitted','duplicate','extra','wrong_symbol'):
            e = sharded(fixture())
            if mode == 'omitted': e['shards'].pop()
            elif mode == 'duplicate': e['shards'].append(deepcopy(e['shards'][0]))
            elif mode == 'extra': e['shards'][0]['security_id'] = 'id-OTHER'
            else: e['shards'][0]['payload']['bars'][0]['symbol'] = 'OTHER'
            with self.subTest(mode=mode), self.assertRaises(ValueError): score_universe(**e)

    def test_all_young_universe_still_validates_context(self):
        e = sharded(fixture(('AAA',)))
        e['listings']['id-AAA']['first_traded_on'] = e['context']['sessions'][-2]['date']
        e['shards'][0]['payload']['bars'] = e['shards'][0]['payload']['bars'][-2:]
        r = score_universe(**e); self.assertEqual(r['scores'], [])
        for key, value in [('actions_complete',False), ('universe_available_at',e['decision_at'])]:
            bad = deepcopy(e); bad['context'][key] = value
            with self.assertRaises(ValueError): score_universe(**bad)

    def test_order_future_prices_decimal_and_nonmutation(self):
        e = sharded(fixture()); before = deepcopy(e); r = score_universe(**e)
        e['shards'].reverse(); e['context']['universe'].reverse()
        for s in e['shards']:
            s['payload']['bars'].reverse()
            for b in s['payload']['bars']:
                if b['session_date'] == '2026-10-01':
                    for key in ('open','high','low','close'): b[key]='999'
        with localcontext() as ctx:
            ctx.prec=6; ctx.rounding=ROUND_DOWN; ctx.traps[Inexact]=True
            self.assertEqual(r, score_universe(**e))
        self.assertEqual(r, score_universe(**before))

    def test_late_listing_and_same_instant_bar_rejected(self):
        for mode in ('listing','bar'):
            e = sharded(fixture())
            if mode == 'listing': e['listings']['id-AAA']['available_at']=e['decision_at']
            else: e['shards'][0]['payload']['bars'][0]['available_at']=e['decision_at']
            with self.subTest(mode=mode), self.assertRaises(ValueError): score_universe(**e)

    def test_split_dividend_scores_and_volume_preserve_original_math(self):
        from decimal import Decimal as D
        args=fixture(); day=args['context']['sessions'][-12]['date']
        args['context']['actions']=[dict(symbol='AAA',session_date=day,
            available_at=args['context']['actions_available_at'],split_ratio='2',
            cash_dividend_per_old_share='1',source_id='SYNTHETIC-action')]
        for b in args['payload']['bars']:
            if b['symbol']=='AAA' and b['session_date']>=day:
                for k in ('open','high','low','close'): b[k]=str(D(b[k])/2)
                b['volume']*=2
        result=score_universe(**sharded(args))
        self.assertEqual(result['scores'],generate(**args)['scores'])
        self.assertEqual(result['prior_inputs']['id-AAA']['prior_adv20_shares'],4000000)

    def test_global_selection_is_not_top_five_per_shard(self):
        f=ranked_account(); e=sharded(f['model']); r=score_universe(**e)
        original=generate(f['model']['payload'],f['model']['context'],decision_at=f['model']['decision_at'])
        self.assertEqual([s['symbol'] for s in choose(r['scores'],set())],
                         [t['symbol'] for t in original['targets'] if t['action']=='TARGET'])


class UniverseAccountTests(unittest.TestCase):
    def test_large_universe_executes_global_five_name_selection(self):
        from analytics.test_stock_accounting_v2 import fixture as accounting_fixture, session_row
        from analytics.stock_accounting_v2 import new_account
        args=fixture(tuple('S'+str(i).zfill(4) for i in range(400)))
        evidence=sharded(args); f=accounting_fixture(fee=0,slip='0')
        prior=args['context']['sessions'][-2]
        symbols={u['security_id']:u['symbol'] for u in args['context']['universe']}
        marks={sid:dict(symbol=sym,price='45.2',completed_at=prior['close_at'],
            available_at='2026-09-30T20:01:00Z') for sid,sym in symbols.items()}
        account=new_account(as_of=prior['close_at'],settled_cash_cents=100000,
            symbols=symbols,positions={},marks=marks)
        row=session_row(f['calendar'],account,'2026-10-01',bid='45.2',ask='45.2',close='45.2')
        result=compare_synthetic(account,[dict(session=row,evidence=evidence)],**options(f))
        expected={'id-S'+str(i).zfill(4):2 for i in range(5)}
        for name in ('baseline','candidate'):
            self.assertEqual(result[name]['state']['positions'],expected)
            self.assertEqual(len(result[name]['sessions'][0]['universe_adapter']['members']),400)

    def test_baseline_and_candidate_match_original_account_planners(self):
        f=ranked_account(); e=sharded(f['model'])
        for strategy, old in [(BASELINE,plan_baseline),(BUFFER,plan_buffer)]:
            model=dict(f['model'],strategy_version=strategy)
            expected=old(f['account'],model,opening(f['session']),**options(f))
            actual=plan_universe(f['account'],e,opening(f['session']),selection_strategy=strategy,**options(f))
            self.assertEqual(economic_trades(actual),economic_trades(expected))
            self.assertEqual(actual['open_nav_after'],expected['open_nav_after'])
            adapter=actual['universe_adapter'];self.assertEqual(adapter['selection_strategy'],strategy)
            self.assertEqual(adapter['equity_cents'],100000)
        self.assertEqual(e,sharded(f['model']))

    def test_actual_holdings_and_strategy_identity(self):
        f=ranked_account();e=sharded(f['model'])
        a=decision_from_account(f['account'],e,f['calendar'],selection_strategy=BASELINE)
        b=decision_from_account(f['account'],e,f['calendar'],selection_strategy=BUFFER)
        self.assertEqual(a['holdings'],{'id-FFF':2});self.assertEqual(b['holdings'],a['holdings'])
        self.assertNotEqual(a['decision_id'],b['decision_id'])
        self.assertEqual(a['targets']['id-FFF'],0);self.assertEqual(b['targets']['id-FFF'],10000)

    def test_own_account_state_recomputed_on_next_month(self):
        old=two_month_input()
        rows=[dict(session=r['session'],**({'evidence':sharded(r['model_evidence'])}
              if 'model_evidence' in r else {})) for r in old['rows']]
        data=dict(old,rows=rows);r=compare_synthetic(**data)
        for name in ('baseline','candidate'):
            s=r[name]['sessions']
            self.assertEqual(s[-1]['universe_adapter']['holdings'],s[-2]['state']['positions'])
        self.assertNotEqual(r['baseline']['sessions'][-1]['universe_adapter']['holdings'],
                            r['candidate']['sessions'][-1]['universe_adapter']['holdings'])

    def test_missing_account_mark_or_identity_substitution_rejected(self):
        for mode in ('missing','identity','price','equity_override'):
            f=ranked_account();e=sharded(f['model'])
            if mode=='missing':f['account']['marks'].pop('id-EEE')
            elif mode=='identity':e['context']['universe'][0]['security_id']='replacement'
            elif mode=='price':f['account']['marks']['id-AAA']['price']='999'
            else:e['equity_cents']=100000
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                decision_from_account(f['account'],e,f['calendar'],selection_strategy=BUFFER)

    def test_no_future_closes_or_historical_pair(self):
        f=ranked_account();e=sharded(f['model'])
        with self.assertRaisesRegex(ValueError,'Future closes'):
            plan_universe(f['account'],e,f['session'],selection_strategy=BUFFER,**options(f))
        f['session']['kind']='historical_price_proxy'
        with self.assertRaisesRegex(ValueError,'Historical study'):
            compare_synthetic(f['account'],[dict(session=f['session'],evidence=e)],**options(f))

    def test_delisting_still_stops_pair_without_zero_recovery(self):
        f=ranked_account();f['session']['events']=[dict(type='delisting',event_id='SYNTHETIC-delist',
            security_id='id-FFF',effective_at=f['session']['open_at'],available_at='2026-09-30T22:00:00Z')]
        with self.assertRaisesRegex(ValueError,'Unsupported corporate event'):
            compare_synthetic(f['account'],[dict(session=f['session'],evidence=sharded(f['model']))],**options(f))


if __name__ == '__main__':
    unittest.main()
