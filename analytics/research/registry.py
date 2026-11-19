"""The versioned research registry: strategies, sources and experiments, with content fingerprints of
the rule documents and code each strategy depends on. Loading validates; nothing here activates anything."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / 'config' / 'research' / 'registry.json'
VERSION = 'sportsedge-research-registry-v1'
STRATEGY_STATUSES = {'active', 'challenger', 'rejected', 'reference'}
EXPERIMENT_STATUSES = {'registered', 'running', 'complete', 'abandoned'}


class RegistryError(ValueError):
    pass


def file_sha256(rel: str) -> str:
    return hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()


def load(path: Path = REGISTRY) -> dict:
    reg = json.loads(Path(path).read_text(encoding='utf-8'))
    if reg.get('registry_version') != VERSION:
        raise RegistryError('REGISTRY_VERSION')
    ids = {}
    for kind in ('strategies', 'sources', 'experiments'):
        rows = reg.get(kind)
        if not isinstance(rows, list) or not rows:
            raise RegistryError('REGISTRY_EMPTY:' + kind)
        seen = set()
        for r in rows:
            if not isinstance(r.get('id'), str) or r['id'] in seen:
                raise RegistryError('REGISTRY_ID:' + kind + ':' + str(r.get('id')))
            seen.add(r['id'])
        ids[kind] = seen
    for s in reg['strategies']:
        if s.get('status') not in STRATEGY_STATUSES:
            raise RegistryError('STRATEGY_STATUS:' + s['id'])
        for f in s.get('code', []) + [s['rules']]:
            if s['status'] == 'rejected' and s.get('location'):
                continue  # kept on another branch; recorded, not required here
            if not (ROOT / f).exists():
                raise RegistryError('STRATEGY_FILE_MISSING:' + s['id'] + ':' + f)
    for e in reg['experiments']:
        if e.get('strategy') not in ids['strategies'] or e.get('status') not in EXPERIMENT_STATUSES:
            raise RegistryError('EXPERIMENT_INVALID:' + e['id'])
    if sum(1 for s in reg['strategies'] if s['status'] == 'active') > 1:
        raise RegistryError('MORE_THAN_ONE_ACTIVE')
    return reg


def fingerprints(reg: dict) -> dict:
    """SHA-256 of every rule document and code file a strategy depends on, plus the registry itself."""
    out = {'registry': hashlib.sha256(REGISTRY.read_bytes()).hexdigest(), 'strategies': {}}
    for s in reg['strategies']:
        files = sorted(set(s.get('code', []) + [s['rules']]))
        out['strategies'][s['id']] = {f: file_sha256(f) if (ROOT / f).exists() else 'at ' + s.get('location', '?')
                                      for f in files}
    return out


def strategy(reg: dict, sid: str) -> dict:
    for s in reg['strategies']:
        if s['id'] == sid:
            return s
    raise RegistryError('UNKNOWN_STRATEGY:' + sid)
