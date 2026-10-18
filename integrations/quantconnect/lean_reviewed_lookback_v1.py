"""In-cloud, exactly-253-session RAW LEAN history acquisition for SportsEdge.

The input calendar must come from a separately reviewed historical exchange
source. We only reconcile the expected dates against actual RAW History bars:
we NEVER infer missing sessions from weekdays, a present-day stock, or a
provider's returned rows. This helper is intentionally not the historical
source review or the portfolio backtest.

Keep the complete result INSIDE QuantConnect's licensed runtime. Never log,
serialize, export, or publish any returned vendor price observations.
"""
from datetime import date, datetime, time, timedelta
from .lean_history_source_v1 import read_raw_window, SourceNotAdmitted

VERSION = "sportsedge-qc-reviewed-lookback-acquisition-v1"
REQUIRED_SESSIONS = 253
PAGE_DAYS = 35
MAX_SPAN_DAYS = 430
MAX_PAGES = 15


def _need(condition, reason):
    if not condition:
        raise SourceNotAdmitted(reason)


def _calendar_days(sessions):
    _need(isinstance(sessions, (list, tuple))
          and len(sessions) == REQUIRED_SESSIONS,
          "Exactly 253 externally reviewed sessions required")
    dates = []
    for value in sessions:
        _need(isinstance(value, str) and len(value) == 10,
              "Calendar session must be YYYY-MM-DD")
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise SourceNotAdmitted("Invalid calendar session") from exc
        _need(parsed.isoformat() == value and parsed.weekday() < 5,
              "Noncanonical or weekend exchange session")
        dates.append(parsed)
    _need(all(a < b for a, b in zip(dates, dates[1:])),
          "Expected calendar sessions must be unique and increasing")
    _need((dates[-1] - dates[0]).days < MAX_SPAN_DAYS,
          "Historical lookback calendar span exceeds bound")
    return dates


def read_reviewed_lookback(algorithm, symbol, *, expected_sessions, decision_at,
                           phase_callback=None):
    """Read exact 253 expected sessions using bounded 35-day history requests.

    Each page must return EXACTLY its expected session dates. The input
    calendar is not independently authenticated by this function. Successful
    structural acquisition cannot establish historical availability, PIT
    universe coverage, classifications, corporate actions or profitability.
    """
    days = _calendar_days(expected_sessions)
    _need(isinstance(decision_at, datetime) and decision_at.tzinfo is None
          and (decision_at.hour, decision_at.minute, decision_at.second,
               decision_at.microsecond) == (8, 0, 0, 0),
          "Registered local 08:00 decision required")
    _need(days[-1] < decision_at.date(), "Future/decision-date session blocked")
    _need(phase_callback is None or callable(phase_callback),
          "Invalid fixed-stage observer")
    all_bars = []
    pages = 0
    cursor = days[0]
    final_end = days[-1] + timedelta(days=1)
    while cursor < final_end:
        page_end = min(cursor + timedelta(days=PAGE_DAYS), final_end)
        _need(pages < MAX_PAGES, "Too many bounded history pages")
        page_expected = [d.isoformat() for d in days if cursor <= d < page_end]
        _need(bool(page_expected), "Calendar interval without a trading session")
        snapshot = read_raw_window(
            algorithm, symbol, start=datetime.combine(cursor, time.min),
            end=datetime.combine(page_end, time.min),
            decision_at=decision_at, phase_callback=phase_callback)
        _need(snapshot["historical_source_admitted"] is False
              and snapshot["performance"] is None,
              "Unexpected downstream promotion of unreviewed data")
        observed = [r["session_date"] for r in snapshot["bars"]]
        _need(observed == page_expected,
              "Missing/extra/reordered dates relative to declared calendar")
        all_bars.extend(snapshot["bars"])
        pages += 1
        cursor = page_end
    _need(len(all_bars) == REQUIRED_SESSIONS
          and [row["session_date"] for row in all_bars] == list(expected_sessions),
          "Historical session aggregation mismatch")
    return {
        "version": VERSION,
        "kind": "QC_253_SESSION_RAW_LOOKBACK_UNADMITTED_IN_CLOUD",
        "security_id": snapshot["security_id"],
        "requested_ticker": snapshot["requested_ticker"],
        "decision_at_local": decision_at.isoformat(),
        "calendar_sessions_supplied": REQUIRED_SESSIONS,
        "bounded_pages": pages,
        "bars": all_bars,
        "requested_raw_unadjusted": True,
        "requested_fill_forward": False,
        "expected_calendar_independently_verified": False,
        "bar_publication_time_verified": False,
        "point_in_time_membership_verified": False,
        "corporate_actions_and_delisting_economics_verified": False,
        "historical_source_admitted": False,
        "strategy_backtest_completed": False,
        "performance": None,
    }
