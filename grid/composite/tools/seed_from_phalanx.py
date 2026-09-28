#!/usr/bin/env python3
"""팔랑크스 composite_preview.html 의 공식 실적 원장(official_financials)을 실적 계약 파일로 옮긴다.

팔랑크스 컴포짓에 이미 원문 근거와 함께 수집된 회사(HPSA·ETN·POWL·FPS)만 대상이다.
값은 바꾸지 않고, 각 분기의 원문 URL 을 그대로 source_url 로 옮긴다.

사용: python3 seed_from_phalanx.py /path/to/phalanx/composite_preview.html
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'actuals'
SEED = {
    'HPSA': ('GRID_HAMMOND_POWER', 'Hammond Power Solutions Inc.', 'HPS.A CN'),
    'ETN': ('GRID_EATON', 'Eaton Corporation plc', 'ETN US'),
    'POWL': ('GRID_POWELL', 'Powell Industries, Inc.', 'POWL US'),
    'FPS': (None, 'Forgent Power Solutions, Inc.', 'FPS US'),
}


def extract_data(html_path):
    text = Path(html_path).read_text(encoding='utf-8')
    start = text.index('\nconst DATA=') + len('\nconst DATA=')
    obj, _ = json.JSONDecoder().raw_decode(text[start:].lstrip())
    return obj


def convert(company, grid_node, name, ticker):
    fin = company['official_financials']
    points = []
    for row in fin['history']:
        if row.get('revenue') is None:
            continue
        src = (row.get('sources') or [{}])[0]
        points.append({
            'fiscal_key': row['fiscal_key'],
            'period_start': row.get('period_start'),
            'period_end': row.get('period_end'),
            'value': row['revenue'],
            'method': {'annual_minus_nine_months': 'annual_minus_9m', 'derived_annual_minus_nine_months': 'annual_minus_9m'}.get(row.get('amount_method'), row.get('amount_method') or 'reported'),
            'source_url': src.get('url'),
            'locator': 'phalanx composite_preview official_financials · ' + str(src.get('source_id')),
            'published_date': src.get('publication_date') or src.get('document_date'),
        })
    ctx = company.get('grid_context') or {}
    breaks = []
    for b in ctx.get('structural_breaks') or []:
        breaks.append({'date': b.get('date'), 'type': b.get('type'),
                       'note': b.get('observed_scope') or b.get('entity') or '', 'source_url': None})
    return {
        'schema': 'grid-composite-actuals/1',
        'id': company['id'],
        'grid_node': grid_node,
        'name': name,
        'ticker': ticker,
        'listed': True,
        'currency': fin['currency'],
        'unit': fin['unit'],
        'accounting_basis': fin.get('accounting_basis'),
        'quarter_calendar': (ctx.get('fiscal_calendar') or {}).get('basis') if isinstance(ctx.get('fiscal_calendar'), dict) else None,
        'collected_at': company.get('evidence_asof'),
        'targets': {'revenue_total': {'label_ko': '연결 매출', 'scope': 'consolidated', 'freq': 'Q',
                                      'primary': True, 'points': points}},
        'primary_target': 'revenue_total',
        'structural_breaks': breaks,
        'profile': {'products': (ctx.get('description') or {}).get('text'), 'plants': [], 'end_markets': None,
                    'export_routes': [], 'hs_candidates': [], 'proxy_routes': []},
        'gaps': [],
        'collection_notes': ['seed: phalanx composite_preview.html DATA.companies[].official_financials '
                             '(asof ' + str(company.get('evidence_asof')) + '); 원문 URL 보존, 값 무변경'],
    }


def main():
    data = extract_data(sys.argv[1])
    by_id = {c['id']: c for c in data['companies']}
    OUT.mkdir(parents=True, exist_ok=True)
    for cid, (node, name, ticker) in SEED.items():
        doc = convert(by_id[cid], node, name, ticker)
        path = OUT / (cid + '.json')
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
        os.replace(tmp, path)
        print(cid, len(doc['targets']['revenue_total']['points']), 'quarters ->', path.relative_to(ROOT))


if __name__ == '__main__':
    main()
