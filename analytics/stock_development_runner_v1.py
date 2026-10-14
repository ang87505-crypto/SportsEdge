"""Development-only, offline historical price-proxy replay of frozen strategies.

Uses PR #43 accounting and selectors unchanged. No provider, broker, automatic
publication or historical-source admission. A source reviewer must supply a
licensed normalized bundle; unsupported corporate events abort the study.
"""
from copy import deepcopy
from datetime import date
from decimal import Decimal as D
import hashlib
import json
from pathlib import Path
import platform

from .stock_accounting_v2 import (exact, require, validate_state, validate_calendar,
    plan_open, close_session, stamp, NY)
from .stock_momentum_v1 import VERSION as BASELINE, digest
from .stock_rank_buffer_candidate import VERSION as CANDIDATE
from .stock_universe_account_v1 import plan_universe
from .stock_readiness_pipeline_v1 import verify_freezes, reconcile, PROTOCOL
from .stock_report_statistics_v1 import monthly_statistics
from .stock_development_metrics_v1 import account_statistics, wealth_statistics

VERSION = 'stock-development-replay-v1'
START, END = '2000-01-01', '2011-12-31'
MONTHS = [f'{y}-{m:02}' for y in range(2000, 2012) for m in range(1, 13)]
SCENARIOS = ((15, 0), (25, 100), (50, 100))
REVIEWS = ('license', 'pit_membership_including_delisted', 'historical_classifications',
           'raw_actions_and_consolidated_volume', 'availability_and_revisions',
           'exchange_and_settlement_calendars', 'corporate_event_economics',
           'execution_proxy', 'benchmarks', 'prior_holdout_exposure')


def _json(raw):
    def pairs(items):
        out = {}
        for key, val in items:
            require(key not in out, 'Duplicate JSON key: ' + key)
            out[key] = val
        return out
    def invalid(value):
        raise ValueError('Nonfinite JSON: ' + value)
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)


def _manifest(manifest):
    # Inspect manifest metadata BEFORE opening or hashing any source payload.
    require(set(manifest) == {'version', 'kind', 'phase', 'start', 'end',
        'protocol_sha256', 'rights_scope', 'dataset_revision', 'bundle', 'reviews'},
        'Exact manifest schema required')
    require(manifest['version'] == VERSION and manifest['kind'] == 'historical_price_proxy',
            'Historical manifest version/kind required')
    require(manifest['phase'] == 'development' and manifest['start'] == START
            and manifest['end'] == END, 'Only full registered development period allowed; validation/test access blocked')
    require(manifest['rights_scope'] == 'local_research', 'Local research rights required; do not export cloud-only data')
    require(isinstance(manifest['dataset_revision'], str) and bool(manifest['dataset_revision'].strip()),
            'Dataset revision required')
    require(manifest['protocol_sha256'] == hashlib.sha256(PROTOCOL.read_bytes()).hexdigest(),
            'Protocol hash mismatch')
    require(set(manifest['reviews']) == set(REVIEWS), 'Every source review must be inventoried')
    for name, review in manifest['reviews'].items():
        require(set(review) == {'reviewer', 'status', 'evidence'} and review['status'] == 'reviewed'
                and isinstance(review['reviewer'], str) and bool(review['reviewer'].strip()),
                'Unreviewed source gate: ' + name)


def _read(root, entry):
    require(set(entry) == {'path', 'sha256'}, 'Relative path and SHA256 required')
    require(isinstance(entry['path'], str) and not Path(entry['path']).is_absolute(), 'Relative source path required')
    path = (root / entry['path']).resolve()
    require(path.is_relative_to(root) and path.is_file(), 'Missing or out-of-root source file')
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == entry['sha256'], 'Source hash mismatch: ' + entry['path'])
    return raw


def load_development(root, manifest):
    """Hash-bound review declarations do not authenticate truth or completeness.

    Manifest must inventory DEVELOPMENT-ONLY bytes. It is impossible to certify
    hidden dates inside a mislabeled payload without reading those bytes first.
    Never point this loader at a mixed development/validation/test archive.
    """
    verify_freezes(); _manifest(manifest)
    root = Path(root).resolve()
    for review in manifest['reviews'].values():
        _read(root, review['evidence'])
    data = _json(_read(root, manifest['bundle']))
    validate_development(data)
    return data


def _structure(data, kind):
    require(set(data) == {'initial_account', 'calendar', 'settlement', 'rows', 'benchmarks', 'risk_free'},
            'Exact normalized bundle schema required; no caller targets, holdings or cost overrides')
    initial = data['initial_account']; validate_state(initial)
    require(initial['settled_cash_cents'] == 100000 and initial['revision'] == 0
            and initial['as_of'] == initial['origin_at']
            and not any(initial[k] for k in ('positions', 'unsettled', 'receivables',
                         'processed_events', 'executed_decisions', 'action_history')),
            'Fresh $1,000 cash-only origin required')
    sessions = validate_calendar(data['calendar'])
    require(isinstance(data['rows'], list) and bool(data['rows']), 'Session rows required')
    prior = stamp(initial['as_of']).astimezone(NY).date().isoformat()
    require(prior in sessions, 'Origin absent from calendar')
    expected = list(sessions); cursor = expected.index(prior)
    for row in data['rows']:
        require(set(row) <= {'session', 'evidence'} and 'session' in row, 'Unexpected row fields')
        s = row['session']; cursor += 1
        require(cursor < len(expected) and s['date'] == expected[cursor], 'Missing/reordered/duplicate exchange session')
        require(s['kind'] == kind, 'Mixed historical/synthetic input forbidden')
        monthly = prior[:7] != s['date'][:7]
        require((row.get('evidence') is not None) == monthly, 'Exactly one decision at each first monthly session required')
        if monthly:
            require(isinstance(row['evidence']['shards'], list), 'Reusable full-universe shards required')
        # A source adapter supplies unspread raw opens in the existing quote
        # contract. These are explicitly hypothetical open-price proxies, not
        # observed bid/ask or an assertion of pre-open price knowledge.
        for q in s['quotes']:
            require(q['bid'] == q['ask'], 'Unspread raw-open proxies required; refusing double spread')
        prior = s['date']


def validate_development(data):
    _structure(data, 'historical_price_proxy')
    sessions = data['calendar']['sessions']
    wanted = [s['date'] for s in sessions if START <= s['date'] <= END]
    actual = [r['session']['date'] for r in data['rows']]
    require(actual == wanted and {d[:7] for d in actual} == set(MONTHS),
            'Every development exchange session and all 144 months required')
    require(actual[0][:7] == '2000-01' and actual[-1][:7] == '2011-12', 'Incomplete development coverage')
    require(all(s['date'] <= END for s in sessions), 'Post-development exchange calendar forbidden')
    origin = data['initial_account']['as_of'][:10]
    require(origin < START and len([s for s in sessions if s['date'] <= origin]) >= 253,
            'Pre-development origin with at least 253 warmup sessions required')
    # Reject future payload rows even though the selector normally ignores them.
    for row in data['rows']:
        e = row.get('evidence')
        if e is None: continue
        at = stamp(e['decision_at'])
        require(at.astimezone(NY).date().isoformat() == row['session']['date'], 'Decision/session mismatch')
        for shard in e['shards']:
            for bar in shard['payload']['bars']:
                require(bar['session_date'] < row['session']['date'], 'Future price row in decision evidence')
        require(all(a['session_date'] < row['session']['date'] for a in e['context']['actions']),
                'Future action row in decision evidence')
    dates = [origin] + actual
    require(set(data['benchmarks']) == {'broad_market_total_return', 'half_market_half_cash'},
            'Both registered benchmark paths required')
    for benchmark in data['benchmarks'].values():
        require(set(benchmark) == {'dates', 'wealth', 'source_revision', 'convention'}, 'Benchmark schema mismatch')
        require(benchmark['dates'] == dates and benchmark['source_revision'] and benchmark['convention'],
                'Benchmark dates/provenance must align')
        wealth_statistics(dates, benchmark['wealth'], data['risk_free'])


@exact
def replay_case(data, strategy, bps, fee):
    """Internal execution shared by historical and explicitly synthetic paths."""
    require(strategy in (BASELINE, CANDIDATE) and (bps, fee) in SCENARIOS, 'Frozen strategy/costs only')
    state = deepcopy(data['initial_account']); outputs = []; receipts = []
    total_cost = D(0); trade_ids = set()
    costs = dict(version='explicit-usd-costs-v2', assumption_id=f'frozen-{bps}bps-{fee}c',
                 slippage_bps=str(bps - 5), fee_cents_per_order=fee)
    for row in data['rows']:
        session = deepcopy(row['session'])
        for q in session['quotes']:
            require(q['bid'] == q['ask'], 'Unspread raw open required')
            raw = D(q['bid']); q['bid'] = str(raw * D('0.9995')); q['ask'] = str(raw * D('1.0005'))
        opening = {k: v for k, v in session.items() if k != 'close_marks'}
        if row.get('evidence') is not None:
            plan = plan_universe(state, row['evidence'], opening, selection_strategy=strategy,
                calendar=data['calendar'], settlement=data['settlement'], costs=costs)
        else:
            plan = plan_open(state, opening, None, decision_id=None,
                calendar=data['calendar'], settlement=data['settlement'], costs=costs)
        closed = close_session(plan, session)
        checked_day = reconcile(state, dict(state=closed['state'], sessions=[closed]))
        total_cost += D(checked_day['costs_dollars'])
        for trade in closed['trades']:
            require(trade['trade_id'] not in trade_ids, 'Duplicate trade across sessions')
            trade_ids.add(trade['trade_id'])
        receipts.append(digest(closed))
        state = closed['state']
        # Retain only small report inputs, not a copy of the full-universe marks
        # and growing event history for every day of a twelve-year replay.
        outputs.append(dict(session_date=closed['session_date'], close_nav=closed['close_nav'],
            open_nav_before=closed['open_nav_before'], trades=closed['trades'],
            cash_constraints=closed['cash_constraints'], state=dict(positions=deepcopy(state['positions']),
            marks={sid: deepcopy(state['marks'][sid]) for sid in state['positions']})))
    result = dict(sessions=outputs)
    checked = dict(sessions=len(outputs), trades=len(trade_ids), costs_dollars=str(total_cost),
        ending_nav_dollars=outputs[-1]['close_nav'], all_receipts_reconciled=True)
    report = account_statistics(data['initial_account'], result, data['risk_free'])
    require(D(report['costs']['total_dollars']) == D(checked['costs_dollars']), 'Report/receipt costs disagree')
    return dict(strategy=strategy, output_sha256=digest(dict(receipts=receipts, state=state)),
                reconciliation=checked, statistics=report)


@exact
def run_bundle(data, *, synthetic=False):
    protected = verify_freezes()
    if synthetic: _structure(data, 'synthetic_fixture')
    else: validate_development(data)
    runs = []
    for bps, fee in SCENARIOS:
        baseline = replay_case(data, BASELINE, bps, fee)
        candidate = replay_case(data, CANDIDATE, bps, fee)
        b, c = baseline['statistics'], candidate['statistics']
        require(b['months'] == c['months'], 'Paired months differ')
        paired = None if synthetic else monthly_statistics(b['months'], b['monthly_returns'], c['monthly_returns'])
        runs.append(dict(nominal_one_way_bps=bps, fee_cents_per_order=fee,
                         baseline=baseline, candidate=candidate, paired_comparison=paired))
    benchmarks = {name: wealth_statistics(b['dates'], b['wealth'], data['risk_free'])
                  for name, b in data['benchmarks'].items()}
    for run in runs:
        for name in ('baseline', 'candidate'):
            s = run[name]['statistics']
            s['benchmark_relative'] = {key: dict(
                cumulative_return_difference=s['cumulative_return'] - val['cumulative_return'],
                cagr_difference=s['cagr'] - val['cagr']) for key, val in benchmarks.items()}
    return dict(version=VERSION, kind='SYNTHETIC_ENGINEERING_ONLY' if synthetic else 'HISTORICAL_DEVELOPMENT_PROXY_PENDING_REVIEW',
        performance=None if synthetic else runs, engineering_scenarios=runs if synthetic else None,
        benchmarks=benchmarks, input_sha256=digest(data), protected_sha256=protected,
        protocol_sha256=hashlib.sha256(PROTOCOL.read_bytes()).hexdigest(),
        source_independently_verified=False, historical_study_approved=False,
        validation_accessed=False, sealed_test_accessed=False,
        trading_enabled=False, automatic_paper_trades=False,
        environment=dict(python=platform.python_version(), decimal_precision=60),
        limitations=['Source review declarations are not authenticated by this runner.',
            'Unsupported delisting/merger/spinoff/fractional/combined events abort; no omitted bad histories.',
            'Open-contingent sizing and bid/ask are execution proxies, not observed executable quotes.',
            '15/25/50 nominal bp scenarios compound spread and slippage; 25/50 also charge $1 per order.',
            'Benchmark paths require separately reviewed total-return, cash and cost conventions.',
            'No validation or sealed-period runner, automatic source admission, publication or promotion.'])


def main():
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest', required=True, type=Path)
    p.add_argument('--root', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    args = p.parse_args()
    require(not args.output.exists(), 'Choose a new output path')
    manifest = _json(args.manifest.read_bytes())
    data = load_development(args.root, manifest)
    report = run_bundle(data)
    report['manifest_sha256'] = digest(manifest)
    report['dataset_revision'] = manifest['dataset_revision']
    # Exclusive creation only after ALL six runs succeed: never a partial report.
    with args.output.open('x') as stream:
        json.dump(report, stream, indent=2, allow_nan=False); stream.write('\n')


if __name__ == '__main__':
    main()
