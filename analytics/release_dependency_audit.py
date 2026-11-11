"""Offline dependency and release-safety audit for SportsEdge draft PRs.

This is a review aid, NOT merge/deploy authorization. It never calls GitHub,
Supabase, Vercel, sportsbooks, Alpaca or trading APIs, and never mutates data.
The manifest is a dated source snapshot; freshness must be reverified
against GitHub before each proposed release.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO_ROOT / "docs/release-dependency-manifest-2026-10-12.json"
TARGETS = {"sports_read_only_preview":26, "stock_research_audit":30,
           "nba_research_integrity":31}
EXPECTED_COUNT = 21
GATE_KEYS = {
    "owner_approved_merge", "owner_approved_deploy", "owner_approved_migration",
    "staging_database_compatibility_verified", "staging_owner_auth_verified",
    "real_browser_qa_verified", "provider_cost_budget_approved",
    "provider_collection_schedule_approved", "paper_run_activation_approved",
    "durable_batch_receipts_verified", "stock_historical_source_verified",
    "nba_executable_roi_verified"
}

class ManifestError(ValueError):
    pass


def audit(snapshot: dict) -> dict:
    if not isinstance(snapshot, dict) or snapshot.get("schema_version") != 1:
        raise ManifestError("Unsupported release manifest schema")
    if snapshot.get("repository") != "ang87505-crypto/SportsEdge":
        raise ManifestError("Unexpected repository")
    if snapshot.get("status") != "review_only_not_release_authorization":
        raise ManifestError("Manifest must not claim release authorization")
    if snapshot.get("main_commit") != "261b03ccc78e0fb3f62fdfa85effcb1e4e9f2f72":
        raise ManifestError("Baseline main commit unexpectedly changed")
    rows = snapshot.get("pull_requests")
    if not isinstance(rows, list) or len(rows) != EXPECTED_COUNT:
        raise ManifestError("Historical pull-request snapshot is incomplete")
    by_id = {}
    by_branch = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ManifestError("Invalid pull request entry")
        number = row.get("number")
        head = row.get("head")
        base = row.get("base")
        if type(number) is not int or number < 1 or number in by_id:
            raise ManifestError("Duplicate or invalid PR number")
        if not isinstance(head, str) or not head or head in by_branch or head == "main":
            raise ManifestError("Duplicate or invalid head branch")
        if not isinstance(base, str) or not base or base == head:
            raise ManifestError("Invalid base branch")
        if not isinstance(row.get("scope"), str) or not row["scope"]:
            raise ManifestError("Missing PR purpose")
        by_id[number] = row
        by_branch[head] = number
    if set(by_id) != set(range(11, 32)):
        raise ManifestError("Unexpected PR numbers in the pinned release snapshot")
    graph = {}
    for number,row in by_id.items():
        if row["base"] != "main" and row["base"] not in by_branch:
            raise ManifestError(f"PR #{number} has an unknown base branch")
        graph[number] = [] if row["base"] == "main" else [by_branch[row["base"]]]

    def closure(target: int) -> list[int]:
        resolved = []
        visiting = set()
        visited = set()
        def visit(number: int) -> None:
            if number in visiting:
                raise ManifestError("Cycle found in pull-request dependencies")
            if number in visited:
                return
            visiting.add(number)
            for parent in graph[number]:
                visit(parent)
            visiting.remove(number)
            visited.add(number)
            resolved.append(number)
        visit(target)
        return resolved
    for number in by_id:
        closure(number)

    targets = snapshot.get("release_targets")
    if targets != TARGETS:
        raise ManifestError("Unexpected or redefined release scopes")
    changes = snapshot.get("known_changes")
    if not isinstance(changes, dict) or \
       changes.get("database_migration_pr") != 22 or \
       changes.get("database_migration_path") != \
       "database/migrations/20261011193330_quote_current_market_guard.sql" or \
       changes.get("owner_auth_pr") != 21 or \
       changes.get("odds_collection_pr") != 25 or \
       changes.get("stock_ui_overlap") != [11, 20] or \
       changes.get("astra_original_eight_file_patch_imported") is not False:
        raise ManifestError("Known release blockers/overlap were changed without review")
    orders = {name:closure(target) for name,target in targets.items()}
    if 21 not in orders["sports_read_only_preview"] or \
       22 not in orders["sports_read_only_preview"] or \
       25 not in orders["sports_read_only_preview"] or \
       27 in orders["sports_read_only_preview"]:
        raise ManifestError("Sports preview dependency/migration checks are inconsistent")
    if 27 not in orders["stock_research_audit"] or \
       21 in orders["stock_research_audit"]:
        raise ManifestError("Stock research must not quietly include owner trading controls")
    if 28 not in orders["nba_research_integrity"] or \
       17 not in orders["nba_research_integrity"]:
        raise ManifestError("NBA audit ancestry missing")

    gates = snapshot.get("gates")
    if not isinstance(gates, dict) or set(gates) != GATE_KEYS:
        raise ManifestError("Missing or unreviewed release gate")
    if any(value is not False for value in gates.values()):
        raise ManifestError("An approval/verification was asserted inside a review-only snapshot")
    must_off = snapshot.get("must_remain_off")
    if must_off != {
        "SPORTSEDGE_PAPER_RUNS_ENABLED": "false_or_unset",
        "automatic_stock_orders": "disabled",
        "automatic_sportsbook_wagers": "disabled"
    }:
        raise ManifestError("Trading safety defaults were loosened")
    return {
        "snapshot_date": snapshot.get("snapshot_date"),
        "main_commit": snapshot["main_commit"],
        "pull_requests_inspected": len(by_id),
        "dependency_order": orders,
        "unreviewed_overlap": {"pull_requests": [11, 20],
                               "file": "src/app/stocks/page.tsx"},
        "database_migration_pr":22,
        "astra_eight_file_patch_imported":False,
        "release_authorized":False,
        "production_ready":False,
        "reason":"CI on draft branches is not combined release verification; auth, SQL, browser, receipts and owner approvals still blocked.",
        "network_requests":0,
        "database_writes":0
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest",type=Path,default=DEFAULT_MANIFEST)
    args=parser.parse_args()
    snapshot=json.loads(args.manifest.read_text(encoding="utf-8"))
    print(json.dumps(audit(snapshot),indent=2))


if __name__ == "__main__":
    main()
