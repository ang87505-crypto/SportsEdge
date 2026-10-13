"""Run deterministic synthetic stock audit probes and the full inherited test suite.

No provider IO or genuine-market dataset. Existing output paths are refused.
Requires the pinned PR #30 checkout plus these additive files.
"""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from analytics.test_stock_verified_signal_replay import integrated_case
from analytics.test_stock_independent_audit import ranked_fixture,replace_signal
from analytics.stock_verified_signal_replay import checked_replay
from analytics.stock_replay_integrity_audit import guarded_replay
from analytics.stock_momentum_v1 import generate
from analytics.stock_rank_buffer_candidate import generate_buffer


def probes():
    result={}
    for name in ['valid','wrong_equity','wrong_holdings','conflicting_close','wrong_session_date','wrong_security_id','cash_dividend_without_pay_date']:
        b,_=integrated_case()
        args=b['signal_evidence'][0]['generate_args']
        if name=='wrong_equity':args['equity_cents']=90000;replace_signal(b,args)
        elif name=='wrong_holdings':args['held_symbols']=['AAA'];replace_signal(b,args)
        elif name=='conflicting_close':b['replay_input']['sessions'][0]['market'][0]['close']='999.00'
        elif name=='wrong_session_date':b['replay_input']['sessions'][-1]['date']='2026-10-02'
        elif name=='wrong_security_id':
            for r in b['replay_input']['sessions']:r['market'][0]['security_id']='different-company'
        elif name=='cash_dividend_without_pay_date':
            b['replay_input']['sessions'][-1]['actions']=[dict(symbol='AAA',source_id='synthetic-dividend',split_numerator=1,split_denominator=1,dividend_cents_per_old_share=100)]
        checked_replay(b)
        try:
            guarded_replay(b);accepted=True;reason=None
        except ValueError as exc:accepted=False;reason=str(exc)
        assert accepted==(name=='valid'),name
        result[name]={'inherited_wrapper_accepts':True,'new_guard_accepts':accepted,'new_guard_reason':reason}
    f=ranked_fixture();f['held_symbols']=['AAA','BBB','CCC','DDD','FFF']
    baseline=generate(**f);candidate=generate_buffer(**f)
    selected=lambda s:sorted(t['symbol'] for t in s['targets'] if t['action']=='TARGET')
    return {'kind':'SYNTHETIC_CORRECTNESS_ONLY','historical_prices_used':False,
            'historical_returns_measured':False,'financial_performance':None,
            'integrity_probes':result,
            'candidate_example':{'existing_holdings':f['held_symbols'],'baseline_selected':selected(baseline),
                'candidate_selected':selected(candidate),'scores_unchanged':candidate['scores']==baseline['scores'],
                'explanation':'Rank-six FFF retained instead of replacement by rank-five EEE; this demonstrates membership behavior only, not realized turnover or returns.'}}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True,type=Path)
    a=p.parse_args()
    if a.output.exists():raise ValueError('Preserve prior result; choose a NEW output file')
    proc=subprocess.run([sys.executable,'-m','unittest','discover','-s','analytics','-p','test_*.py','-q'],cwd=ROOT,capture_output=True,text=True)
    print(proc.stdout+proc.stderr,end='')
    if proc.returncode:raise RuntimeError('Test suite failed; no report written')
    result=probes();result['tests_passed']=True
    result['protocol_sha256']=hashlib.sha256((ROOT/'research/stock_audit_20261012/protocol.json').read_bytes()).hexdigest()
    with a.output.open('x') as f:json.dump(result,f,indent=2,allow_nan=False);f.write('\n')
    print('Synthetic audit report:',a.output)

if __name__=='__main__':main()
