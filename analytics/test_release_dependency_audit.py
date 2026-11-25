"""Synthetic dependency mutations; no GitHub, database or provider requests."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from analytics.release_dependency_audit import audit, ManifestError, DEFAULT_MANIFEST


def snapshot():
    return json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))


class ReleaseDependencyAuditTests(unittest.TestCase):
    def test_pinned_plan_is_not_production_approval(self):
        d=audit(snapshot())
        self.assertEqual(d["pull_requests_inspected"],21)
        self.assertFalse(d["release_authorized"])
        self.assertFalse(d["production_ready"])
        self.assertEqual(d["network_requests"],0)
        self.assertEqual(d["database_writes"],0)

    def test_sports_ui_requires_complete_parent_chain_and_database_migration(self):
        d=audit(snapshot())
        self.assertEqual(d["dependency_order"]["sports_read_only_preview"],
                         [16,18,19,20,21,22,23,24,25,26])
        self.assertEqual(d["database_migration_pr"],22)

    def test_stocks_and_nba_research_are_independent_draft_chains(self):
        d=audit(snapshot())
        self.assertEqual(d["dependency_order"]["stock_research_audit"],
                         [16,18,19,27,29,30])
        self.assertEqual(d["dependency_order"]["nba_research_integrity"],
                         [17,28,31])
        self.assertFalse(d["astra_eight_file_patch_imported"])

    def test_never_accepts_false_approval_as_true(self):
        for name in snapshot()["gates"]:
            with self.subTest(gate=name):
                m=snapshot()
                m["gates"][name]=True
                with self.assertRaises(ManifestError):
                    audit(m)

    def test_detects_missing_baseline_ancestor(self):
        m=snapshot()
        m["pull_requests"]=[p for p in m["pull_requests"] if p["number"]!=18]
        with self.assertRaises(ManifestError):
            audit(m)

    def test_detects_unknown_parent_even_if_rows_complete(self):
        m=snapshot()
        next(p for p in m["pull_requests"] if p["number"]==22)["base"]="some-other-branch"
        with self.assertRaisesRegex(ManifestError,"unknown base"):
            audit(m)

    def test_detects_cycle_in_stack(self):
        m=snapshot()
        next(p for p in m["pull_requests"] if p["number"]==16)["base"]="feature/sports-odds-freshness-ui-20261011"
        with self.assertRaisesRegex(ManifestError,"Cycle"):
            audit(m)

    def test_non_release_prs_cannot_get_sneaked_into_ui_release(self):
        m=snapshot()
        next(p for p in m["pull_requests"] if p["number"]==20)["base"]="research/stock-historical-ledger-20261011"
        with self.assertRaises(ManifestError):
            audit(m)

    def test_stock_ui_overlap_and_original_zip_import_stay_unresolved(self):
        for key,value in [("stock_ui_overlap",[]),
                          ("astra_original_eight_file_patch_imported",True)]:
            with self.subTest(key=key):
                m=snapshot()
                m["known_changes"][key]=value
                with self.assertRaises(ManifestError):
                    audit(m)

    def test_environment_defaults_cannot_enable_trading(self):
        m=snapshot()
        m["must_remain_off"]["SPORTSEDGE_PAPER_RUNS_ENABLED"]="true"
        with self.assertRaisesRegex(ManifestError,"loosened"):
            audit(m)

    def test_repo_and_release_status_are_pinned(self):
        for key,val in [
            ("repository","other/repo"),
            ("main_commit","bad"),
            ("status","approved_for_production")
        ]:
            with self.subTest(field=key):
                m=snapshot()
                m[key]=val
                with self.assertRaises(ManifestError):
                    audit(m)

if __name__=="__main__":
    unittest.main()
