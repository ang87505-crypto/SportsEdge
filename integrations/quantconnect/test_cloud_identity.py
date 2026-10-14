"""No market data, QC credentials or live LEAN required."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from integrations.quantconnect.cloud_identity import run_in_cloud, safe_cloud_run
from analytics.stock_development_runner_v1 import REVIEWS
from analytics.stock_readiness_pipeline_v1 import PROTOCOL
from scripts.package_stock_identity_cloud import build


class Source:
    def __init__(self):
        self.calls = []
        self.manifest = dict(phase='development', start='2000-01-01', end='2011-12-31',
            runtime_scope='quantconnect_cloud', dataset_revision='SYNTHETIC', lean_version='TEST_ONLY',
            protocol_sha256=hashlib.sha256(PROTOCOL.read_bytes()).hexdigest(), reviews={
                k: dict(reviewer='SYNTHETIC', status='reviewed', reference=k,
                        sha256=hashlib.sha256(b'SYNTHETIC').hexdigest()) for k in REVIEWS})
    def metadata(self): return self.manifest
    def evidence(self, reference): self.calls.append(reference); return b'SYNTHETIC'
    def header(self): self.calls.append('header'); raise ValueError('PRIVATE_SOURCE_VALUE')


class CloudTests(unittest.TestCase):
    def test_pending_and_reserved_sources_never_read_payload(self):
        for mode in ('period', 'review', 'license', 'protocol', 'vintage'):
            source = Source()
            if mode == 'period': source.manifest['end'] = '2025-12-31'
            if mode == 'review': source.manifest['reviews'][REVIEWS[-1]]['status'] = 'pending'
            if mode == 'license': source.manifest['runtime_scope'] = 'local_research'
            if mode == 'protocol': source.manifest['protocol_sha256'] = '0'*64
            if mode == 'vintage': source.manifest['dataset_revision'] = ''
            with self.subTest(mode=mode), self.assertRaises(ValueError): run_in_cloud(source)
            self.assertEqual(source.calls, [])

    def test_hash_mismatch_blocks_before_price_header(self):
        source = Source(); source.manifest['reviews'][REVIEWS[0]]['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'hash mismatch'): run_in_cloud(source)
        self.assertNotIn('header', source.calls)

    def test_exception_text_is_not_exported(self):
        status, result = safe_cloud_run(Source())
        self.assertEqual(status, 'SPORTSEDGE_SOURCE_OR_ACCOUNTING_BLOCKED_NO_RESULT')
        self.assertIsNone(result); self.assertNotIn('PRIVATE_SOURCE_VALUE', status)

    def test_package_is_deterministic_quota_bounded_and_preserves_frozen_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = build(Path(tmp)/'a'); second = build(Path(tmp)/'b')
            self.assertEqual(first, second); self.assertLessEqual(first['files'], 22)
            self.assertLessEqual(first['maximum_file_bytes'], 32000)
            code = "from se_bootstrap import install; install(); from analytics.stock_readiness_pipeline_v1 import verify_freezes; print(len(verify_freezes()))"
            result = subprocess.run([sys.executable, '-c', code], cwd=Path(tmp)/'a', text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertGreater(int(result.stdout), 0)
            with self.assertRaises(FileExistsError): build(Path(tmp)/'a')

    def test_package_tamper_is_rejected_before_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/'package'; build(root)
            file = root/'se_code_00.py'; file.write_text(file.read_text()+"\nFILES[next(iter(FILES))] += '# tampered'\n")
            result = subprocess.run([sys.executable, '-c', 'from se_bootstrap import install; install()'],
                cwd=root, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('SPORTSEDGE_SOURCE_HASH_MISMATCH', result.stderr)


if __name__ == '__main__': unittest.main()
