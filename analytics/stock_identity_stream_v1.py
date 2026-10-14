"""Development-only session stream around unchanged selectors/accounting/reporting.

Retains one input session plus compact account reports. A monthly source bundle
is still materialized: full-market Free-node memory feasibility is NOT verified.
Any rejection poisons the stream; no resume/skip or partial performance output.
"""
from copy import deepcopy
from decimal import Decimal as D
from .stock_accounting_v2 import exact, require, stamp, NY, validate_state, validate_calendar, plan_open, close_session
from .stock_momentum_v1 import digest
from .stock_identity_bridge_v1 import normalize_evidence, checkpoint
from .stock_universe_account_v1 import plan_universe
from .stock_development_runner_v1 import START, END, MONTHS, SCENARIOS, BASELINE, CANDIDATE
from .stock_development_metrics_v1 import account_statistics, wealth_statistics
from .stock_readiness_pipeline_v1 import verify_freezes, reconcile
from .stock_report_statistics_v1 import monthly_statistics


class IdentityDevelopmentStream:
    def __init__(self, initial, calendar, settlement, *, synthetic=False):
        self.protected = verify_freezes()
        validate_state(initial); sessions = validate_calendar(calendar)
        require(initial['settled_cash_cents'] == 100000 and initial['revision'] == 0
                and initial['as_of'] == initial['origin_at']
                and not any(initial[k] for k in ('positions', 'unsettled', 'receivables',
                                                 'processed_events', 'executed_decisions', 'action_history')),
                'Fresh $1,000 cash origin required')
        origin = stamp(initial['as_of']).astimezone(NY).date().isoformat()
        require(origin in sessions and stamp(sessions[origin]['close_at']) == stamp(initial['as_of']),
                'Origin must be an exchange close')
        days = list(sessions); after = days[days.index(origin)+1:]
        require(bool(after), 'Development sessions required')
        if not synthetic:
            require(origin < START and len(days[:days.index(origin)+1]) >= 253,
                    'Pre-development origin and warmup required')
            require(all(START <= d <= END for d in after) and set(d[:7] for d in after) == set(MONTHS),
                    'Only complete 2000-2011 development calendar allowed')
        self.initial = deepcopy(initial); self.calendar = deepcopy(calendar); self.settlement = deepcopy(settlement)
        self.synthetic = synthetic; self.days = after; self.index = 0; self.failed = False; self.finished = False
        self.last_date = origin; self.input_receipts = []
        self.cases = [dict(bps=bps, fee=fee, strategy=strategy, state=deepcopy(initial),
                           output=[], receipts=[], trades=set(), total_cost=D(0))
                      for bps, fee in SCENARIOS for strategy in (BASELINE, CANDIDATE)]

    @exact
    def accept(self, row):
        require(not self.failed and not self.finished, 'Stream is failed or finished')
        try:
            self._accept(row)
        except Exception:
            self.failed = True
            raise

    def _accept(self, row):
        require(set(row) <= {'session', 'evidence', 'identity_records'} and 'session' in row,
                'Unexpected stream row fields')
        session = deepcopy(row['session'])
        require(self.index < len(self.days) and session['date'] == self.days[self.index],
                'Missing/repeated/out-of-period exchange session')
        kind = 'synthetic_fixture' if self.synthetic else 'historical_price_proxy'
        require(session['kind'] == kind, 'Mixed historical/synthetic stream forbidden')
        monthly = self.last_date[:7] != session['date'][:7]
        require(('evidence' in row) == monthly and ('identity_records' in row) == monthly,
                'Exactly one identity-bound decision per first monthly session required')
        normalized = scored = source_receipt = None
        if monthly:
            require(stamp(row['evidence']['decision_at']).astimezone(NY).date().isoformat() == session['date'],
                    'Decision/session mismatch')
            normalized, scored, source_receipt = normalize_evidence(row['evidence'], row['identity_records'])
        for q in session['quotes']:
            require(q['bid'] == q['ask'], 'Unspread raw-open proxy required')
            raw = D(q['bid']); q['bid'] = str(raw * D('0.9995')); q['ask'] = str(raw * D('1.0005'))
        opening = {k: v for k, v in session.items() if k != 'close_marks'}
        # Commit all six accounts together only after every path reconciles.
        changes = []
        for case in self.cases:
            state = case['state']; bound = state; receipt = None
            costs = dict(version='explicit-usd-costs-v2', assumption_id=f"frozen-{case['bps']}bps-{case['fee']}c",
                         slippage_bps=str(case['bps']-5), fee_cents_per_order=case['fee'])
            if monthly:
                bound, receipt = checkpoint(state, normalized, scored, row['identity_records'])
                plan = plan_universe(bound, normalized, opening, selection_strategy=case['strategy'],
                    calendar=self.calendar, settlement=self.settlement, costs=costs)
            else:
                plan = plan_open(bound, opening, None, decision_id=None,
                    calendar=self.calendar, settlement=self.settlement, costs=costs)
            closed = close_session(plan, session)
            checked = reconcile(state, dict(state=closed['state'], sessions=[closed]))
            ids = [t['trade_id'] for t in closed['trades']]
            require(len(ids) == len(set(ids)) and not set(ids) & case['trades'], 'Duplicate trade receipt')
            final = closed['state']
            compact = dict(session_date=closed['session_date'], close_nav=closed['close_nav'],
                open_nav_before=closed['open_nav_before'], trades=closed['trades'],
                cash_constraints=closed['cash_constraints'], state=dict(positions=deepcopy(final['positions']),
                marks={sid: deepcopy(final['marks'][sid]) for sid in final['positions']}))
            changes.append((final, compact, ids, checked, digest(dict(closed=closed,
                              identity_checkpoint=receipt, identity_source=source_receipt))))
        for case, (state, compact, ids, checked, receipt) in zip(self.cases, changes):
            case['state'] = state; case['output'].append(compact); case['trades'].update(ids)
            case['total_cost'] += D(checked['costs_dollars']); case['receipts'].append(receipt)
        self.input_receipts.append(digest(row)); self.index += 1; self.last_date = session['date']

    @exact
    def finish(self, benchmarks, risk_free):
        require(not self.failed and not self.finished, 'Stream is failed or finished')
        try:
            result = self._finish(benchmarks, risk_free)
        except Exception:
            self.failed = True
            raise
        self.finished = True
        return result

    def _finish(self, benchmarks, risk_free):
        require(self.index == len(self.days), 'Incomplete development stream; no performance report')
        if not self.synthetic:
            require(set(benchmarks) == {'broad_market_total_return', 'half_market_half_cash'},
                    'Both registered benchmarks required')
        dates = [self.initial['as_of'][:10]] + self.days
        reports = {}
        for key, b in benchmarks.items():
            require(set(b) == {'dates', 'wealth', 'source_revision', 'convention'}
                    and b['dates'] == dates and b['source_revision'] and b['convention'],
                    'Benchmark alignment/provenance mismatch')
            reports[key] = wealth_statistics(b['dates'], b['wealth'], risk_free)
        cases = []
        for case in self.cases:
            report = account_statistics(self.initial, dict(sessions=case['output']), risk_free)
            require(D(report['costs']['total_dollars']) == case['total_cost'], 'Receipt/report cost mismatch')
            report['benchmark_relative'] = {key: dict(
                cumulative_return_difference=report['cumulative_return']-b['cumulative_return'],
                cagr_difference=report['cagr']-b['cagr']) for key, b in reports.items()}
            cases.append(dict(strategy=case['strategy'], statistics=report,
                output_sha256=digest(dict(receipts=case['receipts'], state=case['state'])),
                all_receipts_reconciled=True))
        paired = []
        for index, (bps, fee) in enumerate(SCENARIOS):
            b, c = cases[2*index:2*index+2]
            bs, cs = b['statistics'], c['statistics']
            require(bs['months'] == cs['months'], 'Paired months differ')
            paired.append(dict(nominal_one_way_bps=bps, fee_cents_per_order=fee, baseline=b, candidate=c,
                paired_comparison=None if self.synthetic else monthly_statistics(
                    bs['months'], bs['monthly_returns'], cs['monthly_returns'])))
        return dict(version='stock-identity-development-stream-v1',
            kind='SYNTHETIC_ENGINEERING_ONLY' if self.synthetic else 'HISTORICAL_DEVELOPMENT_PROXY_PENDING_REVIEW',
            performance=None if self.synthetic else paired, engineering_scenarios=paired if self.synthetic else None,
            benchmarks=reports, input_sha256=digest(self.input_receipts), protected_sha256=self.protected,
            source_independently_verified=False, historical_study_approved=False,
            validation_accessed=False, sealed_test_accessed=False, trading_enabled=False)
