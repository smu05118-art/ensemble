#!/usr/bin/env python3
"""Eurostat 단기 산업통계(STS) → data/proxies/eurostat.json (grid-composite-proxy/1).

유럽 전기장비(NACE C27)·전동기/발전기/변압기·배전제어기기(C271·C2711·C2712) 월별 지표:
  · 산업생산 sts_inpr_m (PRD, 2021=100): 달력조정(CA) → eurostat_ip_<nace>_<geo>,
    원계열(NSA) → eurostat_ipnsa_<nace>_<geo>
  · 매출(순매출액, 명목) sts_intv_m (NETTUR, 2021=100): CA → eurostat_turnover_<nace>_<geo>,
    CA 가 없는 나라만 NSA → eurostat_turnovernsa_<nace>_<geo>  (C271 이하 매출은 Eurostat 미공표)
  · 국내 생산자물가 sts_inppd_m (PRC_PRR_DOM, 2021=100, NSA) → eurostat_ppi_<nace>_<geo>
  · 비국내(수출) 생산자물가 sts_inppnd_m (PRC_PRR_NDOM, NSA) → eurostat_ppind_<nace>_<geo>
공표되지 않은(기밀 ':c' 등) 조합은 싣지 않고 errors 에 남긴다. 값 플래그(p 잠정, b 단절 등)는 notes 에 요약.

규칙: 파이썬 stdlib 만 사용, https + 정확한 호스트 허용목록, 요청별 타임아웃, 429/5xx 지수 백오프,
요청 간 간격, 원자료 응답은 data/raw/eurostat/ 에 캐시(--max-age-hours 이내면 재사용),
검증 실패 시 기존 출력 보존 + 종료코드 1, 시간 예산 초과 시 종료코드 2(재실행하면 이어서).

사용: python3 fetch_eurostat.py [--max-seconds 480] [--max-age-hours 20] [--start 2015-01] [--offline]
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'proxies' / 'eurostat.json'
RAW = ROOT / 'data' / 'raw' / 'eurostat'
FAMILY = 'eurostat'
ALLOWED_HOSTS = {'ec.europa.eu'}
API = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/'
TIMEOUT = 90
RETRIES = 5
SPACING = 1.0
UA = 'grid-composite-fetch/1 (research; stdlib urllib)'
MIN_OBS = 24

GEOS = ['EU27_2020', 'DE', 'IT', 'ES', 'FR', 'AT', 'SE', 'FI', 'PL', 'CZ', 'HR', 'PT', 'NL']
GEO_KO = {'EU27_2020': 'EU27', 'DE': '독일', 'IT': '이탈리아', 'ES': '스페인', 'FR': '프랑스', 'AT': '오스트리아',
          'SE': '스웨덴', 'FI': '핀란드', 'PL': '폴란드', 'CZ': '체코', 'HR': '크로아티아', 'PT': '포르투갈', 'NL': '네덜란드'}
NACE_KO = {'C27': '전기장비(C27)', 'C271': '전동기·발전기·변압기·배전제어기기(C271)',
           'C2711': '전동기·발전기·변압기(C2711)', 'C2712': '배전·제어기기(C2712)'}
ALL_NACE = ['C27', 'C271', 'C2711', 'C2712']

# (prefix, dataset, indic_bt, s_adj, nace 목록, geo 목록, kind, agg, lag, 한국어 지표명, fallback_of)
# fallback_of: 이 조합은 지정 prefix 시리즈가 없는 (nace, geo) 에만 싣는다.
QUERIES = [
    ('ip', 'sts_inpr_m', 'PRD', 'CA', ALL_NACE, GEOS, 'production', 'mean', 45, '산업생산(달력조정)', None),
    ('ipnsa', 'sts_inpr_m', 'PRD', 'NSA', ALL_NACE, GEOS, 'production', 'mean', 45, '산업생산(원계열)', None),
    ('turnover', 'sts_intv_m', 'NETTUR', 'CA', ALL_NACE, GEOS, 'shipments', 'mean', 60, '순매출액 지수(명목, 달력조정)', None),
    ('turnovernsa', 'sts_intv_m', 'NETTUR', 'NSA', ALL_NACE, GEOS, 'shipments', 'mean', 60, '순매출액 지수(명목, 원계열)', 'turnover'),
    ('ppi', 'sts_inppd_m', 'PRC_PRR_DOM', 'NSA', ['C271', 'C2711', 'C2712'], GEOS, 'price', 'mean', 35, '국내 생산자물가', None),
    ('ppi', 'sts_inppd_m', 'PRC_PRR_DOM', 'NSA', ['C27'], ['EU27_2020', 'DE'], 'price', 'mean', 35, '국내 생산자물가', None),
    ('ppind', 'sts_inppnd_m', 'PRC_PRR_NDOM', 'NSA', ['C271', 'C2711'], ['EU27_2020', 'DE'], 'price', 'mean', 35, '비국내(수출) 생산자물가', None),
]
FLAG_KO = {'p': '잠정', 'e': '추정', 'b': '시계열 단절', 's': 'Eurostat 추정', 'u': '신뢰도 낮음', 'd': '정의 상이', 'i': '메타 참조'}


class BudgetExceeded(Exception):
    pass


class Fetcher:
    def __init__(self, max_seconds, max_age_hours, offline):
        self.t0 = time.monotonic()
        self.max_seconds = max_seconds
        self.max_age = max_age_hours * 3600
        self.offline = offline
        self.last_req = 0.0
        self.n_net = 0

    def get(self, url, cache_path):
        if cache_path.exists():
            age = time.time() - cache_path.stat().st_mtime
            if self.offline or age < self.max_age:
                return cache_path.read_bytes()
        if self.offline:
            raise RuntimeError(f'offline 인데 캐시 없음: {cache_path.name}')
        if self.max_seconds and time.monotonic() - self.t0 > self.max_seconds:
            raise BudgetExceeded()
        u = urllib.parse.urlsplit(url)
        if u.scheme != 'https' or u.hostname not in ALLOWED_HOSTS:
            raise RuntimeError(f'허용되지 않은 URL: {url}')
        delay = 3.0
        for attempt in range(RETRIES):
            wait = SPACING - (time.monotonic() - self.last_req)
            if wait > 0:
                time.sleep(wait)
            self.last_req = time.monotonic()
            try:
                req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                    final = urllib.parse.urlsplit(r.geturl())
                    if final.scheme != 'https' or final.hostname not in ALLOWED_HOSTS:
                        raise RuntimeError(f'허용되지 않은 리다이렉트: {r.geturl()}')
                    body = r.read()
                self.n_net += 1
                json.loads(body)  # 캐시 전에 JSON 인지 확인
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                tmp = cache_path.with_suffix(cache_path.suffix + '.tmp')
                tmp.write_bytes(body)
                os.replace(tmp, cache_path)
                return body
            except urllib.error.HTTPError as e:
                if (e.code == 429 or 500 <= e.code < 600) and attempt + 1 < RETRIES:
                    time.sleep(delay)
                    delay *= 2
                    continue
                detail = e.read()[:300].decode('utf-8', 'replace') if hasattr(e, 'read') else ''
                raise RuntimeError(f'HTTP {e.code} {url} {detail}') from e
            except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
                if attempt + 1 < RETRIES:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RuntimeError(f'네트워크/응답 실패 {url}: {e}') from e
        raise RuntimeError(f'재시도 소진: {url}')


def build_url(dataset, indic, sadj, naces, geos, start):
    params = [('indic_bt', indic), ('unit', 'I21'), ('s_adj', sadj), ('sinceTimePeriod', start)]
    params += [('nace_r2', n) for n in naces] + [('geo', g) for g in geos]
    return API + dataset + '?' + urllib.parse.urlencode(params)


def decode(doc, dataset):
    """JSON-stat 2.0 → {(nace, geo): {ym: (value, flag)}} + 라벨."""
    if doc.get('class') != 'dataset' or 'value' not in doc or 'dimension' not in doc:
        raise ValueError(f'{dataset}: JSON-stat dataset 아님 {str(doc)[:200]}')
    ids, size, dims = doc['id'], doc['size'], doc['dimension']
    need = {'freq', 'indic_bt', 'nace_r2', 's_adj', 'unit', 'geo', 'time'}
    if not need <= set(ids):
        raise ValueError(f'{dataset}: 차원 누락 {ids}')
    inv = {k: {i: c for c, i in dims[k]['category']['index'].items()} for k in ids}
    for k in ('freq', 'indic_bt', 's_adj', 'unit'):
        if len(inv[k]) > 1:
            raise ValueError(f'{dataset}: {k} 가 둘 이상 {list(inv[k].values())}')
    if list(inv['freq'].values()) != ['M']:
        raise ValueError(f'{dataset}: 월별 아님')
    status = doc.get('status') or {}
    out = {}
    for s, v in doc['value'].items():
        if v is None:
            continue
        n = int(s)
        c = {}
        for k, sz in zip(reversed(ids), reversed(size)):
            c[k] = inv[k][n % sz]
            n //= sz
        t = c['time']
        if len(t) != 7 or t[4] != '-':
            raise ValueError(f'{dataset}: 시간 형식 {t}')
        if not isinstance(v, (int, float)):
            raise ValueError(f'{dataset}: 값 숫자 아님 {v}')
        out.setdefault((c['nace_r2'], c['geo']), {})[t] = (float(v), status.get(s, ''))
    labels = {
        'nace': dims['nace_r2']['category'].get('label', {}),
        'geo': dims['geo']['category'].get('label', {}),
        'unit': next(iter(dims['unit']['category'].get('label', {}).values()), 'I21'),
        'indic': next(iter(dims['indic_bt']['category'].get('label', {}).values()), ''),
        's_adj': next(iter(dims['s_adj']['category'].get('label', {}).values()), ''),
    }
    return out, labels, doc.get('updated'), doc.get('label', dataset)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-seconds', type=float, default=480)
    ap.add_argument('--max-age-hours', type=float, default=20)
    ap.add_argument('--start', default='2015-01')
    ap.add_argument('--offline', action='store_true')
    a = ap.parse_args(argv)
    f = Fetcher(a.max_seconds, a.max_age_hours, a.offline)
    today = datetime.now(timezone.utc)
    stale_before = f'{today.year - 1:04d}-{today.month:02d}'  # 최신 관측이 12개월보다 오래되면 정체로 제외
    series, errors, fatal = {}, [], []
    missing = {}
    try:
        for qi, (prefix, ds, indic, sadj, naces, geos, kind, agg, lag, name_ko, fallback_of) in enumerate(QUERIES):
            url = build_url(ds, indic, sadj, naces, geos, a.start)
            cache = RAW / f'{ds}_{indic}_{sadj}_q{qi}.json'
            try:
                body = f.get(url, cache)
                data, labels, updated, ds_label = decode(json.loads(body), ds)
            except (ValueError, RuntimeError, json.JSONDecodeError) as e:
                fatal.append(f'{ds} {indic} {sadj}: {e}')
                if isinstance(e, ValueError):  # 깨진 응답은 캐시에서 지워 다음 실행에 다시 받게 한다
                    cache.unlink(missing_ok=True)
                continue
            if not data:
                fatal.append(f'{ds} {indic} {sadj}: 값이 하나도 없음')
                continue
            for nace in naces:
                for geo in geos:
                    sid = f'eurostat_{prefix}_{nace}_{geo}'
                    if fallback_of and f'eurostat_{fallback_of}_{nace}_{geo}' in series:
                        continue
                    pts = {k: v for k, v in (data.get((nace, geo)) or {}).items() if k >= a.start}
                    if len(pts) < MIN_OBS:
                        missing.setdefault((prefix, ds, indic, sadj), {}).setdefault(nace, []).append(
                            geo if not pts else f'{geo}({len(pts)}개월)')
                        continue
                    keys = sorted(pts)
                    if keys[-1] < stale_before:
                        errors.append(f'{sid}: 최신 관측 {keys[-1]} — 12개월 넘게 갱신 없음(정체), 제외')
                        continue
                    flags = {}
                    for k in keys:
                        fl = pts[k][1]
                        if fl and not fl.startswith('|'):
                            for ch in fl:
                                flags.setdefault(ch, []).append(k)
                    gaps = []
                    y, m = int(keys[0][:4]), int(keys[0][5:])
                    while f'{y:04d}-{m:02d}' <= keys[-1]:
                        ym = f'{y:04d}-{m:02d}'
                        if ym not in pts:
                            gaps.append(ym)
                        m += 1
                        if m > 12:
                            y, m = y + 1, 1
                    notes = [f'Eurostat {ds} indic_bt={indic} s_adj={sadj} unit=I21 nace_r2={nace} geo={geo}; dataset updated {updated}']
                    for ch, ms in sorted(flags.items()):
                        notes.append(f'플래그 {ch}({FLAG_KO.get(ch, "?")}) {len(ms)}개월: {ms[0]}~{ms[-1]}')
                    if gaps:
                        notes.append(f'원문 결측 {len(gaps)}개월(키 생략): {gaps[0]}~{gaps[-1]}')
                    if fallback_of:
                        notes.append(f'{fallback_of}(CA) 미공표 국가라 원계열로 대체')
                    geo_label = labels['geo'].get(geo, geo)
                    series[sid] = {
                        'label': f'{ds_label}: {labels["indic"]} — {labels["nace"].get(nace, nace)} — {geo_label} ({labels["s_adj"]})',
                        'label_ko': f'{GEO_KO.get(geo, geo)} {NACE_KO[nace]} {name_ko}',
                        'unit': labels['unit'],
                        'seasonal_adjustment': sadj,
                        'freq': 'M',
                        'agg': agg,
                        'kind': kind,
                        'geo': geo,
                        'nace_r2': nace,
                        'release_lag_days': lag,
                        'source_url': url,
                        'notes': ' | '.join(notes),
                        'obs': {k: pts[k][0] for k in keys},
                    }
    except BudgetExceeded:
        print(f'시간 예산 {a.max_seconds}s 소진 — 다시 실행하면 캐시에서 이어서 진행', file=sys.stderr)
        return 2
    for (prefix, ds, indic, sadj), by_nace in missing.items():
        parts = []
        for nace, gl in by_nace.items():
            parts.append(f'{nace}: ' + ('전 국가' if len(gl) == len(GEOS) else ', '.join(gl)))
        errors.append(f'eurostat_{prefix}_*: {ds} {indic} {sadj} 미공표·기밀 또는 {MIN_OBS}개월 미만 → 제외 — ' + '; '.join(parts))
    if fatal:
        for e in fatal:
            print('FATAL', e, file=sys.stderr)
        print('검증 실패 — 기존 출력 보존', file=sys.stderr)
        return 1
    must = ['eurostat_ip_C271_DE', 'eurostat_ip_C271_EU27_2020', 'eurostat_ppi_C271_DE']
    missing = [m for m in must if m not in series]
    if missing:
        print(f'핵심 시리즈 누락 {missing} — 기존 출력 보존', file=sys.stderr)
        return 1
    try:
        old = json.loads(OUT.read_text(encoding='utf-8'))
        for sid in sorted(set(old.get('series', {})) - set(series)):
            errors.append(f'{sid}: 직전 출력에 있었으나 이번에 수집 안 됨')
    except (OSError, json.JSONDecodeError):
        pass
    doc = {
        'schema': 'grid-composite-proxy/1',
        'family': FAMILY,
        'fetched_at': today.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'fetch_tool': 'grid/composite/tools/fetch_eurostat.py',
        'source': {'name': 'Eurostat dissemination API (JSON-stat 2.0), short-term business statistics',
                   'url': API},
        'series': series,
        'errors': sorted(set(errors)),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    json.loads(tmp.read_text(encoding='utf-8'))
    os.replace(tmp, OUT)
    last = max(max(s['obs']) for s in series.values())
    print(f'{OUT.relative_to(ROOT)}: {len(series)} series, latest {last}, network requests {f.n_net}, errors {len(doc["errors"])}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
