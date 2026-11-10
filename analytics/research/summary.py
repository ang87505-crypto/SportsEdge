"""Small public read model shared by the website and chat; no account data or raw prices."""
from __future__ import annotations
import math

VERSION = 'stock-research-summary-v1'
IDS = ('momentum-quality-paper-v1', 'qmom-disclosure-follower-v1', 'berkshire-13f-top5-paper-v1')

def number(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None

def metrics(x):
    return {k: number((x or {}).get(k)) for k in ('cagr', 'total', 'sharpe', 'max_drawdown', 'end_value')}

def build_summary(hist, fwd, manifest, runs, generated_at, source_commit=None):
    sources = []
    for sid in sorted({r['source_id'] for r in manifest}):
        rows = [r for r in manifest if r['source_id'] == sid]
        ok = [r for r in rows if r['status'] in ('OK', 'UNCHANGED')]
        sources.append({'id': sid, 'status': rows[-1]['status'], 'retrievedAt': rows[-1]['retrieved_at'],
                        'lastSuccessAt': ok[-1]['retrieved_at'] if ok else None})
    last_forward = next((r for r in reversed(runs) if r.get('command') == 'forward'), {})
    candidates = []
    for sid in IDS:
        result = ((hist or {}).get('results') or {}).get(sid)
        verdict = ((hist or {}).get('verdicts') or {}).get(sid)
        led = ((fwd or {}).get('ledgers') or {}).get(sid, {})
        forward_result = (led.get('result') or {}).get('bps10', {}).get('continuous') or {}
        candidates.append({
            'id': sid, 'active': False,
            'historical': None if result is None else {
                'verdict': verdict['verdict'] if verdict else 'NOT_EVALUATED',
                'failedChecks': [k for k, ok in (verdict or {}).get('checks', {}).items() if not ok],
                'costBps': 10, 'continuous': metrics(result['bps10']['continuous']['full']),
                'asLive': metrics(result['bps10']['as_live']['full'])},
            'forward': {'status': led.get('status') or (fwd or {}).get('status') or last_forward.get('status') or 'NOT_STARTED',
                        'sessions': led.get('sessions', 0), 'firstExecution': led.get('first_execution'),
                        'totalReturn': number(forward_result.get('full', {}).get('total'))}})
    return {
        'schemaVersion': VERSION, 'generatedAt': generated_at, 'sourceCommit': source_commit,
        'overall': (hist or {}).get('overall', 'NOT_EVALUATED'),
        'historicalAt': (hist or {}).get('at'), 'window': (hist or {}).get('window'),
        'capital': (hist or {}).get('capital'), 'datasetFingerprint': (hist or {}).get('data', {}).get('fingerprint'),
        'benchmark': metrics((hist or {}).get('benchmarks', {}).get('spy-hold', {}).get('full')),
        'forwardAt': (fwd or {}).get('at') or last_forward.get('at'),
        'sources': sources, 'candidates': candidates,
        'limitations': ['Historical results use previously inspected data and a survivorship-biased stock universe.',
                        'Historical simulation and forward paper results are separate; no candidate is activated.']}
