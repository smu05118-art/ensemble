#!/usr/bin/env python3
"""Apply the shared Ensemble presentation to existing standalone documents."""
from pathlib import Path
import re
from site_navigation import menu, assets
ROOT = Path(__file__).resolve().parents[1]
CHAINS = [('pcard','프로브카드'),('rack','서버·랙'),('memory','메모리'),('optics','광통신'),('passive','수동부품'),('power','전력·냉각'),('lux','소비재')]
TITLES = {'pcard':'프로브카드','rack':'서버·랙','memory':'메모리·스토리지','optics':'광통신·인터커넥트','passive':'MLCC·수동부품','power':'전력·냉각','lux':'럭셔리·소비재'}
START, END = '<!-- ensemble-ui:start -->', '<!-- ensemble-ui:end -->'

def apply(path):
    s = path.read_text()
    home = path.name in ('index.html','ensemble_home.html') and path.parent == ROOT
    slug = path.stem
    prefix = '' if home else '../'
    if path.name == 'pcard.html' and '<!-- frame-runtime -->' in s:
        # The exported artifact bootstrap is unused by the standalone research document.
        # Preserve its actual styles, application script and JSON payload byte-for-byte.
        body = s[s.index('<title>'):s.rindex('</body>')]
        end_style = body.index('</style>') + len('</style>')
        s = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + body[:end_style] + '</head><body>' + body[end_style:] + '</body></html>'
    classes = 'ensemble-ui ' + ('ensemble-home' if home else 'ensemble-chain')
    s = re.sub(r'<html\b[^>]*>', '<html lang="ko" class="'+classes+'">', s, count=1)
    tag = '<link rel="stylesheet" href="'+prefix+'ui/ensemble.css?v=20260910-2" data-ensemble-ui="2">'
    s = re.sub(r'<link\b[^>]*data-ensemble-ui="[^"]*"[^>]*>\s*', '', s)
    s = s.replace('</head>', tag+'\n</head>', 1)
    nav = '<nav class="en-chainnav" aria-label="공급망">'+''.join('<a href="'+prefix+'chains/'+key+'.html"'+(' aria-current="page"' if not home and key==slug else '')+'>'+title+'</a>' for key,title in CHAINS)+'</nav>'
    stamp = '<span class="en-context">자료 기준 2026.09.09</span>' if home else ''
    brand = START+'<div class="en-siteframe"><div class="en-masthead"><a class="en-wordmark" href="'+('./' if home else '../')+'">ensemble</a>'+nav+stamp+menu()+'</div></div>'+END
    if START in s:
        s = re.sub(re.escape(START)+r'.*?'+re.escape(END), brand, s, count=1, flags=re.S)
    elif home:
        s = s.replace('<div class="shell">','<div class="shell">'+brand,1)
    else:
        s = s.replace('<body>','<body>'+brand,1)
    if home:
        s = s.replace('🎼 Ensemble','Ensemble').replace('🕰 사이클&맵','시장·밸류체인').replace('🎯 컴포짓 31사','기업 컴포짓').replace('📅 캘린더','발표 일정').replace('🚀 급등 탐색','모멘텀 탐색')
        s = s.replace('🕰 마이크로 마켓사이클 — AI 인프라 밸류체인','AI 인프라 · 마켓사이클').replace('🎯 컴포짓 나우캐스트 — 31사','기업 컴포짓 · 31사')
        # Supply-chain destinations are now in the masthead; retain the original elsewhere only as archive data.
        s = re.sub(r'<div class="chainbar">.*?</div>', '', s, count=1, flags=re.S)
    else:
        s = re.sub(r'<h1\b[^>]*>.*?</h1>', '<h1>'+TITLES[slug]+'</h1>', s, count=1, flags=re.S)
        s = re.sub(r'<title>[^<]*</title>', '<title>'+TITLES[slug]+' | Ensemble</title>',s,count=1)
        if slug == 'power':
            s = s.replace("dataset.theme==='dark'?'':'dark'", "dataset.theme==='dark'?'light':'dark'")
    s = assets(s, prefix)
    path.write_text(s)
    print(str(path.relative_to(ROOT))+': shared interface ready')

if __name__ == '__main__':
    for file in [ROOT/'index.html',ROOT/'ensemble_home.html',*(ROOT/'chains'/f'{key}.html' for key,_ in CHAINS)]:
        apply(file)

    cloud = ROOT / 'cloud/index.html'
    s = cloud.read_text()
    start, end = '<!-- ensemble-sites:start -->', '<!-- ensemble-sites:end -->'
    block = start + menu() + end
    if start in s:
        s = re.sub(re.escape(start)+r'.*?'+re.escape(end), block, s, count=1, flags=re.S)
    else:
        s = s.replace('</header>', block+'</header>', 1)
    cloud.write_text(assets(s, '../'))
    print('cloud/index.html: site navigation ready')
