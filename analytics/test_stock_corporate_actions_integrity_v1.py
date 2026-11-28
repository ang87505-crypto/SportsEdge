"""Synthetic archive integrity and publication tests. No provider or broker calls."""
from copy import deepcopy
import gzip
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from analytics import stock_corporate_actions_recon_v1 as ca
from analytics.test_stock_corporate_actions_recon_v1 import fixture, UNIVERSE
from analytics.stock_forward_bridge_v1 import sha256


class ArchiveIntegrity(unittest.TestCase):
    def test_changed_dividend_cannot_keep_a_valid_archive_receipt(self):
        data, archive = fixture()
        before = ca.archive_digest(archive)
        archive['chunks'][0]['pages'][0]['corporate_actions']['cash_dividends'][0]['rate'] = 100
        # Regression: the old digest binds declared hashes but not the actual pages; calculation previously accepted it.
        self.assertEqual(ca.archive_digest(archive), before)
        with self.assertRaisesRegex(ValueError, 'CA_ARCHIVE_PAGE_DIGEST'):
            ca.reconcile(data, UNIVERSE, archive)

    def test_page_count_and_unfinished_pagination_cannot_claim_complete(self):
        _, original = fixture()
        broken = deepcopy(original)
        broken['chunks'][0]['page_sha256'] = []
        with self.assertRaisesRegex(ValueError, 'CA_ARCHIVE_PAGE_COUNT'):
            ca.verify_archive(broken)
        broken = deepcopy(original)
        page = broken['chunks'][0]['pages'][0]
        page['next_page_token'] = 'TEST_MORE_PAGES'
        broken['chunks'][0]['page_sha256'] = [sha256(page)]
        with self.assertRaisesRegex(ValueError, 'CA_ARCHIVE_INCOMPLETE_PAGINATION'):
            ca.verify_archive(broken)

    def test_failed_chunks_are_retained_without_becoming_verified_pages(self):
        _, archive = fixture(failed_years=(2020,))
        proof = ca.verify_archive(archive)
        self.assertEqual(proof['pages_verified'], 2)
        self.assertEqual(proof['canonical_sha256'], sha256(archive))
        self.assertFalse(proof['completeness_attested'])
        self.assertFalse(proof['availability_before_historical_decisions_verified'])
        archive['chunks'][1]['pages'] = [{}]
        archive['chunks'][1]['page_sha256'] = [sha256({})]
        with self.assertRaisesRegex(ValueError, 'CA_ARCHIVE_FAILED_CHUNK_HAS_PAGES'):
            ca.verify_archive(archive)

    def test_alias_mapping_changes_the_full_archive_digest(self):
        _, archive = fixture()
        before = ca.verify_archive(archive)['canonical_sha256']
        old_digest = ca.archive_digest(archive)
        archive['chunks'][0]['alias_of'] = {'SYNOLD': ['SYNA', '2019-12-31']}
        self.assertEqual(ca.archive_digest(archive), old_digest)
        self.assertNotEqual(ca.verify_archive(archive)['canonical_sha256'], before)

    def test_wrong_versions_and_invalid_complete_flags_are_refused(self):
        _, archive = fixture()
        wrong = deepcopy(archive)
        wrong['version'] = 'TEST_WRONG_SCHEMA'
        with self.assertRaisesRegex(ValueError, 'CA_ARCHIVE_INVALID'):
            ca.verify_archive(wrong)
        wrong = deepcopy(archive)
        wrong['chunks'][0]['complete'] = 'true'
        with self.assertRaisesRegex(ValueError, 'CA_ARCHIVE_INVALID_CHUNK'):
            ca.verify_archive(wrong)


class PublicReport(unittest.TestCase):
    def test_publication_removes_nested_identifiers_and_raw_pages_without_mutating_evidence(self):
        private = {'dataset_sha256': 'a' * 64, 'case': {'id': 'TEST_PROVIDER_ID', 'old_cusip': 'TEST_CUSIP',
                   'events': [{'record_id': 'TEST_RECORD_ID', 'symbol': 'SYNA', 'ratio': .5}]},
                   'pages': [{'private': 'TEST_RAW_PAGE'}], 'return': -.01}
        before = deepcopy(private)
        public = ca.public_report(private)
        self.assertEqual(private, before)
        for token in ('TEST_PROVIDER_ID', 'TEST_CUSIP', 'TEST_RECORD_ID', 'TEST_RAW_PAGE'):
            self.assertNotIn(token, json.dumps(public))
        self.assertEqual(public['case']['events'], [{'symbol': 'SYNA', 'ratio': .5}])
        self.assertEqual(public['return'], private['return'])
        self.assertFalse(public['publication']['raw_pages_included'])

    def test_cli_keeps_public_and_private_outputs_separate_and_refuses_overwriting(self):
        data, archive = fixture()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'universe.json').write_text(json.dumps(UNIVERSE))
            for name, body in [('bars', data), ('actions', archive)]:
                with gzip.open(root / (name + '.json.gz'), 'wt') as fh:
                    json.dump(body, fh)
            command = [sys.executable, '-m', 'analytics.stock_corporate_actions_recon_v1', 'reconcile',
                       '--universe', str(root / 'universe.json'), '--data', str(root / 'bars.json.gz'),
                       '--archive', str(root / 'actions.json.gz'), '--output', str(root / 'private.json'),
                       '--public-output', str(root / 'public.json')]
            run = subprocess.run(command, capture_output=True, text=True, timeout=30)
            self.assertEqual(run.returncode, 0, run.stderr)
            private = json.loads((root / 'private.json').read_text())
            public = json.loads((root / 'public.json').read_text())
            self.assertEqual(private['archive_integrity'], public['archive_integrity'])
            self.assertEqual(private['records']['by_status'], public['records']['by_status'])
            original = (root / 'private.json').read_bytes()
            repeated = subprocess.run(command, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(repeated.returncode, 0)
            self.assertIn('refusing to overwrite', repeated.stderr)
            self.assertEqual((root / 'private.json').read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
