#!/usr/bin/env python3
"""Public operating observations. First fetch establishes a baseline, not new signals."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SOURCE_REGISTRY = ROOT / 'cloud/data/source_registry.json'
URLS = {
    'jobs': 'https://boards-api.greenhouse.io/v1/boards/nebius/jobs',
    'regions': 'https://status.nebius.com/api/v2/components.json',
    'incidents': 'https://status.nebius.com/api/v2/incidents.json',
}

def _https(url):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError('Official source URL must be absolute HTTPS without credentials')
    return parsed

def retrieve_fingerprint(url):
    """Read a bounded official-index response without retaining its content.

    This is deliberately a *change detector*, not a financial parser. A changed
    press-release index creates a visible review candidate; it never fabricates
    a revenue, MW, or contract observation from a page title.
    """
    initial = _https(url)
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Ensemble-public-cloud-observations/1.1',
        'Accept': 'text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.1',
    })
    with urllib.request.urlopen(req, timeout=25) as response:
        final = _https(response.url)
        # A static registry may redirect within the issuer's public web estate,
        # but a redirect to an unrelated origin is not accepted silently.
        if final.hostname != initial.hostname and not final.hostname.endswith('.' + initial.hostname):
            raise ValueError('Unexpected redirect host')
        length = response.headers.get('Content-Length')
        if length and int(length) > 2_000_000:
            raise ValueError('Response too large')
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('Response too large')
        return {
            'content_hash': hashlib.sha256(raw).hexdigest(),
            'content_type': response.headers.get_content_type(),
            'etag': response.headers.get('ETag'),
            'last_modified': response.headers.get('Last-Modified'),
            'bytes': len(raw),
            'final_url': response.url,
        }

def retrieve(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Ensemble-public-cloud-observations/1.0', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=25) as response:
        if response.url != url:
            raise ValueError('Unexpected redirect')
        raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise ValueError('Response too large')
        return json.loads(raw)

def normalize(kind, body):
    if kind == 'jobs':
        rows = body['jobs']
        return [{'id': str(r['id']), 'title': r['title'], 'location': r.get('location', {}).get('name', '미공개'),
                 'url': r['absolute_url'], 'source_updated_at': r.get('updated_at'),
                 'data_center': bool(re.search(r'data\s*center|datacentre|critical facilities|commissioning', r['title'], re.I))} for r in rows]
    if kind == 'regions':
        rows = body['components']
        # A service component is not a region. Select regional group entries only.
        return [{'id': r['id'], 'name': r['name'], 'status': r['status']} for r in rows
                if r.get('group') and re.match(r'^(EU|US|UK|AP|ME|SA|CA|IL)[- ]', r['name'], re.I)]
    return [{'id': r['id'], 'title': r['name'], 'status': r['status'], 'created_at': r['created_at'],
             'resolved_at': r.get('resolved_at'), 'url': r.get('shortlink', '')} for r in body['incidents']]

def update(old, responses, errors, now):
    result = json.loads(json.dumps(old or {'schema': 'ensemble_cloud_observations/1', 'provider': 'NBIS', 'adapters': {}, 'events': [], 'snapshots': []}))
    result['attempted_at'] = now
    for kind, url in URLS.items():
        previous = result['adapters'].get(kind, {})
        if kind in errors:
            result['adapters'][kind] = {**previous, 'url': url, 'health': 'error', 'attempted_at': now, 'error': errors[kind]}
            continue
        rows = responses[kind]
        old_rows = {r['id']: r for r in previous.get('rows', [])}
        initial = 'rows' not in previous
        current_ids = set()
        for r in rows:
            current_ids.add(r['id'])
            before = old_rows.get(r['id'])
            r['first_seen_at'] = before.get('first_seen_at', now) if before else now
            r['baseline_import'] = before.get('baseline_import', False) if before else initial
            if not initial and before is None:
                result['events'].append({'kind': kind, 'type': 'added', 'id': r['id'], 'at': now, 'label': r.get('title', r.get('name')), 'url': r.get('url', url)})
            elif before and kind == 'regions' and r['status'] != before['status']:
                result['events'].append({'kind': kind, 'type': 'status_changed', 'id': r['id'], 'at': now, 'label': r['name'] + ': ' + before['status'] + ' → ' + r['status'], 'url': url})
        if kind in ('jobs', 'regions') and not initial:
            for rid in old_rows.keys() - current_ids:
                r = old_rows[rid]
                result['events'].append({'kind': kind, 'type': 'removed', 'id': rid, 'at': now, 'label': r.get('title', r.get('name')), 'url': r.get('url', url)})
        result['adapters'][kind] = {'url': url, 'health': 'ok', 'attempted_at': now, 'updated_at': now, 'rows': rows, 'baseline_at': previous.get('baseline_at', now)}
    if not errors:
        jobs = result['adapters']['jobs']['rows']
        snap = {'date': now[:10], 'jobs': len(jobs), 'dc_jobs': sum(r['data_center'] for r in jobs), 'region_groups': len(result['adapters']['regions']['rows'])}
        result['snapshots'] = [s for s in result['snapshots'] if s['date'] != snap['date']][-364:] + [snap]
    result['events'] = result['events'][-1000:]
    return result

def watch_official_sources(old, registry, now, fetcher=retrieve_fingerprint):
    """Keep last-good source fingerprints and surface only genuine index changes.

    A failed issuer site is preserved as an explicit connection error. It is not
    treated as an absence of a filing and does not delete the last verified
    source connection. The workflow may therefore remain useful when a public
    IR site rate-limits an unattended request.
    """
    previous = (old or {}).get('disclosures', {}).get('providers', {})
    watched, events = {}, []
    for provider, spec in registry['providers'].items():
        url = spec['url']
        before = previous.get(provider, {})
        base = {
            'provider': provider,
            'label': spec['label'],
            'url': url,
            'kind': spec['kind'],
            'automated': True,
            'last_checked_at': now,
            'first_seen_at': before.get('first_seen_at', now),
        }
        try:
            current = fetcher(url)
            changed = bool(before.get('content_hash') and before.get('content_hash') != current['content_hash'])
            row = {**before, **base, **current, 'health': 'ok',
                   'last_good_at': now,
                   'last_changed_at': now if changed else before.get('last_changed_at', now)}
            if changed:
                events.append({'kind': 'official_disclosure', 'type': 'source_changed', 'id': provider,
                               'at': now, 'label': spec['label'], 'url': url})
        except Exception as exc:
            # Preserve actual last-good fingerprint and metadata. Do not emit a
            # false "removed" or a data observation on a fetch failure.
            row = {**before, **base, 'health': 'error',
                   'error': type(exc).__name__ + ': ' + str(exc)[:160]}
        watched[provider] = row
    return {'attempted_at': now, 'providers': watched}, events

def main():
    parser = argparse.ArgumentParser();parser.add_argument('--output', type=Path, default=ROOT / 'cloud/data/operations.json');args = parser.parse_args()
    old = json.loads(args.output.read_text()) if args.output.exists() else None
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    responses, errors = {}, {}
    for kind, url in URLS.items():
        try:
            responses[kind] = normalize(kind, retrieve(url))
            if not responses[kind]:
                raise ValueError('Empty response: keep previous baseline for review')
        except Exception as exc:
            errors[kind] = type(exc).__name__ + ': ' + str(exc)[:160]
    result = update(old, responses, errors, now)
    registry = json.loads(SOURCE_REGISTRY.read_text())
    if registry.get('schema') != 'ensemble_cloud_official_sources/1':
        raise ValueError('Unsupported official source registry schema')
    ledger = json.loads((ROOT / 'cloud/data/ledger.json').read_text())
    if set(registry.get('providers', {})) != set(ledger.get('providers', {}).keys()):
        raise ValueError('Official source registry must cover every cloud provider exactly once')
    disclosures, disclosure_events = watch_official_sources(old, registry, now)
    result['disclosures'] = disclosures
    result['events'] = (result['events'] + disclosure_events)[-1000:]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=args.output.parent, delete=False, encoding='utf-8') as file:
        json.dump(result, file, ensure_ascii=False, indent=2); file.write('\n'); name = file.name
    os.replace(name, args.output)
    print(json.dumps({'operations': {k: {'health': v['health'], 'count': len(v.get('rows', [])), 'error': v.get('error')} for k, v in result['adapters'].items()},
                      'official_disclosures': {'covered': len(disclosures['providers']),
                                               'ok': sum(v['health'] == 'ok' for v in disclosures['providers'].values()),
                                               'error': sum(v['health'] == 'error' for v in disclosures['providers'].values())}}, ensure_ascii=False))
    if errors:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
