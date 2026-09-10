"""Verified destinations shared by every Ensemble entry point."""
from html import escape
import re

SITES = [
    ('앙상블', 'https://smu05118-art.github.io/ensemble/', '기업·공급망 리서치'),
    ('팔랑크스', 'https://smu05118-art.github.io/phalanx/', '무역·산업 데이터'),
    ('파놉티스', 'https://smu05118-art.github.io/phalanx/panoptes/', '국제분쟁 지도'),
    ('아르고스', 'https://smu05118-art.github.io/phalanx/argus/', '시클리컬 사이클 관제'),
]

def menu():
    links = ''.join('<a href="'+escape(url,quote=True)+'"'+(' aria-current="location"' if i==0 else '')+'><span>'+escape(name)+'</span><small>'+escape(description)+'</small></a>' for i,(name,url,description) in enumerate(SITES))
    return '<details class="en-sites"><summary>사이트 이동</summary><nav class="en-sites-menu" aria-label="리서치 사이트">'+links+'</nav></details>'

def assets(text, prefix):
    css = '<link rel="stylesheet" href="'+prefix+'ui/sites.css?v=1" data-ensemble-sites="1">'
    js = '<script src="'+prefix+'ui/sites.js?v=1" data-ensemble-sites="1"></script>'
    text = re.sub(r'<link\b[^>]*data-ensemble-sites="[^"]*"[^>]*>\s*', '', text)
    text = re.sub(r'<script\b[^>]*data-ensemble-sites="[^"]*"[^>]*></script>\s*', '', text)
    return text.replace('</head>',css+'\n</head>',1).replace('</body>',js+'\n</body>',1)
