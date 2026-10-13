"""Synthetic tamper tests plus the pinned PR manifest — no GitHub writes."""
from copy import deepcopy
import json
import unittest
from analytics.release_train_gate import DEFAULT_MANIFEST, inspect_release_plan


def valid_plan():
    return json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))


class DraftReleaseReadinessTests(unittest.TestCase):
    def test_complete_current_inventory_is_safe_draft_only(self):
        report = inspect_release_plan(valid_plan())
        self.assertEqual(report["tracked_pr_count"],21)
        self.assertTrue(report["snapshot_checked"])
        self.assertFalse(report["current_github_rechecked"])
        self.assertFalse(report["production_ready"])
        self.assertFalse(report["paper_execution_approved"])
        self.assertFalse(report["schema_migration_approved"])
        order = report["draft_dependency_order"]
        self.assertLess(order.index(19),order.index(20))
        self.assertLess(order.index(22),order.index(26))
        self.assertLess(order.index(27),order.index(29))
        self.assertLess(order.index(29),order.index(30))
        self.assertLess(order.index(28),order.index(31))

    def test_determinism_no_change_to_input(self):
        plan=valid_plan()
        before=deepcopy(plan)
        self.assertEqual(inspect_release_plan(plan),inspect_release_plan(plan))
        self.assertEqual(plan,before)

    def test_missing_duplicate_and_untracked_pr_rejected(self):
        for mutate in (
            lambda p:p["prs"].pop(),
            lambda p:p["prs"].append(deepcopy(p["prs"][0])),
            lambda p:p["prs"][0].update(number=99),
            lambda p:p["review_tracks"]["nba_research"].pop(),
            lambda p:p["review_tracks"]["nba_research"].append(18),
        ):
            p=valid_plan();mutate(p)
            with self.assertRaises(ValueError):inspect_release_plan(p)

    def test_wrong_dependency_or_unknown_parent_rejected(self):
        for node,parent in ((26,19),(18,17),(30,31),(22,999)):
            p=valid_plan()
            next(x for x in p["prs"] if x["number"]==node)["depends_on"]=parent
            with self.assertRaises(ValueError):inspect_release_plan(p)

    def test_live_activation_flag_is_not_approval(self):
        for flag in valid_plan()["release_gates"]:
            with self.subTest(flag=flag):
                p=valid_plan();p["release_gates"][flag]=True
                with self.assertRaisesRegex(ValueError,"Release gate changed"):
                    inspect_release_plan(p)
        p=valid_plan();p["release_gates"].pop("paper_runs_enabled")
        with self.assertRaisesRegex(ValueError,"Mandatory release gate"):
            inspect_release_plan(p)

    def test_sql_staging_status_cannot_be_claimed_automatically(self):
        for field,value in (
            ("applied_to_staging",True),
            ("production_approved",True),
            ("requires_live_locking_rls_postgrest_tests",False),
            ("path","database/migrations/wrong.sql"),
        ):
            p=valid_plan();p["mandatory_migration"][field]=value
            with self.assertRaisesRegex(ValueError,"Dangerous migration"):
                inspect_release_plan(p)

    def test_cross_branch_stocks_page_collision_must_remain_visible(self):
        p=valid_plan();p["cross_branch_overlap"]=[]
        with self.assertRaisesRegex(ValueError,"overlap"):
            inspect_release_plan(p)
        p=valid_plan();p["cross_branch_overlap"][0]["resolution"]=""
        with self.assertRaisesRegex(ValueError,"overlap"):
            inspect_release_plan(p)

    def test_no_accidental_change_of_base_snapshot(self):
        p=valid_plan();p["main_commit"]="new-commit"
        with self.assertRaisesRegex(ValueError,"Main SHA changed"):
            inspect_release_plan(p)
        p=valid_plan();p["repository"]="unknown/fork"
        with self.assertRaisesRegex(ValueError,"Unknown repository"):
            inspect_release_plan(p)

    def test_owner_approval_or_risks_cannot_be_erased(self):
        p=valid_plan();p["prohibited_until_separate_approval"]=[]
        with self.assertRaisesRegex(ValueError,"owner approval"):
            inspect_release_plan(p)
        p=valid_plan();p["known_blockers"]=[]
        with self.assertRaisesRegex(ValueError,"release blockers"):
            inspect_release_plan(p)


if __name__=="__main__":
    unittest.main()
