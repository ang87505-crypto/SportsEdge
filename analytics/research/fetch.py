"""Read-only HTTP fetching for research collectors: per-host rate limits, retries with backoff,
conditional-request caching and explicit failure codes. GET and form/JSON POST only; no credentials
are ever placed in a URL. Injectable transport so every collector is testable without a network."""
from __future__ import annotations
from dataclasses import dataclass, field
import email.utils
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

RETRY_STATUSES = {429, 500, 502, 503, 504}


@dataclass
class Response:
    url: str
    status: int
    headers: dict
    body: bytes
    from_cache: bool = False


class FetchError(RuntimeError):
    def __init__(self, code: str, url: str, detail: str = ''):
        super().__init__(f'{code} {url} {detail}'.strip())
        self.code, self.url, self.detail = code, url, detail


def urllib_transport(method: str, url: str, headers: dict, body: bytes | None, timeout: float) -> Response:
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return Response(url, r.status, {k.lower(): v for k, v in r.headers.items()}, r.read())
    except urllib.error.HTTPError as e:
        return Response(url, e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, e.read() or b'')


@dataclass
class Fetcher:
    user_agent: str
    min_interval: dict = field(default_factory=dict)   # host -> seconds between requests
    transport: callable = urllib_transport
    clock: callable = time.monotonic
    sleep: callable = time.sleep
    cache_dir: Path | None = None
    retries: int = 4
    timeout: float = 30.0
    max_requests: int = 2000
    count: int = 0
    _last: dict = field(default_factory=dict)

    def _wait(self, host: str):
        gap = self.min_interval.get(host, 1.0)
        last = self._last.get(host)
        if last is not None:
            delay = gap - (self.clock() - last)
            if delay > 0:
                self.sleep(delay)
        self._last[host] = self.clock()

    def _cache_path(self, method, url, body):
        if not self.cache_dir:
            return None
        key = hashlib.sha256((method + ' ' + url).encode() + (body or b'')).hexdigest()
        return Path(self.cache_dir) / key

    def request(self, method: str, url: str, *, body: bytes | None = None, headers: dict | None = None,
                ok=(200,)) -> Response:
        if not url.startswith('https://'):
            raise FetchError('URL_NOT_HTTPS', url)
        host = urllib.parse.urlparse(url).hostname
        h = {'User-Agent': self.user_agent, 'Accept-Encoding': 'identity'} | (headers or {})
        cache = self._cache_path(method, url, body)
        cached = None
        if cache and cache.exists():
            cached = json.loads(cache.read_text())
            if cached.get('etag'):
                h['If-None-Match'] = cached['etag']
            if cached.get('last_modified'):
                h['If-Modified-Since'] = cached['last_modified']
        for attempt in range(self.retries + 1):
            if self.count >= self.max_requests:
                raise FetchError('REQUEST_BUDGET_EXHAUSTED', url)
            self.count += 1
            self._wait(host)
            try:
                r = self.transport(method, url, h, body, self.timeout)
            except Exception as e:  # network error: retried like a 503
                r = None
                err = type(e).__name__
            if r is not None and r.status == 304 and cached is not None:
                return Response(url, 200, cached['headers'], bytes.fromhex(cached['body_hex']), from_cache=True)
            if r is not None and r.status in ok:
                if cache:
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    cache.write_text(json.dumps({'etag': r.headers.get('etag'), 'last_modified': r.headers.get('last-modified'),
                                                 'headers': r.headers, 'body_hex': r.body.hex()}))
                return r
            if r is not None and r.status not in RETRY_STATUSES:
                raise FetchError(f'HTTP_{r.status}', url)
            if attempt == self.retries:
                raise FetchError('RETRIES_EXHAUSTED', url, f'HTTP_{r.status}' if r is not None else err)
            wait = 2.0 * (2 ** attempt)
            if r is not None and r.headers.get('retry-after'):
                ra = r.headers['retry-after']
                try:
                    wait = max(wait, float(ra))
                except ValueError:
                    when = email.utils.parsedate_to_datetime(ra)
                    wait = max(wait, when.timestamp() - time.time()) if when else wait
            self.sleep(min(wait, 120.0))
        raise FetchError('UNREACHABLE', url)

    def get(self, url: str, **kw) -> Response:
        return self.request('GET', url, **kw)

    def post_form(self, url: str, form: dict, **kw) -> Response:
        return self.request('POST', url, body=urllib.parse.urlencode(form).encode(),
                            headers={'Content-Type': 'application/x-www-form-urlencoded'}, **kw)

    def post_json(self, url: str, payload, **kw) -> Response:
        return self.request('POST', url, body=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, **kw)
