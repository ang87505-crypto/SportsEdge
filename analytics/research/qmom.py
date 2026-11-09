"""Read-only collector for QMOM's official disclosed holdings (https://funds.alphaarchitect.com/qmom/).

The page shows a holdings "Effective Date" and a wpDataTables table (Ticker, Name, CUSIP, Shares, Price,
Market Value $mm, % of Net Assets). The static HTML may carry every row, or only the first page with the
rest served by the site's own table endpoint (wp-admin/admin-ajax.php, which robots.txt allows). Both
raw responses are stored. A snapshot is used for decisions only when it is complete and fresh.
"""
from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
import html as htmlmod
import json
import re

SOURCE_ID = 'qmom-holdings'
URL = 'https://funds.alphaarchitect.com/qmom/'
AJAX = 'https://funds.alphaarchitect.com/wp-admin/admin-ajax.php'
MIN_ROWS = 20
WEIGHT_RANGE = (90.0, 102.0)
STALE_BUSINESS_DAYS = 3


class ParseError(ValueError):
    pass


def _num(text: str) -> float:
    t = htmlmod.unescape(text).replace(',', '').replace('$', '').replace('%', '').strip()
    if t in ('', '-', '—'):
        raise ParseError('EMPTY_NUMBER')
    try:
        return float(t)
    except ValueError:
        raise ParseError('NUMBER_INVALID:' + t[:20]) from None


HEADERS = {'Ticker': 'ticker', 'Name': 'name', 'CUSIP': 'cusip', 'Shares': 'shares', 'Price (Local)': 'price',
           'Market Value ($mm)': 'mv', '% of Net Assets': 'weight'}


def _text(fragment: str) -> str:
    return htmlmod.unescape(re.sub(r'<[^>]+>', '', fragment)).strip()


def tables(page: str) -> list[dict]:
    """Every <table> with its header texts and body rows (cell texts in column order). Works on the static
    HTML the server sends and on browser-rendered HTML alike: columns are found by their visible headers."""
    out = []
    for t in re.findall(r'<table\b.*?</table>', page, re.S):
        head = re.search(r'<thead\b.*?</thead>', t, re.S)
        headers = [_text(h) for h in re.findall(r'<th\b[^>]*>(.*?)</th>', head.group(0), re.S)] if head else []
        body = t[head.end():] if head else t
        rows = [[_text(c) for c in re.findall(r'<td\b[^>]*>(.*?)</td>', tr, re.S)]
                for tr in re.findall(r'<tr\b[^>]*>(.*?)</tr>', body, re.S) if '<td' in tr]
        out.append({'headers': headers, 'rows': rows})
    return out


def holdings_table(page: str) -> dict | None:
    for t in tables(page):
        if {'Ticker', 'CUSIP', '% of Net Assets'} <= set(t['headers']):
            return t
    return None


def header_signature(page: str) -> list[str]:
    """Visible column headers of the holdings table; a change creates a research item."""
    t = holdings_table(page)
    return t['headers'] if t else []


def effective_date(page: str) -> str | None:
    for t in tables(page):
        if t['headers'] == ['Effective Date'] and t['rows']:
            m = re.fullmatch(r'(\d{2})/(\d{2})/(\d{4})', t['rows'][0][0])
            if m:
                return f'{m.group(3)}-{m.group(1)}-{m.group(2)}'
    return None


def parse_rows_html(page: str) -> list[dict]:
    t = holdings_table(page)
    if t is None:
        return []
    idx = {HEADERS[h]: i for i, h in enumerate(t['headers']) if h in HEADERS}
    if len(idx) != len(HEADERS):
        raise ParseError('HOLDINGS_COLUMNS_CHANGED:' + '|'.join(t['headers']))
    rows = []
    for cells in t['rows']:
        if len(cells) != len(t['headers']):
            raise ParseError('ROW_MISSING_COLUMN')
        g = lambda k: cells[idx[k]]
        rows.append(_row(g('ticker'), g('name'), g('cusip'), g('shares'), g('price'), g('mv'), g('weight')))
    return rows


def _row(ticker, name, cusip, shares, price, mv, weight) -> dict:
    ticker = re.sub(r'<[^>]+>', '', str(ticker)).strip().upper()
    if not ticker or len(ticker) > 30 or not re.fullmatch(r'[A-Z0-9&./\- ]+', ticker):
        raise ParseError('TICKER_INVALID:' + ticker[:20])
    # Disclosed non-equity lines (e.g. 'CASH&OTHER') are kept as rows but are not tradeable symbols.
    equity = bool(re.fullmatch(r'[A-Z][A-Z0-9]{0,6}([./-][A-Z0-9]{1,3})?', ticker))
    return {'ticker': ticker, 'equity_symbol': equity, 'name': str(name).strip(), 'cusip': str(cusip).strip().upper(),
            'shares': _num(str(shares)), 'price': _num(str(price)), 'market_value_mm': _num(str(mv)),
            'weight_pct': _num(str(weight))}


def parse_rows_ajax(body: bytes) -> list[dict]:
    """wpDataTables server-side response: {"data": [[ticker, name, cusip, shares, price, mv, weight], ...]}."""
    doc = json.loads(body)
    data = doc.get('data') if isinstance(doc, dict) else None
    if not isinstance(data, list):
        raise ParseError('AJAX_NO_DATA')
    out = []
    for r in data:
        if not isinstance(r, list) or len(r) < 7:
            raise ParseError('AJAX_ROW_INVALID')
        out.append(_row(*r[:7]))
    return out


def ajax_request(page: str) -> dict | None:
    """The table's own server-side request parameters, if the page uses server-side paging."""
    m = re.search(r'data-wpdatatable_id="(\d+)"[^>]*>[\s\S]{0,5000}?column-stock_ticker', page)
    table_id = m.group(1) if m else None
    nonce = None
    if table_id:
        n = re.search(r'id="wdtNonceFrontendServerSide_' + table_id + r'"[^>]*value="([0-9a-f]+)"', page) or \
            re.search(r'name="wdtNonceFrontendServerSide_' + table_id + r'"[^>]*value="([0-9a-f]+)"', page)
        nonce = n.group(1) if n else None
    if not table_id or not nonce:
        return None
    return {'url': f'{AJAX}?action=get_wdtable&table_id={table_id}', 'form': {'draw': '1', 'start': '0', 'length': '-1',
                                                                              'wdtNonce': nonce}}


def business_days_between(a: date, b: date) -> int:
    n, d = 0, a
    while d < b:
        d += timedelta(days=1)
        n += d.weekday() < 5
    return n


def validate(rows: list[dict], eff: str | None, retrieved_at: str) -> tuple[str, list[str]]:
    problems = []
    if not eff:
        return 'PARSE_FAILED', ['EFFECTIVE_DATE_MISSING']
    if len(rows) < MIN_ROWS:
        problems.append(f'TOO_FEW_ROWS:{len(rows)}')
    total = sum(r['weight_pct'] for r in rows)
    if not WEIGHT_RANGE[0] <= total <= WEIGHT_RANGE[1]:
        problems.append(f'WEIGHTS_SUM:{total:.2f}')
    if len({r['ticker'] for r in rows}) != len(rows):
        problems.append('DUPLICATE_TICKER')
    if any(r['weight_pct'] < 0 or r['shares'] < 0 for r in rows):
        problems.append('NEGATIVE_VALUE')
    if problems:
        return 'INCOMPLETE', problems
    got = datetime.fromisoformat(retrieved_at.replace('Z', '+00:00')).date()
    if date.fromisoformat(eff) > got:
        return 'PARSE_FAILED', ['EFFECTIVE_DATE_IN_FUTURE']
    if business_days_between(date.fromisoformat(eff), got) > STALE_BUSINESS_DAYS:
        return 'STALE', [f'EFFECTIVE_DATE_OLD:{eff}']
    return 'OK', []


def collect(fetcher, store, now: datetime) -> dict:
    """One collection: the page, then the table endpoint if needed. Returns the stored manifest line."""
    at = now.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    try:
        page_r = fetcher.get(URL)
    except Exception as e:
        return store.put(source_id=SOURCE_ID, url=URL, retrieved_at=at, body=None, status='FETCH_FAILED',
                         error=getattr(e, 'code', type(e).__name__))
    page = page_r.body.decode('utf-8', 'replace')
    sig = header_signature(page)
    prior = store.latest(SOURCE_ID, require_body=True)
    if prior is not None:
        old = (store.load(prior['path']).get('parsed') or {}).get('header_signature')
        if old and old != sig:
            store.research_item(source_id=SOURCE_ID, observed_at=at, kind='TABLE_HEADER_CHANGED',
                                detail={'before': old, 'after': sig})
    eff = effective_date(page)
    try:
        rows = parse_rows_html(page)
    except ParseError as e:
        rows, err = [], str(e)
    else:
        err = None
    via = 'static-html'
    ajax_line = None
    if len(rows) < MIN_ROWS and err is None:
        req = ajax_request(page)
        if req:
            try:
                ar = fetcher.post_form(req['url'], req['form'])
                rows, via = parse_rows_ajax(ar.body), 'table-endpoint'
                ajax_line = store.put(source_id=SOURCE_ID + '-table', url=req['url'], retrieved_at=at, body=ar.body,
                                      status='OK', content_type='application/json', available_at=at, effective_date=eff,
                                      dedupe=False)
            except Exception as e:  # keep the page; record why the table could not be completed
                err = 'TABLE_ENDPOINT:' + getattr(e, 'code', type(e).__name__)
    status, problems = ('PARSE_FAILED', [err]) if err and not rows else validate(rows, eff, at)
    parsed = {'effective_date': eff, 'rows': rows, 'row_count': len(rows), 'weight_sum': round(sum(r['weight_pct'] for r in rows), 4),
              'via': via, 'problems': problems, 'header_signature': sig,
              'table_snapshot': ajax_line['path'] if ajax_line else None}
    return store.put(source_id=SOURCE_ID, url=URL, retrieved_at=at, body=page_r.body, status=status,
                     content_type=page_r.headers.get('content-type', ''), available_at=at, effective_date=eff,
                     parsed=parsed, error=';'.join(problems) or None, dedupe=False)
