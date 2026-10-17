"""Repeat synthetic score/account compatibility checks; never reports returns."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from analytics.test_stock_candidate_adapter_v1 import ranked_account
from analytics.test_stock_universe_readiness_v1 import sharded, economic_trades
from analytics.test_stock_accounting_v2 import opening, options
from analytics.stock_baseline_replay_v2 import plan_baseline
from analytics.stock_buffer_replay_v1 import plan_buffer
from analytics.stock_universe_account_v1 import plan_universe
from analytics.stock_universe_scoring_v1 import score_universe
from analytics.stock_momentum_v1 import VERSION as BASELINE
from analytics.stock_rank_buffer_candidate import VERSION as BUFFER


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
    if a.output.exists():raise ValueError('Choose a new output filename')
    amendment=Path(__file__).with_name('amendment.json')
    for name,sha in json.loads(amendment.read_text())['protected_sha256'].items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=sha:raise ValueError('Frozen dependency changed: '+name)
    f=ranked_account();e=sharded(f['model']);scored=score_universe(**e)
    assert scored==score_universe(**e)
    results={}
    for strategy,original in [(BASELINE,plan_baseline),(BUFFER,plan_buffer)]:
        actual=plan_universe(f['account'],e,opening(f['session']),selection_strategy=strategy,**options(f))
        old=original(f['account'],dict(f['model'],strategy_version=strategy),opening(f['session']),**options(f))
        assert economic_trades(actual)==economic_trades(old)
        assert actual==plan_universe(f['account'],e,opening(f['session']),selection_strategy=strategy,**options(f))
        results[strategy]=dict(original_economic_receipts_match=True,repeated_output_identical=True,
            selected_permanent_ids=[sid for sid,b in actual['universe_adapter']['targets'].items() if b])
    report=dict(kind='SYNTHETIC_ENGINEERING_CHECK_NOT_BACKTEST',performance=None,historical_backtest_ready=False,
        processed_members=scored['processed_members'],source_report_id=scored['report_id'],checks=results,
        amendment_sha256=hashlib.sha256(amendment.read_bytes()).hexdigest())
    with a.output.open('x') as out:json.dump(report,out,indent=2,allow_nan=False);out.write('\n')


if __name__=='__main__':main()
