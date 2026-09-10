#!/usr/bin/env python3
"""Static asset, provenance and export-contract validation (no browser automation)."""
import json
from pathlib import Path
import re
from urllib.parse import urlparse
ROOT = Path(__file__).resolve().parents[1]
def read(name): return json.loads((ROOT / 'cloud/data' / (name+'.json')).read_text())
ledger, research, exports, operations = map(read, ['ledger','research','exports','operations'])
assert len(ledger['providers']) == 22
assert set(research['profiles']) == {'NBIS','CRWV','IREN','APLD','CIFR','WULF'}
seen = set()
for s in ledger['signals']:
    assert (s['key'],s['revision']) not in seen
    seen.add((s['key'],s['revision']))
    assert s['provider'] in ledger['providers']
    if s['verified']:
        assert urlparse(s['source_url']).scheme == 'https'
        assert s['published_at'] <= s['observed_at']
        assert s['verified_at'] and s['first_seen_at']
for provider, profile in research['profiles'].items():
    assert profile['source'] in research['sources']
    for t in profile['tranches']:
        assert t['source'] in research['sources'] and t['mw'] >= 0
        assert t['mw_basis'] in ('reported','assumption')
        assert t['timing_basis'] in ('reported','assumption')
    for c in profile['contracts']:
        assert c['source'] in research['sources']
        if c['rate'] is not None:
            assert c['mw'] and c['years'] and c['tcv_m']
            assert abs(c['rate']-c['tcv_m']/c['years']/c['mw']) < .000001
assert len(exports['ensemble']) == 22 and len(exports['monthly_scenarios']) == 6
assert exports['observations'] and all(s['verified'] for s in exports['observations'])
assert len(operations['adapters']['regions']['rows']) < 100
for name in ('index.html','ensemble_home.html'):
    assert (ROOT / name).read_text().count('data-ensemble-cloud="v2"') == 1
for file in [ROOT/'cloud/index.html']:
    for ref in re.findall(r'(?:src|href)="([^"]+)"',file.read_text()):
        if not urlparse(ref).scheme and not ref.startswith('#'):
            assert (file.parent/ref.split('?')[0]).exists(), (file,ref)
for name in ('rack','memory','optics','power'):
    assert (ROOT/'chains'/f'{name}.html').is_file()
for required in ('app.js','cloud.css','ensemble-tab.js','model.js','signals-core.js'):
    assert (ROOT/'cloud'/required).stat().st_size > 100
assert 'data/exports.json' in (ROOT/'cloud/app.js').read_text()
print(f"Static/provenance checks passed: {len(ledger['signals'])} revisions, {len(exports['observations'])} reviewed current observations")
