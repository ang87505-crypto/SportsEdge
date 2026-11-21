"""Exercise the real archive helper against disposable local Git remotes, with no network or credentials."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / '.github' / 'scripts' / 'research-data-branch.sh'
LEDGER = 'lab/stock-forward-ledger.jsonl'
FIRST = b'{"id":"first","fixture":true}\n'
SECOND = b'{"id":"second","fixture":true}\n'


@unittest.skipUnless(os.name == 'posix' and all(shutil.which(x) for x in ('bash', 'git', 'base64', 'sha256sum')),
                     'Requires the POSIX archive-helper tools used in GitHub CI')
class ArchiveBranchGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sportsedge-archive-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.remote = self.root / 'remote.git'
        self.worker = self.root / 'worker'
        self.worker.mkdir()
        self.env = dict(os.environ, GH_TOKEN='synthetic-test-token',
                        GITHUB_REPOSITORY='synthetic/archive-fixture',
                        RESEARCH_DATA_REMOTE=str(self.remote), GIT_TERMINAL_PROMPT='0',
                        GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=str(self.root / 'empty-gitconfig'))
        self.git('init', '--bare', '--quiet', str(self.remote))
        self.assert_ok(self.helper('checkout'))
        self.data = self.worker / 'research-data'
        for name, content in ((LEDGER, FIRST), ('runs.jsonl', FIRST),
                              ('snapshots/immutable.json', b'{"fixture":"original"}\n')):
            path = self.data / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        self.assert_ok(self.helper('commit', 'synthetic initial archive'))
        self.initial_head = self.remote_head()

    def git(self, *args):
        result = subprocess.run(['git', *args], cwd=self.root, env=self.env,
                                capture_output=True, text=True, timeout=15)
        self.assert_ok(result)
        return result.stdout.strip()

    def helper(self, *args):
        return subprocess.run(['bash', str(SCRIPT), *args], cwd=self.worker, env=self.env,
                              capture_output=True, text=True, timeout=15)

    def assert_ok(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def remote_head(self):
        return self.git('--git-dir', str(self.remote), 'rev-parse', 'refs/heads/research-data')

    def assert_refused_without_publication(self):
        result = self.helper('commit', 'synthetic rejected edit')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.remote_head(), self.initial_head)

    def test_stock_ledger_append_is_published_and_preserves_previous_bytes(self):
        (self.data / LEDGER).write_bytes(FIRST + SECOND)
        self.assert_ok(self.helper('commit', 'synthetic ledger append'))
        self.assertNotEqual(self.remote_head(), self.initial_head)
        stored = self.git('--git-dir', str(self.remote), 'show', 'research-data:' + LEDGER)
        self.assertEqual(stored, (FIRST + SECOND).decode().strip())

    def test_stock_ledger_prefix_rewrite_is_rejected_even_when_a_row_is_appended(self):
        self.assertEqual(len(b'first'), len(b'other'))
        (self.data / LEDGER).write_bytes(FIRST.replace(b'first', b'other') + SECOND)
        self.assert_refused_without_publication()

    def test_stock_ledger_truncation_is_rejected(self):
        (self.data / LEDGER).write_bytes(FIRST[:-2])
        self.assert_refused_without_publication()

    def test_stock_ledger_deletion_is_rejected(self):
        (self.data / LEDGER).unlink()
        self.assert_refused_without_publication()

    def test_existing_run_log_append_remains_publishable(self):
        (self.data / 'runs.jsonl').write_bytes(FIRST + SECOND)
        self.assert_ok(self.helper('commit', 'synthetic run append'))
        self.assertNotEqual(self.remote_head(), self.initial_head)

    def test_immutable_snapshot_rewrite_remains_rejected(self):
        (self.data / 'snapshots/immutable.json').write_bytes(b'{"fixture":"changed"}\n')
        self.assert_refused_without_publication()

    def test_unchanged_archive_is_a_successful_noop(self):
        result = self.helper('commit', 'synthetic noop')
        self.assert_ok(result)
        self.assertIn('nothing to commit', result.stdout)
        self.assertEqual(self.remote_head(), self.initial_head)


if __name__ == '__main__':
    unittest.main()
