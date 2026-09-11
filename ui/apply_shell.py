#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""apply_shell.py — 앙상블 공용 UI 셸(마스트헤드·브랜드 CSS·sites.js)을 체인 페이지에 주입.

체인 페이지는 각자의 결정론 빌더가 생성한다. 셸은 그 산출을 후처리로 감싸는 단계라,
빌더를 다시 돌릴 때마다 이 스크립트를 이어서 실행해야 사이트 UI가 유지된다.
멱등: 이미 주입된 페이지(ensemble-ui:start 존재)는 건드리지 않는다.

셸 원본은 --donor 로 준 페이지에서 그대로 떠 온다(사본 하드코딩 금지).
사용: python3 ui/apply_shell.py chains/lux.html --donor chains/power.html --title '럭셔리·소비재' [--h1 '럭셔리·소비재']
"""
import argparse
import re
import sys

MARK = '<!-- ensemble-ui:start -->'


def extract_shell(donor_html):
    i = donor_html.find(MARK)
    j = donor_html.find('<!-- ensemble-ui:end -->')
    if i < 0 or j < 0:
        sys.exit('donor 에 셸 마커가 없다: ' + MARK)
    block = donor_html[i:j + len('<!-- ensemble-ui:end -->')]
    links = re.findall(r'<link rel="[^"]*"[^>]*data-ensemble-[^>]*>', donor_html)
    script = re.search(r'<script src="\.\./ui/sites\.js[^>]*></script>', donor_html)
    if not links or not script:
        sys.exit('donor 에서 링크·스크립트를 찾지 못했다')
    return block, links, script.group(0)


def apply(html, block, links, script, title, h1):
    if MARK in html:
        return html, False
    html = html.replace('<html lang="ko">', '<html lang="ko" class="ensemble-ui ensemble-chain">', 1)
    html = re.sub(r'<title>.*?</title>', '<title>%s | Ensemble</title>' % title, html, count=1, flags=re.S)
    html = html.replace('</head>', '\n'.join(links) + '\n</head>', 1)
    html = html.replace('<body>', '<body>' + block, 1)
    if h1:
        html = re.sub(r'<h1>.*?</h1>', '<h1>%s</h1>' % h1, html, count=1, flags=re.S)
    # 테마 토글: 셸이 light/dark 를 명시적으로 쓴다(빈 문자열이면 시스템 테마로 되돌아간다)
    html = html.replace("dataset.theme==='dark'?'':'dark'", "dataset.theme==='dark'?'light':'dark'")
    html = html.replace('</body>', script + '\n</body>', 1)
    return html, True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('target')
    ap.add_argument('--donor', required=True)
    ap.add_argument('--title', required=True)
    ap.add_argument('--h1', default=None)
    a = ap.parse_args()
    donor = open(a.donor, encoding='utf-8').read()
    block, links, script = extract_shell(donor)
    html = open(a.target, encoding='utf-8').read()
    out, changed = apply(html, block, links, script, a.title, a.h1)
    if not changed:
        print('이미 주입됨 — 변경 없음: ' + a.target)
        return
    open(a.target, 'w', encoding='utf-8').write(out)
    print('셸 주입 %s (%d바이트)' % (a.target, len(out)))


if __name__ == '__main__':
    main()
