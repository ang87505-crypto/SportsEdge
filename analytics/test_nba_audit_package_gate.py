"""All ZIP fixtures fictional; integrity tests assert no research return."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile
from analytics.nba_audit_package_gate import verify_bundle, BASE_COMMIT


def fixture(*, promote=False, rogue=False, corrupt=False, test_count=110):
    protocol = {'base_commit': BASE_COMMIT, 'promotion': False}
    prot = json.dumps(protocol).encode()
    report = {
       'version': 'nba-audit-20261012-v1',
       'protocol_sha256': hashlib.sha256(prot).hexdigest(),
       'promote': promote, 'untouched_test_results': None,
       'trustworthy_executable_roi': None,
       'validation_selected': 'identity_carry75',
       'reproduction': {'pr28': {
          'whole_evaluation': {'model_flat10': {'bets':6442,'profit_cents':-109257,'staked_cents':6442000}},
          'last_5000': {'model_flat10': {'bets':3840,'profit_cents':24768,'staked_cents':3840000}}
       }}
    }
    verified = {'base_commit': BASE_COMMIT, 'test_exit_code':0,
                'two_runs_byte_identical':True,'remote_mutations':False,
                'test_count':test_count}
    content = {
       'research/nba_audit_20261012/protocol.json':prot,
       'research/nba_audit_20261012/report.json':json.dumps(report).encode(),
       'research/nba_audit_20261012/verification.json':json.dumps(verified).encode()
    }
    hashes = {k:hashlib.sha256(v).hexdigest() for k,v in content.items()}
    patch = b'fictional-test-patch-only'
    fd=tempfile.TemporaryDirectory()
    path=Path(fd.name)/'test.zip'
    with ZipFile(path,'w') as f:
       f.writestr('README.md','mock')
       f.writestr('nba-audit-additions.patch',patch)
       f.writestr('SHA256SUMS.json',json.dumps(hashes))
       for key,value in content.items():
           f.writestr('files/'+key, (value+b'tampered') if corrupt and key.endswith('report.json') else value)
       if rogue:
           f.writestr('../injected.txt','evil')
    return fd,path,hashes,hashlib.sha256(patch).hexdigest()


class NbaBundleGateTests(unittest.TestCase):
    def test_valid_mock_does_not_claim_real_market_returns(self):
        ctx,path,h,p=fixture()
        with ctx:
            out=verify_bundle(path,expected=h,patch_sha256=p)
            self.assertEqual(out['new_files'],3)
            self.assertFalse(out['promoted'])
            self.assertFalse(out['historical_input_replay_independently_run'])

    def test_tampering_checksum_or_extra_members_refused(self):
        for opts in ({'corrupt':True},{'rogue':True}):
            with self.subTest(opts=opts):
                ctx,path,h,p=fixture(**opts)
                with ctx, self.assertRaises(ValueError):
                    verify_bundle(path,expected=h,patch_sha256=p)

    def test_valid_checksums_cannot_override_promotion_veto(self):
        ctx,path,h,p=fixture(promote=True)
        with ctx,self.assertRaisesRegex(ValueError,'Must not promote'):
            verify_bundle(path,expected=h,patch_sha256=p)

    def test_provenance_and_exact_archive_sha_are_pinned(self):
        ctx,path,h,p=fixture()
        with ctx:
            with self.assertRaisesRegex(ValueError,'Unexpected, missing'):
                verify_bundle(path,expected={'different-file':'wrong'},patch_sha256=p)
            with self.assertRaisesRegex(ValueError,'Patch differs'):
                verify_bundle(path,expected=h,patch_sha256='0'*64)


if __name__=='__main__':
    unittest.main()
