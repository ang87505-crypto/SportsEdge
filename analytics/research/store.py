"""Append-only source snapshots with availability timestamps.

Layout under a data root (the `research-data` branch in CI):

    snapshots/<source>/<YYYY-MM-DD>/<retrieved compact>_<sha16>.json.gz   one record per stored body
    manifest.jsonl                                                       one line per collection attempt
    items.jsonl                                                          research items (source changes)

A record is never rewritten. A body identical to the source's latest stored body is not stored again;
the manifest line points at the earlier record instead. Every record keeps the complete raw body
(base64), its SHA-256, the source URL, when SportsEdge retrieved it, and when the information became
usable (`available_at`), which is never earlier than its public availability.
"""
from __future__ import annotations
import base64
import gzip
import hashlib
import json
from pathlib import Path

STATUSES = ('OK', 'UNCHANGED', 'STALE', 'INCOMPLETE', 'PARSE_FAILED', 'FETCH_FAILED', 'NOT_CONFIGURED',
            'SCHEMA_CHANGED', 'BLOCKED')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), default=str).encode()


class AppendOnlyError(RuntimeError):
    pass


class SnapshotStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ writing
    def _append(self, name: str, row: dict):
        with open(self.root / name, 'a', encoding='utf-8') as fh:
            fh.write(json.dumps(row, sort_keys=True, default=str) + '\n')

    def put(self, *, source_id: str, url: str, retrieved_at: str, body: bytes | None, status: str,
            content_type: str = '', available_at: str | None = None, effective_date: str | None = None,
            parsed=None, error: str | None = None, key: str | None = None, dedupe: bool = True) -> dict:
        """Store one collection attempt. `key` names a logical document (e.g. an SEC accession and file)."""
        if status not in STATUSES:
            raise ValueError('UNKNOWN_STATUS:' + status)
        digest = sha256(body) if body is not None else None
        line = {'source_id': source_id, 'key': key, 'url': url, 'retrieved_at': retrieved_at, 'status': status,
                'available_at': available_at, 'effective_date': effective_date, 'content_sha256': digest,
                'error': error, 'path': None, 'parsed_sha256': sha256(canonical(parsed)) if parsed is not None else None}
        prior = self.latest(source_id, key=key, require_body=True) if dedupe and digest else None
        if prior is not None and prior['content_sha256'] == digest and status == 'OK':
            line.update(status='UNCHANGED', path=prior['path'])
            self._append('manifest.jsonl', line)
            return line
        if body is not None:
            compact = retrieved_at.replace('-', '').replace(':', '').replace('.', '')
            rel = Path('snapshots') / source_id / retrieved_at[:10] / f'{compact}_{digest[:16]}.json.gz'
            path = self.root / rel
            if path.exists():
                raise AppendOnlyError('SNAPSHOT_EXISTS:' + str(rel))
            path.parent.mkdir(parents=True, exist_ok=True)
            record = dict(line, path=str(rel), content_type=content_type, body_b64=base64.b64encode(body).decode(),
                          parsed=parsed)
            with gzip.open(path, 'wt', encoding='utf-8') as fh:
                json.dump(record, fh, sort_keys=True, default=str)
            line['path'] = str(rel)
        self._append('manifest.jsonl', line)
        return line

    def research_item(self, *, source_id: str, observed_at: str, kind: str, detail: dict):
        """A source change worth a human look. It never changes an executable rule."""
        self._append('items.jsonl', {'source_id': source_id, 'observed_at': observed_at, 'kind': kind,
                                     'detail': detail, 'executable_rules_changed': False})

    # ------------------------------------------------------------ reading
    def manifest(self) -> list[dict]:
        p = self.root / 'manifest.jsonl'
        if not p.exists():
            return []
        return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]

    def latest(self, source_id: str, *, key: str | None = None, require_body: bool = False,
               statuses: tuple = ('OK', 'UNCHANGED', 'STALE', 'INCOMPLETE')) -> dict | None:
        rows = [m for m in self.manifest() if m['source_id'] == source_id and (key is None or m.get('key') == key)
                and m['status'] in statuses and (m.get('path') or not require_body)]
        return rows[-1] if rows else None

    def load(self, rel_path: str) -> dict:
        with gzip.open(self.root / rel_path, 'rt', encoding='utf-8') as fh:
            rec = json.load(fh)
        body = base64.b64decode(rec['body_b64'])
        if sha256(body) != rec['content_sha256']:
            raise AppendOnlyError('SNAPSHOT_HASH_MISMATCH:' + rel_path)
        rec['body'] = body
        return rec

    def keys(self, source_id: str) -> set:
        return {m['key'] for m in self.manifest() if m['source_id'] == source_id and m.get('path')}
