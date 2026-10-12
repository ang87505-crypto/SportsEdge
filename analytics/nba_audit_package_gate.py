"""Fail-closed review gate for the exact Oct 12 Astra NBA research handoff.

This is a packaging/integrity gate, NOT independent market-data validation.
No network calls, database writes or betting actions. Standard library only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

BASE_COMMIT = '1bca2bdb6e3a9c53b15021a63242e26055e285d2'
EXPECTED = {
 'analytics/nba_research_audit_20261012.py': '2d930ce59fe8355df17962bb073b11208718d8b16e4d99196402b34f08eca983',
 'analytics/test_nba_research_audit_20261012.py': '9dfaf252d8b4e870cef4b222d02cd4b6a0998bbba3b7b4e25557128161a55b34',
 'docs/NBA_RESEARCH_AUDIT_2026_10_12.md': 'a7479f039dadbe2438244317d341dd5eb2f768ffd8ab9bc499d5965eeb034a3b',
 'research/nba_audit_20261012/pr17_replay.json': '26ea469fbda2dd0b76997c40f5bace00741d1b48456f7b02bb066ff96f090051',
 'research/nba_audit_20261012/protocol.json': 'f0a014fa84a49e27ed6258ef94da7cbbf93613bce1c8a5a79a7a9c5cdb87b231',
 'research/nba_audit_20261012/report.json': '4b57ddc7ba9d3d7fa03c4077694bc24576aaaf5cd3cb4fa6ff3d0c012834c5d0',
 'research/nba_audit_20261012/reproduce.py': '9f7be76b26622c892fd7ec619ab59724356292710e04bfbe2498c5b5fe7d2f55',
 'research/nba_audit_20261012/verification.json': '39bb411e3e0b9aca2591675e5fb2f9cdc5855a027dcab2e6207ab27bd95999a4',
}
PATCH_SHA256 = 'a245befefa43e51eaebab1c9566c6465ee146d4ab944e77e5ff828c480e2b448'
ROOT_FILES = {'README.md', 'nba-audit-additions.patch', 'SHA256SUMS.json'}


def require(value: bool, message: str) -> None:
    if not value:
        raise ValueError(message)


def verify_bundle(path: Path, *, expected: dict[str, str] | None = None,
                  patch_sha256: str | None = None) -> dict:
    """Read-only audit of package integrity and non-promotion assertions.

    expected/patch_sha256 overrides exist ONLY for synthetic unit tests; the
    CLI always uses frozen official checksums above.
    """
    expected = EXPECTED if expected is None else expected
    patch_sha256 = PATCH_SHA256 if patch_sha256 is None else patch_sha256
    with ZipFile(path) as bundle:
        infos = bundle.infolist()
        names = [i.filename for i in infos]
        want = ROOT_FILES | {'files/' + k for k in expected}
        require(len(names) == len(set(names)) and set(names) == want,
                'Unexpected, missing, or repeated ZIP members')
        require(all(not i.is_dir() and i.file_size < 15_000_000 for i in infos),
                'Unexpected ZIP directory or oversized file')
        require(sum(i.file_size for i in infos) < 25_000_000,
                'Unreasonably large package')
        sums = json.loads(bundle.read('SHA256SUMS.json'))
        require(sums == expected, 'Research checksum manifest differs from pinned package')
        for rel, sha in expected.items():
            actual = hashlib.sha256(bundle.read('files/' + rel)).hexdigest()
            require(actual == sha, f'Checksum mismatch: {rel}')
        require(hashlib.sha256(bundle.read('nba-audit-additions.patch')).hexdigest() == patch_sha256,
                'Patch differs from pinned audit')
        report = json.loads(bundle.read('files/research/nba_audit_20261012/report.json'))
        protocol = json.loads(bundle.read('files/research/nba_audit_20261012/protocol.json'))
        verification = json.loads(bundle.read('files/research/nba_audit_20261012/verification.json'))
    require(verification.get('base_commit') == BASE_COMMIT,
            'Package built against unexpected repository commit')
    require(report.get('version') == 'nba-audit-20261012-v1', 'Unknown audit report version')
    require(report.get('protocol_sha256') == expected['research/nba_audit_20261012/protocol.json'],
            'Protocol/report checksum mismatch')
    require(protocol.get('base_commit') == BASE_COMMIT and protocol.get('promotion') is False,
            'Expected frozen, unpromoted prospective protocol')
    require(report.get('promote') is False and report.get('untouched_test_results') is None and
            report.get('trustworthy_executable_roi') is None,
            'Must not promote model or imply trustworthy executable returns')
    require(report.get('validation_selected') == 'identity_carry75',
            'Changed research selection; manual investigation required')
    require(verification.get('test_exit_code') == 0 and
            verification.get('two_runs_byte_identical') is True and
            verification.get('remote_mutations') is False,
            'Author-reported verification or safety flags changed')
    base = report['reproduction']['pr28']['whole_evaluation']['model_flat10']
    last = report['reproduction']['pr28']['last_5000']['model_flat10']
    require((base['bets'], base['profit_cents'], base['staked_cents']) == (6442, -109257, 6442000),
            'Legacy full-period price scenario changed')
    require((last['bets'], last['profit_cents'], last['staked_cents']) == (3840, 24768, 3840000),
            'Legacy last-5,000 scenario changed')
    return {'bundle_verified': True, 'new_files': len(expected),
            'base_commit': BASE_COMMIT, 'candidate': report['validation_selected'],
            'promoted': False, 'executable_roi_verified': False,
            'historical_input_replay_independently_run': False,
            'note': 'Integrity and fixed-result gate only; review source code, run full suite and independently reproduce data before merge.'}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip_path', type=Path, help='Local unmodified Astra NBA audit ZIP')
    args = parser.parse_args()
    print(json.dumps(verify_bundle(args.zip_path), indent=2))


if __name__ == '__main__':
    main()
