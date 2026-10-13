"""Offline synthetic pipeline and independent receipt reconciliation. No provider I/O.

Historical admission is deliberately absent until source/event/execution review.
The runner never derives historical returns from arbitrary local price files.
"""
from copy import deepcopy
from decimal import Decimal as D, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
from .stock_accounting_v2 import exact, require
from .stock_universe_account_v1 import compare_synthetic
from .stock_momentum_v1 import digest

VERSION = 'stock-readiness-pipeline-v1'
ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / 'research/stock_audit_20261012/protocol.json'


def verify_freezes():
    """Verify every inherited protected source, not merely strategy labels."""
    paths = ['stock_accounting_v2_20261012/protocol_amendment.json',
             'stock_candidate_adapter_20261013/freeze.json',
             'stock_universe_readiness_20261013/amendment.json']
    verified = {}
    for path in paths:
        doc = json.loads((ROOT / 'research' / path).read_text())
        # Accounting amendment binds the original protocol separately.
        if 'original_protocol_sha256' in doc:
            require(hashlib.sha256(PROTOCOL.read_bytes()).hexdigest() == doc['original_protocol_sha256'],
                    'Original registered protocol changed')
        for name, expected in doc.get('protected_sha256', {}).items():
            actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            require(actual == expected, 'Frozen dependency changed: ' + name)
            verified[name] = actual
    return verified


@exact
def reconcile(initial, account_result):
    """Rebuild positions, cash and claims independently from public receipts.

    Does not call kernel NAV, trade rounding, settlement or payment helpers.
    This checks cents and per-order cost components, plus each closing NAV.
    """
    cash = initial['settled_cash_cents']
    positions = deepcopy(initial['positions'])
    unsettled = {r['id']: r['amount_cents'] for r in initial['unsettled']}
    claims = {r['event_id']: D(r['amount']) for r in initial['receivables']}
    total_cost = D(0); trade_ids = set(); curve = []
    for row in account_result['sessions']:
        for e in row['events']:
            kind = e['kind']
            if kind == 'sale_settlement':
                require(unsettled.pop(e['id'], None) == e['amount_cents'], 'Settlement mismatch')
                cash += e['amount_cents']
            elif kind == 'dividend_entitlement':
                require(e['event_id'] not in claims, 'Duplicate entitlement')
                if e['shares']:
                    claims[e['event_id']] = D(e['amount'])
            elif kind == 'dividend_payment':
                claim = claims.pop(e['event_id'])
                paid = int((claim * 100).to_integral_value(rounding=ROUND_HALF_UP))
                require(paid == e['amount_cents'], 'Dividend cash mismatch')
                require(D(paid)/100-claim == D(e['rounding_dollars']), 'Dividend rounding mismatch')
                cash += paid
            elif kind == 'split':
                source = next(a for a in row['state']['action_history'] if a['event_id'] == e['event_id'])
                sid = source['security_id']; old = positions.get(sid, 0)
                require(old == e['old_shares'], 'Split entitlement mismatch')
                numerator = old * source['numerator']
                require(numerator % source['denominator'] == 0, 'Unresolved fraction')
                if old:
                    positions[sid] = numerator // source['denominator']
                    require(positions[sid] == e['new_shares'], 'Split receipt mismatch')
            elif kind != 'rename':
                raise ValueError('Unreconciled event receipt: ' + kind)
        session_cost = D(0)
        for t in row['trades']:
            require(t['trade_id'] not in trade_ids, 'Duplicate trade receipt'); trade_ids.add(t['trade_id'])
            require(t['status'] == 'SIMULATED_NOT_EXECUTED', 'External execution forbidden')
            side = t['side']; require(side in ('buy','sell'), 'Invalid side')
            n = t['shares']; require(type(n) is int and n > 0, 'Whole shares required')
            fee = t['fee_cents']; gross = D(t['unit_price']) * n
            expected = int((gross*100).to_integral_value(rounding=ROUND_CEILING if side=='buy' else ROUND_FLOOR))
            expected += fee if side=='buy' else -fee
            require(expected == t['amount_cents'], 'Order cash mismatch')
            sid = t['security_id']; positions[sid] = positions.get(sid, 0) + (n if side=='buy' else -n)
            require(positions[sid] >= 0, 'Short position forbidden')
            if not positions[sid]: positions.pop(sid)
            if side=='buy': cash -= expected
            else: unsettled[t['trade_id']] = expected
            session_cost += D(fee)/100 + sum((D(t[k]) for k in
                ('spread_cost_dollars','slippage_cost_dollars','rounding_cost_dollars')), D(0))
        require(D(row['open_nav_before'])-D(row['open_nav_after']) == session_cost, 'Execution costs do not reconcile to NAV')
        total_cost += session_cost
        state = row['state']
        require(cash == state['settled_cash_cents'] and cash >= 0, 'Settled cash mismatch')
        require(positions == state['positions'], 'Position mismatch')
        require(unsettled == {r['id']: r['amount_cents'] for r in state['unsettled']}, 'Unsettled cash mismatch')
        require(claims == {r['event_id']: D(r['amount']) for r in state['receivables']}, 'Claim mismatch')
        exposure = sum((D(state['marks'][sid]['price'])*n for sid,n in positions.items()), D(0))
        expected_nav = D(cash+sum(unsettled.values()))/100 + sum(claims.values(), D(0)) + exposure
        require(expected_nav == D(row['close_nav']), 'NAV mismatch')
        curve.append(dict(date=row['session_date'], nav_dollars=str(expected_nav),
                          settled_cash_cents=cash, exposure_dollars=str(exposure)))
    require(account_result['state'] == account_result['sessions'][-1]['state'], 'Terminal account mismatch')
    return dict(sessions=len(curve), trades=len(trade_ids), costs_dollars=str(total_cost),
                ending_nav_dollars=curve[-1]['nav_dollars'], all_receipts_reconciled=True)


def synthetic_input():
    from .test_stock_candidate_adapter_v1 import two_month_input
    from .test_stock_universe_readiness_v1 import sharded
    data = two_month_input()
    # The registered study begins with cash only, not the held-stock adapter fixture.
    data['initial_account']['positions'] = {}
    data['initial_account']['settled_cash_cents'] = 100000
    data['rows'] = [dict(session=r['session'], **({'evidence':sharded(r['model_evidence'])}
                    if 'model_evidence' in r else {})) for r in data['rows']]
    return data


@exact
def run_synthetic(data=None):
    protected = verify_freezes()
    data = synthetic_input() if data is None else deepcopy(data)
    require(data['initial_account']['settled_cash_cents'] == 100000 and
            not any(data['initial_account'][k] for k in ('positions','unsettled','receivables')),
            'Registered initial account must be $1,000 cash only')
    require(all(r['session']['kind']=='synthetic_fixture' for r in data['rows']), 'Synthetic fixtures only')
    runs = []
    for bps, fee in ((15,0),(25,100),(50,100)):
        case = deepcopy(data)
        case['costs'] = dict(version='explicit-usd-costs-v2', assumption_id=f'frozen-{bps}bps-{fee}c',
                             slippage_bps=str(bps-5), fee_cents_per_order=fee)
        for row in case['rows']:
            for q in row['session']['quotes']:
                require(q['bid']==q['ask'], 'Synthetic input must supply unspread raw opening price')
                mid = D(q['bid'])
                q['bid']=str(mid*D('0.9995'));q['ask']=str(mid*D('1.0005'))
        result = compare_synthetic(**case)
        checks = {name:reconcile(case['initial_account'],result[name]) for name in ('baseline','candidate')}
        repeated = compare_synthetic(**case)
        require(result == repeated, 'Nondeterministic paired replay')
        runs.append(dict(nominal_one_way_bps=bps, fee_cents_per_order=fee,
                         input_sha256=digest(case), output_sha256=digest(result),
                         repeated_outputs_identical=True, reconciliation=checks))
    return dict(version=VERSION, kind='SYNTHETIC_ENGINEERING_ONLY', performance=None,
                historical_backtest_ready=False, protocol_sha256=hashlib.sha256(PROTOCOL.read_bytes()).hexdigest(),
                protected_sha256=protected, scenarios=runs,
                cost_convention='5bp half-spread; remaining slippage applied to bid/ask; cents rounded per order',
                real_trades=False, automatic_paper_trades=False)


def readiness():
    """Repository inventory only; never searches for credentials or price payloads."""
    return dict(version=VERSION, status='BLOCKED', performance=None,
        historical_backtest_ready=False, authorized_source_dataset_supplied=False,
        blockers=['licensed_full_PIT_universe_and_inactive_security_history_missing',
                  '1999_or_earlier_warmup_and_full_2000_2011_development_prices_missing',
                  'source_raw_prices_consolidated_volume_and_availability_unreconciled',
                  'delisting_merger_spinoff_and_fractional_entitlement_support_incomplete',
                  'historical_execution_proxy_and_calendar_review_pending',
                  'licensed_total_return_benchmark_missing',
                  'independent_rights_and_sealed_test_exposure_attestation_missing'],
        alpaca='Existing collector/gate code is available; no authorized archive bytes supplied to this run. 2026 checks cannot admit historical performance.',
        next_action='Confirm WRDS/CRSP access and permitted use; supply an authorized development-only source sample and dictionary. Reconcile events before full development data.')


def main():
    import argparse
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode',choices=('synthetic','readiness'),required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    require(not args.output.exists(), 'Output exists; choose a new path')
    result=run_synthetic() if args.mode=='synthetic' else readiness()
    with args.output.open('x') as f:json.dump(result,f,indent=2,allow_nan=False);f.write('\n')

if __name__=='__main__':main()
