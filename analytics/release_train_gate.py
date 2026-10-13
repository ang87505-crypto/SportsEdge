"""Offline, fail-closed review of SportsEdge's DRAFT release dependency snapshot.

This module DOES NOT authorize a merge, migration, deployment, billing or
execution. It checks that no PR/dependency or critical release blocker is
silently omitted from the written release plan.
"""
from __future__ import annotations
from copy import deepcopy
import argparse
import json
from pathlib import Path

DEFAULT_MANIFEST = Path(__file__).resolve().parents[1] / "docs/SPORTSEDGE_RELEASE_TRAIN_2026_10_12.json"
EXPECTED_PRS = set(range(11, 32))
REQUIRED_TRACKS = {
    "independent_optional",
    "stock_research",
    "nba_research",
    "sports_control_and_ux",
    "separate_stock_ui",
}
REQUIRED_MIGRATION = "database/migrations/20261011193330_quote_current_market_guard.sql"
BLOCKED_FLAGS = {
    "owner_approved_production_merge",
    "full_combined_ci_after_integration",
    "paper_runs_enabled",
    "owner_auth_real_staging_verified",
    "durable_batch_command_receipts_verified",
    "staging_db_migration_applied",
    "staging_concurrency_rls_verified",
    "live_odds_provider_cost_approved",
    "stock_historical_data_point_in_time_verified",
    "nba_investable_edge_demonstrated",
    "astra_nba_zip_eight_files_imported",
    "production_deployment_approved",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def inspect_release_plan(manifest: dict) -> dict:
    """Check topology and mandatory warning coverage, NOT real-time GitHub state."""
    require(isinstance(manifest, dict), "Release plan must be an object")
    require(manifest.get("repository") == "ang87505-crypto/SportsEdge",
            "Unknown repository")
    require(manifest.get("production_branch") == "main", "Unexpected production branch")
    require(manifest.get("main_commit") == "261b03ccc78e0fb3f62fdfa85effcb1e4e9f2f72",
            "Main SHA changed; re-audit against current GitHub state")
    rows = manifest.get("prs")
    require(isinstance(rows, list) and len(rows) == len(EXPECTED_PRS),
            "Incomplete PR inventory")
    numbers = [r.get("number") for r in rows if isinstance(r, dict)]
    require(len(numbers) == len(rows) and len(set(numbers)) == len(numbers)
            and set(numbers) == EXPECTED_PRS, "Missing or duplicated PR")
    by_id = {r["number"]: r for r in rows}
    for n, row in by_id.items():
        require(isinstance(row.get("head"), str) and row["head"].strip() == row["head"]
                and bool(row["head"]) and isinstance(row.get("category"), str),
                f"PR #{n} has missing branch/category")
        parent = row.get("depends_on")
        require(parent is None or (type(parent) is int and parent in by_id),
                f"PR #{n} depends on missing PR")
    # Confirm the known parent chain before discussing merges. These are PR
    # diff bases, not inferred file dependencies.
    expected_parents = {
        18: 16, 19: 18, 20: 19, 21: 20, 22: 21, 23: 22, 24: 23,
        25: 24, 26: 25, 27: 19, 28: 17, 29: 27, 30: 29, 31: 28,
    }
    for n in EXPECTED_PRS:
        require(by_id[n]["depends_on"] == expected_parents.get(n),
                f"PR #{n} base branch mismatch")
    # Generic cycle check, so this remains safe if the baseline changes later.
    visited: set[int] = set()
    visiting: set[int] = set()
    order: list[int] = []
    def visit(n: int) -> None:
        require(n not in visiting, "Cyclic PR dependency")
        if n in visited:
            return
        visiting.add(n)
        p = by_id[n]["depends_on"]
        if p is not None:
            visit(p)
        visiting.remove(n)
        visited.add(n)
        order.append(n)
    for n in sorted(by_id):
        visit(n)
    tracks = manifest.get("review_tracks")
    require(isinstance(tracks, dict) and set(tracks) == REQUIRED_TRACKS,
            "Release track inventory missing")
    flattened: list[int] = []
    for key, values in tracks.items():
        require(isinstance(values, list), "Release tracks require PR lists")
        flattened.extend(values)
    require(len(flattened) == len(EXPECTED_PRS)
            and len(set(flattened)) == len(flattened)
            and set(flattened) == EXPECTED_PRS,
            "PR omitted from release tracks or entered twice")
    overlaps = manifest.get("cross_branch_overlap")
    require(isinstance(overlaps, list) and any(
        isinstance(o, dict) and {o.get("a"), o.get("b")} == {11, 20}
        and o.get("path") == "src/app/stocks/page.tsx"
        and isinstance(o.get("resolution"), str) and bool(o["resolution"])
        for o in overlaps), "Unacknowledged independent-stock-UI overlap")
    migration = manifest.get("mandatory_migration")
    require(isinstance(migration, dict)
            and migration.get("pr") == 22
            and migration.get("path") == REQUIRED_MIGRATION
            and migration.get("applied_to_staging") is False
            and migration.get("production_approved") is False
            and migration.get("requires_live_locking_rls_postgrest_tests") is True,
            "Dangerous migration status or missing staging verification warning")
    gates = manifest.get("release_gates")
    require(isinstance(gates, dict) and set(gates) == BLOCKED_FLAGS,
            "Mandatory release gate missing")
    require(all(gates[k] is False for k in BLOCKED_FLAGS),
            "Release gate changed: re-audit with explicit owner authorization; "
            "this snapshot does not authorize production")
    prohibited = manifest.get("prohibited_until_separate_approval")
    blockers = manifest.get("known_blockers")
    require(isinstance(prohibited, list) and len(prohibited) >= 6
            and all(isinstance(x, str) and x.strip() for x in prohibited),
            "Required owner approval caveats missing")
    require(isinstance(blockers, list) and len(blockers) >= 7
            and all(isinstance(x, str) and x.strip() for x in blockers),
            "Known release blockers missing")
    return {
        "snapshot_checked": True,
        "current_github_rechecked": False,
        "draft_dependency_order": order,
        "tracked_pr_count": len(rows),
        "production_ready": False,
        "schema_migration_approved": False,
        "model_promotion_approved": False,
        "paper_execution_approved": False,
        "requires_owner_release_approval": True,
        "note": "Read-only snapshot topology check. Query current GitHub, "
                "run merged-branch tests, verify staging and seek approval before each promotion."
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("manifest", nargs="?", type=Path, default=DEFAULT_MANIFEST)
    args = p.parse_args()
    result = inspect_release_plan(json.loads(args.manifest.read_text(encoding="utf-8")))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
