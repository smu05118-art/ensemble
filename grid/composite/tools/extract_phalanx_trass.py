#!/usr/bin/env python3
"""팔랑크스 TRASS 원자료(data_tb_detail.js·data_kr_detail.js)에서 한국 변압기 수출 프록시를 뽑는다.

- 산일전기 시트: 안산시(산일전기 공장 소재지) 신고 기준 HS850421·850422 수출(지역 통계 — 회사 단독 수치 아님),
  국내 전체 HS850421·850422 수출. 단위는 천 USD 로 판정했다: 2025-07 국내→전체 HS850421 30,625 ·
  HS850422 83,697 이 UN Comtrade 한국 수출(30,624,732 · 83,827,768 USD)과 일치.
- 제룡전기 시트: 서울 광진구 신고 기준 수출(2024-12 까지만 존재 — 오래됨 표시).
- K-트래킹(data_kr_detail): 관세청 잠정 HSK 10단위 국가 수출(천원, 고정환율 1,350 환산 — YoY 에는 영향 없음),
  2024-01 부터. 잠정 최신월(partial)은 뺀다.

TRASS 배열은 값이 없는 달을 0 으로 채우므로, 첫·마지막 양수 달 밖의 0 은 결측으로 보고 버린다.
구간 안의 0 은 원자료의 0 으로 남긴다(지역×HS 단위라 실제 무수출 달이 있을 수 있다).

사용: python3 extract_phalanx_trass.py /path/to/phalanx
"""
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'proxies' / 'korea_trass.json'

TRASS = {
    # port: (series id, label, label_ko, kind)
    ('trass_TRF_산일전기', 'T260'): ('trass_sanil_ansan_8504212', 'Ansan-city exports HS850421+850422 (Sanil plant region)',
                                   '안산시 신고 수출 HS850421+850422 (산일전기 공장 소재지 · 지역 합계)', 'trade_route'),
    ('trass_TRF_산일전기', 'T261'): ('trass_sanil_ansan_850421', 'Ansan-city exports HS850421',
                                   '안산시 신고 수출 HS850421(유입식 ≤650kVA)', 'trade_route'),
    ('trass_TRF_산일전기', 'T263'): ('trass_sanil_ansan_850422', 'Ansan-city exports HS850422',
                                   '안산시 신고 수출 HS850422(유입식 650~10,000kVA)', 'trade_route'),
    ('trass_TRF_산일전기', 'T264'): ('trass_kr_8504212', 'Korea exports HS850421+850422 (TRASS)',
                                   '한국 전체 수출 HS850421+850422 (TRASS)', 'trade_total'),
    ('trass_TRF_산일전기', 'T265'): ('trass_kr_850421', 'Korea exports HS850421 (TRASS)', '한국 전체 수출 HS850421 (TRASS)', 'trade_total'),
    ('trass_TRF_산일전기', 'T266'): ('trass_kr_850422', 'Korea exports HS850422 (TRASS)', '한국 전체 수출 HS850422 (TRASS)', 'trade_total'),
    ('trass_TRF_제룡전기', 'T378'): ('trass_jeryong_gwangjin', 'Gwangjin-gu (Seoul) exports, Jeryong sheet',
                                   '서울 광진구 신고 수출 (제룡전기 시트 · 2024-12 까지)', 'trade_route'),
    ('trass_TRF_제룡전기', 'T384'): ('trass_jeryong_gwangjin_8504219020', 'Gwangjin-gu exports HSK 8504219020',
                                   '서울 광진구 신고 수출 HSK 8504219020 (2024-12 까지)', 'trade_route'),
}
KRE = {
    'kre_8504219010': ('kre_8504219010', 'Korea provisional exports HSK 8504219010 (≤100kVA)', '관세청 잠정 수출 HSK 8504219010 (소형 ≤100kVA)'),
    'kre_8504219020': ('kre_8504219020', 'Korea provisional exports HSK 8504219020 (100–650kVA)', '관세청 잠정 수출 HSK 8504219020 (100~650kVA)'),
    'kre_850423': ('kre_850423', 'Korea provisional exports HSK 850423 (>10MVA)', '관세청 잠정 수출 HSK 850423 (대형 >10MVA)'),
}


def load_js(path, var):
    text = Path(path).read_text(encoding='utf-8')
    m = re.search(re.escape(var) + r'\["(\w+)"\]=', text) if '[' not in var else re.search(re.escape(var), text)
    obj, _ = json.JSONDecoder().raw_decode(text[m.end():])
    return obj


def trimmed(months, values):
    idx = [i for i, v in enumerate(values) if v]
    if not idx:
        return {}
    lo, hi = idx[0], idx[-1]
    return {months[i]: float(values[i]) for i in range(lo, hi + 1) if values[i] is not None}


def main():
    ph = Path(sys.argv[1])
    manifest = (ph / 'manifest.js').read_text(encoding='utf-8')
    months = json.JSONDecoder().raw_decode(manifest[manifest.index('{'):])[0]['months']
    tb = load_js(ph / 'data_tb_detail.js', 'PSHD')['detail']
    kr = load_js(ph / 'data_kr_detail.js', 'PSHD')['detail']
    krmeta = load_js(ph / 'data_kr.js', 'PSH')
    series = {}
    for (sheet, port), (sid, label, label_ko, kind) in TRASS.items():
        obs = trimmed(months, tb[sheet][port]['exp']['v'])
        if not obs:
            raise SystemExit('empty series ' + sid)
        stale = max(obs) < '2025-06'
        series[sid] = {
            'label': label, 'label_ko': label_ko, 'unit': 'USD thousand', 'freq': 'M', 'agg': 'sum', 'kind': kind,
            'geo': 'KR', 'flow': 'X', 'release_lag_days': 45,
            'notes': ('TRASS 기업수출 아카이브(W-Trend) 원자료, 확정 통관 기준. 지역×HS 합계라 회사 단독 수출이 아니다.'
                      + (' 2024-12 이후 갱신 없음(오래됨).' if stale else '')),
            'obs': obs,
        }
    partial = {c['core_set']: (c.get('kre') or {}) for c in krmeta['companies'] if c.get('kre')}
    for key, (sid, label, label_ko) in KRE.items():
        port = next(iter(kr[key]))
        obs = trimmed(months, kr[key][port]['exp']['v'])
        info = partial.get(key, {})
        dropped = None
        if info.get('partial') and info.get('prov') in obs:
            dropped = info['prov']
            obs.pop(dropped)
        series[sid] = {
            'label': label, 'label_ko': label_ko, 'unit': 'KRW thousand (USD×1350 fixed)', 'freq': 'M', 'agg': 'sum',
            'kind': 'trade_total', 'geo': 'KR', 'flow': 'X', 'release_lag_days': 12,
            'notes': '관세청 잠정치(1·11·21일 집계) — 고정환율 1,350 환산이라 YoY 는 USD 기준과 같다. 2024-01 부터.'
                     + (f' 잠정 부분월 {dropped} 제외.' if dropped else ''),
            'obs': obs,
        }
    doc = {
        'schema': 'grid-composite-proxy/1',
        'family': 'korea_trass',
        'fetched_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'fetch_tool': 'grid/composite/tools/extract_phalanx_trass.py',
        'source': {'name': 'TRASS 기업수출 아카이브 · 관세청 잠정 수출 (팔랑크스 data_tb_detail.js / data_kr_detail.js)',
                   'url': 'https://smu05118-art.github.io/phalanx/'},
        'series': series,
        'errors': [],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.tmp')
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    os.replace(tmp, OUT)
    for sid, s in series.items():
        print(sid, len(s['obs']), min(s['obs']), max(s['obs']))


if __name__ == '__main__':
    main()
