#!/usr/bin/env python3
"""Public operating observations. First fetch establishes a baseline, not new signals."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
URLS = {
    'jobs': 'https://boards-api.greenhouse.io/v1/boards/nebius/jobs',
    'regions': 'https://status.nebius.com/api/v2/components.json',
    'incidents': 'https://status.nebius.com/api/v2/incidents.json',
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
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=args.output.parent, delete=False, encoding='utf-8') as file:
        json.dump(result, file, ensure_ascii=False, indent=2); file.write('\n'); name = file.name
    os.replace(name, args.output)
    print(json.dumps({k: {'health': v['health'], 'count': len(v.get('rows', [])), 'error': v.get('error')} for k, v in result['adapters'].items()}, ensure_ascii=False))
    if errors:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
