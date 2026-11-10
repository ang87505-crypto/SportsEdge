"""Read-only SEC filing evidence for research (docs/STOCK_STRATEGY_NEXTGEN_PREREG_2026_11_10.md).

- `filing_event` records: one normalized row per reported Form 4 transaction, with source, SEC URL, accession,
  raw-file SHA-256, report period, transaction date, filing date, acceptance time (UNKNOWN in the quarterly data
  sets, which carry the EDGAR filing date only), first-observed time, parse status and issuer CIK/ticker.
- Form 4 rows come from SEC's quarterly Insider Transactions Data Sets (as filed; amendments are their own
  filings). XBRL fundamentals come from the companyfacts API with each value's `filed` date and accession.
- Availability: anything filed on date D is usable only at the close of the first session after D.
- Identity: issuers are matched by CIK. A missing or ambiguous identifier fails closed (UNKNOWN), never guessed.
Nothing here trades. SEC requests use the User-Agent from the SEC_EDGAR_USER_AGENT secret.
"""
from __future__ import annotations
import csv
from datetime import date, datetime
import hashlib
import io
import json
import zipfile

TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json'
FORM345_URL = 'https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/{q}_form345.zip'
CONCEPTS = ('NetIncomeLoss', 'ProfitLoss', 'Assets', 'Liabilities', 'StockholdersEquity')
REQUIRED = {
    'SUBMISSION.tsv': ('ACCESSION_NUMBER', 'FILING_DATE', 'PERIOD_OF_REPORT', 'DOCUMENT_TYPE', 'ISSUERCIK',
                       'ISSUERTRADINGSYMBOL'),
    'REPORTINGOWNER.tsv': ('ACCESSION_NUMBER', 'RPTOWNERCIK', 'RPTOWNER_RELATIONSHIP'),
    'NONDERIV_TRANS.tsv': ('ACCESSION_NUMBER', 'TRANS_DATE', 'TRANS_CODE', 'TRANS_SHARES', 'TRANS_PRICEPERSHARE',
                           'TRANS_ACQUIRED_DISP_CD', 'DIRECT_INDIRECT_OWNERSHIP'),
}
PURCHASE_FORMS = {'4', '4/A'}
CODE_NAMES = {'P': 'open-market or private purchase', 'S': 'sale', 'A': 'grant/award', 'M': 'option exercise',
              'F': 'tax withholding', 'G': 'gift', 'D': 'disposition to issuer', 'C': 'conversion', 'J': 'other'}


class ContractError(ValueError):
    pass


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sec_date(s: str) -> str | None:
    """'31-MAR-2024', '2024-03-31' or '2024-03-31 00:00:00' -> '2024-03-31'; anything else -> None."""
    s = (s or '').strip()
    for fmt in ('%d-%b-%Y', '%Y-%m-%d', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(s.title() if fmt == '%d-%b-%Y' else s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def quarters(first: str, last: str) -> list[str]:
    """'2016q1'..'2026q3' inclusive."""
    y, q = int(first[:4]), int(first[-1])
    out = []
    while (y, q) <= (int(last[:4]), int(last[-1])):
        out.append(f'{y}q{q}')
        y, q = (y + 1, 1) if q == 4 else (y, q + 1)
    return out


def last_complete_quarter(today: str) -> str:
    d = date.fromisoformat(today)
    q = (d.month - 1) // 3          # quarters fully ended this year
    return f'{d.year}q{q}' if q else f'{d.year - 1}q4'


# ---------------------------------------------------------------- identity

def cik_map(tickers_doc: dict, symbols) -> tuple[dict, list]:
    """Universe symbol -> CIK from SEC company_tickers.json (BRK.B is BRK-B there). Ambiguous/missing -> unmapped."""
    by = {}
    for row in tickers_doc.values():
        by.setdefault(str(row['ticker']).upper(), set()).add(int(row['cik_str']))
    out, missing = {}, []
    for s in sorted(symbols):
        ciks = by.get(s.replace('.', '-').upper(), set())
        if len(ciks) == 1:
            out[s] = next(iter(ciks))
        else:
            missing.append(s)
    return out, missing


# ---------------------------------------------------------------- Form 4 data sets

def _table(zf: zipfile.ZipFile, name: str):
    match = [n for n in zf.namelist() if n.split('/')[-1].upper() == name.upper()]
    if len(match) != 1:
        raise ContractError('MISSING_TABLE:' + name)
    text = zf.read(match[0]).decode('utf-8', errors='replace')
    reader = csv.DictReader(io.StringIO(text), delimiter='\t', quoting=csv.QUOTE_NONE)
    missing = [c for c in REQUIRED[name] if c not in (reader.fieldnames or [])]
    if missing:
        raise ContractError('MISSING_COLUMNS:' + name + ':' + ','.join(missing))
    return reader


def parse_form345(raw: bytes, issuer_ciks: set[int]) -> dict:
    """Filter one quarterly data set to the given issuers. Raises ContractError on a broken file contract."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as e:
        raise ContractError('BAD_ZIP') from e
    subs = {}
    for r in _table(zf, 'SUBMISSION.tsv'):
        try:
            cik = int(r['ISSUERCIK'])
        except ValueError:
            continue
        if cik in issuer_ciks:
            subs[r['ACCESSION_NUMBER']] = {'accession': r['ACCESSION_NUMBER'], 'filed': sec_date(r['FILING_DATE']),
                                           'period': sec_date(r['PERIOD_OF_REPORT']), 'form': r['DOCUMENT_TYPE'].strip(),
                                           'issuer_cik': cik, 'issuer_symbol': r['ISSUERTRADINGSYMBOL'].strip().upper(),
                                           'aff10b5one': (r.get('AFF10B5ONE') or 'UNKNOWN').strip() or 'UNKNOWN'}
    owners = {}
    for r in _table(zf, 'REPORTINGOWNER.tsv'):
        if r['ACCESSION_NUMBER'] in subs:
            owners.setdefault(r['ACCESSION_NUMBER'], []).append(
                {'owner_cik': r['RPTOWNERCIK'].strip(), 'relationship': r['RPTOWNER_RELATIONSHIP'].strip()})
    trans = []
    for r in _table(zf, 'NONDERIV_TRANS.tsv'):
        if r['ACCESSION_NUMBER'] not in subs:
            continue
        trans.append({'accession': r['ACCESSION_NUMBER'], 'trans_date': sec_date(r['TRANS_DATE']),
                      'code': r['TRANS_CODE'].strip().upper(), 'shares': _num(r['TRANS_SHARES']),
                      'price': _num(r['TRANS_PRICEPERSHARE']), 'acq_disp': r['TRANS_ACQUIRED_DISP_CD'].strip().upper(),
                      'direct': r['DIRECT_INDIRECT_OWNERSHIP'].strip().upper()})
    return {'submissions': list(subs.values()), 'owners': owners, 'nonderiv': trans}


def _num(s):
    try:
        x = float(str(s).strip())
        return x if x == x else None
    except ValueError:
        return None


def filing_events(extract: dict, *, quarter: str, raw_sha256: str, observed_at: str, ticker_by_cik: dict) -> list[dict]:
    """One normalized filing_event per non-derivative transaction row."""
    subs = {s['accession']: s for s in extract['submissions']}
    out = []
    for t in extract['nonderiv']:
        s = subs[t['accession']]
        owners = extract['owners'].get(t['accession'], [])
        ok = s['filed'] is not None and t['trans_date'] is not None and len(owners) >= 1
        out.append({'source_type': 'sec-form345-dataset', 'event_class': 'form4-reported-transaction',
                    'sec_url': FORM345_URL.format(q=quarter), 'accession': t['accession'], 'doc_sha256': raw_sha256,
                    'form': s['form'], 'report_period': s['period'], 'transaction_date': t['trans_date'],
                    'filing_date': s['filed'], 'acceptance_utc': 'UNKNOWN', 'first_observed_at': observed_at,
                    'parse_status': 'OK' if ok else 'INCOMPLETE', 'issuer_cik': s['issuer_cik'],
                    'ticker': ticker_by_cik.get(s['issuer_cik'], 'UNKNOWN'), 'filed_symbol': s['issuer_symbol'],
                    'owner_ciks': sorted({o['owner_cik'] for o in owners}), 'code': t['code'], 'shares': t['shares'],
                    'price': t['price'], 'acq_disp': t['acq_disp'], 'ownership': t['direct'] or 'UNKNOWN',
                    'plan_10b5_1': s['aff10b5one'], 'venue': 'UNKNOWN_VENUE' if t['code'] == 'P' else None})
    return out


def qualifying_purchases(events: list[dict]) -> tuple[dict, dict]:
    """Qualifying insider purchases by ticker, deduplicated, plus an attribution summary."""
    stats = {'rows': len(events), 'by_code': {}, 'excluded': {}, 'duplicates': 0, 'qualifying': 0,
             'indirect': 0, 'incomplete': 0, 'filing_lag_days': []}
    seen, out = set(), {}
    for e in sorted(events, key=lambda x: (x['filing_date'] or '9999', x['accession'])):
        stats['by_code'][e['code']] = stats['by_code'].get(e['code'], 0) + 1
        why = None
        if e['parse_status'] != 'OK':
            why = 'incomplete'
        elif e['form'] not in PURCHASE_FORMS:
            why = 'form_' + e['form']
        elif e['code'] != 'P':
            why = 'code_' + e['code']
        elif e['acq_disp'] != 'A':
            why = 'not_acquired'
        elif not e['shares'] or e['shares'] <= 0 or not e['price'] or e['price'] <= 0:
            why = 'no_price_or_shares'
        elif e['ticker'] == 'UNKNOWN':
            why = 'unknown_issuer'
        if why:
            stats['excluded'][why] = stats['excluded'].get(why, 0) + 1
            continue
        for owner in e['owner_ciks']:
            key = (e['issuer_cik'], owner, e['transaction_date'], round(e['shares'], 4), round(e['price'], 4))
            if key in seen:
                stats['duplicates'] += 1
                continue
            seen.add(key)
            stats['qualifying'] += 1
            stats['indirect'] += e['ownership'] == 'I'
            stats['filing_lag_days'].append((date.fromisoformat(e['filing_date']) - date.fromisoformat(e['transaction_date'])).days)
            out.setdefault(e['ticker'], []).append({'filed': e['filing_date'], 'trans_date': e['transaction_date'],
                                                    'owner_cik': owner, 'value': e['shares'] * e['price'],
                                                    'ownership': e['ownership'], 'accession': e['accession']})
    lags = sorted(stats.pop('filing_lag_days'))
    stats['filing_lag_days'] = {'median': lags[len(lags) // 2], 'p90': lags[int(len(lags) * 0.9)], 'max': lags[-1]} if lags else None
    return out, stats


# ---------------------------------------------------------------- XBRL fundamentals

def extract_facts(doc: dict) -> dict:
    """Keep USD values of the registered concepts with their filing provenance."""
    gaap = (doc.get('facts') or {}).get('us-gaap') or {}
    out = {}
    for c in CONCEPTS:
        rows = ((gaap.get(c) or {}).get('units') or {}).get('USD') or []
        out[c] = [{k: r.get(k) for k in ('start', 'end', 'val', 'filed', 'form', 'fp', 'fy', 'accn')} for r in rows
                  if r.get('end') and r.get('filed') and isinstance(r.get('val'), (int, float))]
    return out


def _as_of(rows, cutoff, pred):
    """For each period, the latest value filed strictly before cutoff (a restatement replaces it from its own date)."""
    best = {}
    for r in rows:
        if r['filed'] < cutoff and pred(r):
            key = (r.get('start'), r['end'])
            if key not in best or r['filed'] >= best[key]['filed']:
                best[key] = r
    return best


def fundamentals_at(facts: dict, cutoff: str, stale_days: int = 550) -> dict | None:
    """ROA and safety as known before `cutoff` (a session date; filings dated on or after it are invisible)."""
    def annual(r):
        if not r.get('start') or r.get('form') not in ('10-K', '10-K/A'):
            return False
        n = (date.fromisoformat(r['end']) - date.fromisoformat(r['start'])).days
        return 330 <= n <= 400
    ni = _as_of(facts.get('NetIncomeLoss', []), cutoff, annual) or _as_of(facts.get('ProfitLoss', []), cutoff, annual)
    if not ni:
        return None
    (start, end), row = max(ni.items(), key=lambda kv: kv[0][1])
    if (date.fromisoformat(cutoff) - date.fromisoformat(end)).days > stale_days:
        return None
    inst = lambda c: _as_of(facts.get(c, []), cutoff, lambda r: r['end'] == end and not r.get('start')).get((None, end))
    assets = inst('Assets')
    if not assets or assets['val'] <= 0:
        return None
    liab = inst('Liabilities')
    equity = inst('StockholdersEquity')
    liabilities = liab['val'] if liab else (assets['val'] - equity['val'] if equity else None)
    if liabilities is None:
        return None
    return {'roa': row['val'] / assets['val'], 'safety': 1 - liabilities / assets['val'], 'fy_end': end,
            'filed': max(row['filed'], assets['filed']), 'accn': row['accn']}
