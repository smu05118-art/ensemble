#!/usr/bin/env python3
"""원/달러 월평균 환율(FRED EXKOUS)을 받아 data/proxies/fx.json 에 쓴다.

모델 입력이 아니라 진단용이다 — 산일전기 수출 매출(원)과 안산시 수출(천 USD)의 비율이
실제 환율과 비슷하면 안산시 수출이 산일전기 수출을 거의 대표한다는 근거가 된다(통화 환산 아님).
stdlib 만 사용, https·호스트 고정, 실패 시 기존 파일 보존.
"""
import csv
import datetime as dt
import io
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'data' / 'proxies' / 'fx.json'
URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=EXKOUS'


def main():
    req = urllib.request.Request(URL, headers={'User-Agent': 'grid-composite-fetch/1 (research)'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status != 200 or urllib.parse.urlparse(resp.geturl()).hostname != 'fred.stlouisfed.org':
            raise SystemExit('unexpected response')
        text = resp.read(2_000_000).decode('utf-8')
    rows = list(csv.reader(io.StringIO(text)))
    if not rows or rows[0][1].upper() != 'EXKOUS':
        raise SystemExit('unexpected header ' + repr(rows[:1]))
    obs = {}
    for date, val in rows[1:]:
        if date >= '2015-01-01' and val not in ('', '.'):
            obs[date[:7]] = float(val)
    if len(obs) < 100:
        raise SystemExit('too few observations')
    doc = {
        'schema': 'grid-composite-proxy/1', 'family': 'fx',
        'fetched_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'fetch_tool': 'grid/composite/tools/fetch_fx.py',
        'source': {'name': 'FRED EXKOUS (Board of Governors H.10, 월평균)', 'url': URL},
        'series': {'fx_krw_per_usd': {
            'label': 'South Korean won per US dollar, monthly average', 'label_ko': '원/달러 월평균 환율(H.10)',
            'unit': 'KRW per USD', 'freq': 'M', 'agg': 'mean', 'kind': 'price', 'release_lag_days': 3,
            'notes': '진단 전용 — 앙상블 후보 아님', 'obs': obs}},
        'errors': [],
    }
    tmp = OUT.with_suffix('.tmp')
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    os.replace(tmp, OUT)
    print('fx', len(obs), min(obs), max(obs))


if __name__ == '__main__':
    sys.exit(main())
