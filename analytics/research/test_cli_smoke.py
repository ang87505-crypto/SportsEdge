"""SYNTHETIC end-to-end smoke test of the research runner: a fake Alpaca source, synthetic bars, a synthetic
13F filing and a synthetic QMOM snapshot. Proves the wiring only; its numbers mean nothing."""
from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import random
import tempfile
import unittest
from unittest import mock

from analytics.research import cli, qmom, sec13f
from analytics.research.store import SnapshotStore


def weekdays(a: str, b: str) -> list[str]:
    d, out = date.fromisoformat(a), []
    while d <= date.fromisoformat(b):
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


class FakeSource:
    """Serves /v2/calendar, /v2/stocks/bars and /v1/corporate-actions from synthetic data."""

    def __init__(self, symbols, end='2026-11-20'):
        rnd = random.Random(7)
        self.days = weekdays('2016-01-04', end)
        self.bars = {}
        for s in sorted(symbols):
            p, rows = rnd.uniform(30, 150), []
            for d in self.days:
                if s == 'OLDCO' and d >= '2026-01-14':
                    continue  # renamed to NEWCO
                if s == 'NEWCO' and d < '2026-01-14':
                    continue
                if s == 'GONE' and d >= '2026-08-04':
                    continue  # cash merger
                o = p * (1 + rnd.gauss(0, 0.004))
                c = o * (1 + rnd.gauss(0.0004, 0.012))
                p = c
                rows.append({'t': d + 'T05:00:00Z', 'o': round(o, 2), 'c': round(c, 2), 'v': 5e6})
            self.bars[s] = rows
        self.count = 0

    def fetch(self, base, path, query):
        self.count += 1
        return [{'date': d} for d in self.days if query['start'] <= d <= query['end']]

    def paged(self, base, path, query):
        self.count += 1
        syms = query['symbols'].split(',')
        if path == '/v1/corporate-actions':
            ca = {'name_changes': [{'old_symbol': 'OLDCO', 'new_symbol': 'NEWCO', 'process_date': '2026-01-14'}],
                  'cash_mergers': [{'acquiree_symbol': 'GONE', 'rate': '210', 'effective_date': '2026-08-04'}]}
            return [{'corporate_actions': {k: [r for r in v if (r.get('old_symbol') or r.get('acquiree_symbol')) in syms]
                                           for k, v in ca.items()}}]
        out = {}
        for s in syms:
            if s in self.bars:
                out[s] = [r for r in self.bars[s] if query['start'] <= r['t'][:10] <= query['end']]
        return [{'bars': out}]


class Smoke(unittest.TestCase):
    def test_historical_forward_and_report_end_to_end(self):
        members = [{'symbol': f'S{i:02d}', 'sector': f'Sec{i % 6}', 'first_traded_on': '2015-01-02'} for i in range(12)]
        members += [{'symbol': 'OLDCO', 'sector': 'Sec1', 'first_traded_on': '2015-01-02'},
                    {'symbol': 'GONE', 'sector': 'Sec2', 'first_traded_on': '2015-01-02'}]
        universe = {'version': 'x', 'max_last_close': '95', 'securities': members}
        src = FakeSource([m['symbol'] for m in members] + ['SPY', 'QMOM', 'BRK.B', 'NEWCO', 'S01', 'S02'])
        with tempfile.TemporaryDirectory() as d:
            data = Path(d)
            ufile = data / 'universe.json'
            ufile.write_text(json.dumps(universe))
            store = SnapshotStore(data)
            # one synthetic 13F filing and a synthetic CUSIP mapping
            rows = [{'issuer': f'Co{i}', 'title': 'COM', 'cusip': f'00000000{i}', 'value': 100 - i, 'shares': 1, 'share_type': 'SH',
                     'put_call': None, 'other_manager': None} for i in range(6)]
            meta = {'accession': '0000000000-16-000001', 'form': '13F-HR', 'filing_date': '2016-11-14', 'report_date': '2016-09-30',
                    'accepted_at': '2016-11-14T21:05:00Z'}
            store.put(source_id=sec13f.SOURCE_ID, key='filing:x:infotable', url='https://example.test', retrieved_at='2026-11-09T23:00:00Z',
                      body=b'synthetic', status='OK', parsed=dict(meta, primary={'period': '2016-09-30', 'is_amendment': False,
                                                                                    'amendment_type': None}, rows=rows))
            mapping = {f'00000000{i}': {'ticker': f'S{i:02d}'} for i in range(6)}
            store.put(source_id='openfigi-cusip', url='https://example.test', retrieved_at='2026-11-09T23:00:00Z', body=b'map',
                      status='OK', parsed={'cusips': list(mapping), 'mapping': mapping})
            snap = [{'ticker': f'S{i:02d}', 'name': 'x', 'cusip': 'x', 'shares': 1, 'price': 1, 'market_value_mm': 1,
                     'weight_pct': 4.0} for i in range(12)] + [{'ticker': 'NOPE', 'name': 'x', 'cusip': 'x', 'shares': 1, 'price': 1,
                                                                 'market_value_mm': 1, 'weight_pct': 52.0}]
            store.put(source_id=qmom.SOURCE_ID, url=qmom.URL, retrieved_at='2026-11-09T23:30:00Z', body=b'<html/>', status='OK',
                      effective_date='2026-11-09', parsed={'effective_date': '2026-11-09', 'rows': snap})
            with mock.patch.object(cli, 'UNIVERSE', ufile), mock.patch.object(cli, 'alpaca', lambda: src):
                now = datetime(2026, 11, 21, 3, 0, tzinfo=timezone.utc)
                hist = cli.cmd_historical(data, data / 'results', '2026-11-06', now)
                self.assertIn(hist['overall'].split(':')[0], ('NONE QUALIFIES', 'QUALIFIES FOR REVIEW'))
                self.assertEqual(set(hist['results']), {'momentum-quality-paper-v1', 'berkshire-13f-top5-paper-v1'})
                self.assertEqual(hist['data']['joins'][0]['old'], 'OLDCO')
                self.assertEqual(len(hist['verdicts']['momentum-quality-paper-v1']['checks']), 9)
                brk = hist['results']['berkshire-13f-top5-paper-v1']
                self.assertEqual(brk['decision_log'][0]['meta']['period'], '2016-09-30')
                for c in (0, 5, 10, 25):
                    self.assertIn('unresolved', brk[f'bps{c}']['as_live'])
                fwd = cli.cmd_forward(data, data / 'results', '2026-11-20', now)
                f = fwd['ledgers']['qmom-disclosure-follower-v1']
                self.assertEqual(f['first_execution'], '2026-11-10')
                self.assertEqual(f['status'], 'INSUFFICIENT FORWARD SAMPLE')
                self.assertAlmostEqual(f['decisions'][0]['meta']['dropped_weight'], 0.20)  # NOPE capped to 20% and unpriced
                report = cli.cmd_report(data, now).read_text()
                self.assertIn('Historical evaluation', report)
                self.assertIn('Forward paper ledgers', report)
                with self.assertRaises(FileExistsError):
                    cli.write_new(data / 'results' / f"historical-{cli.stamp(now).replace(':', '')}.json", {})


if __name__ == '__main__':
    unittest.main()
