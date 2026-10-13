"""Audited *offline* integration for existing stock research pieces.

Recompute each frozen signal from its declared prior-only inputs before the
historical ledger can replay it. This prevents the historical cash ledger from
accepting edited signal targets under an unchanged signal ID. No provider IO,
no broker orders, no database writes, and no genuine return claims.

Authenticating declared historical publication times, source archives and
point-in-time universes still requires independent external evidence.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import json
from pathlib import Path
from typing import Any

try:
    from .stock_momentum_v1 import generate, VERSION
    from .stock_historical_ledger import replay
except ImportError:
    from stock_momentum_v1 import generate, VERSION
    from stock_historical_ledger import replay


AUDIT_VERSION = "stock-offline-recomputed-signals-v1"


def checked_replay(bundle: dict[str, Any]) -> dict:
    """Replay only signals that exactly match recomputation from frozen inputs.

    Required top-level keys:
      replay_input: exact input contract of stock_historical_ledger.replay
      signal_evidence: [{signal_id, generate_args}], one per historical decision

    Both price and publication provenance remain UNVERIFIED declarations.
    The recomputation is a code-integrity check, not historical source proof.
    """
    if not isinstance(bundle, dict) or set(bundle) != {"replay_input", "signal_evidence"}:
        raise ValueError("Require exactly replay_input and signal_evidence")
    timeline = bundle["replay_input"]
    entries = bundle["signal_evidence"]
    if not isinstance(timeline, dict) or not isinstance(entries, list) or len(entries) > 500:
        raise ValueError("Invalid stock replay input or signal evidence list")
    sessions = timeline.get("sessions")
    if not isinstance(sessions, list) or not sessions:
        raise ValueError("Historical session list required")
    published: dict[str, dict] = {}
    for session in sessions:
        if not isinstance(session, dict):
            raise ValueError("Invalid historical session")
        wrapper = session.get("decision")
        if wrapper is None:
            continue
        if not isinstance(wrapper, dict) or not isinstance(wrapper.get("signal"), dict):
            raise ValueError("Historical decision wrapper is malformed")
        signal = wrapper["signal"]
        key = signal.get("signal_id")
        if not isinstance(key, str) or not key or key in published:
            raise ValueError("Duplicate or missing historical signal ID")
        if signal.get("strategy_version") != VERSION:
            raise ValueError("Unapproved stock strategy version")
        published[key] = signal
    if len(published) != len(entries):
        raise ValueError("A historical decision has missing or extra signal evidence")
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"signal_id", "generate_args"}:
            raise ValueError("Invalid independent signal-recomputation evidence")
        sid = entry["signal_id"]
        args = entry["generate_args"]
        if not isinstance(sid, str) or sid not in published or sid in seen:
            raise ValueError("Missing, duplicate or unrelated source evidence")
        seen.add(sid)
        if not isinstance(args, dict) or set(args) - {
            "payload", "context", "decision_at", "equity_cents", "held_symbols"
        } or not {"payload", "context", "decision_at"}.issubset(args):
            raise ValueError("Invalid stock model input envelope")
        calculated = generate(**deepcopy(args))
        if calculated != published[sid]:
            raise ValueError(
                "Historical signal differs from recomputed frozen model; "
                "do not record fabricated selection or result"
            )
        # An immutable content hash proves deterministic mathematical input
        # equality only. It cannot prove when data were historically published.
    report = replay(deepcopy(timeline))
    if report["signals_executed"] != len(published):
        raise ValueError("Historical ledger omitted a verified research signal")
    return {
        "audit_version": AUDIT_VERSION,
        "signal_replay": "all_frozen_model_outputs_recomputed_exactly",
        "recomputed_signals": len(published),
        "historical_source_publication_verified": False,
        "point_in_time_stock_universe_verified": False,
        "historical_fills_executable_verified": False,
        "real_world_return_verified": False,
        "note": (
            "Exact model-to-ledger consistency only. Original research inputs "
            "and their historical knowledge timestamps remain unverified; "
            "do not characterize the reported scenario as realized earnings."
        ),
        "portfolio_scenario": report,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    # Fail before creating the report for an invalid input. Exclusive output.
    result = checked_replay(json.loads(args.input.read_text(encoding="utf-8")))
    with args.output.open("x", encoding="utf-8") as f:
        json.dump(result, f, indent=2, allow_nan=False)
        f.write("\n")


if __name__ == "__main__":
    main()
