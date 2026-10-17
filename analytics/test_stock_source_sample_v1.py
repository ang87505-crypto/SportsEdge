"""All test bytes and source declarations are SYNTHETIC."""
import hashlib
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from analytics.stock_source_sample_v1 import inspect_sample, VERSION, ROLES, EVENTS


def manifest():
    return dict(version=VERSION, kind='synthetic_fixture', phase='development',
        coverage_start='2010-01-01T00:00:00-05:00', coverage_end='2010-12-31T23:59:59-05:00',
        rights_confirmed=False, rights_scope='unverified', volume_basis='unknown',
        availability_evidence='unverified', files={r:[] for r in ROLES},
        event_examples={e:[] for e in EVENTS})


class SourceSampleTests(unittest.TestCase):
    def test_empty_inventory_reports_precise_gaps_without_readiness(self):
        with tempfile.TemporaryDirectory() as root:
            r=inspect_sample(root,manifest())
        self.assertFalse(r['structural_preflight_passed']);self.assertFalse(r['historical_backtest_ready'])
        self.assertIn('missing_security_master',r['structural_gaps'])
        self.assertIn('missing_example_delisting',r['structural_gaps'])
        self.assertIsNone(r['performance'])

    def test_complete_declared_structure_still_does_not_authenticate_data(self):
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/'fictional.txt';p.write_text('SYNTHETIC SOURCE BYTES ONLY\n')
            h=hashlib.sha256(p.read_bytes()).hexdigest();m=manifest()
            m['files']={r:[dict(path=p.name,sha256=h)] for r in ROLES}
            m['volume_basis']='consolidated';m['availability_evidence']='documented_source_or_conservative_mapping'
            m['event_examples']={e:[dict(security_id='SYNTHETIC-A',event_id='SYNTHETIC-'+e,source_sha256=h)] for e in EVENTS}
            r=inspect_sample(root,m)
            self.assertTrue(r['structural_preflight_passed'])
            self.assertFalse(r['source_independently_verified']);self.assertFalse(r['historical_backtest_ready'])
            self.assertFalse(r['normalized_values_reconciled'])

    def test_changed_bytes_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/'source';p.write_text('synthetic');m=manifest()
            m['files']['prices']=[dict(path='source',sha256=hashlib.sha256(p.read_bytes()).hexdigest())]
            p.write_text('changed')
            with self.assertRaisesRegex(ValueError,'bytes changed'):inspect_sample(root,m)

    def test_test_period_and_unconfirmed_rights_block_before_payload_read(self):
        for mode in ('validation','test','rights'):
            m=manifest();m['kind']='source_sample';m['rights_confirmed']=True;m['rights_scope']='local_research'
            if mode=='validation':m['coverage_end']='2012-01-01T12:00:00Z'
            elif mode=='test':m['coverage_end']='2017-01-01T12:00:00Z'
            else:m['rights_confirmed']=False
            with self.subTest(mode=mode),patch('analytics.stock_source_sample_v1._verified_file') as read:
                with self.assertRaises(ValueError):inspect_sample('.',m)
                read.assert_not_called()

    def test_paths_and_unbound_events_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            m=manifest();m['files']['prices']=[dict(path='../outside',sha256='0'*64)]
            with self.assertRaises(ValueError):inspect_sample(root,m)
            m=manifest();m['event_examples']['delisting']=[dict(security_id='A',event_id='B',source_sha256='0'*64)]
            with self.assertRaisesRegex(ValueError,'not bound'):inspect_sample(root,m)


if __name__=='__main__':unittest.main()
