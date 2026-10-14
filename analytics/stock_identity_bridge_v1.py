"""Evidence-bound identity normalization and economically neutral checkpoints.

No provider acquisition or source certification. Intervals are half-open and
must describe one permanent economic security, not a ticker or successor issuer.
No economic event is inferred from a mapping change.
"""
from copy import deepcopy
from .stock_accounting_v2 import exact, require, stamp, label, iso_day, validate_state, nav, amount
from .stock_momentum_v1 import digest
from .stock_universe_scoring_v1 import score_universe
from .stock_universe_account_v1 import plan_universe

VERSION = 'stock-identity-bridge-v1'
FIELDS = {'security_id', 'symbol', 'sector', 'exchange', 'type', 'effective_from',
          'effective_until', 'available_at', 'source_id', 'first_traded_on',
          'first_trade_available_at', 'first_trade_source_id'}


class IdentityRegistry:
    """A decision-local, historically reviewed snapshot; never current metadata.

    Availability applies to the complete record, including its interval end.
    Unknown future ends must remain null. Corrections require a newly reviewed
    vintage; overlapping revisions are not resolved by silently taking latest.
    """
    def __init__(self, records, *, decision_at):
        self.at = stamp(decision_at)
        require(isinstance(records, list) and bool(records), 'Identity records required')
        self.rows = deepcopy(records)
        self.by_id = {}
        for row in self.rows:
            require(set(row) == FIELDS, 'Exact identity interval schema required')
            for key in ('security_id', 'symbol', 'sector', 'exchange', 'type',
                        'source_id', 'first_trade_source_id'):
                label(row[key])
            start = stamp(row['effective_from'])
            end = stamp(row['effective_until']) if row['effective_until'] else None
            require(start < self.at and (end is None or start < end), 'Invalid identity interval')
            require(stamp(row['available_at']) < self.at
                    and stamp(row['first_trade_available_at']) < self.at,
                    'Identity/classification evidence unavailable at decision')
            iso_day(row['first_traded_on'])
            require(row['first_traded_on'] <= start.date().isoformat(), 'Listing begins after mapping')
            self.by_id.setdefault(row['security_id'], []).append(row)
        # Audit aliases across ALL intervals, not only active tickers.
        ordered = sorted(self.rows, key=lambda r: (r['symbol'], stamp(r['effective_from']), r['security_id']))
        for i, row in enumerate(ordered):
            for other in ordered[i + 1:]:
                if other['symbol'] != row['symbol']:
                    break
                require(not self._overlap(row, other), 'Overlapping ticker ownership')
        for rows in self.by_id.values():
            rows.sort(key=lambda r: stamp(r['effective_from']))
            first = rows[0]['first_traded_on']
            for i, row in enumerate(rows):
                require(row['first_traded_on'] == first, 'Permanent ID listing history changed')
                require(row['type'] == rows[0]['type'], 'Security conversion requires lifecycle accounting')
                if i:
                    require(not self._overlap(rows[i - 1], row), 'Overlapping permanent-ID intervals')

    @staticmethod
    def _overlap(a, b):
        return ((a['effective_until'] is None or stamp(b['effective_from']) < stamp(a['effective_until']))
                and (b['effective_until'] is None or stamp(a['effective_from']) < stamp(b['effective_until'])))

    def resolve(self, sid, at):
        time = stamp(at)
        require(time < self.at, 'Future identity lookup forbidden')
        matches = [r for r in self.by_id.get(sid, []) if stamp(r['effective_from']) <= time
                   and (r['effective_until'] is None or time < stamp(r['effective_until']))]
        require(len(matches) == 1, 'Missing/ambiguous historical identity interval')
        return deepcopy(matches[0])

    def continuous(self, sid, start, end):
        """Reject a mapping gap even when no price observation falls in it."""
        cursor = stamp(start); finish = stamp(end)
        require(cursor <= finish, 'Reversed mapping interval')
        self.resolve(sid, start); self.resolve(sid, end)
        for row in self.by_id[sid]:
            lo = stamp(row['effective_from'])
            hi = stamp(row['effective_until']) if row['effective_until'] else self.at
            if hi <= cursor:
                continue
            require(lo <= cursor, 'Gap in permanent-ID mapping')
            cursor = hi
            if cursor > finish:
                return
        raise ValueError('Incomplete permanent-ID mapping')


@exact
def normalize_evidence(raw, records):
    """Raw bars/actions MUST carry permanent IDs and observed historical tickers.

    Membership is the supplied complete prior-close context, independently
    reconciled by the source reviewer. Registry can also include retired IDs.
    Historical aliases become the prior-close ticker only AFTER ID validation;
    this preserves the frozen selector's current-ticker tie-breaking rule.
    """
    require(set(raw) == {'shards', 'context', 'listings', 'decision_at'}, 'Exact source evidence schema required')
    registry = IdentityRegistry(records, decision_at=raw['decision_at'])
    e = deepcopy(raw); c = e['context']
    completed = [r for r in c['sessions'] if stamp(r['close_at']) < registry.at]
    require(bool(completed), 'Prior exchange close required')
    prior = completed[-1]['close_at']
    members = c['universe']; ids = [u['security_id'] for u in members]
    require(len(ids) == len(set(ids)), 'Duplicate PIT membership')
    current = {}
    for u in members:
        sid = u['security_id']; row = registry.resolve(sid, prior)
        require(all(u[k] == row[k] for k in ('symbol', 'exchange', 'sector', 'type')),
                'PIT classification/membership disagrees with registry')
        listing = e['listings'][sid]
        require(listing == dict(first_traded_on=row['first_traded_on'],
            available_at=row['first_trade_available_at'], source_id=row['first_trade_source_id']),
            'Listing evidence disagrees with permanent identity')
        current[sid] = row
    for shard in e['shards']:
        sid = shard['security_id']
        require(sid in current, 'Unknown shard identity')
        times = []
        for bar in shard['payload']['bars']:
            require(bar.pop('security_id', None) == sid, 'Raw bar permanent identity mismatch')
            time = bar['completed_at']; historical = registry.resolve(sid, time)
            require(stamp(time) <= stamp(prior) and stamp(bar['available_at']) < registry.at,
                    'Future/unavailable raw observation')
            require(bar['symbol'] == historical['symbol'], 'Historical ticker substitution')
            bar['symbol'] = current[sid]['symbol']; times.append(time)
        require(bool(times), 'Empty identity history')
        registry.continuous(sid, min(times, key=stamp), prior)
    closes = {s['date']: s['close_at'] for s in completed}
    for action in c['actions']:
        sid = action.pop('security_id', None)
        require(sid in current and action['session_date'] in closes, 'Unresolved action identity/session')
        historical = registry.resolve(sid, closes[action['session_date']])
        require(action['symbol'] == historical['symbol'], 'Corporate-action ticker substitution')
        action['symbol'] = current[sid]['symbol']
    scored = score_universe(**e)  # Missing members, late inputs, IPOs, raw prices: unchanged gate.
    receipt = dict(version=VERSION, source_sha256=digest(raw), registry_sha256=digest(sorted(
        records, key=lambda r: (r['security_id'], r['effective_from']))), normalized_sha256=digest(e),
        scoring_report_id=scored['report_id'], source_independently_verified=False)
    return e, scored, receipt


@exact
def checkpoint(account, evidence, scored, records):
    """Admit prior marks for new IDs and reconcile mapping-only changes atomically.

    Never replace an existing price, remove exposure, transfer holdings to a
    successor, or erase event history. Retiring an ID with any recorded economic
    action is unsupported by frozen v2's reconciliation and fails explicitly.
    """
    validate_state(account)
    registry = IdentityRegistry(records, decision_at=evidence['decision_at'])
    require(scored == score_universe(**evidence), 'Scoring evidence changed')
    s = deepcopy(account); members = set(scored['members']); old_ids = set(s['symbols'])
    prior = s['as_of']; changes = []
    require(stamp(prior) < stamp(evidence['decision_at']), 'Checkpoint must precede decision')
    for sid in sorted(old_ids - members):
        require(sid not in s['positions'] and not any(r['security_id'] == sid for r in s['receivables']),
                'Universe exit retains position/claim; lifecycle accounting required')
        require(not any(e['security_id'] == sid for e in s['action_history']),
                'Retired action history requires lifecycle-aware reconciliation')
        # A dated terminal interval, rather than omission alone, proves why an
        # unexposed identifier may leave the active registry. It proves no recovery.
        rows = registry.by_id.get(sid, [])
        require(rows and all(r['effective_until'] is not None
                and stamp(r['effective_until']) <= stamp(prior) for r in rows),
                'Universe exit lacks ended identity evidence')
        s['symbols'].pop(sid); s['marks'].pop(sid, None)
        changes.append(dict(kind='retire_unexposed_identity', security_id=sid))
    for sid in sorted(members):
        p = scored['prior_inputs'][sid]; row = registry.resolve(sid, prior)
        require(stamp(p['completed_at']) == stamp(prior), 'New-member mark is not prior close')
        old = s['symbols'].get(sid)
        if old is not None and old != p['symbol']:
            # Require an actual historical interval with the old alias, not a
            # caller's replacement ticker plus a coincidentally matching price.
            history = registry.by_id[sid]
            candidates = [r for r in history if r['symbol'] == old
                          and r['effective_until'] is not None
                          and stamp(r['effective_until']) <= stamp(prior)]
            require(bool(candidates), 'Rename lacks old identity evidence')
            registry.continuous(sid, candidates[-1]['effective_from'], prior)
            changes.append(dict(kind='identity_alias', security_id=sid, old_symbol=old, new_symbol=p['symbol']))
        mark = s['marks'].get(sid)
        if sid in old_ids:
            require(mark is not None and amount(mark['price']) == amount(p['price'])
                    and stamp(mark['completed_at']) == stamp(p['completed_at'])
                    and stamp(mark['available_at']) < stamp(evidence['decision_at']),
                    'Existing account mark mismatch; price correction/recovery forbidden')
            mark['symbol'] = p['symbol']
        else:
            require(sid not in s['positions'], 'New ID cannot inherit holdings')
            s['marks'][sid] = {k: p[k] for k in ('symbol', 'price', 'completed_at', 'available_at')}
            changes.append(dict(kind='admit_identity', security_id=sid))
        require(p['symbol'] == row['symbol'], 'Checkpoint mapping mismatch')
        s['symbols'][sid] = p['symbol']
    validate_state(s)
    # Independent neutrality checks: no economic field can change here.
    for key in set(account) - {'symbols', 'marks'}:
        require(s[key] == account[key], 'Identity checkpoint changed economics')
    before = nav(account, {sid: amount(m['price']) for sid, m in account['marks'].items()})
    after = nav(s, {sid: amount(m['price']) for sid, m in s['marks'].items()})
    require(before == after, 'Identity checkpoint changed NAV')
    return s, dict(version=VERSION, prior_state_sha256=digest(account), state_sha256=digest(s),
                   changes=changes, nav_before=str(before), nav_after=str(after))


@exact
def plan_identity(account, raw, records, session, *, selection_strategy, calendar, settlement, costs):
    """Existing frozen universe planner with a hash-bound neutral checkpoint."""
    require('close_marks' not in session, 'Future closes cannot enter identity planner')
    evidence, scored, normalized = normalize_evidence(raw, records)
    state, receipt = checkpoint(account, evidence, scored, records)
    plan = plan_universe(state, evidence, session, selection_strategy=selection_strategy,
                         calendar=calendar, settlement=settlement, costs=costs)
    return dict(plan, identity_checkpoint=receipt, identity_normalization=normalized)
