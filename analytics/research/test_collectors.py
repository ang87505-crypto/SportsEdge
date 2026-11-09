"""Collector tests. Real fixtures are excerpts of official records (see fixtures/*/README or headers);
everything built inside a test is a synthetic TEST-ONLY variant."""
from __future__ import annotations
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from analytics.research import figi, qmom, sec13f
from analytics.research.fetch import FetchError, Response
from analytics.research.store import SnapshotStore

FIX = Path(__file__).resolve().parent / 'fixtures'
REAL_PAGE = (FIX / 'qmom' / 'qmom_page_excerpt_2026-11-09.html').read_text()
NOW = datetime(2026, 11, 9, 23, 30, tzinfo=timezone.utc)


def synthetic_page(n=50, weight=2.0, eff='11/09/2026', extra=''):
    """SYNTHETIC TEST-ONLY page in the official markup, n rows of `weight` percent."""
    rows = ''.join(
        f'<tr id="table_35_row_{i}"><td class=" expand column-stock_ticker"><span class="responsiveExpander"></span>T{i:02d}</td>'
        f'<td class=" column-security_desc">Test Co {i}</td><td class=" column-cusip">00000{i:04d}</td>'
        f'<td class="numdata integer column-shares">1,000</td><td class="numdata float column-price">50.00</td>'
        f'<td class="numdata float column-market-value-mm">0.05</td><td class="numdata float column-weightings">{weight}</td></tr>'
        for i in range(n))
    return ('<table><thead><tr><th class="column-maxholdings_websiteeffective_date">Effective Date</th></tr></thead><tbody>'
            f'<tr><td class=" expand column-maxholdings_websiteeffective_date"><span class="responsiveExpander"></span>{eff}</td></tr></tbody></table>'
            '<table data-wpdatatable_id="35"><thead><tr><th class="column-stock_ticker">Ticker</th><th class="column-security_desc">Name</th>'
            '<th class="column-cusip">CUSIP</th><th class="column-shares">Shares</th><th class="column-price">Price</th>'
            '<th class="column-market-value-mm">MV</th><th class="column-weightings">%</th></tr></thead><tbody>' + rows +
            '</tbody></table>' + extra)


class FakeFetcher:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def _hit(self, method, url, body=None):
        self.calls.append((method, url, body))
        r = self.routes.get(url)
        if r is None:
            raise FetchError('HTTP_404', url)
        if isinstance(r, Exception):
            raise r
        return Response(url, 200, {'content-type': 'text/html'}, r if isinstance(r, bytes) else r.encode())

    def get(self, url, **kw):
        return self._hit('GET', url)

    def post_form(self, url, form, **kw):
        return self._hit('POST', url, form)

    def post_json(self, url, payload, **kw):
        return self._hit('POST', url, payload)


class QmomCollector(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = SnapshotStore(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_real_excerpt_is_incomplete_not_silently_used(self):
        line = qmom.collect(FakeFetcher({qmom.URL: REAL_PAGE}), self.store, NOW)
        self.assertEqual(line['status'], 'INCOMPLETE')
        rec = self.store.load(line['path'])
        self.assertEqual(rec['parsed']['effective_date'], '2026-11-09')
        self.assertEqual(rec['parsed']['rows'][0]['ticker'], 'SYRE')
        self.assertIn('TOO_FEW_ROWS:5', rec['parsed']['problems'])
        self.assertEqual(rec['body'].decode(), REAL_PAGE)  # complete raw page preserved

    def test_complete_page_is_ok_with_hash_and_times(self):
        line = qmom.collect(FakeFetcher({qmom.URL: synthetic_page()}), self.store, NOW)
        self.assertEqual(line['status'], 'OK')
        self.assertEqual(line['available_at'], '2026-11-09T23:30:00Z')
        self.assertEqual(line['effective_date'], '2026-11-09')
        self.assertEqual(self.store.load(line['path'])['parsed']['row_count'], 50)

    def test_stale_effective_date(self):
        line = qmom.collect(FakeFetcher({qmom.URL: synthetic_page(eff='10/30/2026')}), self.store, NOW)
        self.assertEqual(line['status'], 'STALE')

    def test_future_effective_date_is_refused(self):
        line = qmom.collect(FakeFetcher({qmom.URL: synthetic_page(eff='11/12/2026')}), self.store, NOW)
        self.assertEqual(line['status'], 'PARSE_FAILED')

    def test_malformed_row_fails_parsing(self):
        bad = synthetic_page().replace('<td class="numdata float column-price">50.00</td>', '<td class="numdata float column-price">n/a</td>', 1)
        line = qmom.collect(FakeFetcher({qmom.URL: bad}), self.store, NOW)
        self.assertEqual(line['status'], 'PARSE_FAILED')

    def test_weights_that_do_not_add_up_are_incomplete(self):
        line = qmom.collect(FakeFetcher({qmom.URL: synthetic_page(weight=1.0)}), self.store, NOW)
        self.assertEqual(line['status'], 'INCOMPLETE')

    def test_server_side_table_is_completed_from_the_site_endpoint(self):
        nonce = '<input type="hidden" id="wdtNonceFrontendServerSide_35" name="wdtNonceFrontendServerSide_35" value="abc123">'
        page = synthetic_page(n=5, extra=nonce)
        data = {'data': [[f'T{i:02d}', f'Co {i}', f'00000{i:04d}', '1,000', '50.00', '0.05', '2.00'] for i in range(50)]}
        url = qmom.AJAX + '?action=get_wdtable&table_id=35'
        f = FakeFetcher({qmom.URL: page, url: json.dumps(data)})
        line = qmom.collect(f, self.store, NOW)
        self.assertEqual(line['status'], 'OK')
        self.assertEqual(f.calls[1][2]['wdtNonce'], 'abc123')
        rec = self.store.load(line['path'])['parsed']
        self.assertEqual((rec['via'], rec['row_count']), ('table-endpoint', 50))
        self.assertIsNotNone(rec['table_snapshot'])

    def test_fetch_failure_is_recorded(self):
        line = qmom.collect(FakeFetcher({qmom.URL: FetchError('RETRIES_EXHAUSTED', qmom.URL)}), self.store, NOW)
        self.assertEqual((line['status'], line['error']), ('FETCH_FAILED', 'RETRIES_EXHAUSTED'))

    def test_table_layout_change_creates_a_research_item(self):
        qmom.collect(FakeFetcher({qmom.URL: synthetic_page()}), self.store, NOW)
        changed = synthetic_page().replace('<th class="column-weightings">%</th>', '<th class="column-weightings">%</th><th class="column-sector">S</th>')
        qmom.collect(FakeFetcher({qmom.URL: changed}), self.store, datetime(2026, 11, 10, 23, 30, tzinfo=timezone.utc))
        items = [json.loads(x) for x in (Path(self.tmp.name) / 'items.jsonl').read_text().splitlines()]
        self.assertEqual(items[0]['kind'], 'TABLE_HEADER_CHANGED')
        self.assertFalse(items[0]['executable_rules_changed'])


class Sec13fParsing(unittest.TestCase):
    def test_real_submissions_index(self):
        sub = sec13f.parse_submissions(json.loads((FIX / 'sec' / 'submissions_13f_only_2026-11-09.json').read_text()))
        self.assertEqual(sub['older_pages'], ['CIK0001067983-submissions-001.json'])
        amend = next(f for f in sub['filings'] if f['accession'] == '0000950123-25-008361')
        self.assertEqual((amend['form'], amend['report_date'], amend['accepted_at']), ('13F-HR/A', '2025-03-31', '2025-08-14T20:10:02Z'))

    def test_real_amendment_documents(self):
        p = sec13f.parse_primary((FIX / 'sec' / 'primary_doc_000095012325008361.xml').read_bytes())
        self.assertEqual((p['is_amendment'], p['amendment_type'], p['period']), (True, 'NEW HOLDINGS', '2025-03-31'))
        rows = sec13f.parse_infotable((FIX / 'sec' / 'infotable_000095012325008361.xml').read_bytes())
        self.assertEqual(sum(r['value'] for r in rows), p['table_value_total'])
        self.assertEqual(sec13f.infotable_name(json.loads((FIX / 'sec' / 'index_000095012325008361.json').read_text())), '43981.xml')

    def test_acceptance_is_utc_and_dated_in_new_york(self):
        self.assertEqual(sec13f.acceptance_ny_date('2026-08-15T02:30:00Z'), '2026-08-14')  # 22:30 New York
        self.assertEqual(sec13f.acceptance_ny_date('2026-08-14T20:05:04Z'), '2026-08-14')

    def test_duplicates_aggregate_and_options_and_non_common_are_excluded(self):
        mk = lambda cusip, title, value, put=None, typ='SH': {'issuer': 'X', 'title': title, 'cusip': cusip, 'value': value,
                                                              'shares': 10, 'share_type': typ, 'put_call': put, 'other_manager': None}
        rows = [mk('037833100', 'COM', 100), mk('037833100', 'COM', 50), mk('037833100', 'COM', 999, put='Call'),
                mk('000000AAA', 'PFD SER A', 500), mk('00000BBB0', 'SPONSORED ADR', 400), mk('00000CCC0', 'NOTE 1.5% 2030', 300, typ='PRN')]
        h = sec13f.eligible_holdings(rows)
        self.assertEqual([(x['cusip'], x['value'], x['lines']) for x in h], [('037833100', 150, 2)])

    def test_dtd_and_entities_are_refused(self):
        evil = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><informationTable>&a;</informationTable>'
        with self.assertRaises(sec13f.ParseError):
            sec13f.parse_infotable(evil)

    def test_malformed_infotable(self):
        with self.assertRaises(sec13f.ParseError):
            sec13f.parse_infotable(b'<informationTable><infoTable><cusip>BAD</cusip></infoTable></informationTable>')


def filing(acc, accepted, period, holdings, amend=None):
    """SYNTHETIC TEST-ONLY parsed filing."""
    rows = [{'issuer': n, 'title': 'COM', 'cusip': c, 'value': v, 'shares': 1, 'share_type': 'SH', 'put_call': None,
             'other_manager': None} for c, n, v in holdings]
    return {'accession': acc, 'accepted_at': accepted, 'form': '13F-HR/A' if amend else '13F-HR',
            'primary': {'period': period, 'is_amendment': bool(amend), 'amendment_type': amend}, 'rows': rows}


class KnownPortfolio(unittest.TestCase):
    def setUp(self):
        self.q1 = filing('A1', '2025-05-15T20:00:00Z', '2025-03-31', [('C1', 'AAA', 500), ('C2', 'BBB', 400)])
        self.q1_new = filing('A2', '2025-08-14T20:10:00Z', '2025-03-31', [('C9', 'ZZZ', 900)], amend='NEW HOLDINGS')
        self.q2 = filing('A3', '2025-08-14T20:05:00Z', '2025-06-30', [('C1', 'AAA', 600), ('C3', 'CCC', 300)])
        self.fs = [self.q1, self.q1_new, self.q2]

    def test_nothing_before_the_first_acceptance_and_never_backdated_to_quarter_end(self):
        self.assertIsNone(sec13f.known_portfolio(self.fs, '2025-03-31T23:59:59Z'))
        self.assertIsNone(sec13f.known_portfolio(self.fs, '2025-05-15T19:59:59Z'))
        self.assertEqual(sec13f.known_portfolio(self.fs, '2025-05-15T20:00:00Z')['period'], '2025-03-31')

    def test_a_later_amendment_is_not_known_before_its_acceptance(self):
        k = sec13f.known_portfolio([self.q1, self.q1_new], '2025-08-14T20:09:59Z')
        self.assertNotIn('C9', [h['cusip'] for h in k['holdings']])
        k = sec13f.known_portfolio([self.q1, self.q1_new], '2025-08-14T20:10:00Z')
        self.assertEqual(k['holdings'][0]['cusip'], 'C9')
        self.assertEqual(k['sources'], ['A1', 'A2'])

    def test_latest_period_wins_and_old_period_amendments_do_not_rewrite_it(self):
        k = sec13f.known_portfolio(self.fs, '2025-08-15T00:00:00Z')
        self.assertEqual(k['period'], '2025-06-30')
        self.assertEqual([h['cusip'] for h in k['holdings']], ['C1', 'C3'])

    def test_restatement_replaces_the_period(self):
        restated = filing('A4', '2025-09-01T15:00:00Z', '2025-06-30', [('C5', 'EEE', 50)], amend='RESTATEMENT')
        k = sec13f.known_portfolio(self.fs + [restated], '2025-09-02T00:00:00Z')
        self.assertEqual([h['cusip'] for h in k['holdings']], ['C5'])


class Sec13fCollector(unittest.TestCase):
    def test_not_configured_without_a_user_agent(self):
        with tempfile.TemporaryDirectory() as d:
            line = sec13f.collect(FakeFetcher({}), SnapshotStore(Path(d)), NOW, user_agent=None)
            self.assertEqual((line['status'], line['error']), ('NOT_CONFIGURED', 'SEC_EDGAR_USER_AGENT_NOT_CONFIGURED'))

    def test_collects_a_filing_once_with_its_acceptance_time(self):
        sub = {'filings': {'recent': {'accessionNumber': ['0000950123-25-008361'], 'filingDate': ['2025-08-14'],
                                      'reportDate': ['2025-03-31'], 'acceptanceDateTime': ['2025-08-14T20:10:02.000Z'],
                                      'form': ['13F-HR/A'], 'primaryDocument': ['xslForm13F_X02/primary_doc.xml']}, 'files': []}}
        base = 'https://www.sec.gov/Archives/edgar/data/1067983/000095012325008361/'
        routes = {sec13f.SUBMISSIONS.format(cik='0001067983'): json.dumps(sub),
                  base + 'index.json': (FIX / 'sec' / 'index_000095012325008361.json').read_bytes(),
                  base + 'primary_doc.xml': (FIX / 'sec' / 'primary_doc_000095012325008361.xml').read_bytes(),
                  base + '43981.xml': (FIX / 'sec' / 'infotable_000095012325008361.xml').read_bytes()}
        with tempfile.TemporaryDirectory() as d:
            store = SnapshotStore(Path(d))
            f = FakeFetcher(routes)
            line = sec13f.collect(f, store, NOW, user_agent='SportsEdge Research test@example.test')
            self.assertEqual(line['summary']['new_filings'], ['0000950123-25-008361'])
            got = sec13f.stored_filings(store)
            self.assertEqual(got[0]['accepted_at'], '2025-08-14T20:10:02Z')
            n = len(f.calls)
            sec13f.collect(f, store, NOW, user_agent='SportsEdge Research test@example.test')
            self.assertEqual(len(f.calls) - n, 1)  # only the index is re-read; the filing is not fetched again


class OpenFigi(unittest.TestCase):
    def test_unique_us_equity_is_mapped_and_class_shares_use_dots(self):
        hit = figi.choose([{'exchCode': 'US', 'marketSector': 'Equity', 'ticker': 'BRK/B', 'name': 'BERKSHIRE'}])
        self.assertEqual(hit['ticker'], 'BRK.B')

    def test_ambiguous_or_missing_stay_unmapped(self):
        body = json.dumps([{'data': [{'exchCode': 'US', 'marketSector': 'Equity', 'ticker': 'A'},
                                     {'exchCode': 'US', 'marketSector': 'Equity', 'ticker': 'B'}]},
                           {'warning': 'No identifier found.'}]).encode()
        out = figi.parse_response(['C1', 'C2'], body)
        self.assertIn('unmapped', out['C1'])
        self.assertEqual(out['C2']['unmapped'], 'No identifier found.')

    def test_mappings_are_cached_and_stored(self):
        body = json.dumps([{'data': [{'exchCode': 'US', 'marketSector': 'Equity', 'ticker': 'AAPL'}]}])
        with tempfile.TemporaryDirectory() as d:
            store = SnapshotStore(Path(d))
            f = FakeFetcher({figi.URL: body})
            self.assertEqual(figi.map_cusips(f, store, ['037833100'], NOW)['037833100']['ticker'], 'AAPL')
            figi.map_cusips(f, store, ['037833100'], NOW)
            self.assertEqual(len(f.calls), 1)


if __name__ == '__main__':
    unittest.main()
