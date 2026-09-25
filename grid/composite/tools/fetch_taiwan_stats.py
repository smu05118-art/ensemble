#!/usr/bin/env python3
"""대만 경제부 통계처(MOEA DOS) 오픈데이터 → data/proxies/taiwan_stats.json (grid-composite-proxy/1).

service.moea.gov.tw/EE520/opendata/ 의 공개 CSV(정부자료개방 data.gov.tw 등록분)만 쓴다.
  · moea_ip_2810      : 工業生產指數 2810 發電、輸電及配電機械製造業(발전·송전·배전기계 = 변압기·개폐장치 포함), 2021=100, 원계열
  · moea_ip_28        : 工業生產指數 28 電力設備及配備製造業, 2021=100, 원계열
  · moea_ip_28_sa     : 製造業季節調整後生產量指數 28, 2021=100, 계절조정
  · moea_pvi_28       : 製造業生產價值指數 28(생산액 지수), 2021=100, 원계열
  · moea_export_orders_electrical : 外銷訂單金額 電機產品(전기기계 수출수주액), 백만 미달러
Fortune Electric(1519)·Chung-Hsin(1513)·Shihlin(1503)·TECO(1504)·Allis(1514) 의 대만 공장 경기 프록시.

실패(수집 불가) — errors 에 기록:
  · 품목별 '變壓器' 생산량·생산액(工業產品產銷存 統計): dmz26.moea.gov.tw/GMWeb 연결 거부(프록시 502),
    www.moea.gov.tw 는 Cloudflare 차단(403) — 품목 수준 시계열 없음
  · 재정부 관세 HS 8504 대미 수출: portal.sw.nat.gov.tw·web02 동적조회의 국가×HS6 파라미터 비공개/접속불가 — Comtrade(미국 수입, 상대국 490) 로 대체

규칙: 파이썬 stdlib 만 사용, https + 정확한 호스트 허용목록, 요청별 타임아웃, 429/5xx 지수 백오프,
요청 간 간격, 원자료는 data/raw/taiwan_stats/ 에 gzip 캐시(--max-age-hours 이내면 재사용),
검증 실패 시 기존 출력 보존 + 종료코드 1, 시간 예산 초과 시 종료코드 2(재실행하면 이어서).

사용: python3 fetch_taiwan_stats.py [--max-seconds 480] [--max-age-hours 20] [--start 2015-01] [--offline]
"""
import argparse
import csv
import gzip
import io
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
FAMILY = 'taiwan_stats'
OUT = ROOT / 'data' / 'proxies' / f'{FAMILY}.json'
RAW = ROOT / 'data' / 'raw' / FAMILY
ALLOWED_HOSTS = {'service.moea.gov.tw'}
BASE = 'https://service.moea.gov.tw/EE520/opendata/'
TIMEOUT = 120
RETRIES = 5
SPACING = 1.5
UA = 'grid-composite-fetch/1 (research; stdlib urllib)'
MIN_OBS = 24

# 파일 → (cache 이름, 기대 헤더, data.gov.tw 데이터셋 번호)
FILES = {
    'ip': ('d.csv', ['統計項目', '行業代碼', '行業別', '資料期(民國年)', '統計值(指數)', '計量單位'], 6607),
    'ip_sa': ('經濟部統計處_製造業季節調整後生產量指數.csv',
              ['統計項目', '行業代碼', '行業別', '資料期(民國年)', '統計值(指數)', '計量單位'], 16367),
    'pvi': ('經濟部統計處_製造業生產價值指數.csv',
            ['統計項目', '行業代碼', '行業別', '資料期(民國年)', '統計值(指數)', '計量單位'], 16366),
    'eo': ('經濟部統計處_外銷訂單_電機產品.csv', ['統計項目', '貨品別', '資料期(民國年)', '統計值(金額)', '計量單位'], 162492),
}
# series id → (파일키, 통계항목, 코드/품목, 기대 이름, 기대 단위, unit, kind, agg, SA, label, label_ko, lag)
SERIES = {
    'moea_ip_2810': ('ip', '生產指數', '2810', '發電、輸電及配電機械製造業', '110年=100', 'index 2021=100', 'production',
                     'mean', 'NSA', 'Taiwan industrial production index, 2810 power generation, transmission & distribution machinery (NSA, 2021=100)',
                     '대만 산업생산지수 2810 발전·송배전기계(변압기·개폐장치 포함) · 원계열 (2021=100)', 23),
    'moea_ip_28': ('ip', '生產指數', '28', '電力設備及配備製造業', '110年=100', 'index 2021=100', 'production', 'mean', 'NSA',
                   'Taiwan industrial production index, 28 electrical equipment (NSA, 2021=100)',
                   '대만 산업생산지수 28 전력설비·장비 제조업 · 원계열 (2021=100)', 23),
    'moea_ip_28_sa': ('ip_sa', '季節調整後生產指數', '28', '電力設備及配備製造業', '110年=100', 'index 2021=100', 'production',
                      'mean', 'SA', 'Taiwan industrial production index, 28 electrical equipment (SA, 2021=100)',
                      '대만 산업생산지수 28 전력설비·장비 제조업 · 계절조정 (2021=100)', 23),
    'moea_pvi_28': ('pvi', '生產價值指數', '28', '電力設備及配備製造業', '110年=100', 'index 2021=100', 'production', 'mean',
                    'NSA', 'Taiwan manufacturing production value index, 28 electrical equipment (NSA, 2021=100)',
                    '대만 제조업 생산액지수 28 전력설비·장비 제조업 · 원계열 (2021=100)', 23),
    'moea_export_orders_electrical': ('eo', '外銷訂單金額_美元', '電機產品', None, '百萬美元', 'USD million', 'orders', 'sum',
                                      'NSA', 'Taiwan export orders, electrical machinery products (USD million)',
                                      '대만 수출수주액 · 전기기계 제품(電機產品) · 백만 미달러', 20),
}
KNOWN_GAPS = [
    '대만 품목별 變壓器 생산량·생산액(工業產品產銷存統計): dmz26.moea.gov.tw 연결 거부(egress 프록시 502), www.moea.gov.tw Cloudflare 403 — 수집 불가, moea_transformer_prod_value/qty 없음',
    '대만 관세 HS 8504 대미 수출: portal.sw.nat.gov.tw 연결 끊김, web02.mof.gov.tw 동적조회는 HS6(funid i8142) 총계만 확인·국가×HS 필터 미구현 — 미국측 수입(Comtrade 상대국 490)으로 대체',
    '2810 은 4자리 업종 전체(발전기·전동기 포함) — 변압기 전용 아님',
]


class BudgetExceeded(Exception):
    pass


class Net:
    def __init__(self, max_seconds, max_age_hours, offline):
        self.t0 = time.monotonic()
        self.max_seconds = max_seconds
        self.max_age = max_age_hours * 3600
        self.offline = offline
        self.last = 0.0
        self.n_net = 0

    def get(self, name, cache_name):
        cache = RAW / cache_name
        if cache.exists() and (self.offline or time.time() - cache.stat().st_mtime < self.max_age):
            return gzip.decompress(cache.read_bytes())
        if self.offline:
            raise RuntimeError(f'offline 인데 캐시 없음: {cache_name}')
        if self.max_seconds and time.monotonic() - self.t0 > self.max_seconds:
            raise BudgetExceeded()
        url = BASE + urllib.parse.quote(name)
        u = urllib.parse.urlsplit(url)
        if u.scheme != 'https' or u.hostname not in ALLOWED_HOSTS:
            raise RuntimeError(f'허용되지 않은 URL: {url}')
        delay = 3.0
        for attempt in range(RETRIES):
            wait = SPACING - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            try:
                req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/csv,*/*'})
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                    final = urllib.parse.urlsplit(r.geturl())
                    if final.scheme != 'https' or final.hostname not in ALLOWED_HOSTS:
                        raise RuntimeError(f'허용되지 않은 리다이렉트: {r.geturl()}')
                    raw = r.read()
                self.n_net += 1
                cache.parent.mkdir(parents=True, exist_ok=True)
                tmp = cache.with_suffix(cache.suffix + '.tmp')
                tmp.write_bytes(gzip.compress(raw, mtime=0))
                os.replace(tmp, cache)
                return raw
            except urllib.error.HTTPError as e:
                if (e.code == 429 or 500 <= e.code < 600) and attempt + 1 < RETRIES:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RuntimeError(f'HTTP {e.code} {url}') from e
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt + 1 < RETRIES:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RuntimeError(f'네트워크 실패 {url}: {e}') from e
        raise RuntimeError(f'재시도 소진: {url}')


def roc_month(p):
    """'11507' → '2026-07' (민국 연도 3자리 + 월 2자리)."""
    p = p.strip()
    if len(p) != 5 or not p.isdigit():
        raise ValueError(f'자료기간 형식 이상 {p!r}')
    y, m = int(p[:3]) + 1911, int(p[3:])
    if not 1 <= m <= 12:
        raise ValueError(f'월 범위 이상 {p!r}')
    return f'{y:04d}-{m:02d}'


def load_csv(raw, header):
    text = raw.decode('utf-8-sig')
    rows = list(csv.reader(io.StringIO(text)))
    if not rows or [h.strip() for h in rows[0]] != header:
        raise ValueError(f'CSV 헤더 변경: {rows[0] if rows else None}')
    return rows[1:]


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-seconds', type=float, default=480)
    ap.add_argument('--max-age-hours', type=float, default=20)
    ap.add_argument('--start', default='2015-01')
    ap.add_argument('--offline', action='store_true')
    a = ap.parse_args(argv)
    net = Net(a.max_seconds, a.max_age_hours, a.offline)
    now = datetime.now(timezone.utc)
    errors = list(KNOWN_GAPS)
    data = {}
    try:
        for key, (name, header, _) in FILES.items():
            raw = net.get(name, f'{key}.csv.gz')
            data[key] = load_csv(raw, header)
        obs = {sid: {} for sid in SERIES}
        for sid, spec in SERIES.items():
            fk, stat, code, ename, eunit = spec[:5]
            seen = obs[sid]
            for r in data[fk]:
                if fk == 'eo':
                    item, cat, per, val, unit = (x.strip() for x in r[:5])
                    if item != stat or cat != code:
                        continue
                else:
                    item, c, nm, per, val, unit = (x.strip() for x in r[:6])
                    if item != stat or c != code:
                        continue
                    if nm != ename:
                        raise ValueError(f'{sid}: 업종명 변경 {nm!r} != {ename!r}')
                if unit != eunit:
                    raise ValueError(f'{sid}: 단위 변경 {unit!r} != {eunit!r}')
                ym = roc_month(per)
                if ym < a.start:
                    continue
                if val in ('', '-', '…', '...', 'x', 'X'):
                    continue
                v = float(val.replace(',', ''))
                if ym in seen and seen[ym] != v:
                    raise ValueError(f'{sid}: {ym} 중복 값 충돌')
                seen[ym] = v
    except BudgetExceeded:
        print(f'시간 예산 {a.max_seconds}s 소진 — 다시 실행하면 캐시에서 이어서 진행', file=sys.stderr)
        return 2
    except (ValueError, RuntimeError, KeyError, TypeError, IndexError, UnicodeDecodeError, OSError) as e:
        if not isinstance(e, RuntimeError):
            for c in RAW.glob('*.gz'):
                c.unlink()
        print('FATAL', e, '— 기존 출력 보존', file=sys.stderr)
        return 1

    series = {}
    stale_before = f'{now.year - 1:04d}-{now.month:02d}'
    for sid, spec in SERIES.items():
        fk, stat, code, ename, eunit, unit, kind, agg, sa, label, label_ko, lag = spec
        o = obs[sid]
        if len(o) < MIN_OBS:
            errors.append(f'{sid}: 관측 {len(o)}개 < {MIN_OBS} — 제외')
            continue
        keys = sorted(o)
        if keys[-1] < stale_before:
            errors.append(f'{sid}: 최신 관측 {keys[-1]} — 12개월 넘게 갱신 없음, 제외')
            continue
        name, _, nid = FILES[fk]
        notes = [f'MOEA DOS open data {name} (data.gov.tw dataset {nid}); 統計項目={stat}; '
                 + (f'行業代碼={code} {ename}' if ename else f'貨品別={code}') + f'; 計量單位={eunit}; 최근 월은 잠정치이며 이후 개정']
        if sid == 'moea_ip_2810':
            notes.append('4자리 세부업종은 2자리(28)보다 한 달 늦게 올라오는 경우가 있음')
        series[sid] = {
            'label': label,
            'label_ko': label_ko,
            'unit': unit,
            'seasonal_adjustment': sa,
            'freq': 'M',
            'agg': agg,
            'kind': kind,
            'geo': 'TW',
            'release_lag_days': lag,
            'source_url': f'https://data.gov.tw/dataset/{nid}',
            'notes': ' | '.join(notes),
            'obs': {k: o[k] for k in keys},
        }
    if 'moea_ip_2810' not in series:
        print('핵심 시리즈 moea_ip_2810 누락 — 기존 출력 보존', file=sys.stderr)
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
        'fetched_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'fetch_tool': 'grid/composite/tools/fetch_taiwan_stats.py',
        'source': {'name': 'Taiwan MOEA Department of Statistics open data (industrial production / manufacturing indices / export orders)',
                   'url': BASE},
        'series': series,
        'errors': sorted(set(errors)),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    json.loads(tmp.read_text(encoding='utf-8'))
    os.replace(tmp, OUT)
    last = max(max(s['obs']) for s in series.values())
    print(f'{OUT.relative_to(ROOT)}: {len(series)} series, latest {last}, network requests {net.n_net}, errors {len(doc["errors"])}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
