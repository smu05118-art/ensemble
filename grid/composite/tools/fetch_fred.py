#!/usr/bin/env python3
"""FRED(세인트루이스 연은) 월별 매크로 프록시 → data/proxies/fred_us.json (grid-composite-proxy/1).

미국 전기장비·변압기 수요/공급 사이클을 보는 공개 시계열(키 불필요 CSV 엔드포인트):
  · 산업생산(연준 G.17): 전기장비 3353·335·가전 제외 전기장비·전선·송배전 유틸리티
  · 생산자물가(BLS PPI): 변압기(335311)·전력/배전 변압기 품목(WPU117409)·개폐기·배전반
  · 제조업 수주/출하/수주잔/재고(Census M3): 35S(전기장비·가전·부품), 35C(전기장비 3353)
  · 건설투자(Census C30): 전력(총·민간·공공)·제조업·민간 오피스(데이터센터 포함)
계절조정(SA)·원계열(NSA)이 모두 있으면 둘 다 싣는다(엔진은 로그 YoY 사용).

규칙: 파이썬 stdlib 만 사용, https + 정확한 호스트 허용목록, 요청별 타임아웃, 429/5xx 지수 백오프,
요청 간 간격, 원자료는 data/raw/fred/ 에 캐시(재실행 시 --max-age-hours 이내면 재사용),
검증 실패 시 기존 출력 보존 + 종료코드 1 (fail-closed), 시간 예산 초과 시 종료코드 2(재실행하면 이어서).

사용: python3 fetch_fred.py [--max-seconds 480] [--max-age-hours 20] [--start 2015-01] [--offline]
"""
import argparse
import csv
import html
import http.client
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'proxies' / 'fred_us.json'
RAW = ROOT / 'data' / 'raw' / 'fred'
FAMILY = 'fred_us'
ALLOWED_HOSTS = {'fred.stlouisfed.org'}
CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id={id}'
PAGE_URL = 'https://fred.stlouisfed.org/series/{id}'
TIMEOUT = 45
RETRIES = 5
SPACING = 0.6  # 초, 요청 간 최소 간격
UA = 'grid-composite-fetch/1 (research; stdlib urllib)'

# (id, label_ko, kind, agg, release_lag_days, 비고)
# kind 는 계약 열거값만 사용: production | shipments | orders | price | construction
IP_LAG, PPI_LAG, M3ADV_LAG, M3FULL_LAG, C30_LAG = 16, 14, 26, 35, 32
SERIES = [
    # ── 산업생산(연준 G.17), Index 2017=100 ──
    ('IPG3353S', '미국 산업생산: 전기장비(NAICS 3353, 변압기·개폐기·모터) · 계절조정', 'production', 'mean', IP_LAG, 'G.17 에 3353 하위(335311 변압기) 지수는 없음 — 가장 좁은 IP'),
    ('IPG3353N', '미국 산업생산: 전기장비(NAICS 3353) · 원계열', 'production', 'mean', IP_LAG, ''),
    ('IPG335S', '미국 산업생산: 전기장비·가전·부품(NAICS 335) · 계절조정', 'production', 'mean', IP_LAG, ''),
    ('IPG335N', '미국 산업생산: 전기장비·가전·부품(NAICS 335) · 원계열', 'production', 'mean', IP_LAG, ''),
    ('IPG335A2S', '미국 산업생산: 가전 제외 전기장비(NAICS 3351·3353·3359) · 계절조정', 'production', 'mean', IP_LAG, ''),
    ('IPG335A2N', '미국 산업생산: 가전 제외 전기장비(NAICS 3351·3353·3359) · 원계열', 'production', 'mean', IP_LAG, ''),
    ('IPG33593T9S', '미국 산업생산: 기타 전기장비(NAICS 33593-9, 배선기구 등) · 계절조정', 'production', 'mean', IP_LAG, 'Hubbell 배선기구 노출'),
    ('IPG33593T9N', '미국 산업생산: 기타 전기장비(NAICS 33593-9) · 원계열', 'production', 'mean', IP_LAG, ''),
    ('IPN33592S', '미국 산업생산: 통신·전력 전선·케이블(NAICS 33592) · 계절조정', 'production', 'mean', IP_LAG, ''),
    ('IPN33592N', '미국 산업생산: 통신·전력 전선·케이블(NAICS 33592) · 원계열', 'production', 'mean', IP_LAG, ''),
    ('IPG2211S', '미국 산업생산: 전력 발전·송전·배전 유틸리티(NAICS 2211) · 계절조정', 'production', 'mean', IP_LAG, '전력 수요(부하) 측 지표'),
    ('IPG2211N', '미국 산업생산: 전력 발전·송전·배전 유틸리티(NAICS 2211) · 원계열', 'production', 'mean', IP_LAG, ''),
    ('IPG22112S', '미국 산업생산: 송전·제어·배전(NAICS 22112) · 계절조정', 'production', 'mean', IP_LAG, ''),
    ('IPG22112N', '미국 산업생산: 송전·제어·배전(NAICS 22112) · 원계열', 'production', 'mean', IP_LAG, ''),
    ('CAPUTLG335S', '미국 가동률: 전기장비·가전·부품(NAICS 335) · 계절조정', 'production', 'mean', IP_LAG, '3353 가동률(CAPUTLG3353S)은 FRED 에 없음 → 335 로 대체'),
    # ── 생산자물가(BLS PPI), 원계열 ──
    ('WPU117409', '미국 PPI 품목: 전력·배전 변압기(부품 제외)', 'price', 'mean', PPI_LAG, '가장 좁은 변압기 가격 지수(산업 PCU3353113353111 은 2023-02 종료 → 품목 지수 사용)'),
    ('PCU335311335311', '미국 PPI 산업: 전력·특수 변압기 제조업(NAICS 335311)', 'price', 'mean', PPI_LAG, ''),
    ('PCU335311335311P', '미국 PPI 산업: 전력·특수 변압기 제조업 · 1차 제품', 'price', 'mean', PPI_LAG, ''),
    ('WPU1174', '미국 PPI 품목: 변압기·전력 조정기', 'price', 'mean', PPI_LAG, ''),
    ('WPU117', '미국 PPI 품목: 전기 기계·장비', 'price', 'mean', PPI_LAG, ''),
    ('PCU335313335313', '미국 PPI 산업: 개폐기·배전반 기기 제조업(NAICS 335313)', 'price', 'mean', PPI_LAG, ''),
    ('PCU335313335313A', '미국 PPI 산업: 개폐기(덕트·릴레이 제외)', 'price', 'mean', PPI_LAG, ''),
    ('WPU117522', '미국 PPI 품목: 개폐기·배전반 기기', 'price', 'mean', PPI_LAG, ''),
    ('PCU3353133353133', '미국 PPI 산업: 저압(1,000V 이하) 패널보드·분전반', 'price', 'mean', PPI_LAG, ''),
    ('WPU1175', '미국 PPI 품목: 개폐기·배전반·산업제어 장비', 'price', 'mean', PPI_LAG, ''),
    ('PCU3353133531', '미국 PPI 산업: 전기장비 제조업(NAICS 33531)', 'price', 'mean', PPI_LAG, 'PCU33533353(NAICS 3353)과 값이 동일 — 하나만 수록'),
    ('PCU335335', '미국 PPI 산업: 전기장비·가전·부품 제조업(NAICS 335)', 'price', 'mean', PPI_LAG, ''),
    # ── 제조업 수주·출하·수주잔·재고(Census M3), Millions of Dollars ──
    ('A35SNO', '미국 제조업 신규수주: 전기장비·가전·부품(M3 35S) · 계절조정', 'orders', 'sum', M3ADV_LAG, '내구재 속보(advance)에 포함'),
    ('U35SNO', '미국 제조업 신규수주: 전기장비·가전·부품(M3 35S) · 원계열', 'orders', 'sum', M3ADV_LAG, ''),
    ('A35SVS', '미국 제조업 출하: 전기장비·가전·부품(M3 35S) · 계절조정', 'shipments', 'sum', M3ADV_LAG, ''),
    ('U35SVS', '미국 제조업 출하: 전기장비·가전·부품(M3 35S) · 원계열', 'shipments', 'sum', M3ADV_LAG, ''),
    ('A35SUO', '미국 제조업 수주잔고: 전기장비·가전·부품(M3 35S) · 계절조정', 'orders', 'last', M3ADV_LAG, '월말 잔량'),
    ('U35SUO', '미국 제조업 수주잔고: 전기장비·가전·부품(M3 35S) · 원계열', 'orders', 'last', M3ADV_LAG, '월말 잔량'),
    ('A35STI', '미국 제조업 재고: 전기장비·가전·부품(M3 35S) · 계절조정', 'production', 'last', M3ADV_LAG, '월말 재고(계약 kind 열거에 inventory 없음 → production)'),
    ('U35STI', '미국 제조업 재고: 전기장비·가전·부품(M3 35S) · 원계열', 'production', 'last', M3ADV_LAG, '월말 재고(kind=production)'),
    ('A35CNO', '미국 제조업 신규수주: 전기장비(M3 35C = NAICS 3353) · 계절조정', 'orders', 'sum', M3FULL_LAG, 'M3 확정(full) 보고서에만 — 속보보다 약 1주 늦음'),
    ('U35CNO', '미국 제조업 신규수주: 전기장비(M3 35C = NAICS 3353) · 원계열', 'orders', 'sum', M3FULL_LAG, ''),
    ('A35CVS', '미국 제조업 출하: 전기장비(M3 35C = NAICS 3353) · 계절조정', 'shipments', 'sum', M3FULL_LAG, ''),
    ('U35CVS', '미국 제조업 출하: 전기장비(M3 35C = NAICS 3353) · 원계열', 'shipments', 'sum', M3FULL_LAG, ''),
    ('A35CUO', '미국 제조업 수주잔고: 전기장비(M3 35C = NAICS 3353) · 계절조정', 'orders', 'last', M3FULL_LAG, '월말 잔량'),
    ('U35CUO', '미국 제조업 수주잔고: 전기장비(M3 35C = NAICS 3353) · 원계열', 'orders', 'last', M3FULL_LAG, '월말 잔량'),
    ('A35CTI', '미국 제조업 재고: 전기장비(M3 35C = NAICS 3353) · 계절조정', 'production', 'last', M3FULL_LAG, '월말 재고(kind=production)'),
    ('U35CTI', '미국 제조업 재고: 전기장비(M3 35C = NAICS 3353) · 원계열', 'production', 'last', M3FULL_LAG, '월말 재고(kind=production)'),
    # ── 건설투자(Census C30), Millions of Dollars ──
    ('TLPWRCONS', '미국 건설투자: 전력(총) · 계절조정 연율', 'construction', 'mean', C30_LAG, 'SAAR — 분기 평균 = 분기 연율'),
    ('TLPWRCON', '미국 건설투자: 전력(총) · 원계열 월액', 'construction', 'sum', C30_LAG, ''),
    ('PRPWRCONS', '미국 건설투자: 민간 전력 · 계절조정 연율', 'construction', 'mean', C30_LAG, 'SAAR'),
    ('PRPWRCON', '미국 건설투자: 민간 전력 · 원계열 월액', 'construction', 'sum', C30_LAG, ''),
    ('PBPWRCONS', '미국 건설투자: 공공 전력 · 계절조정 연율', 'construction', 'mean', C30_LAG, 'SAAR'),
    ('PBPWRCON', '미국 건설투자: 공공 전력 · 원계열 월액', 'construction', 'sum', C30_LAG, ''),
    ('TLMFGCONS', '미국 건설투자: 제조업(총) · 계절조정 연율', 'construction', 'mean', C30_LAG, 'SAAR'),
    ('TLMFGCON', '미국 건설투자: 제조업(총) · 원계열 월액', 'construction', 'sum', C30_LAG, ''),
    ('PROFCONS', '미국 건설투자: 민간 오피스(데이터센터 포함) · 계절조정 연율', 'construction', 'mean', C30_LAG, 'SAAR. Census C30 분류상 데이터센터는 Office 하위 — FRED 에 데이터센터 단독 시계열 없음'),
    ('PROFCON', '미국 건설투자: 민간 오피스(데이터센터 포함) · 원계열 월액', 'construction', 'sum', C30_LAG, 'Census C30 분류상 데이터센터는 Office 하위'),
]

# 요청했으나 FRED 에 없거나(404) 종료·정체된 후보 — 사실 그대로 errors 에 남긴다(2026-09-25 확인).
KNOWN_UNAVAILABLE = [
    'IPG33531S/IPG33531N/IPN3353/IPG335311S: FRED 404 — 연준 G.17 은 3353 보다 세분된 전기장비(변압기) 산업생산을 공표하지 않음',
    'CAPUTLG3353S/CAPUTLG3353N/CAPG3353S: FRED 404 — 3353 가동률 없음(335 가동률 CAPUTLG335S 로 대체)',
    'CAPUTLG335N: FRED 404 — 가동률 원계열 없음',
    'WPU117404/WPU11740/WPU117401/WPU117403/WPU117405/WPU117406/WPU11741/WPU117410: FRED 404 — 변압기 품목 PPI 정식 ID 는 WPU117409',
    'PCU33531335313: FRED 404 — 개폐기 PPI 정식 ID 는 PCU335313335313',
    'PCU3353113353111(산업 PPI 전력·배전 변압기): 2023-02 이후 갱신 없음 → 제외, 동일 품목 WPU117409 사용',
    'PCU335311335311G/WPU11741101(범용 변압기)·WPU117402: 2015-05 종료 → 제외',
    'IP8504(수입물가 HS8504 변압기·컨버터): 2021-12 종료 → 제외',
    'CES3133530001/CEU3133530001(전기장비 3353 고용): FRED 404',
    '데이터센터 건설투자: FRED 에는 C30 대분류(PROFCONS 등)만 있고 데이터센터 단독 시계열 없음 → 민간 오피스(PROFCONS/PROFCON)로 대체. '
    '단, Census C30 원표(https://www.census.gov/construction/c30/xlsx/privsatime.xlsx)에는 민간 Office 하위 "Data center"(SAAR)와 '
    'Power 하위 "Electric"(SAAR) 세부 열이 있음 — FRED 패밀리 범위 밖이라 이 파일에는 미수록(2026-09-25 확인)',
    'A35ENO/A35DNO: FRED 404(M3 35 하위 E·D 범주 없음/배터리는 출하만)',
]

SOURCES = {
    'IP': 'Board of Governors of the Federal Reserve System (G.17 Industrial Production and Capacity Utilization)',
    'CAP': 'Board of Governors of the Federal Reserve System (G.17 Industrial Production and Capacity Utilization)',
    'PC': 'U.S. Bureau of Labor Statistics (Producer Price Index)',
    'WP': 'U.S. Bureau of Labor Statistics (Producer Price Index)',
    'A3': 'U.S. Census Bureau (M3 Manufacturers\' Shipments, Inventories, and Orders)',
    'U3': 'U.S. Census Bureau (M3 Manufacturers\' Shipments, Inventories, and Orders)',
}


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

    def check_budget(self):
        if self.max_seconds and time.monotonic() - self.t0 > self.max_seconds:
            raise BudgetExceeded()

    def get(self, url, cache_path):
        """캐시가 신선하면 캐시, 아니면 네트워크. (bytes, from_cache)"""
        if cache_path.exists():
            age = time.time() - cache_path.stat().st_mtime
            if self.offline or age < self.max_age:
                return cache_path.read_bytes(), True
        if self.offline:
            raise RuntimeError(f'offline 인데 캐시 없음: {cache_path.name}')
        self.check_budget()
        u = urllib.parse.urlsplit(url)
        if u.scheme != 'https' or u.hostname not in ALLOWED_HOSTS:
            raise RuntimeError(f'허용되지 않은 URL: {url}')
        delay = 2.0
        for attempt in range(RETRIES):
            wait = SPACING - (time.monotonic() - self.last_req)
            if wait > 0:
                time.sleep(wait)
            self.last_req = time.monotonic()
            try:
                req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'identity'})
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                    final = urllib.parse.urlsplit(r.geturl())
                    if final.scheme != 'https' or final.hostname not in ALLOWED_HOSTS:
                        raise RuntimeError(f'허용되지 않은 리다이렉트: {r.geturl()}')
                    body = r.read()
                self.n_net += 1
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                tmp = cache_path.with_suffix(cache_path.suffix + '.tmp')
                tmp.write_bytes(body)
                os.replace(tmp, cache_path)
                return body, False
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    raise FileNotFoundError(url) from e
                if e.code in (429,) or 500 <= e.code < 600:
                    if attempt + 1 < RETRIES:
                        time.sleep(delay)
                        delay *= 2
                        continue
                raise
            except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as e:
                if attempt + 1 < RETRIES:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RuntimeError(f'네트워크 실패 {url}: {e}') from e
        raise RuntimeError(f'재시도 소진: {url}')


def parse_csv(sid, body):
    text = body.decode('utf-8-sig')
    rows = list(csv.reader(io.StringIO(text)))
    if not rows or len(rows[0]) != 2 or rows[0][1] != sid or rows[0][0] not in ('observation_date', 'DATE'):
        raise ValueError(f'{sid}: CSV 헤더 불일치 {rows[:1]}')
    obs = {}
    for r in rows[1:]:
        if not r:
            continue
        d, v = r
        if not re.match(r'^\d{4}-\d{2}-01$', d):
            raise ValueError(f'{sid}: 날짜 형식 {d}')
        if v in ('.', ''):
            continue  # FRED 결측 표기 — 키를 뺀다
        obs[d[:7]] = float(v)
    return obs


def parse_meta(sid, body):
    t = body.decode('utf-8', 'replace')

    def grab(pat):
        m = re.search(pat, t, re.S)
        return html.unescape(re.sub(r'\s+', ' ', m.group(1))).strip() if m else None

    title = grab(r'<title>(.*?)\s*\(' + re.escape(sid) + r'\)\s*\|\s*FRED')
    units = grab(r'<strong>Units:</strong>&nbsp;\s*<span class="series-meta-value"><span class="series-meta-value-units">(.*?)</span>')
    sa = grab(r'<strong>Units:</strong>&nbsp;\s*<span class="series-meta-value"><span class="series-meta-value-units">.*?</span>,&nbsp;(.*?)</span>')
    freq = grab(r'<strong>Frequency:</strong>.*?series-meta-value-frequency">(.*?)</span>')
    source = grab(r'<strong>Source:</strong>\s*<a[^>]*>(.*?)<')
    release = grab(r'<strong>Release:</strong>\s*<a[^>]*>(.*?)<')
    updated = grab(r'series-meta-updated-date[^"]*">(.*?)</span>')
    if not (title and units and sa and freq):
        raise ValueError(f'{sid}: 시리즈 페이지 메타 파싱 실패 title={title!r} units={units!r} sa={sa!r} freq={freq!r}')
    return {'title': title, 'units': units, 'seasonal_adjustment': sa, 'frequency': freq,
            'source': source, 'release': release, 'updated': updated}


def load_meta(f, sid):
    """시리즈 페이지에서 제목·단위·계절조정·빈도를 읽는다. 페이지 HTML(~130KB)은 버리고 메타 JSON 만 캐시."""
    mcache = RAW / f'{sid}.meta.json'
    if mcache.exists() and (f.offline or time.time() - mcache.stat().st_mtime < f.max_age):
        return json.loads(mcache.read_text(encoding='utf-8'))
    pcache = RAW / f'{sid}.page.html'
    body, _ = f.get(PAGE_URL.format(id=sid), pcache)
    meta = parse_meta(sid, body)
    tmp = mcache.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=1, sort_keys=True), encoding='utf-8')
    os.replace(tmp, mcache)
    pcache.unlink(missing_ok=True)
    return meta


def month_range(a, b):
    out, m = [], a
    while m <= b:
        out.append(m)
        m = month_add(m, 1)
    return out


def month_add(ym, k):
    y, m = int(ym[:4]), int(ym[5:])
    n = y * 12 + (m - 1) + k
    return f'{n // 12:04d}-{n % 12 + 1:02d}'


def validate_series(sid, obs, meta, start, today):
    probs = []
    if meta['frequency'].split(',')[0].strip() != 'Monthly':
        probs.append(f'{sid}: 월별 아님({meta["frequency"]})')
    keys = sorted(k for k in obs if k >= start)
    if len(keys) < 24:
        probs.append(f'{sid}: {start} 이후 관측 {len(keys)}개 < 24')
    elif keys[-1] < month_add(today[:7], -18):
        probs.append(f'{sid}: 최신 관측 {keys[-1]} — 18개월 이상 정체')
    for k in keys:
        v = obs[k]
        if v != v or v in (float('inf'), float('-inf')):
            probs.append(f'{sid}: {k} 비정상 값')
            break
    return probs


def load_old():
    try:
        return json.loads(OUT.read_text(encoding='utf-8'))
    except Exception:  # noqa: BLE001
        return None


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-seconds', type=float, default=480)
    ap.add_argument('--max-age-hours', type=float, default=20)
    ap.add_argument('--start', default='2015-01')
    ap.add_argument('--offline', action='store_true', help='네트워크 없이 캐시만 사용')
    a = ap.parse_args(argv)
    f = Fetcher(a.max_seconds, a.max_age_hours, a.offline)
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    series, errors, fatal = {}, list(KNOWN_UNAVAILABLE), []
    ids = [s[0] for s in SERIES]
    if len(ids) != len(set(ids)):
        print('SERIES 목록에 중복 ID', file=sys.stderr)
        return 1
    try:
        for sid, label_ko, kind, agg, lag, note in SERIES:
            try:
                body, _ = f.get(CSV_URL.format(id=sid), RAW / f'{sid}.csv')
                obs = parse_csv(sid, body)
                meta = load_meta(f, sid)
            except FileNotFoundError:
                # SERIES 는 존재를 확인한 목록 — 404 는 종료·개명 신호이므로 조용히 빼지 않고 실패시킨다(fail-closed).
                fatal.append(f'{sid}: FRED 404 — 목록 점검 필요(종료·개명?)')
                continue
            except (ValueError, RuntimeError, urllib.error.HTTPError) as e:
                fatal.append(f'{sid}: {e}')
                if isinstance(e, ValueError):  # 깨진 응답은 캐시에서 지워 다음 실행에 다시 받게 한다
                    for c in (RAW / f'{sid}.csv', RAW / f'{sid}.meta.json'):
                        c.unlink(missing_ok=True)
                continue
            probs = validate_series(sid, obs, meta, a.start, today)
            if probs:
                fatal.extend(probs)
                continue
            sa = meta['seasonal_adjustment']
            # 'Not Seasonally Adjusted Annual Rate' 가 SAAR 로 잘못 붙지 않도록 NSA 를 먼저 본다.
            sa_code = ('NSA' if sa.startswith('Not Seasonally Adjusted') else
                       'SAAR' if sa.startswith('Seasonally Adjusted Annual Rate') else
                       'SA' if sa.startswith('Seasonally Adjusted') else sa)
            src = meta.get('source') or next((v for k, v in SOURCES.items() if sid.startswith(k)), 'U.S. Census Bureau')
            notes = [f'FRED {sid}; 원출처 {src}' + (f' · {meta["release"]}' if meta.get('release') else ''),
                     f'units="{meta["units"]}", {sa}']
            if note:
                notes.append(note)
            kept = sorted(k for k in obs if k >= a.start)
            gaps = [m for m in month_range(kept[0], kept[-1]) if m not in obs]
            if gaps:
                notes.append(f'원문 결측 {len(gaps)}개월(키 생략): {gaps[0]}~{gaps[-1]}' if len(gaps) > 3 else f'원문 결측(키 생략): {", ".join(gaps)}')
            series[f'fred_{sid}'] = {
                'label': meta['title'],
                'label_ko': label_ko,
                'unit': meta['units'],
                'seasonal_adjustment': sa_code,
                'freq': 'M',
                'agg': agg,
                'kind': kind,
                'geo': 'US',
                'release_lag_days': lag,
                'source_url': PAGE_URL.format(id=sid),
                'source_updated': meta.get('updated'),
                'notes': ' | '.join(notes),
                'obs': {k: v for k, v in sorted(obs.items()) if k >= a.start},
            }
    except BudgetExceeded:
        print(f'시간 예산 {a.max_seconds}s 소진 — 캐시 {len(series)}개 확보, 다시 실행하면 이어서 진행', file=sys.stderr)
        return 2
    if fatal:
        for e in fatal:
            print('FATAL', e, file=sys.stderr)
        print('검증 실패 — 기존 출력 보존', file=sys.stderr)
        return 1
    if len(series) < len(SERIES) * 0.8:
        print(f'시리즈 {len(series)}/{len(SERIES)} — 너무 적음, 기존 출력 보존', file=sys.stderr)
        return 1
    old = load_old()
    if old:
        for sid in sorted(set(old.get('series', {})) - set(series)):
            errors.append(f'{sid}: 직전 출력에 있었으나 이번에 수집 안 됨')
    doc = {
        'schema': 'grid-composite-proxy/1',
        'family': FAMILY,
        'fetched_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'fetch_tool': 'grid/composite/tools/fetch_fred.py',
        'source': {'name': 'FRED, Federal Reserve Bank of St. Louis (fredgraph CSV, no API key)',
                   'url': 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=<ID>'},
        'series': series,
        'errors': errors,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    json.loads(tmp.read_text(encoding='utf-8'))
    os.replace(tmp, OUT)
    last = max(max(s['obs']) for s in series.values())
    print(f'{OUT.relative_to(ROOT)}: {len(series)} series, latest {last}, network requests {f.n_net}, errors {len(errors)}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
