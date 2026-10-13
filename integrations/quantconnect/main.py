"""QuantConnect LEAN, read-only SportsEdge historical universe coverage diagnostic.

Paste as main.py in the user's existing QuantConnect Python research project.
No trading, no stock selection, no market-data export and NO strategy P/L.
Checks aggregate coverage of LEAN's supplied Morningstar universe, not
whether it satisfies the frozen NYSE/NASDAQ/AMEX common-stock universe.
"""
from AlgorithmImports import *
from decimal import Decimal, InvalidOperation


START_YEAR, END_YEAR = 2000, 2011
EXPECTED_MONTHS = frozenset((year, month)
                            for year in range(START_YEAR, END_YEAR + 1)
                            for month in range(1, 13))


def _positive_number(value):
    """Reject missing, NaN and infinite vendor numeric values."""
    try:
        number = Decimal(str(value))
        return number.is_finite() and number > 0
    except (InvalidOperation, ValueError, TypeError):
        return False


def _valid_sector(entry):
    try:
        value = entry.asset_classification.morningstar_sector_code
        return value is not None and int(value) > 0
    except (AttributeError, TypeError, ValueError, OverflowError):
        return False


def audit_fundamentals(fundamentals):
    """Return counts only, never underlying licensed market observations.

    The input universe does NOT automatically prove that every eligible,
    inactive or common-stock security was present as of the frozen cutoff.
    Sector categories, volume basis, first listing and action semantics
    still require independent review even when all recorded values look sane.
    """
    counts = dict(observed=0, missing_identity=0, duplicate_identity=0,
                  missing_fundamental_data=0, missing_sector=0,
                  invalid_price=0, invalid_dollar_volume=0,
                  metadata_present=0)
    ids = set()
    for row in fundamentals:
        counts['observed'] += 1
        symbol = getattr(row, 'symbol', None)
        stable_id = getattr(symbol, 'id', None)
        if stable_id is None or not str(stable_id).strip():
            counts['missing_identity'] += 1
        elif str(stable_id) in ids:
            counts['duplicate_identity'] += 1
        else:
            ids.add(str(stable_id))

        if getattr(row, 'has_fundamental_data', False) is not True:
            counts['missing_fundamental_data'] += 1
            continue
        if not _valid_sector(row):
            counts['missing_sector'] += 1
        if not _positive_number(getattr(row, 'price', None)):
            counts['invalid_price'] += 1
        if not _positive_number(getattr(row, 'dollar_volume', None)):
            counts['invalid_dollar_volume'] += 1
        if (_valid_sector(row)
                and _positive_number(getattr(row, 'price', None))
                and _positive_number(getattr(row, 'dollar_volume', None))
                and stable_id is not None and str(stable_id).strip()):
            counts['metadata_present'] += 1
    counts['structural_gaps'] = sum(counts[k] for k in (
        'missing_identity', 'duplicate_identity', 'missing_fundamental_data',
        'missing_sector', 'invalid_price', 'invalid_dollar_volume'))
    # Aggregate audit is never an authorization to backtest SportsEdge.
    counts['source_admitted'] = False
    counts['performance_measured'] = False
    return counts


class SportsEdgeUniverseReadiness(QCAlgorithm):
    def initialize(self):
        self.set_start_date(START_YEAR, 1, 1)
        self.set_end_date(END_YEAR, 12, 31)
        self.set_cash(1000)
        self.spy = self.add_equity('SPY', Resolution.DAILY,
                                   data_normalization_mode=DataNormalizationMode.RAW).symbol
        self.set_warm_up(253, Resolution.DAILY)
        self.universe_settings.asynchronous = False
        self.universe_settings.schedule.on(self.date_rules.month_start(self.spy))
        self._audits = {}
        self.add_universe(self._inspect_universe)
        self.debug('SPORTSEDGE QC SOURCE AUDIT: no stock orders; no historical P/L')

    def _inspect_universe(self, fundamentals):
        # The warmup may suppress a month: a missing audit is reported, not
        # silently replaced with a later month or an invented zero.
        if self.is_warming_up:
            return []
        key = (self.time.year, self.time.month)
        if key not in EXPECTED_MONTHS or key in self._audits:
            return []
        report = audit_fundamentals(fundamentals)
        self._audits[key] = report
        self.debug(
            f'QC SOURCE AUDIT {key[0]}-{key[1]:02d} '
            f'rows={report["observed"]} metadata={report["metadata_present"]} '
            f'missing_id={report["missing_identity"]} '
            f'duplicate_id={report["duplicate_identity"]} '
            f'no_fundamentals={report["missing_fundamental_data"]} '
            f'missing_sector={report["missing_sector"]} '
            f'invalid_price={report["invalid_price"]} '
            f'invalid_dollar_volume={report["invalid_dollar_volume"]} '
            'SOURCE_NOT_ADMITTED'
        )
        # Never subscribe to a partial/full universe just to make a backtest
        # run on the free node; no buy/sell orders exist in this diagnostic.
        return []

    def on_data(self, data: Slice):
        pass

    def on_end_of_algorithm(self):
        missing = EXPECTED_MONTHS - set(self._audits)
        bad = sum(1 for r in self._audits.values()
                  if r['structural_gaps'] or r['observed'] == 0)
        self.debug(
            'SPORTSEDGE QC COVERAGE: '
            f'months_seen={len(self._audits)}/{len(EXPECTED_MONTHS)} '
            f'missing_months={len(missing)} months_with_metadata_gaps={bad} '
            'STATUS=BLOCKED_SOURCE_NOT_ADMITTED; PERFORMANCE=NOT_MEASURED; '
            'NO ORDERS. Remaining: full PIT exchange/type/first-listing IDs, '
            'raw consolidated bars and availability, sector history, corporate '
            'events/settlement, execution and benchmark reconciliation.'
        )
