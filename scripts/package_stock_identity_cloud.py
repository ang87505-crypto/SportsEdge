"""Build a code-only QC Free upload directory; no data or credentials accepted.

One source module per ordinary Python file, within documented Free quotas.
Frozen source bytes are restored verbatim under an isolated temporary root.
This packaging is not a claim of native LEAN or Free-node runtime validation.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES = ['stock_accounting_v2', 'stock_baseline_replay_v2', 'stock_buffer_replay_v1',
           'stock_data_contract', 'stock_development_metrics_v1', 'stock_development_runner_v1',
           'stock_identity_bridge_v1', 'stock_identity_stream_v1', 'stock_momentum_v1',
           'stock_rank_buffer_candidate', 'stock_readiness_pipeline_v1', 'stock_report_statistics_v1',
           'stock_universe_account_v1', 'stock_universe_scoring_v1']
METADATA = ['research/stock_audit_20261012/protocol.json',
            'research/stock_accounting_v2_20261012/protocol_amendment.json',
            'research/stock_candidate_adapter_20261013/freeze.json',
            'research/stock_universe_readiness_20261013/amendment.json']


def build(destination):
    source = {f'analytics/{m}.py': (ROOT / f'analytics/{m}.py').read_text() for m in MODULES}
    source['integrations/quantconnect/cloud_identity.py'] = (ROOT / 'integrations/quantconnect/cloud_identity.py').read_text()
    source['integrations/quantconnect/lean_history_source_v1.py'] = (ROOT / 'integrations/quantconnect/lean_history_source_v1.py').read_text()
    source['integrations/quantconnect/lean_reviewed_lookback_v1.py'] = (ROOT / 'integrations/quantconnect/lean_reviewed_lookback_v1.py').read_text()
    groups = [{name: text} for name, text in sorted(source.items())]
    groups.append({name: (ROOT / name).read_text() for name in METADATA})
    groups[-1].update({'analytics/__init__.py': '', 'integrations/__init__.py': '',
                       'integrations/quantconnect/__init__.py': ''})
    files = {f'se_code_{i:02}.py': '# SportsEdge source code only; no market data.\nFILES = '+repr(group)+'\n'
             for i, group in enumerate(groups)}
    names = [name[:-3] for name in files]
    expected = {name: hashlib.sha256(text.encode()).hexdigest() for group in groups for name, text in group.items()}
    files['se_bootstrap.py'] = '''"""Restore reviewed source code only. Never exports platform data."""
import hashlib
import importlib
from pathlib import Path
import sys
import tempfile
MODULES = '''+repr(names)+'''
EXPECTED = '''+repr(expected)+'''
_root = None

def install():
    global _root
    if _root is not None:
        return _root
    # Refuse namespace collisions rather than importing a different package.
    if any(name == 'analytics' or name.startswith('analytics.') or name == 'integrations'
           or name.startswith('integrations.') for name in sys.modules):
        raise RuntimeError('SPORTSEDGE_RESTART_ISOLATED_RESEARCH_KERNEL')
    content = {}
    for module in MODULES:
        for name, value in importlib.import_module(module).FILES.items():
            if name in content:
                raise RuntimeError('SPORTSEDGE_DUPLICATE_SOURCE')
            content[name] = value
    if set(content) != set(EXPECTED):
        raise RuntimeError('SPORTSEDGE_SOURCE_INVENTORY_MISMATCH')
    for name, value in content.items():
        if hashlib.sha256(value.encode()).hexdigest() != EXPECTED[name]:
            raise RuntimeError('SPORTSEDGE_SOURCE_HASH_MISMATCH')
    root = Path(tempfile.mkdtemp(prefix='sportsedge-code-'))
    for name, value in content.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
    sys.path.insert(0, str(root))
    _root = root
    return root
'''
    files['sportsedge_cloud_entry.py'] = '''"""Import from a QC research notebook. No source provider is implied."""
from se_bootstrap import install

def run(source):
    install()
    from integrations.quantconnect.cloud_identity import safe_cloud_run
    return safe_cloud_run(source)
'''
    # 18 package files, leaving main.py/research.ipynb and provider room on Free.
    if len(files) > 22 or any(len(v.encode()) > 32000 for v in files.values()):
        raise ValueError('QC Free source quota exceeded; do not upload or purchase automatically')
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    for name, content in files.items():
        (destination / name).write_text(content)
    manifest = {name: hashlib.sha256(value.encode()).hexdigest() for name, value in files.items()}
    return dict(files=len(files), maximum_file_bytes=max(len(v.encode()) for v in files.values()), sha256=manifest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.output), indent=2))
