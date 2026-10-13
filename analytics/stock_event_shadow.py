"""Bounded offline shadow-event prototype. No network, models or order APIs.

Source verification here validates an allowlisted URL against a trusted ingest
receipt. It cannot authenticate publisher content supplied by an untrusted caller.
The future transport must validate TLS/final URL and create receipts itself.
"""
from copy import deepcopy
from datetime import datetime
import hashlib
import json
from urllib.parse import urlsplit

VERSION = 'stock-event-shadow-v1'
SOURCES = {'sec': {'www.sec.gov', 'data.sec.gov'},
           'federal_reserve': {'www.federalreserve.gov'}}


class EventRejected(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise EventRejected(message)


def stamp(value):
    require(isinstance(value, str) and 'T' in value, 'Timestamp required')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise EventRejected('Invalid timestamp') from exc
    require(result.tzinfo is not None and result.utcoffset() is not None, 'Timezone required')
    return result


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode()).hexdigest()


def verify_source(event):
    require(event['source'] in SOURCES, 'Source not approved')
    url = urlsplit(event['url'])
    require(url.scheme == 'https' and url.hostname in SOURCES[event['source']]
            and url.username is None and url.password is None and url.port in (None, 443)
            and not url.fragment, 'Untrusted source URL')
    receipt = event['receipt']
    require(receipt['final_url'] == event['url'] and receipt['tls_verified'] is True,
            'Missing trusted transport receipt')
    require(isinstance(receipt['collector_version'], str) and receipt['collector_version'].strip(),
            'Collector version missing')
    require(receipt['body_sha256'] == hashlib.sha256(event['body'].encode()).hexdigest(),
            'Body hash mismatch')


def validate_event(event):
    try:
        require(isinstance(event['event_id'], str) and bool(event['event_id'].strip()), 'ID required')
        require(type(event['revision']) is int and event['revision'] >= 0, 'Revision required')
        require(isinstance(event['body'], str) and len(event['body'].encode()) <= 100_000,
                'Body exceeds bounded envelope')
        require(event['status'] in ('published', 'corrected', 'deleted'), 'Invalid event status')
        verify_source(event)
        published, observed = stamp(event['published_at']), stamp(event['observed_at'])
        require(published <= observed, 'Publication after observation')
        require(stamp(event['receipt']['observed_at']) == observed, 'Receipt observation mismatch')
        if event['revision'] == 0:
            require(event['status'] == 'published' and event.get('updated_at') is None,
                    'Invalid original revision')
        else:
            require(event['status'] in ('corrected', 'deleted') and
                    published <= stamp(event['updated_at']) <= observed, 'Invalid correction timestamp')
        require(event['source'] != 'sec' or
                (isinstance(event['entity_id'], str) and len(event['entity_id']) == 10
                 and event['entity_id'].isascii() and event['entity_id'].isdigit()), 'SEC CIK required')
    except EventRejected:
        raise
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise EventRejected('Malformed event envelope') from exc


class ShadowStream:
    """Single-process bounded append-only prototype; restart persistence not built."""
    def __init__(self, capacity=1000):
        require(type(capacity) is int and 0 < capacity <= 100_000, 'Invalid capacity')
        self.capacity = capacity
        self._rows = []

    def ingest(self, event):
        validate_event(event)
        item = deepcopy(event)
        key = (item['source'], item['event_id'])
        prior = [r['event'] for r in self._rows
                 if (r['event']['source'], r['event']['event_id']) == key]
        for old in prior:
            if old['revision'] == item['revision']:
                # Repeat receipts do not move first-observed time forward.
                same = ('body', 'url', 'status', 'published_at', 'updated_at', 'entity_id', 'form')
                require(all(old.get(k) == item.get(k) for k in same), 'Conflicting duplicate revision')
                require(stamp(item['observed_at']) >= stamp(old['observed_at']), 'Backdated duplicate')
                return 'DUPLICATE'
        require(len(self._rows) < self.capacity, 'Capacity reached; durable persistence needed')
        require(item['revision'] == len(prior), 'Missing/out-of-order revision')
        if prior:
            require(item['url'] == prior[0]['url'] and item['published_at'] == prior[0]['published_at']
                    and item['entity_id'] == prior[0]['entity_id'], 'Revision identity changed')
            require(stamp(item['updated_at']) >= stamp(prior[-1].get('updated_at') or prior[-1]['published_at']),
                    'Backdated update')
        if self._rows:
            require(stamp(item['observed_at']) >= stamp(self._rows[-1]['event']['observed_at']),
                    'Nonchronological receipt')
        parent = self._rows[-1]['hash'] if self._rows else '0'*64
        row = dict(event=item, parent_hash=parent, version=VERSION)
        row['hash'] = digest(row)
        self._rows.append(row)
        return 'ACCEPTED'

    def assess(self, *, source, event_id, decision_at, mappings):
        at = stamp(decision_at)
        known = [r for r in self._rows if r['event']['source'] == source
                 and r['event']['event_id'] == event_id and stamp(r['event']['observed_at']) <= at]
        require(bool(known), 'Event not yet observed')
        row = known[-1]; event = row['event']
        resolved = []
        for mapping in mappings:
            if mapping['entity_id'] != event['entity_id']:
                continue
            if (stamp(mapping['available_at']) <= at and stamp(mapping['effective_from']) <= at
                    and (mapping['effective_until'] is None or at < stamp(mapping['effective_until']))):
                require(bool(mapping.get('evidence')) and bool(mapping.get('security_id'))
                        and bool(mapping.get('ticker')), 'Unproven entity mapping')
                resolved.append(mapping)
        ambiguous = len(resolved) != 1
        category = ('corporate_filing' if source == 'sec' else 'policy_release')
        result = dict(version=VERSION, event_id=event_id, source=source, url=event['url'],
                      revision=event['revision'], published_at=event['published_at'],
                      observed_at=event['observed_at'], updated_at=event.get('updated_at'),
                      decision_at=decision_at, category=category, direction='UNKNOWN',
                      materiality='UNASSESSED', novelty='UNASSESSED', probability=None,
                      horizon='UNREGISTERED', source_confidence='ALLOWLIST_AND_RECEIPT_ONLY',
                      mapping_status='AMBIGUOUS_OR_MISSING' if ambiguous else 'CALLER_ATTESTED',
                      securities=[] if ambiguous else [deepcopy(resolved[0])],
                      status='QUARANTINED' if ambiguous or event['status'] == 'deleted' else 'SHADOW_ONLY',
                      signal_age_seconds=(at-stamp(event['published_at'])).total_seconds(),
                      detection_delay_seconds=(stamp(event['observed_at'])-stamp(event['published_at'])).total_seconds(),
                      orders_allowed=False, input_hash=digest(dict(event=event, mappings=mappings)),
                      audit_hash=row['hash'])
        result['output_hash'] = digest(result)
        return result
