"""Fictional prices/calendar/identities; no market or return evidence."""
from copy import deepcopy
import json
import subprocess
import unittest
from analytics.test_stock_momentum_v1 import fixture
from analytics.stock_forward_signal_v1 import forward_signal, BASELINE, CANDIDATE
from analytics.stock_momentum_v1 import generate


def source():
    f = fixture(('AAA', 'BBB', 'CCC'))
    f['payload']['bars'] = [b for b in f['payload']['bars'] if b['session_date'] < '2026-10-01']
    f['payload']['retrieved_at'] = f['decision_at']
    shards = []
    for u in f['context']['universe']:
        payload = deepcopy(f['payload'])
        payload['bars'] = [b for b in payload['bars'] if b['symbol'] == u['symbol']]
        shards.append({'security_id': u['security_id'], 'payload': payload})
    return dict(experiment_id='SYNTHETIC-engineering', registered_at='2026-09-01T00:00:00Z',
        observed_at='2026-10-01T12:00:01Z', model_version=BASELINE, held_security_ids=[],
        evidence=dict(shards=shards, context=f['context'], decision_at=f['decision_at'],
            listings={u['security_id']:dict(first_traded_on='2000-01-03',
                available_at='2026-09-01T00:00:00Z', source_id='synthetic-listing-'+u['symbol'])
                for u in f['context']['universe']}))


class ForwardSignalTests(unittest.TestCase):
    def test_baseline_matches_frozen_generator(self):
        b = source(); r = forward_signal(b)
        expected = generate(**fixture(('AAA', 'BBB', 'CCC')))
        self.assertEqual(sorted(t['symbol'] for t in r['targets']),
                         sorted(t['symbol'] for t in expected['targets']))
        self.assertFalse(r['executionPermitted']); self.assertIsNone(r['performance'])
        self.assertFalse(r['sourceIndependentlyVerified'])

    def test_candidate_and_actual_holdings_bound(self):
        b = source(); base = forward_signal(b)
        b['model_version'] = CANDIDATE; b['held_security_ids'] = ['id-AAA']
        r = forward_signal(b)
        self.assertNotEqual(base['decisionId'], r['decisionId'])
        self.assertEqual(r['heldSecurityIds'], ['id-AAA'])

    def test_missing_member_or_held_identity_rejected(self):
        b = source(); b['evidence']['shards'].pop()
        with self.assertRaises(ValueError): forward_signal(b)
        b = source(); b['held_security_ids'] = ['delisted-not-reconciled']
        with self.assertRaises(ValueError): forward_signal(b)

    def test_late_registration_capture_or_retrieval_rejected(self):
        for field in ('registered_at', 'observed_at'):
            b = source(); b[field] = '2026-10-01T12:02:00Z'
            with self.assertRaises(ValueError): forward_signal(b)
        b = source(); b['evidence']['shards'][0]['payload']['retrieved_at'] = '2026-10-02T00:00:00Z'
        with self.assertRaises(ValueError): forward_signal(b)

    def test_target_injection_and_reserved_period_rejected(self):
        b = source(); b['targets'] = []
        with self.assertRaises(ValueError): forward_signal(b)
        for year in (2011, 2025, 2027):
            b = source(); b['evidence']['decision_at'] = f'{year}-10-01T12:00:00Z'
            with self.assertRaises(ValueError): forward_signal(b)

    def test_repeat_and_input_immutability(self):
        b = source(); before = deepcopy(b); result = forward_signal(b)
        self.assertEqual(b, before); self.assertEqual(result, forward_signal(b))

    def test_python_signal_to_node_rebalance(self):
        signal = forward_signal(source())
        script = '''
import {planComputedForwardSignal} from './src/lib/stocks/paper-strategy-rebalance.ts';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const signal=JSON.parse(raw);
const account={now:'2026-10-01T13:35:00Z',sessionOpenAt:'2026-10-01T13:30:00Z',
 sessionCloseAt:'2026-10-01T20:00:00Z',accountType:'paper',accountId:'synthetic',
 accountSnapshotAt:'2026-10-01T13:34:55Z',equityCents:100000,settledCashCents:100000,
 positionsComplete:true,ordersComplete:true,openOrderCount:0,unresolvedReceiptCount:0,
 positions:[],feeReserveCentsPerOrder:0,
 quotes:signal.targets.map(t=>({securityId:t.securityId,symbol:t.symbol,
  bidCents:4520,askCents:4521,observedAt:'2026-10-01T13:34:55Z',
  priorAdv20Shares:signal.priorInputs[t.securityId].prior_adv20_shares}))};
const result=planComputedForwardSignal(signal,account);
account.quotes[0].priorAdv20Shares++;
let rejected=false;try{planComputedForwardSignal(signal,account)}catch{rejected=true}
if(!rejected)throw Error('tampered liquidity admitted');
console.log(JSON.stringify(result));
'''
        completed = subprocess.run(['node', '--experimental-strip-types', '--input-type=module',
            '-e', script], input=json.dumps(signal), text=True, capture_output=True, check=True)
        result = json.loads(completed.stdout)
        self.assertEqual(result['phase'], 'BUY')
        self.assertEqual(len(result['legs']), 3)
        self.assertEqual(result['unusedCashCents'], 100000 - 3 * 2 * 4521)
        self.assertFalse(result['executionPermitted'])


if __name__ == '__main__':
    unittest.main()
