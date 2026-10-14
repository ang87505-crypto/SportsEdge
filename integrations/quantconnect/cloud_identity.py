"""Cloud-only orchestration. No HTTP/API, broker calls, data logs or exports.

Source protocol: metadata() -> manifest; evidence(reference) -> bytes;
header() -> {initial, calendar, settlement}; rows() -> chronological iterable;
benchmarks() -> {benchmarks, risk_free}. All implementations run INSIDE QC.
No implementation of that source is supplied: QC's standard feed does not by
itself prove the required source evidence and lifecycle economics.
"""
import hashlib
from analytics.stock_accounting_v2 import require
from analytics.stock_development_runner_v1 import REVIEWS
from analytics.stock_readiness_pipeline_v1 import PROTOCOL, verify_freezes
from analytics.stock_identity_stream_v1 import IdentityDevelopmentStream


def run_in_cloud(source):
    """Return a report to its in-cloud caller only after complete reconciliation.

    References/hashes bind declarations, not their truth. Do not print exception
    values or reports: source-dependent identifiers may appear in kernel errors.
    """
    verify_freezes()
    manifest = source.metadata()
    require(set(manifest) == {'phase', 'start', 'end', 'runtime_scope', 'dataset_revision',
                            'lean_version', 'protocol_sha256', 'reviews'}, 'Exact cloud manifest required')
    require(manifest['phase'] == 'development' and manifest['start'] == '2000-01-01'
            and manifest['end'] == '2011-12-31', 'Reserved period blocked before data access')
    require(manifest['runtime_scope'] == 'quantconnect_cloud', 'Cloud-only licensed scope required')
    require(manifest['protocol_sha256'] == hashlib.sha256(PROTOCOL.read_bytes()).hexdigest(), 'Frozen protocol mismatch')
    require(all(isinstance(manifest[k], str) and manifest[k].strip()
                for k in ('dataset_revision', 'lean_version')), 'Dataset/engine vintage required')
    require(set(manifest['reviews']) == set(REVIEWS), 'Every historical review required')
    # Complete validation BEFORE reading a single evidence or price object.
    for review in manifest['reviews'].values():
        require(set(review) == {'reviewer', 'status', 'reference', 'sha256'}
                and review['status'] == 'reviewed'
                and isinstance(review['reviewer'], str) and bool(review['reviewer'].strip())
                and isinstance(review['reference'], str) and bool(review['reference'].strip())
                and isinstance(review['sha256'], str) and len(review['sha256']) == 64
                and all(c in '0123456789abcdef' for c in review['sha256']), 'Pending/invalid historical review')
    for review in manifest['reviews'].values():
        evidence = source.evidence(review['reference'])
        require(isinstance(evidence, bytes) and hashlib.sha256(evidence).hexdigest() == review['sha256'],
                'Historical evidence hash mismatch')
    header = source.header()
    require(set(header) == {'initial', 'calendar', 'settlement'}, 'Exact source header required')
    stream = IdentityDevelopmentStream(**header)
    for row in source.rows():
        stream.accept(row)
    final = source.benchmarks()
    require(set(final) == {'benchmarks', 'risk_free'}, 'Exact benchmark envelope required')
    report = stream.finish(**final)
    report['dataset_revision'] = manifest['dataset_revision']; report['lean_version'] = manifest['lean_version']
    return report


def safe_cloud_run(source):
    """Fixed external status; detailed exceptions remain inside the cloud process."""
    try:
        result = run_in_cloud(source)
    except Exception:
        return 'SPORTSEDGE_SOURCE_OR_ACCOUNTING_BLOCKED_NO_RESULT', None
    return 'SPORTSEDGE_DEVELOPMENT_COMPLETED_PENDING_SOURCE_REVIEW', result
