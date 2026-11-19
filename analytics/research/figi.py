"""CUSIP -> US ticker mapping through the free OpenFIGI v3 API (no key: 25 requests/minute, 10 jobs per
request). Every response is stored as a snapshot; mappings are cached by CUSIP and never guessed.
OpenFIGI returns the identifier's current listing, so a mapping is checked against price data before use;
an unmapped or untradeable holding stays in cash."""
from __future__ import annotations
from datetime import timezone
import json

SOURCE_ID = 'openfigi-cusip'
URL = 'https://api.openfigi.com/v3/mapping'
BATCH = 10


def choose(entries: list[dict]) -> dict | None:
    """The US composite equity listing among OpenFIGI results, if exactly identifiable."""
    eq = [e for e in entries if e.get('exchCode') == 'US' and e.get('marketSector') == 'Equity' and e.get('ticker')]
    tickers = {e['ticker'] for e in eq}
    if len(tickers) != 1:
        return None
    e = eq[0]
    return {'ticker': e['ticker'].replace('/', '.'), 'name': e.get('name'), 'security_type': e.get('securityType'),
            'figi': e.get('compositeFIGI') or e.get('figi')}


def parse_response(cusips: list[str], body: bytes) -> dict:
    doc = json.loads(body)
    if not isinstance(doc, list) or len(doc) != len(cusips):
        raise ValueError('OPENFIGI_RESPONSE_SHAPE')
    out = {}
    for cusip, job in zip(cusips, doc):
        if 'data' in job:
            hit = choose(job['data'])
            out[cusip] = hit or {'unmapped': 'AMBIGUOUS_OR_NOT_US_EQUITY'}
        else:
            out[cusip] = {'unmapped': str(job.get('warning') or job.get('error') or 'NO_RESULT')[:80]}
    return out


def cached_mappings(store) -> dict:
    out = {}
    for m in store.manifest():
        if m['source_id'] == SOURCE_ID and m.get('path') and m['status'] in ('OK', 'UNCHANGED'):
            out.update(store.load(m['path'])['parsed']['mapping'])
    return out


def map_cusips(fetcher, store, cusips: list[str], now) -> dict:
    at = now.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    have = cached_mappings(store)
    todo = sorted({c for c in cusips if c not in have})
    for i in range(0, len(todo), BATCH):
        group = todo[i:i + BATCH]
        jobs = [{'idType': 'ID_CUSIP', 'idValue': c, 'exchCode': 'US'} for c in group]
        try:
            r = fetcher.post_json(URL, jobs)
            mapping = parse_response(group, r.body)
        except Exception as e:
            store.put(source_id=SOURCE_ID, url=URL, retrieved_at=at, body=None, status='FETCH_FAILED',
                      error=getattr(e, 'code', type(e).__name__), key=','.join(group))
            continue
        store.put(source_id=SOURCE_ID, url=URL, retrieved_at=at, body=r.body, status='OK', content_type='application/json',
                  available_at=at, parsed={'cusips': group, 'mapping': mapping}, key=','.join(group), dedupe=False)
        have.update(mapping)
    return {c: have.get(c, {'unmapped': 'NOT_REQUESTED'}) for c in cusips}
