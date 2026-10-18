"""Streaming in-cloud audit of QC universe snapshots for survivorship/look-ahead.

Emits FIXED codes only: no identifiers, tickers, counts, dates or vendor
values leave the cloud. A clean result is not source admission; each code is
a reason the frozen backtest cannot yet trust the vendor universe.

Codes:
  SNAPSHOT_ORDER                   as-of times not strictly increasing
  SNAPSHOT_NOT_BEFORE_DECISION     as-of/read not strictly before 08:00 decision
  EMPTY_SNAPSHOT                   a scheduled month returned no members
  MISSING_DECISION_MONTH           a registered month has no snapshot
  REAPPEARED_AFTER_GAP             permanent ID absent then present again
  UNEXPLAINED_EXIT                 permanent ID left with no LEAN Delisting
  EXIT_EXPLANATION_UNAVAILABLE     Delisting lookup could not be performed
  CLASSIFICATION_MISSING           a member had no sector code
  CLASSIFICATION_NEVER_CHANGES_POSSIBLE_BACKFILL
      zero sector changes across a long, large panel. Morningstar documents
      that industry assignments change, so a perfectly static panel suggests
      current classifications were back-filled. A heuristic flag, not proof.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

VERSION = 'sportsedge-qc-pit-bias-audit-v1'
STATIC_MIN_SPAN = timedelta(days=5 * 365)
STATIC_MIN_POPULATION = 100
NY = ZoneInfo('America/New_York')  # self-contained: deployable as one QC root file


def stamp(value):
    """Aware datetime from an aware datetime or ISO text; naive input rejected."""
    at = datetime.fromisoformat(value) if isinstance(value, str) else value
    if not isinstance(at, datetime) or at.tzinfo is None:
        raise ValueError('Timezone-aware timestamp required')
    return at


class PitBiasAudit:
    def __init__(self, expected_months):
        self.expected = frozenset(expected_months)
        self.codes = set(); self.months = set(); self.index = -1
        self.last_asof = None; self.asofs = []; self.first_asof = {}; self.state = {}

    def observe(self, *, asof_at, observed_at, decision_at, members):
        """members: {permanent_id: sector_code or None} for ONE snapshot."""
        asof, read, at = stamp(asof_at), stamp(observed_at), stamp(decision_at)
        if self.last_asof is not None and asof <= self.last_asof:
            self.codes.add('SNAPSHOT_ORDER')
        if not asof <= read < at:
            self.codes.add('SNAPSHOT_NOT_BEFORE_DECISION')
        if not members:
            self.codes.add('EMPTY_SNAPSHOT')
        self.index += 1; self.last_asof = asof; self.asofs.append(asof)
        local = at.astimezone(NY); self.months.add((local.year, local.month))
        for sid, sector in members.items():
            if sector is None:
                self.codes.add('CLASSIFICATION_MISSING')
            entry = self.state.get(sid)
            if entry is None:
                self.state[sid] = [self.index, sector, False]
                self.first_asof[sid] = asof
                continue
            if entry[0] != self.index - 1:
                self.codes.add('REAPPEARED_AFTER_GAP')
            if sector != entry[1]:
                entry[2] = True
            entry[0] = self.index; entry[1] = sector
        return self

    def exits(self):
        """Permanent IDs last seen before the final snapshot (stay in cloud)."""
        return sorted(sid for sid, entry in self.state.items() if entry[0] < self.index)

    def finish(self, explained_exits):
        """explained_exits: IDs with a LEAN Delisting, or None if unavailable."""
        codes = set(self.codes)
        if not self.expected <= self.months:
            codes.add('MISSING_DECISION_MONTH')
        if explained_exits is None:
            codes.add('EXIT_EXPLANATION_UNAVAILABLE')
        elif set(self.exits()) - set(explained_exits):
            codes.add('UNEXPLAINED_EXIT')
        long_lived = [sid for sid, entry in self.state.items()
                      if self.asofs[entry[0]] - self.first_asof[sid] >= STATIC_MIN_SPAN]
        if (len(long_lived) >= STATIC_MIN_POPULATION
                and not any(entry[2] for entry in self.state.values())):
            codes.add('CLASSIFICATION_NEVER_CHANGES_POSSIBLE_BACKFILL')
        if self.index < 0:
            codes.add('EMPTY_SNAPSHOT')
        return dict(version=VERSION, status='BLOCKED' if codes else 'NO_LISTED_ANOMALY',
                    codes=sorted(codes), source_admitted=False, performance=None)
