"""Bounded public SEC bulk-archive repair; research storage only, never a trading input.

Discover the two most recent closed quarters from the official index instead of guessing a moved
download directory. Preserve legacy normalized JSON snapshots. New snapshots retain the original ZIP
and its discovery page, verified CRCs/table headers, and conservative collection-time availability.
Bulk filing dates are not EDGAR acceptance times: these archives remain unusable for PIT decisions.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import io
import json
from pathlib import Path, PurePosixPath
import re
import stat
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib

from .fetch import Fetcher, FetchError, Response
from .store import SnapshotStore, sha256

SOURCE_ID = 'sec-form345-dataset'
VERSION = 'sec-form345-archive-v1'
INDEX_URL = 'https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets'
MAX_INDEX_BYTES = 2 * 1024 * 1024
MAX_ZIP_BYTES = 32 * 1024 * 1024
MAX_UNPACKED_BYTES = 256 * 1024 * 1024
MAX_HEADER_BYTES = 64 * 1024
ARCHIVE_PATH = re.compile(r'/files/(?:structureddata|datastandardsinnovation)/data/'
                          r'insider-transactions-data-sets/(20\d{2}q[1-4])_form345\.zip')
# Primary field names: SEC Insider Transactions Data Sets documentation, tables 5.1–5.8.
TABLE_KEYS = {
    'SUBMISSION': {'ACCESSION_NUMBER', 'FILING_DATE', 'DOCUMENT_TYPE', 'ISSUERCIK'},
    'REPORTINGOWNER': {'ACCESSION_NUMBER', 'RPTOWNERCIK'},
    'NONDERIV_TRANS': {'ACCESSION_NUMBER', 'NONDERIV_TRANS_SK', 'TRANS_DATE', 'TRANS_CODE'},
    'NONDERIV_HOLDING': {'ACCESSION_NUMBER', 'NONDERIV_HOLDING_SK'},
    'DERIV_TRANS': {'ACCESSION_NUMBER', 'DERIV_TRANS_SK', 'TRANS_DATE', 'TRANS_CODE'},
    'DERIV_HOLDING': {'ACCESSION_NUMBER', 'DERIV_HOLDING_SK'},
    'FOOTNOTES': {'ACCESSION_NUMBER', 'FOOTNOTE_ID', 'FOOTNOTE_TXT'},
    'OWNER_SIGNATURE': {'ACCESSION_NUMBER', 'OWNERSIGNATURENAME', 'OWNERSIGNATUREDATE'},
}


class ArchiveError(ValueError):
    pass


def utc_now():
    return datetime.now(timezone.utc)


def utc(dt):
    if not isinstance(dt, datetime) or dt.tzinfo is None:
        raise ArchiveError('CLOCK_REQUIRES_TIMEZONE')
    return dt.astimezone(timezone.utc)


def stamp(dt):
    return utc(dt).strftime('%Y-%m-%dT%H:%M:%SZ')


def closed_quarters(as_of):
    dt = utc(as_of)
    current = dt.year * 4 + (dt.month - 1) // 3
    return [f'{n // 4}q{n % 4 + 1}' for n in (current - 2, current - 1)]


def archive_quarter(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme != 'https' or p.netloc != 'www.sec.gov' or p.query or p.fragment:
        raise ArchiveError('UNTRUSTED_ARCHIVE_URL')
    m = ARCHIVE_PATH.fullmatch(p.path)
    if not m:
        raise ArchiveError('UNTRUSTED_ARCHIVE_URL')
    return m[1]


class IndexParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.text = {}, []

    def handle_data(self, text):
        self.text.append(text)

    def handle_starttag(self, tag, attrs):
        if tag.lower() != 'a':
            return
        href = dict(attrs).get('href')
        if not href:
            return
        url = urllib.parse.urljoin(INDEX_URL, href)
        try:
            q = archive_quarter(url)
        except (ValueError, ArchiveError):
            return
        self.links.setdefault(q, set()).add(url)


def published_links(body):
    if not isinstance(body, bytes) or len(body) > MAX_INDEX_BYTES:
        raise ArchiveError('INDEX_SIZE_INVALID')
    try:
        p = IndexParser()
        p.feed(body.decode('utf-8-sig'))
    except (UnicodeError, ValueError) as e:
        raise ArchiveError('INDEX_INVALID') from e
    if 'insider transactions data sets' not in ' '.join(' '.join(p.text).split()).lower() or not p.links:
        raise ArchiveError('INDEX_SCHEMA_CHANGED')
    if any(len(urls) != 1 for urls in p.links.values()):
        raise ArchiveError('INDEX_AMBIGUOUS_QUARTER')
    return {q: next(iter(urls)) for q, urls in p.links.items()}


def validate_archive(body):
    """Verify archive structure and all member CRCs; transaction/PIT interpretation is deliberately separate."""
    if not isinstance(body, bytes) or not body or len(body) > MAX_ZIP_BYTES:
        raise ArchiveError('ZIP_SIZE_INVALID')
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            entries = z.infolist()
            if not entries or len(entries) > 32 or sum(x.file_size for x in entries) > MAX_UNPACKED_BYTES:
                raise ArchiveError('ZIP_LIMIT_EXCEEDED')
            tables = {}
            for entry in entries:
                path = PurePosixPath(entry.filename)
                if path.is_absolute() or '..' in path.parts or '\\' in entry.filename or '\x00' in entry.filename or \
                        entry.flag_bits & 1 or stat.S_ISLNK(entry.external_attr >> 16):
                    raise ArchiveError('ZIP_MEMBER_REFUSED')
                if entry.is_dir():
                    continue
                if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise ArchiveError('ZIP_COMPRESSION_REFUSED')
                name, ext = path.stem.upper(), path.suffix.lower()
                table = name in TABLE_KEYS and ext in ('.tsv', '.txt')
                with z.open(entry) as f:
                    if table:
                        header = f.readline(MAX_HEADER_BYTES + 1)
                        if len(header) > MAX_HEADER_BYTES:
                            raise ArchiveError('TABLE_HEADER_TOO_LARGE')
                        columns = header.decode('utf-8-sig').rstrip('\r\n').split('\t')
                        if name in tables or len(columns) != len(set(columns)) or not all(columns) or \
                                not TABLE_KEYS[name].issubset(columns):
                            raise ArchiveError('TABLE_SCHEMA_CHANGED')
                        tables[name] = {'columns': columns, 'uncompressedBytes': entry.file_size}
                    # Exhaust every member, including metadata, to verify CRCs without extracting paths.
                    while f.read(64 * 1024):
                        pass
            if set(tables) != set(TABLE_KEYS):
                raise ArchiveError('TABLES_MISSING')
            return {'tables': tables, 'archiveBytes': len(body), 'archiveSha256': sha256(body)}
    except (zipfile.BadZipFile, EOFError, UnicodeError, RuntimeError, NotImplementedError, zlib.error) as e:
        raise ArchiveError('ZIP_INVALID') from e


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def bounded_transport(method, url, headers, body, timeout):
    if method != 'GET' or body is not None or url != INDEX_URL and not archive_quarter(url):
        raise ArchiveError('REQUEST_REFUSED')
    limit = MAX_INDEX_BYTES if url == INDEX_URL else MAX_ZIP_BYTES
    opener = urllib.request.build_opener(NoRedirect())
    req = urllib.request.Request(url, method='GET', headers=headers)
    try:
        response = opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        return Response(url, e.code, {}, b'')
    with response as r:
        data = r.read(limit + 1)
        if len(data) > limit:
            raise ArchiveError('RESPONSE_TOO_LARGE')
        return Response(url, r.status, {k.lower(): v for k, v in r.headers.items()}, data)


def cached_archive(store, quarter, as_of):
    prior = store.latest(SOURCE_ID, key=quarter, require_body=True, statuses=('OK', 'UNCHANGED'))
    # Older entries are normalized JSON, not original ZIPs. Preserve them and never certify them as raw archives.
    if not prior or not prior.get('parsed_sha256'):
        return None
    rec = store.load(prior['path'])
    parsed = rec.get('parsed') or {}
    if parsed.get('schemaVersion') != VERSION:
        return None
    try:
        if rec['key'] != quarter or archive_quarter(rec['url']) != quarter or \
                parsed.get('quarter') != quarter or parsed.get('pointInTimeUsable') is not False or \
                utc(datetime.fromisoformat(rec['available_at'].replace('Z', '+00:00'))) > as_of:
            raise ArchiveError('CACHE_BINDING_INVALID')
        checked = validate_archive(rec['body'])
        if any(parsed.get(k) != v for k, v in checked.items()):
            raise ArchiveError('CACHE_BINDING_INVALID')
    except (KeyError, TypeError, ValueError) as e:
        raise ArchiveError('CACHE_INTEGRITY_FAILED') from e
    return prior


def collect(fetcher, store, *, user_agent, now=utc_now):
    as_of = utc(now())
    quarters = closed_quarters(as_of)
    cached, pending, results, cached_digests = [], [], {}, {}
    for q in quarters:
        try:
            old = cached_archive(store, q, as_of)
        except Exception:
            results[q] = {'status': 'BLOCKED', 'error': 'CACHE_INTEGRITY_FAILED', 'url': INDEX_URL}
            continue
        (cached if old else pending).append(q)
        if old:
            cached_digests[q] = old['content_sha256']
    agent_ok = isinstance(user_agent, str) and 12 <= len(user_agent) <= 180 and '@' in user_agent and \
        not any(c in user_agent for c in '\r\n')
    discovery = None
    if pending and not agent_ok:
        for q in pending:
            results[q] = {'status': 'NOT_CONFIGURED', 'error': 'SEC_CONTACT_USER_AGENT_REQUIRED', 'url': INDEX_URL}
    elif pending:
        try:
            index = fetcher.get(INDEX_URL)
            links = published_links(index.body)
            discovery = {'url': INDEX_URL, 'sha256': sha256(index.body), 'html': index.body.decode('utf-8-sig')}
        except Exception as e:
            code = e.code if isinstance(e, FetchError) else str(e) if isinstance(e, ArchiveError) else 'INDEX_UNAVAILABLE'
            for q in pending:
                results[q] = {'status': 'FETCH_FAILED', 'error': code, 'url': INDEX_URL}
        else:
            for q in pending:
                if q not in links:
                    results[q] = {'status': 'INCOMPLETE', 'error': 'QUARTER_NOT_PUBLISHED', 'url': INDEX_URL}
                    continue
                url = links[q]
                try:
                    response = fetcher.get(url)
                    parsed = validate_archive(response.body) | {'schemaVersion': VERSION, 'quarter': q,
                        'discovery': discovery, 'pointInTimeUsable': False,
                        'acceptanceTimestamps': 'NOT_SUPPLIED_BY_BULK_DATASET', 'usage': 'RESEARCH_ARCHIVE_ONLY'}
                    results[q] = {'status': 'OK', 'url': url, 'body': response.body, 'parsed': parsed,
                                  'content_type': response.headers.get('content-type', '')}
                except Exception as e:
                    code = e.code if isinstance(e, FetchError) else str(e) if isinstance(e, ArchiveError) else 'ARCHIVE_UNAVAILABLE'
                    results[q] = {'status': 'FETCH_FAILED' if isinstance(e, FetchError) else 'PARSE_FAILED', 'url': url, 'error': code}
    # Identical bodies under different quarter URLs are not independent verified quarter archives. Refuse new
    # claims instead of colliding with the existing store's content-addressed filename or relabelling an old file.
    digests = cached_digests | {q: r['parsed']['archiveSha256'] for q, r in results.items() if r['status'] == 'OK'}
    for q, result in list(results.items()):
        if result['status'] == 'OK' and sum(v == digests[q] for v in digests.values()) > 1:
            results[q] = {'status': 'PARSE_FAILED', 'error': 'IDENTICAL_QUARTER_ARCHIVES', 'url': result['url']}
    # One completed-batch timestamp, after I/O, is conservative availability for every new archive in the batch.
    at = stamp(now())
    if at < stamp(as_of):
        raise ArchiveError('CLOCK_MOVED_BACKWARDS')
    written = []
    for q in quarters:
        if q in results:
            result = results[q]
            written.append(store.put(source_id=SOURCE_ID, key=q, retrieved_at=at,
                body=result.get('body'), status=result['status'], url=result['url'], error=result.get('error'),
                content_type=result.get('content_type', ''), parsed=result.get('parsed'),
                available_at=at if result['status'] == 'OK' else None))
    ok = len(cached) + sum(r['status'] in ('OK', 'UNCHANGED') for r in written)
    return {'status': 'OK' if ok == len(quarters) else 'INCOMPLETE', 'quarters': quarters,
            'cached': cached, 'newlyVerified': [r['key'] for r in written if r['status'] in ('OK', 'UNCHANGED')],
            'failures': [{'quarter': r['key'], 'status': r['status'], 'error': r['error']} for r in written
                         if r['status'] not in ('OK', 'UNCHANGED')], 'pointInTimeUsable': False}


def main():
    import os
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data', type=Path, required=True)
    args = p.parse_args()
    agent = os.getenv('SEC_EDGAR_USER_AGENT', '').strip()
    fetcher = Fetcher(user_agent=agent, min_interval={'www.sec.gov': 1.0}, retries=0,
                      max_requests=3, timeout=30, transport=bounded_transport)
    store = SnapshotStore(args.data)
    result = collect(fetcher, store, user_agent=agent)
    with (args.data / 'runs.jsonl').open('a', encoding='utf-8') as f:
        f.write(json.dumps({'command': 'sec-form345-archive', 'at': stamp(utc_now()),
                            'requests': fetcher.count, 'result': result}, sort_keys=True) + '\n')
    print(json.dumps(result, sort_keys=True))
    raise SystemExit(0 if result['status'] == 'OK' else 1)


if __name__ == '__main__':
    main()
