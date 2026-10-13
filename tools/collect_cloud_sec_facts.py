#!/usr/bin/env python3
"""Append direct SEC XBRL quarterly revenue facts to the cloud evidence ledger.

Only duration-qualified reported facts enter.  This collector deliberately does
not derive Q4 from annual data, map a group-revenue tag to a cloud segment, or
assign a directional score.  It is safe for the daily workflow: unchanged SEC
facts leave the ledger byte-for-byte unchanged.
"""
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'cloud/data'
REGISTRY = DATA / 'source_registry.json'
LEDGER = DATA / 'ledger.json'
CONCEPTS = ('RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet')
FORMS = {'10-Q', '10-K', '6-K', '20-F'}


def fetch_json(url):
    if not re.fullmatch(r'https://data\.sec\.gov/api/xbrl/companyfacts/CIK\d{10}\.json', url):
        raise ValueError('Unexpected SEC companyfacts URL')
    request = urllib.request.Request(url, headers={
        'User-Agent': 'Ensemble public research contact@example.com',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.url != url:
            raise ValueError('Unexpected SEC companyfacts redirect')
        raw = response.read(8_000_001)
        if len(raw) > 8_000_000:
            raise ValueError('SEC companyfacts response too large')
    return json.loads(raw)


def companyfacts_url(submission_url):
    match = re.fullmatch(r'https://data\.sec\.gov/submissions/CIK(\d{10})\.json', submission_url)
    if not match:
        raise ValueError('SEC filing index must contain a zero-padded CIK')
    return 'https://data.sec.gov/api/xbrl/companyfacts/CIK' + match.group(1) + '.json'


def _quarter_label(end, fy, fp):
    if isinstance(fy, int) and fp in {'Q1', 'Q2', 'Q3'}:
        return f'FY{fy}-{fp} · 종료 {end}'
    year, month, _ = map(int, end.split('-'))
    return f'CY{year}-Q{(month - 1) // 3 + 1} · 종료 {end}'


def direct_quarters(companyfacts, currency, asof):
    """Return latest filed direct-quarter values from one compatible revenue tag."""
    facts = companyfacts.get('facts', {}).get('us-gaap', {})
    for concept in CONCEPTS:
        units = facts.get(concept, {}).get('units', {})
        rows = units.get(currency, [])
        chosen = {}
        for row in rows:
            start, end, filed, value = row.get('start'), row.get('end'), row.get('filed'), row.get('val')
            if row.get('form') not in FORMS or not all(isinstance(v, str) for v in (start, end, filed)):
                continue
            if not isinstance(value, (int, float)) or filed > asof:
                continue
            try:
                days = (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days + 1
            except ValueError:
                continue
            if not 70 <= days <= 110:
                continue
            # Same end date may appear in an amended filing. Keep the latest
            # published fact, while preserving the original period endpoints.
            key = end
            if key not in chosen or (filed, bool(row.get('frame'))) > (chosen[key]['filed'], bool(chosen[key].get('frame'))):
                chosen[key] = {**row, 'concept': concept, 'days': days}
        if chosen:
            return [chosen[k] for k in sorted(chosen)][-24:]
    return []


def direct_annuals(companyfacts, currency, asof):
    """Return reported annual values without deriving an unreported Q4."""
    facts = companyfacts.get('facts', {}).get('us-gaap', {})
    for concept in CONCEPTS:
        chosen = {}
        for row in facts.get(concept, {}).get('units', {}).get(currency, []):
            start, end, filed, value = row.get('start'), row.get('end'), row.get('filed'), row.get('val')
            if row.get('form') not in {'10-K', '20-F'} or not all(isinstance(v, str) for v in (start, end, filed)):
                continue
            if not isinstance(value, (int, float)) or filed > asof:
                continue
            try:
                days = (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days + 1
            except ValueError:
                continue
            if not 330 <= days <= 380:
                continue
            if end not in chosen or filed > chosen[end]['filed']:
                chosen[end] = {**row, 'concept': concept, 'days': days}
        if chosen:
            return [chosen[k] for k in sorted(chosen)][-12:]
    return []


def fact_row(provider, source_url, item, currency, now, previous, metric='group_revenue', annual=False):
    period = ((f'FY{item["fy"]}' if isinstance(item.get('fy'), int) else 'CY' + item['end'][:4]) + ' · 종료 ' + item['end']) if annual else _quarter_label(item['end'], item.get('fy'), item.get('fp'))
    # `fy`/`fp` identify the filing context and can recur in comparative
    # columns. The actual reported end date is the stable observation key.
    key = f'sec_companyfacts:{provider}:{metric}:{item["end"]}'
    source_fact = {
        'concept': item['concept'], 'currency': currency, 'start': item['start'], 'end': item['end'],
        'filed': item['filed'], 'form': item['form'], 'value': item['val'], 'frame': item.get('frame'),
    }
    source_hash = hashlib.sha256(json.dumps(source_fact, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    prior = [x for x in previous if x.get('key') == key]
    if prior and prior[-1].get('source_fingerprint') == source_hash:
        return None
    revision = max((int(x.get('revision', 0)) for x in prior), default=0) + 1
    unit = currency + ' M'
    return {
        'id': hashlib.sha256((key + ':' + str(revision)).encode()).hexdigest()[:20],
        'key': key,
        'revision': revision,
        'provider': provider,
        'metric': metric,
        'title': ('전사 연간 매출' if annual else '전사 분기 매출') + ' · SEC XBRL 직접 태그',
        'value': round(item['val'] / 1_000_000, 6),
        'unit': unit,
        'axis': 'demand',
        'source_url': source_url,
        'source_path': 'SEC Company Facts XBRL direct fact',
        'period': period,
        'effective_at': item['end'],
        'published_at': item['filed'],
        'observed_at': now,
        'verified_at': now,
        'first_seen_at': prior[-1].get('first_seen_at', now) if prior else now,
        'verified': True,
        'evidence': 'confirmed',
        # Group revenue is deliberately not scored as cloud-only demand.
        'direction': None,
        'rule': '',
        'scope': '전사 기준 · SEC XBRL 직접 태그 (클라우드 세그먼트와 구분)',
        'note': f"{item['concept']} · {item['form']} · {item['start']}~{item['end']} ({item['days']}일). SEC XBRL 원문값을 단위만 M으로 표시; 연간값으로 Q4를 역산하지 않음.",
        'origin': 'sec_companyfacts',
        'correlation_group': source_url,
        'source_fingerprint': source_hash,
    }


def collect(ledger, registry, now, fetch=fetch_json):
    rows = list(ledger['signals'])
    additions = []
    asof = now[:10]
    for provider, spec in registry['providers'].items():
        if spec['kind'] != 'sec_filing_index':
            continue
        facts_url = companyfacts_url(spec['url'])
        entity = fetch(facts_url)
        currency = ledger['providers'][provider]['currency']
        facts = [(item, 'group_revenue', False) for item in direct_quarters(entity, currency, asof)]
        facts += [(item, 'group_revenue_annual', True) for item in direct_annuals(entity, currency, asof)]
        for item, metric, annual in facts:
            row = fact_row(provider, facts_url, item, currency, now, rows + additions, metric, annual)
            if row:
                additions.append(row)
    if additions:
        result = {**ledger, 'signals': rows + additions, 'updated': now}
    else:
        result = ledger
    return result, additions


def write_atomic(path, data):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as out:
        json.dump(data, out, ensure_ascii=False, indent=2)
        out.write('\n')
        name = out.name
    Path(name).replace(path)


def main():
    # Evidence scoring accepts an explicit calendar date. Do not write a
    # timestamp here: a time-qualified discovery timestamp would be excluded
    # by the browser's date-only as-of guard.
    now = dt.datetime.now(dt.timezone.utc).date().isoformat()
    ledger = json.loads(LEDGER.read_text())
    registry = json.loads(REGISTRY.read_text())
    if set(registry.get('providers', {})) != set(ledger.get('providers', {})):
        raise ValueError('Registry and ledger providers differ')
    result, additions = collect(ledger, registry, now)
    if additions:
        write_atomic(LEDGER, result)
    print(json.dumps({'providers': sum(x['kind'] == 'sec_filing_index' for x in registry['providers'].values()),
                      'added_revisions': len(additions), 'ledger_changed': bool(additions)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
