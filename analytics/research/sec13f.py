"""Read-only collector and parsers for Form 13F filings on SEC EDGAR (original records only).

Availability: a filing is known from its EDGAR acceptance timestamp (`acceptanceDateTime`, UTC). It is
never backdated to the quarter end. Amendments (13F-HR/A) are kept separately with their own
acceptance times: a RESTATEMENT replaces the period's holdings from its acceptance on; NEW HOLDINGS
(e.g. confidential positions released later) adds to them from its acceptance on. Nothing accepted
later is ever treated as known earlier.
"""
from __future__ import annotations
from datetime import datetime, timezone
import json
import re
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

SOURCE_ID = 'sec-edgar-13f'
NY = ZoneInfo('America/New_York')
SUBMISSIONS = 'https://data.sec.gov/submissions/CIK{cik}.json'
ARCHIVE = 'https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc}/'
FORMS = ('13F-HR', '13F-HR/A')
EXCLUDED_TITLE = re.compile(r'\b(PFD|PREF|PREFERRED|NOTE|NOTES|DEBT|BOND|WT|WTS|WARRANT|WARRANTS|RIGHT|RIGHTS|UNIT|UNITS|'
                            r'ADR|ADS|SPONSORED|CONV|OPTION|ETF|FUND|TRUST UNIT)\b')


class ParseError(ValueError):
    pass


def _local(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def _find(el, name):
    for c in el.iter():
        if _local(c.tag) == name:
            return c
    return None


def _text(el, name, default=None):
    c = _find(el, name)
    return c.text.strip() if c is not None and c.text is not None else default


def parse_submissions(doc: dict) -> dict:
    """13F filings from a submissions document (or one of its older `files` pages) and the older pages to fetch."""
    rec = doc['filings']['recent'] if 'filings' in doc else doc
    out = []
    for i, form in enumerate(rec['form']):
        if form not in FORMS:
            continue
        acc = rec['accessionNumber'][i]
        acc_at = rec['acceptanceDateTime'][i]
        if not re.fullmatch(r'\d{10}-\d{2}-\d{6}', acc) or not acc_at:
            raise ParseError('SUBMISSION_ROW_INVALID:' + str(acc))
        out.append({'accession': acc, 'form': form, 'filing_date': rec['filingDate'][i], 'report_date': rec['reportDate'][i],
                    'accepted_at': acceptance_utc(acc_at), 'primary_document': rec['primaryDocument'][i]})
    files = [f['name'] for f in doc.get('filings', {}).get('files', [])] if 'filings' in doc else []
    return {'filings': out, 'older_pages': files}


def acceptance_utc(text: str) -> str:
    """EDGAR acceptanceDateTime is UTC ('2026-08-14T20:05:04.000Z' is 16:05 New York)."""
    dt = datetime.fromisoformat(text.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ParseError('ACCEPTANCE_WITHOUT_TIMEZONE')
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def acceptance_ny_date(accepted_at: str) -> str:
    return datetime.fromisoformat(accepted_at.replace('Z', '+00:00')).astimezone(NY).date().isoformat()


def infotable_name(index_doc: dict, primary_document: str = 'primary_doc.xml') -> str:
    names = [i['name'] for i in index_doc['directory']['item']]
    xmls = [n for n in names if n.lower().endswith('.xml') and n.split('/')[-1] != primary_document.split('/')[-1]]
    if len(xmls) == 1:
        return xmls[0]
    tagged = [n for n in xmls if 'info' in n.lower() or 'table' in n.lower()]
    if len(tagged) == 1:
        return tagged[0]
    raise ParseError('INFOTABLE_AMBIGUOUS:' + ','.join(xmls) if xmls else 'INFOTABLE_MISSING')


def _mdy(s: str | None) -> str | None:
    if not s:
        return None
    m = re.fullmatch(r'(\d{2})-(\d{2})-(\d{4})', s)
    return f'{m.group(3)}-{m.group(1)}-{m.group(2)}' if m else s


def _safe_xml(xml: bytes):
    """Untrusted XML: refuse any DTD or entity declaration (XXE, entity expansion) before parsing."""
    head = xml[:4096].upper() if isinstance(xml, bytes) else xml.encode()[:4096].upper()
    if b'<!DOCTYPE' in head or b'<!ENTITY' in xml.upper():
        raise ParseError('XML_DTD_REFUSED')
    return ET.fromstring(xml)


def parse_primary(xml: bytes) -> dict:
    try:
        root = _safe_xml(xml)
    except ET.ParseError as e:
        raise ParseError('PRIMARY_XML_INVALID') from e
    sub = _text(root, 'submissionType')
    if sub not in FORMS:
        raise ParseError('NOT_A_13F_HOLDINGS_REPORT:' + str(sub))
    is_amend = (_text(root, 'isAmendment', 'false') or 'false').lower() == 'true'
    kind = _text(root, 'amendmentType')
    if is_amend and kind not in ('RESTATEMENT', 'NEW HOLDINGS'):
        raise ParseError('AMENDMENT_TYPE_UNKNOWN:' + str(kind))
    report_type = _text(root, 'reportType')
    return {'submission_type': sub, 'period': _mdy(_text(root, 'reportCalendarOrQuarter')), 'is_amendment': is_amend,
            'amendment_type': kind if is_amend else None, 'amendment_no': _text(root, 'amendmentNo'),
            'report_type': report_type, 'table_entry_total': int(_text(root, 'tableEntryTotal', '0') or 0),
            'table_value_total': int(_text(root, 'tableValueTotal', '0') or 0),
            'confidential_omitted': (_text(root, 'isConfidentialOmitted', 'false') or 'false').lower() == 'true'}


def parse_infotable(xml: bytes) -> list[dict]:
    try:
        root = _safe_xml(xml)
    except ET.ParseError as e:
        raise ParseError('INFOTABLE_XML_INVALID') from e
    rows = []
    for el in root.iter():
        if _local(el.tag) != 'infoTable':
            continue
        cusip = (_text(el, 'cusip') or '').upper()
        if not re.fullmatch(r'[0-9A-Z]{9}', cusip):
            raise ParseError('CUSIP_INVALID:' + cusip)
        try:
            value, shares = int(_text(el, 'value')), int(_text(el, 'sshPrnamt'))
        except (TypeError, ValueError) as e:
            raise ParseError('NUMBER_INVALID:' + cusip) from e
        rows.append({'issuer': _text(el, 'nameOfIssuer', ''), 'title': _text(el, 'titleOfClass', ''), 'cusip': cusip,
                     'value': value, 'shares': shares, 'share_type': _text(el, 'sshPrnamtType', ''),
                     'put_call': _text(el, 'putCall'), 'other_manager': _text(el, 'otherManager')})
    return rows


def eligible_holdings(rows: list[dict]) -> list[dict]:
    """US common-stock share positions, duplicates (one line per manager) aggregated by CUSIP, options excluded."""
    agg: dict = {}
    for r in rows:
        if r['put_call'] or r['share_type'] != 'SH' or EXCLUDED_TITLE.search(r['title'].upper()):
            continue
        a = agg.setdefault(r['cusip'], {'cusip': r['cusip'], 'issuer': r['issuer'], 'title': r['title'], 'value': 0, 'shares': 0, 'lines': 0})
        a['value'] += r['value']
        a['shares'] += r['shares']
        a['lines'] += 1
    return sorted(agg.values(), key=lambda a: (-a['value'], a['cusip']))


def known_portfolio(filings: list[dict], as_of_utc: str) -> dict | None:
    """The latest reporting period's holdings as known at `as_of_utc`, from parsed filings
    ({accession, accepted_at, primary: parse_primary(), rows: parse_infotable()})."""
    known = [f for f in filings if f['accepted_at'] <= as_of_utc]
    originals = [f for f in known if not f['primary']['is_amendment']]
    if not originals:
        return None
    period = max(f['primary']['period'] for f in originals)
    same = sorted([f for f in known if f['primary']['period'] == period], key=lambda f: f['accepted_at'])
    base = None
    adds = []
    for f in same:
        kind = f['primary']['amendment_type']
        if not f['primary']['is_amendment'] or kind == 'RESTATEMENT':
            base, adds = f, []  # a restatement replaces everything known before it for the period
        elif kind == 'NEW HOLDINGS':
            adds.append(f)
    rows = list(base['rows']) + [r for a in adds for r in a['rows']]
    return {'period': period, 'as_of': as_of_utc, 'sources': [base['accession']] + [a['accession'] for a in adds],
            'holdings': eligible_holdings(rows)}


# 13F filings accepted before this date are plain text without an XML information table. The research window
# needs filings from late 2016 on, so text-era filings are counted and skipped instead of failing every night.
XML_ERA_START = '2013-06-01T00:00:00Z'


def collect(fetcher, store, now: datetime, cik: str = '0001067983', user_agent: str | None = None) -> dict:
    """Fetch the submissions index (and older pages) and every 13F filing not yet stored."""
    at = now.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    url = SUBMISSIONS.format(cik=cik)
    if not user_agent:
        return store.put(source_id=SOURCE_ID, url=url, retrieved_at=at, body=None, status='NOT_CONFIGURED',
                         error='SEC_EDGAR_USER_AGENT_NOT_CONFIGURED')
    summary = {'new_filings': [], 'errors': [], 'skipped_text_era': 0}
    try:
        r = fetcher.get(url)
        doc = json.loads(r.body)
        index = parse_submissions(doc)
        store.put(source_id=SOURCE_ID, key='submissions', url=url, retrieved_at=at, body=r.body, status='OK',
                  content_type='application/json', available_at=at, parsed={'filings': index['filings']})
        filings = list(index['filings'])
        for page in index['older_pages']:
            purl = 'https://data.sec.gov/submissions/' + page
            pr = fetcher.get(purl)
            older = parse_submissions(json.loads(pr.body))
            store.put(source_id=SOURCE_ID, key='submissions:' + page, url=purl, retrieved_at=at, body=pr.body,
                      status='OK', content_type='application/json', available_at=at, parsed={'filings': older['filings']})
            filings += older['filings']
    except Exception as e:
        return store.put(source_id=SOURCE_ID, url=url, retrieved_at=at, body=None, status='FETCH_FAILED',
                         error=getattr(e, 'code', type(e).__name__) + ':' + str(e)[:200])
    have = store.keys(SOURCE_ID)
    cik_int = str(int(cik))
    for f in sorted(filings, key=lambda f: f['accepted_at']):
        key = 'filing:' + f['accession']
        if key + ':infotable' in have:
            continue
        if f['accepted_at'] < XML_ERA_START:
            summary['skipped_text_era'] += 1
            continue
        base = ARCHIVE.format(cik_int=cik_int, acc=f['accession'].replace('-', ''))
        try:
            ir = fetcher.get(base + 'index.json')
            name = infotable_name(json.loads(ir.body), f['primary_document'])
            pr = fetcher.get(base + 'primary_doc.xml')
            primary = parse_primary(pr.body)
            tr = fetcher.get(base + name)
            rows = parse_infotable(tr.body)
        except Exception as e:
            summary['errors'].append(f['accession'] + ':' + getattr(e, 'code', str(e))[:120])
            store.put(source_id=SOURCE_ID, key=key, url=base, retrieved_at=at, body=None, status='PARSE_FAILED',
                      error=str(e)[:300])
            continue
        meta = {k: f[k] for k in ('accession', 'form', 'filing_date', 'report_date', 'accepted_at')}
        store.put(source_id=SOURCE_ID, key=key + ':index', url=base + 'index.json', retrieved_at=at, body=ir.body,
                  status='OK', content_type='application/json', available_at=f['accepted_at'], parsed=meta)
        store.put(source_id=SOURCE_ID, key=key + ':primary', url=base + 'primary_doc.xml', retrieved_at=at, body=pr.body,
                  status='OK', content_type='text/xml', available_at=f['accepted_at'], parsed=dict(meta, primary=primary))
        store.put(source_id=SOURCE_ID, key=key + ':infotable', url=base + name, retrieved_at=at, body=tr.body,
                  status='OK', content_type='text/xml', available_at=f['accepted_at'],
                  parsed=dict(meta, primary=primary, rows=rows))
        summary['new_filings'].append(f['accession'])
    status = 'OK' if not summary['errors'] else 'INCOMPLETE'
    return store.put(source_id=SOURCE_ID, key='run', url=url, retrieved_at=at, body=None, status=status,
                     error=';'.join(summary['errors'])[:2000] or None) | {'summary': summary}


def stored_filings(store) -> list[dict]:
    """Every parsed 13F filing in the store, with the acceptance time it became public."""
    out = {}
    for m in store.manifest():
        if m['source_id'] == SOURCE_ID and (m.get('key') or '').endswith(':infotable') and m.get('path'):
            rec = store.load(m['path'])['parsed']
            out[rec['accession']] = {'accession': rec['accession'], 'accepted_at': rec['accepted_at'],
                                     'form': rec['form'], 'primary': rec['primary'], 'rows': rec['rows']}
    return sorted(out.values(), key=lambda f: f['accepted_at'])
