"""Server-side timing receipts for forward-ledger predictions (research only).

**Why:** git commit dates are written by the client and can be backdated, so they prove nothing about when a
prediction existed.

**The receipt.** It is a GitHub *commit status*, created by the workflow token on the ledger commit that added
`predictions/<signal>.json`:
- **context:** `forward-ledger/receipt/<signal>`;
- **description:** `record_sha=<64 hex>`.

**Why it counts as evidence:**
- **Timestamp:** GitHub's server assigns `created_at`. A client cannot set or backdate it.
- **Immutable:** a status cannot be edited or deleted. A later status only adds a newer entry.
- **Proves existence:** a status can only be created for a commit already on GitHub, so it shows that commit and its
  exact file content existed at `created_at`.

**Binding to the record.** The verifier checks:
- the status creator (`github-actions[bot]`);
- the context;
- the exact record hash in the description;
- that the file content *at that commit* hashes to the same record.

**Not counted:** a status from anyone else, for another hash, or after the next open.

Fails closed. Lookup failures are UNAVAILABLE, and the caller treats them as not VALID.
"""
from __future__ import annotations
from datetime import timedelta
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

CONTEXT_PREFIX = 'forward-ledger/receipt/'
TRUSTED_CREATOR = 'github-actions[bot]'
# Recording, pushing and receipting take about a minute (measured in the rehearsal run). A run that starts later than this
# before the open does not start a prediction, so a record can never be receipted at the last second.
RECEIPT_MARGIN = timedelta(minutes=20)
API = 'https://api.github.com'


class ReceiptUnavailable(RuntimeError):
    pass


def context(signal: str) -> str:
    return CONTEXT_PREFIX + signal


def description(record_sha: str) -> str:
    return 'record_sha=' + record_sha


def urllib_transport(method, url, headers, body, timeout=20):
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read() or b''


class GitHubStatuses:
    """Creates and lists commit statuses with the workflow token. Network or HTTP failures raise ReceiptUnavailable."""

    def __init__(self, repo: str, token: str, transport=urllib_transport):
        if not repo or '/' not in repo or not token:
            raise ReceiptUnavailable('NOT_CONFIGURED')
        self.repo, self.token, self.transport = repo, token, transport

    def _call(self, method, path, payload=None):
        headers = {'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
                   'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sportsedge-forward-ledger'}
        body = json.dumps(payload).encode() if payload is not None else None
        if body is not None:
            headers['Content-Type'] = 'application/json'
        try:
            status, raw = self.transport(method, API + path, headers, body)
        except Exception as e:  # network failure
            raise ReceiptUnavailable('NETWORK:' + type(e).__name__) from e
        if status not in (200, 201):
            raise ReceiptUnavailable(f'HTTP_{status}')
        return json.loads(raw)

    def create(self, commit: str, signal: str, record_sha: str, target_url: str | None = None) -> dict:
        payload = {'state': 'success', 'context': context(signal), 'description': description(record_sha)}
        if target_url:
            payload['target_url'] = target_url
        return self._call('POST', f'/repos/{self.repo}/statuses/{commit}', payload)

    def list(self, commit: str) -> list[dict]:
        out, page = [], 1
        while True:
            rows = self._call('GET', f'/repos/{self.repo}/commits/{commit}/statuses?per_page=100&page={page}')
            out += rows
            if len(rows) < 100 or page >= 20:
                return out
            page += 1


def _git(ledger_dir: Path, *args) -> str | None:
    try:
        r = subprocess.run(['git', '-C', str(ledger_dir), *args], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout if r.returncode == 0 else None


def adding_commit(ledger_dir: Path, signal: str) -> str | None:
    """The commit that first added the prediction (a locator only; its date is never used)."""
    out = _git(ledger_dir, 'log', '--diff-filter=A', '--format=%H', '--', f'predictions/{signal}.json')
    lines = (out or '').split()
    return lines[-1] if lines else None


def record_sha_at(ledger_dir: Path, commit: str, signal: str, sha_fn) -> str | None:
    """The record hash recomputed from the file exactly as it was at `commit` (None if absent or self-inconsistent)."""
    raw = _git(ledger_dir, 'show', f'{commit}:predictions/{signal}.json')
    if raw is None:
        return None
    try:
        rec = json.loads(raw)
    except ValueError:
        return None
    body = {k: v for k, v in rec.items() if k != 'record_sha'}
    return rec['record_sha'] if sha_fn(body) == rec.get('record_sha') else None


def lookup(ledger_dir: Path, predictions: dict, client, sha_fn) -> dict:
    """signal -> receipt evidence:
    - `FOUND`, with the server `created_at`;
    - `MISSING`;
    - `UNAVAILABLE` (lookup failed: fail closed)."""
    out = {}
    for signal, rec in sorted(predictions.items()):
        commit = adding_commit(ledger_dir, signal)
        if not commit:
            out[signal] = {'state': 'MISSING', 'reason': 'NO_LEDGER_COMMIT'}
            continue
        content = record_sha_at(ledger_dir, commit, signal, sha_fn)
        try:
            statuses = client.list(commit)
        except ReceiptUnavailable as e:
            out[signal] = {'state': 'UNAVAILABLE', 'reason': str(e), 'commit': commit}
            continue
        match = [s for s in statuses if s.get('context') == context(signal)
                 and (s.get('creator') or {}).get('login') == TRUSTED_CREATOR
                 and s.get('description') == description(rec.get('record_sha', ''))]
        if not match:
            out[signal] = {'state': 'MISSING', 'reason': 'NO_TRUSTED_STATUS_FOR_THIS_HASH', 'commit': commit}
            continue
        first = min(match, key=lambda s: s['created_at'])
        out[signal] = {'state': 'FOUND', 'commit': commit, 'status_id': first.get('id'), 'created_at': first['created_at'],
                       'creator': first['creator']['login'], 'context': first['context'], 'description': first['description'],
                       'content_record_sha': content}
    return out
