"""Synthetic coverage and all-members traversal tests; no LEAN runtime claim."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from datetime import datetime, timedelta

stub = types.ModuleType('AlgorithmImports')
stub.QCAlgorithm = type('QCAlgorithm', (), {})
old = sys.modules.get('AlgorithmImports')
sys.modules['AlgorithmImports'] = stub
try:
    spec = importlib.util.spec_from_file_location('audit_v2', Path(__file__).with_name('main.py'))
    qc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(qc)
finally:
    if old is None: del sys.modules['AlgorithmImports']
    else: sys.modules['AlgorithmImports'] = old

class AuditTests(unittest.TestCase):
    def setUp(self):
        self.cutoff = datetime(2000, 1, 3, 8)
        self.days = sorted((self.cutoff-timedelta(days=i)).date()
                           for i in range(3, 256))
        self.rows = [(d, datetime.combine(d, datetime.min.time())+timedelta(hours=16),
                      '10', 100, False) for d in self.days]

    def test_complete_structure_not_source_admission(self):
        self.assertTrue(qc.inspect_rows(self.rows, self.days, self.cutoff)['structural_pass'])

    def test_missing_duplicate_fill_forward_late_nonfinite(self):
        cases = [self.rows[:-1], self.rows+[self.rows[-1]]]
        for index, value in [(1,self.cutoff),(2,'NaN'),(2,'0'),(3,-1),(3,1.5),(4,True)]:
            row = list(self.rows[-1]); row[index]=value
            cases.append(self.rows[:-1]+[tuple(row)])
        for rows in cases:
            with self.subTest(rows=rows[-1]):
                self.assertFalse(qc.inspect_rows(rows,self.days,self.cutoff)['structural_pass'])

    def test_empty_short_calendar(self):
        self.assertFalse(qc.inspect_rows([],self.days,self.cutoff)['structural_pass'])
        self.assertFalse(qc.inspect_rows(self.rows[:-1],self.days[:-1],self.cutoff)['structural_pass'])

    def instance(self, size=65):
        a=qc.SportsEdgeRawHistoryAudit(); a.time=self.cutoff
        a._members=[types.SimpleNamespace(id=str(i)) for i in range(size)]
        a.spy=types.SimpleNamespace(id='SPY'); a._universe_day=self.cutoff.date()
        a._audits={}; a._fatal=False; a.debug=lambda s: None; a.quit=lambda: None
        calls=[]
        def history(symbols, cutoff):
            calls.append(len(symbols))
            for d,end,close,volume,filled in self.rows:
                yield {str(s.id):types.SimpleNamespace(symbol=s,time=datetime.combine(d,datetime.min.time()),
                    end_time=end,close=close,volume=volume,is_fill_forward=filled) for s in symbols}
        a.history_rows=history
        return a,calls

    def test_every_member_across_batches(self):
        a,calls=self.instance(); a.audit()
        self.assertEqual(calls,[1,32,32,1])
        r=a._audits[(2000,1)]
        self.assertEqual(r['inspected'],65); self.assertTrue(r['completed'])
        self.assertFalse(r['source_admitted'])
        a.audit(); self.assertEqual(calls,[1,32,32,1])

    def test_missing_callback_and_duplicate_identity_stop(self):
        for duplicate in [True,False]:
            a,_=self.instance()
            if duplicate:a._members.append(a._members[0])
            else:a._universe_day=None
            a.audit(); self.assertTrue(a._fatal)
            self.assertFalse(a._audits[(2000,1)]['completed'])

    def test_runtime_failure_is_not_partial_success(self):
        a,_=self.instance()
        a.history_rows=lambda *args: (_ for _ in ()).throw(RuntimeError('synthetic'))
        a.audit();a.on_end_of_algorithm()
        self.assertTrue(a._fatal); self.assertFalse(a._coverage_completed)
        self.assertFalse(a._source_admitted)

    def test_sealed_dates_not_requested(self):
        a,calls=self.instance();a.time=datetime(2017,1,3,8);a.audit()
        self.assertEqual(calls,[])

if __name__=='__main__':unittest.main()
