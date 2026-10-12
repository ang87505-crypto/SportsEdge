"""One frozen turnover-mitigation hypothesis. Offline targets only, never trades.

Use unchanged baseline to validate inputs and compute scores. Keep eligible
holdings in top ten; fill remaining slots by baseline momentum order. Selection
can differ, but no new source feature, fitted parameter or return claim is added.
"""
from decimal import Decimal
try:
    from .stock_momentum_v1 import generate, digest
except ImportError:
    from stock_momentum_v1 import generate, digest

VERSION='stock-mom252-skip21-trend200-holdrank10-v1'
HOLD_RANK_MAX=10


def choose(scores, held_symbols):
    """Internal pure ranking kernel. Caller must use baseline-validated scores."""
    ranked=sorted((s for s in scores if s['eligible'] and s['trend_positive'] and Decimal(s['momentum'])>0),
                  key=lambda s:(Decimal(s['momentum']).copy_negate(),s['symbol']))
    retained=[s for rank,s in enumerate(ranked,1) if rank<=HOLD_RANK_MAX and s['symbol'] in held_symbols]
    selected=[];sectors={};symbols=set()
    for s in retained+ranked:
        if s['symbol'] in symbols or sectors.get(s['sector'],0)>=2:continue
        if len(selected)==5:break
        selected.append(s);symbols.add(s['symbol']);sectors[s['sector']]=sectors.get(s['sector'],0)+1
    return selected


def generate_buffer(payload, context, *, decision_at, equity_cents=100000, held_symbols=()):
    baseline=generate(payload,context,decision_at=decision_at,equity_cents=equity_cents,held_symbols=held_symbols)
    selected=choose(baseline['scores'],set(held_symbols));chosen={s['symbol'] for s in selected}
    budget=equity_cents//10
    targets=[dict(symbol=s,action='TARGET' if s in chosen else 'EXIT',
                  target_budget_cents=budget if s in chosen else 0) for s in sorted(chosen|set(held_symbols))]
    envelope={'candidate_version':VERSION,'hold_rank_max':HOLD_RANK_MAX,
              'baseline_signal':baseline,'targets':targets}
    sid=digest(envelope)
    return {**baseline,'strategy_version':VERSION,'signal_id':sid,'input_digest':sid,
            'parent_signal_id':baseline['signal_id'],'hold_rank_max':HOLD_RANK_MAX,
            'targets':targets,'cash_target_cents':equity_cents-budget*len(chosen),
            'status':'research_candidate_targets_only','performance_measured':False,
            'note':'Frozen candidate; inherited planner and historical ledger intentionally do not approve this version.'}
