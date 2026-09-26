#!/usr/bin/env python3
"""out/composite.json 을 page_template.html 에 넣어 grid/composite.html 을 만든다.

사이트 공통 머리(워드마크·체인 내비·사이트 메뉴)와 스타일은 tools/apply_ensemble_ui.py 와 같은 규칙으로 붙인다.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
COMP = HERE.parent
REPO = COMP.parents[1]
sys.path.insert(0, str(REPO / 'tools'))
from apply_ensemble_ui import CHAINS, START, END, wordmark, brand_assets  # noqa: E402
from site_navigation import menu, assets  # noqa: E402

OUT = REPO / 'grid' / 'composite.html'


def slim(data):
    """화면이 쓰지 않는 필드를 뺀다(전체는 out/composite.json 에 남는다)."""
    keep_yoy = {'trass_sanil_ansan_8504212_post'}
    data['proxy_yoy'] = {k: v for k, v in (data.get('proxy_yoy') or {}).items() if k in keep_yoy}
    for p in data.get('peers') or []:
        p.pop('other_targets', None)
        for c in p.get('candidates') or []:
            for k in ('label_ko', 'family', 'kind', 'first', 'last'):
                c.pop(k, None)
            for row in c.get('ccf') or []:
                row.pop('p', None)
        mo = p.get('monthly') or {}
        for x in mo.get('proxies') or []:
            x.pop('label_ko', None)
    return data


def main():
    data = slim(json.loads((COMP / 'out' / 'composite.json').read_text(encoding='utf-8')))
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    payload = payload.replace('</', '<\\/').replace('<!--', '<\\!--')
    html = (HERE / 'page_template.html').read_text(encoding='utf-8')
    html = html.replace('__DATA__', payload, 1)
    prefix = '../'
    nav = '<nav class="en-chainnav" aria-label="공급망">' + ''.join(
        '<a href="' + prefix + 'chains/' + key + '.html"' + (' aria-current="page"' if key == 'grid' else '') + '>' + title + '</a>'
        for key, title in CHAINS) + '</nav>'
    brand = START + '<div class="en-siteframe"><div class="en-masthead">' + wordmark(prefix) + nav + menu() + '</div></div>' + END
    html = html.replace(START + END, brand, 1)
    html = html.replace('</head>', '<link rel="stylesheet" href="' + prefix + 'ui/ensemble.css?v=20260910-3" data-ensemble-ui="3">\n</head>', 1)
    html = assets(brand_assets(html, prefix), prefix)
    tmp = OUT.with_suffix('.tmp')
    tmp.write_text(html, encoding='utf-8')
    os.replace(tmp, OUT)
    print(OUT.relative_to(REPO), len(html), 'bytes')


if __name__ == '__main__':
    main()
