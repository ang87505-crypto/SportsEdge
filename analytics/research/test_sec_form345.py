"""SYNTHETIC archive fixtures only. Field names follow the SEC's public tables 5.1–5.8."""
from datetime import datetime, timedelta, timezone
import base64
import gzip
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from analytics.research import sec_form345 as sec
from analytics.research.fetch import FetchError, Response
from analytics.research.store import SnapshotStore, canonical
from analytics.research.summary import build_summary

NOW = datetime(2026, 11, 27, 18, tzinfo=timezone.utc)
UA = 'SportsEdge synthetic-test contact@example.invalid'
PREFIX = 'https://www.sec.gov/files/datastandardsinnovation/data/insider-transactions-data-sets/'


def archive_url(q):
    return PREFIX + q + '_form345.zip'


def index(*quarters):
    return ('<h1>Insider Transactions Data Sets</h1>' + ''.join(
        f'<a href="{archive_url(q)}">{q}</a>' for q in quarters)).encode()


def archive(*, omitted=None, extra=None, changed=None, marker='SYNTHETIC'):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, keys in sec.TABLE_KEYS.items():
            if name == omitted:
                continue
            fields = sorted(keys)
            if name == changed:
                fields = ['UNRECOGNIZED_FIELD']
            # This checks the archive contract, not invented filings, prices or performance.
            z.writestr(name + '.tsv', '\t'.join(fields) + '\n' + '\t'.join('SYNTHETIC' for _ in fields) + '\n')
        z.writestr('metadata.json', json.dumps({'fixture':'SYNTHETIC','marker':marker}))
        if extra:
            z.writestr(extra, 'SYNTHETIC')
    return out.getvalue()


class FakeFetcher:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def get(self, url):
        self.calls.append(url)
        r = self.routes.get(url, FetchError('HTTP_404', url))
        if isinstance(r, Exception):
            raise r
        return Response(url, 200, {'content-type': 'application/octet-stream'}, r)


def routes():
    return {sec.INDEX_URL: index('2026q2', '2026q3', '2026q4'),
            archive_url('2026q2'): archive(marker='2026q2'), archive_url('2026q3'): archive(marker='2026q3')}


class SecArchive(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = SnapshotStore(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def collect(self, fetcher, when=NOW, agent=UA):
        return sec.collect(fetcher, self.store, user_agent=agent, now=lambda: when)

    def test_closed_quarters_cross_year_and_refuse_naive_clocks(self):
        self.assertEqual(sec.closed_quarters(NOW), ['2026q2', '2026q3'])
        self.assertEqual(sec.closed_quarters(datetime(2027, 1, 1, tzinfo=timezone.utc)), ['2026q3', '2026q4'])
        with self.assertRaises(sec.ArchiveError):
            sec.closed_quarters(datetime(2026, 11, 27))

    def test_discovers_current_and_legacy_sec_paths_without_guessing(self):
        data = index('2026q2').replace(PREFIX.encode(), b'/files/structureddata/data/insider-transactions-data-sets/')
        self.assertEqual(sec.published_links(data)['2026q2'],
                         'https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/2026q2_form345.zip')
        self.assertEqual(sec.published_links(index('2026q3'))['2026q3'], archive_url('2026q3'))

    def test_foreign_hosts_queries_credentials_and_redirects_are_not_capabilities(self):
        for url in [archive_url('2026q2')+'?key=bad', archive_url('2026q2')+'#fragment',
                    archive_url('2026q2').replace('www.sec.gov', 'evil.example'),
                    archive_url('2026q2').replace('www.sec.gov', 'www.sec.gov@evil.example'),
                    archive_url('2026q2').replace('https:', 'http:')]:
            with self.subTest(url=url), self.assertRaises(sec.ArchiveError):
                sec.archive_quarter(url)
        self.assertIsNone(sec.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.example'))

    def test_a_waf_page_or_ambiguous_quarter_is_not_a_published_index(self):
        for body in [b'<html>Access denied</html>', b'\xff', index('2026q2')+(
                '<a href="https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/2026q2_form345.zip">other</a>').encode()]:
            with self.subTest(body=body[:30]), self.assertRaises(sec.ArchiveError):
                sec.published_links(body)

    def test_validates_documented_tables_and_crc_without_interpreting_transactions(self):
        v = sec.validate_archive(archive())
        self.assertEqual(set(v['tables']), set(sec.TABLE_KEYS))
        self.assertEqual(len(v['archiveSha256']), 64)

    def test_html_missing_tables_schema_changes_and_unsafe_members_are_refused(self):
        for body in [b'<html>not a ZIP</html>', archive(omitted='SUBMISSION'), archive(changed='SUBMISSION'),
                     archive(extra='../escape.tsv'), archive(extra='duplicate/SUBMISSION.tsv')]:
            with self.subTest(length=len(body)), self.assertRaises(sec.ArchiveError):
                sec.validate_archive(body)

    def test_compressed_and_unpacked_byte_limits_are_checked(self):
        body = archive()
        with patch.object(sec, 'MAX_ZIP_BYTES', len(body)-1), self.assertRaises(sec.ArchiveError):
            sec.validate_archive(body)
        with patch.object(sec, 'MAX_UNPACKED_BYTES', 1), self.assertRaises(sec.ArchiveError):
            sec.validate_archive(body)

    def test_crc_corruption_is_refused(self):
        body=bytearray(archive());central=body.index(b'PK\x01\x02');body[central+16]^=1
        with self.assertRaises(sec.ArchiveError):sec.validate_archive(bytes(body))

    def test_identical_quarter_payloads_are_not_counted_or_overwritten(self):
        data=routes();data[archive_url('2026q3')]=data[archive_url('2026q2')]
        r=self.collect(FakeFetcher(data))
        self.assertEqual(r['newlyVerified'],[])
        self.assertEqual(len(r['failures']),2)
        self.assertTrue(all(x['error']=='IDENTICAL_QUARTER_ARCHIVES' for x in r['failures']))
        self.assertTrue(all(x['path'] is None for x in self.store.manifest()))

    def test_only_two_closed_quarters_are_fetched_in_three_gets(self):
        f = FakeFetcher(routes())
        r = self.collect(f)
        self.assertEqual(r['status'], 'OK')
        self.assertEqual(f.calls, [sec.INDEX_URL, archive_url('2026q2'), archive_url('2026q3')])
        self.assertNotIn(archive_url('2026q4'), f.calls)
        for line in self.store.manifest():
            rec = self.store.load(line['path'])
            self.assertEqual(rec['available_at'], sec.stamp(NOW))
            self.assertFalse(rec['parsed']['pointInTimeUsable'])
            self.assertEqual(rec['parsed']['acceptanceTimestamps'], 'NOT_SUPPLIED_BY_BULK_DATASET')
            self.assertEqual(rec['parsed']['discovery']['sha256'], sec.sha256(routes()[sec.INDEX_URL]))
            self.assertTrue(rec['body'].startswith(b'PK'))

    def test_collection_time_after_download_is_availability_not_quarter_end(self):
        ticks = iter([NOW, NOW + timedelta(seconds=20)])
        r = sec.collect(FakeFetcher(routes()), self.store, user_agent=UA, now=lambda: next(ticks))
        self.assertEqual(r['status'], 'OK')
        self.assertTrue(all(x['available_at']=='2026-11-27T18:00:20Z' for x in self.store.manifest()))

    def test_verified_cache_makes_zero_requests_and_creates_no_new_receipt(self):
        self.collect(FakeFetcher(routes()))
        before = (self.store.root/'manifest.jsonl').read_bytes()
        f = FakeFetcher({})
        r = self.collect(f, NOW+timedelta(days=1))
        self.assertEqual(r['cached'], ['2026q2','2026q3'])
        self.assertEqual(r['newlyVerified'], [])
        self.assertEqual(f.calls, [])
        self.assertEqual((self.store.root/'manifest.jsonl').read_bytes(), before)

    def test_legacy_normalized_json_is_preserved_and_never_claimed_to_be_raw_zip(self):
        old = self.store.put(source_id=sec.SOURCE_ID, key='2026q2', url=archive_url('2026q2'),
            retrieved_at='2026-11-10T00:00:00Z', status='OK', body=b'{"events":[]}', content_type='application/json')
        original = (self.store.root/old['path']).read_bytes()
        r = self.collect(FakeFetcher(routes()))
        self.assertEqual(r['status'],'OK')
        self.assertEqual((self.store.root/old['path']).read_bytes(),original)
        self.assertEqual(len(self.store.manifest()),3)

    def test_one_failed_quarter_cannot_hide_behind_the_last_successful_one(self):
        data = routes();data[archive_url('2026q2')] = FetchError('HTTP_404',archive_url('2026q2'))
        r = self.collect(FakeFetcher(data))
        self.assertEqual(r['status'],'INCOMPLETE')
        self.assertEqual(r['failures'][0]['quarter'],'2026q2')
        src=build_summary(None,None,self.store.manifest(),[],sec.stamp(NOW))['sources'][0]
        self.assertEqual(src['status'],'FETCH_FAILED')
        self.assertEqual(src['lastBatch']['failed'][0]['key'],'2026q2')

    def test_missing_published_quarter_is_explicitly_pending(self):
        data=routes();data[sec.INDEX_URL]=index('2026q2')
        f=FakeFetcher(data);r=self.collect(f)
        self.assertEqual(r['failures'],[{'quarter':'2026q3','status':'INCOMPLETE','error':'QUARTER_NOT_PUBLISHED'}])
        self.assertEqual(len(f.calls),2)

    def test_200_html_is_not_an_accepted_archive(self):
        data=routes();data[archive_url('2026q3')]=b'<html>Request blocked</html>'
        r=self.collect(FakeFetcher(data))
        self.assertEqual(r['failures'][0]['status'],'PARSE_FAILED')
        self.assertNotEqual(self.store.manifest()[-1]['status'],'OK')

    def test_missing_or_malformed_contact_agent_performs_no_request(self):
        for agent in ['',None,'no-contact-agent','test contact@example.invalid\r\nInjected: x']:
            f=FakeFetcher({});r=self.collect(f,agent=agent)
            self.assertEqual(f.calls,[])
            self.assertEqual(r['status'],'INCOMPLETE')
            self.assertTrue(all(x['status']=='NOT_CONFIGURED' for x in r['failures']))

    def test_cached_tampering_or_future_availability_is_blocked_without_refetch(self):
        self.collect(FakeFetcher(routes()))
        row=self.store.manifest()[0];path=self.store.root/row['path']
        rec=self.store.load(row['path']);rec.pop('body');rec['available_at']='2026-11-30T00:00:00Z'
        with gzip.open(path,'wt',encoding='utf-8') as f:json.dump(rec,f)
        f=FakeFetcher({});r=self.collect(f,NOW+timedelta(days=1))
        self.assertEqual(r['failures'][0]['error'],'CACHE_INTEGRITY_FAILED')
        self.assertEqual(f.calls,[])

    def test_self_consistent_cache_rewrites_cannot_replace_the_manifest_receipt(self):
        self.collect(FakeFetcher(routes()))
        row=self.store.manifest()[0];path=self.store.root/row['path']
        original=path.read_bytes()
        for kind in ('metadata','body','availability'):
            with self.subTest(kind=kind):
                rec=json.loads(gzip.decompress(original))
                if kind=='metadata':
                    rec['parsed']['usage']='UNAUTHORIZED_DECISION_INPUT'
                elif kind=='body':
                    body=archive(marker='TAMPERED')
                    rec['body_b64']=base64.b64encode(body).decode()
                    rec['content_sha256']=sec.sha256(body)
                    rec['parsed'].update(sec.validate_archive(body))
                else:
                    rec['available_at']='2026-11-01T00:00:00Z'
                rec['parsed_sha256']=sec.sha256(canonical(rec['parsed']))
                with gzip.open(path,'wt',encoding='utf-8') as f:json.dump(rec,f)
                fetcher=FakeFetcher({});result=self.collect(fetcher,NOW+timedelta(days=1))
                self.assertEqual(result['failures'][0]['error'],'CACHE_INTEGRITY_FAILED')
                self.assertEqual(fetcher.calls,[])

    def test_unchanged_cache_keeps_its_original_availability_and_needs_no_request(self):
        self.collect(FakeFetcher(routes()))
        row=self.store.manifest()[0];rec=self.store.load(row['path'])
        self.store.put(source_id=sec.SOURCE_ID,key=row['key'],url=rec['url'],body=rec['body'],
            retrieved_at=sec.stamp(NOW+timedelta(hours=1)),available_at=sec.stamp(NOW+timedelta(hours=1)),
            status='OK',parsed=rec['parsed'])
        before=(self.store.root/'manifest.jsonl').read_bytes()
        fetcher=FakeFetcher({});result=self.collect(fetcher,NOW+timedelta(days=1))
        self.assertEqual(result['cached'],['2026q2','2026q3'])
        self.assertEqual(fetcher.calls,[])
        self.assertEqual(self.store.load(row['path'])['available_at'],sec.stamp(NOW))
        self.assertEqual((self.store.root/'manifest.jsonl').read_bytes(),before)

    def test_bounded_transport_refuses_non_get_and_oversized_responses(self):
        with self.assertRaises(sec.ArchiveError):
            sec.bounded_transport('POST',sec.INDEX_URL,{},b'body',1)
        class Stream(io.BytesIO):
            status=200
            headers={}
        class Opener:
            def open(self,*args,**kwargs):return Stream(b'12345')
        with patch.object(sec.urllib.request,'build_opener',return_value=Opener()), \
                patch.object(sec,'MAX_INDEX_BYTES',4), self.assertRaises(sec.ArchiveError):
            sec.bounded_transport('GET',sec.INDEX_URL,{},None,1)


if __name__ == '__main__':
    unittest.main()
