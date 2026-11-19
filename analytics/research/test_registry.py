"""Registry contract tests."""
from __future__ import annotations
import json
from pathlib import Path
import tempfile
import unittest

from analytics.research import registry


class Registry(unittest.TestCase):
    def test_committed_registry_is_valid_and_fingerprinted(self):
        reg = registry.load()
        ids = {s['id']: s['status'] for s in reg['strategies']}
        self.assertEqual(ids['stock-v2-weekly-1'], 'active')
        for sid in ('momentum-quality-paper-v1', 'qmom-disclosure-follower-v1', 'berkshire-13f-top5-paper-v1'):
            self.assertEqual(ids[sid], 'challenger')
        self.assertEqual(ids['daily-oc-losers5-v1'], 'rejected')  # failures stay recorded
        fp = registry.fingerprints(reg)
        prereg = fp['strategies']['momentum-quality-paper-v1']['docs/STOCK_STRATEGY_RESEARCH_PREREG_2026_11_09.md']
        self.assertEqual(len(prereg), 64)

    def test_invalid_registries_are_refused(self):
        good = json.loads(registry.REGISTRY.read_text())
        cases = []
        two_active = json.loads(json.dumps(good))
        two_active['strategies'][2]['status'] = 'active'
        cases.append((two_active, 'MORE_THAN_ONE_ACTIVE'))
        dup = json.loads(json.dumps(good))
        dup['sources'].append(dict(dup['sources'][0]))
        cases.append((dup, 'REGISTRY_ID'))
        orphan = json.loads(json.dumps(good))
        orphan['experiments'][0]['strategy'] = 'nope'
        cases.append((orphan, 'EXPERIMENT_INVALID'))
        missing = json.loads(json.dumps(good))
        missing['strategies'][2]['code'] = ['analytics/research/does_not_exist.py']
        cases.append((missing, 'STRATEGY_FILE_MISSING'))
        for doc, code in cases:
            with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as fh:
                json.dump(doc, fh)
            with self.assertRaises(registry.RegistryError) as e:
                registry.load(Path(fh.name))
            self.assertIn(code, str(e.exception))


if __name__ == '__main__':
    unittest.main()
