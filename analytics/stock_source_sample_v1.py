"""Offline source-sample preflight; checks bytes/declarations, not source truth.

Real samples are restricted to development dates before reading any payload.
No licensed data acquisition, validation/test access or return calculation.
"""
import hashlib
import json
from pathlib import Path
from .stock_accounting_v2 import require, stamp, NY

VERSION = 'stock-source-sample-preflight-v1'
ROLES = ('rights', 'security_master', 'prices', 'corporate_actions',
         'exchange_calendar', 'settlement_calendar', 'benchmark', 'field_mapping')
EVENTS = ('ordinary_cash_dividend', 'split', 'rename', 'delisting')


def _verified_file(root, entry):
    require(set(entry) == {'path', 'sha256'}, 'File path and SHA256 required')
    require(isinstance(entry['path'], str) and not Path(entry['path']).is_absolute(),
            'Sample paths must be relative')
    path = (root / entry['path']).resolve()
    require(path.is_relative_to(root) and path.is_file(), 'Missing or out-of-root sample file')
    expected = entry['sha256']
    require(isinstance(expected, str) and len(expected) == 64
            and all(c in '0123456789abcdef' for c in expected), 'Invalid SHA256')
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    require(h.hexdigest() == expected, 'Source bytes changed: ' + entry['path'])
    return expected


def inspect_sample(root, manifest):
    """Returns structural gaps and hard historical blockers; never admission.

    `rights_confirmed` records the operator's declaration only. The referenced
    license/use evidence must still be independently reviewed. Real payloads
    cannot be inspected until this declaration and the development range pass.
    """
    root = Path(root).resolve()
    require(set(manifest) == {'version','kind','phase','coverage_start','coverage_end',
        'rights_confirmed','rights_scope','volume_basis','availability_evidence',
        'files','event_examples'}, 'Exact sample manifest fields required')
    require(manifest['version'] == VERSION, 'Sample version mismatch')
    require(manifest['kind'] in ('synthetic_fixture','source_sample'), 'Explicit sample kind required')
    # Timestamp parsing and range guard precede ALL file reads.
    start = stamp(manifest['coverage_start']).astimezone(NY).date().isoformat()
    end = stamp(manifest['coverage_end']).astimezone(NY).date().isoformat()
    require(start <= end, 'Unordered sample coverage')
    require(manifest['phase'] == 'development', 'Only development-sample phase admitted')
    if manifest['kind'] == 'source_sample':
        require('1999-01-01' <= start <= end <= '2011-12-31',
                'Validation/sealed-test sample access blocked')
        require(manifest['rights_confirmed'] is True and manifest['rights_scope'] == 'local_research',
                'Confirm legally permitted local research before reading source data')
    require(isinstance(manifest['files'], dict) and set(manifest['files']) == set(ROLES),
            'All source roles must be inventoried, including missing ones')
    gaps = []; verified = {}
    for role in ROLES:
        entries = manifest['files'][role]
        require(isinstance(entries, list), 'Source-role file list required')
        if not entries:
            gaps.append('missing_' + role)
        verified[role] = [_verified_file(root, e) for e in entries]
    if manifest['volume_basis'] != 'consolidated':
        gaps.append('consolidated_volume_unverified')
    if manifest['availability_evidence'] != 'documented_source_or_conservative_mapping':
        gaps.append('availability_semantics_unverified')
    require(isinstance(manifest['event_examples'], dict) and set(manifest['event_examples']) == set(EVENTS),
            'Dividend/split/rename/delisting examples must be inventoried')
    action_hashes = set(verified['corporate_actions'])
    for kind, examples in manifest['event_examples'].items():
        require(isinstance(examples, list), 'Event examples must be a list')
        if not examples:
            gaps.append('missing_example_' + kind)
        for example in examples:
            require(set(example) == {'security_id','event_id','source_sha256'}, 'Event source reference required')
            require(isinstance(example['security_id'], str) and bool(example['security_id'])
                    and isinstance(example['event_id'], str) and bool(example['event_id']), 'Event identity required')
            require(example['source_sha256'] in action_hashes, 'Event example not bound to a verified action file')
    return dict(version=VERSION, kind=manifest['kind'], phase='development',
        file_hashes_verified=verified, structural_gaps=gaps, structural_preflight_passed=not gaps,
        license_independently_verified=False, source_independently_verified=False,
        normalized_values_reconciled=False, historical_backtest_ready=False, performance=None,
        remaining_blockers=['independent_license_and_source_review',
            'source_to_normalized_values_and_timing_reconciliation',
            'delisting_merger_spinoff_fractional_event_accounting',
            'reviewed_historical_execution_proxy', 'full_dataset_and_benchmarks',
            'sealed_test_access_governance'])


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    require(not args.output.exists(), 'Choose a new output filename')
    result = inspect_sample(args.root, json.loads(args.manifest.read_text()))
    with args.output.open('x') as stream:
        json.dump(result, stream, indent=2, allow_nan=False); stream.write('\n')


if __name__ == '__main__':
    main()
