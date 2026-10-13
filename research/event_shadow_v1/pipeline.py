"""Offline event-ingestion boundary. Trusted collector receipts required.
No network, LLM execution, prices, returns, orders, or ongoing monitoring.
Allowlisting is transport provenance checking, not verification of a claim.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
from urllib.parse import urlsplit

VERSION = 'event-shadow-contract-v1'
SOURCES = {'sec': ('www.sec.gov', '/Archives/edgar/data/'),
           'fed': ('www.federalreserve.gov', '/newsevents/pressreleases/')}


def digest(obj):
    return sha256(json.dumps(obj, sort_keys=True, separators=(',', ':'),
                            allow_nan=False).encode()).hexdigest()


def stamp(value):
    if not isinstance(value, str): raise ValueError('timestamp required')
    at = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if at.tzinfo is None or at.utcoffset() is None: raise ValueError('timezone required')
    return at.astimezone(timezone.utc)


def source_url(source, url):
    if source not in SOURCES or not isinstance(url,str): raise ValueError('unapproved source')
    u = urlsplit(url); host,path = SOURCES[source]
    if (u.scheme != 'https' or u.hostname != host or u.username or u.password
            or u.port not in (None,443) or not u.path.startswith(path)
            or u.query or u.fragment or '%' in u.path or '/..' in u.path):
        raise ValueError('unapproved source URL')
    return url


def process(event, receipt, mappings, decision_at, seen):
    """Receipt must come from an independent trusted HTTPS collector.
    This offline function cannot authenticate arbitrary user-supplied receipts.
    observed_at is the first locally observed content version, never backdated.
    Mapping interval is [valid_from,valid_to), known_at is separate evidence time.
    seen is caller-owned durable dedup state in a future service; mutated only
    after successful validation. One issuer may map to several share classes;
    ambiguous mappings are quarantined, never guessed from a company name.
    """
    url = source_url(event['source'], event['url'])
    source_url(event['source'], receipt['final_url'])
    body = event['body']
    if not isinstance(body,str) or not 0 < len(body.encode()) <= 1_000_000:
        raise ValueError('invalid body size')
    body_hash=sha256(body.encode()).hexdigest()
    if (receipt['final_url'] != url or receipt['status'] != 200
            or receipt['body_sha256'] != body_hash):
        raise ValueError('receipt does not bind this content')
    observed=stamp(receipt['observed_at']); published=stamp(event['published_at'])
    decision=stamp(decision_at)
    if not published <= observed < decision: raise ValueError('unavailable at decision')
    effective=published
    for key in ('updated_at','deleted_at'):
        if event.get(key) is not None:
            value=stamp(event[key])
            if not published <= value <= observed: raise ValueError('revision timing')
            effective=max(effective,value)
    if event.get('deleted_at') is not None: raise ValueError('deleted event quarantined')
    issuer=event.get('issuer_id')
    if not isinstance(issuer,str) or not issuer.strip(): raise ValueError('issuer required')
    matches=[]
    for m in mappings:
        if m['issuer_id'] != issuer: continue
        if (stamp(m['known_at']) < decision and stamp(m['valid_from']) <= effective
                and (m.get('valid_to') is None or effective < stamp(m['valid_to']))):
            if not all(isinstance(m.get(k),str) and m[k].strip()
                       for k in ('security_id','ticker','evidence_url')):
                raise ValueError('mapping evidence required')
            matches.append(m)
    if len(matches) != 1: raise ValueError('missing or ambiguous dated security mapping')
    category=event.get('category')
    allowed=('earnings','guidance','regulatory','macro','corporate_other','unknown')
    if category not in allowed: raise ValueError('unknown category')
    identity=digest({'source':event['source'],'url':url,
                     'published':published.isoformat(),'effective':effective.isoformat(),
                     'content':body_hash})
    if identity in seen:return {'status':'DUPLICATE','event_id':identity,'orders_allowed':False}
    out={'version':VERSION,'event_id':identity,'source':event['source'],
         'canonical_url':url,'published_at':published.isoformat(),
         'observed_at':observed.isoformat(),'decision_at':decision.isoformat(),
         'updated_at':event.get('updated_at'),'deleted_at':None,
         'security_id':matches[0]['security_id'],'ticker':matches[0]['ticker'],
         'mapping_hash':digest(matches[0]),'category':category,
         'category_provenance':'supplied_metadata_unvalidated',
         'content_sha256':body_hash,'input_sha256':digest({'event':event,'receipt':receipt,'mappings':mappings}),
         'model_version':'none','novelty':'unmeasured','surprise':None,
         'materiality':None,'ambiguity':'unreviewed','source_confidence':'allowlisted_receipt_only',
         'relationship_direction':'unknown','affected_sectors':[],
         'expected_impact_horizon':None,'impact_probability':None,
         'signal_age_seconds':(decision-published).total_seconds(),
         'ingestion_latency_seconds':(observed-published).total_seconds(),
         'status':'SHADOW_REVIEW_ONLY','orders_allowed':False}
    out['output_sha256']=digest(out)
    seen.add(identity)
    return out
