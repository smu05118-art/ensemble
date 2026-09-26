#!/usr/bin/env python3
"""인도 MoSPI IIP(산업생산지수) 월별 → data/proxies/india_stats.json (grid-composite-proxy/1).

MoSPI eSankhyiki IIP API(https://api.mospi.gov.in/api/iip/getIIPData, 토큰 불필요)에서
기준연도 2011-12(구계열, 2026-03 까지)와 2022-23(신계열, 2023-04 부터)을 각각 전량 받아 아래를 뽑는다.
  · india_iip_27            : NIC-2008 27 'Manufacture of Electrical Equipment'   (2011-12=100)
  · india_iip_27_b2223      : 같은 업종, 신기준                                     (2022-23=100)
  · india_iip_capgoods       : 용도별 'Capital Goods'                                (2011-12=100)
  · india_iip_capgoods_b2223 : 용도별 'Capital Goods', 신기준                        (2022-23=100)
두 기준 계열은 잇지 않는다(비율 연결 = 추정이므로 금지). 모두 원계열(계절조정 없음).
변압기 품목(item) 지수는 API 로 공표되지 않는다(품목별 지수는 보도자료 PDF/Excel 부록뿐) — errors 에 기록.

TLS: api.mospi.gov.in 은 RFC 5746 보안 재협상을 지원하지 않아 OpenSSL 3 기본값으로는 핸드셰이크가 거부된다.
인증서 검증은 그대로 두고 ssl.OP_LEGACY_SERVER_CONNECT 만 켠다(이 호스트 전용 컨텍스트).

규칙: 파이썬 stdlib 만 사용, https + 정확한 호스트 허용목록, 요청별 타임아웃, 429/5xx 지수 백오프,
요청 간 간격, 원자료 응답은 data/raw/india_stats/ 에 캐시(--max-age-hours 이내면 재사용),
검증 실패 시 기존 출력 보존 + 종료코드 1, 시간 예산 초과 시 종료코드 2(재실행하면 이어서).

사용: python3 fetch_india_stats.py [--max-seconds 480] [--max-age-hours 20] [--start 2015-01] [--offline]
"""
import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAMILY = 'india_stats'
OUT = ROOT / 'data' / 'proxies' / f'{FAMILY}.json'
RAW = ROOT / 'data' / 'raw' / FAMILY
ALLOWED_HOSTS = {'api.mospi.gov.in'}
API = 'https://api.mospi.gov.in/api/iip/getIIPData'
TIMEOUT = 90
RETRIES = 5
SPACING = 1.0
PAGE = 200  # API 상한(limit>200 이면 400)
UA = 'grid-composite-fetch/1 (research; stdlib urllib)'
MIN_OBS = 24
RELEASE_LAG = 28  # 2025년부터 다음 달 28일 공표(그 전은 둘째 달 12일 ≈ 42일)
MONTHS = {m: i for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                                      'September', 'October', 'November', 'December'], 1)}
BASES = ('2011-12', '2022-23')
# (기준연도, type, category, sub_category) → (series id, 영문, 한국어)
WANT = {
    ('2011-12', 'Sectoral', 'Manufacturing', 'Manufacture of Electrical Equipment'):
        ('india_iip_27', 'India IIP, NIC 27 Manufacture of electrical equipment (base 2011-12=100)',
         '인도 IIP 전기장비 제조(NIC 27) · 원계열 (2011-12=100)'),
    ('2022-23', 'Sectoral', 'Manufacturing', 'Manufacture of Electrical Equipment'):
        ('india_iip_27_b2223', 'India IIP, NIC 27 Manufacture of electrical equipment (base 2022-23=100)',
         '인도 IIP 전기장비 제조(NIC 27) · 원계열 (2022-23=100, 신기준)'),
    ('2011-12', 'Use-based category', 'Capital Goods', ''):
        ('india_iip_capgoods', 'India IIP, use-based Capital goods (base 2011-12=100)',
         '인도 IIP 용도별 자본재 · 원계열 (2011-12=100)'),
    ('2022-23', 'Use-based category', 'Capital Goods', ''):
        ('india_iip_capgoods_b2223', 'India IIP, use-based Capital goods (base 2022-23=100)',
         '인도 IIP 용도별 자본재 · 원계열 (2022-23=100, 신기준)'),
}
KNOWN_GAPS = [
    'IIP 품목(item) 수준 변압기 지수는 API 에 없음(보도자료 부록만) — india_iip_27 은 NIC 27 전체(변압기·모터·배터리·전선·조명·가전 포함)',
    '구기준(2011-12=100) 계열은 2026-03 에서 끝나고 신기준(2022-23=100)은 2023-04 부터 — 두 계열을 잇지 않고 따로 싣는다',
]


class BudgetExceeded(Exception):
    pass


def tls_context():
    ctx = ssl.create_default_context()  # 인증서·호스트명 검증 유지
    ctx.options |= getattr(ssl, 'OP_LEGACY_SERVER_CONNECT', 0x4)
    return ctx


class Net:
    def __init__(self, max_seconds, max_age_hours, offline):
        self.t0 = time.monotonic()
        self.max_seconds = max_seconds
        self.max_age = max_age_hours * 3600
        self.offline = offline
        self.last = 0.0
        self.n_net = 0
        self.ctx = tls_context()

    def get_json(self, url, cache_name):
        cache = RAW / cache_name
        if cache.exists() and (self.offline or time.time() - cache.stat().st_mtime < self.max_age):
            return json.loads(cache.read_bytes())
        if self.offline:
            raise RuntimeError(f'offline 인데 캐시 없음: {cache_name}')
        if self.max_seconds and time.monotonic() - self.t0 > self.max_seconds:
            raise BudgetExceeded()
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
                req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
                with urllib.request.urlopen(req, timeout=TIMEOUT, context=self.ctx) as r:
                    final = urllib.parse.urlsplit(r.geturl())
                    if final.scheme != 'https' or final.hostname not in ALLOWED_HOSTS:
                        raise RuntimeError(f'허용되지 않은 리다이렉트: {r.geturl()}')
                    raw = r.read()
                self.n_net += 1
                obj = json.loads(raw)
                cache.parent.mkdir(parents=True, exist_ok=True)
                tmp = cache.with_suffix(cache.suffix + '.tmp')
                tmp.write_bytes(raw)
                os.replace(tmp, cache)
                return obj
            except urllib.error.HTTPError as e:
                if (e.code == 429 or 500 <= e.code < 600) and attempt + 1 < RETRIES:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RuntimeError(f'HTTP {e.code} {url}') from e
            except (urllib.error.URLError, TimeoutError, ConnectionError, ssl.SSLError, json.JSONDecodeError) as e:
                if attempt + 1 < RETRIES:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RuntimeError(f'네트워크/응답 실패 {url}: {e}') from e
        raise RuntimeError(f'재시도 소진: {url}')


def fetch_base(net, base, tag):
    """한 기준연도의 월별 전 레코드를 페이지로 받는다. 총 건수·중복 검증."""
    rows, page, total = [], 1, None
    while True:
        q = urllib.parse.urlencode({'frequency': 'Monthly', 'base_year': base, 'limit': PAGE, 'page': page})
        d = net.get_json(f'{API}?{q}', f'iip_{base}_{tag}_p{page:03d}.json')
        if d.get('statusCode') is not True or not isinstance(d.get('data'), list):
            raise ValueError(f'IIP API 응답 이상 {base} p{page}: {str(d)[:200]}')
        md = d.get('meta_data') or {}
        if total is None:
            total, pages = md.get('totalRecords'), md.get('totalPages')
        elif md.get('totalRecords') != total:
            raise ValueError(f'{base}: 페이지 사이에 총 건수 변경 {total} → {md.get("totalRecords")} (캐시 혼합) — 재실행 필요')
        rows.extend(d['data'])
        if page >= (pages or 0):
            break
        page += 1
    if len(rows) != total:
        raise ValueError(f'{base}: 받은 건수 {len(rows)} != totalRecords {total}')
    return rows


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-seconds', type=float, default=480)
    ap.add_argument('--max-age-hours', type=float, default=20)
    ap.add_argument('--start', default='2015-01')
    ap.add_argument('--offline', action='store_true')
    a = ap.parse_args(argv)
    net = Net(a.max_seconds, a.max_age_hours, a.offline)
    now = datetime.now(timezone.utc)
    tag = now.strftime('%Y%m%d')
    errors, fatal = list(KNOWN_GAPS), []
    obs = {v[0]: {} for v in WANT.values()}
    growth = {v[0]: {} for v in WANT.values()}
    try:
        for base in BASES:
            rows = fetch_base(net, base, tag)
            seen = {}
            for r in rows:
                if r.get('base_year') != base:
                    raise ValueError(f'기준연도 불일치 {r.get("base_year")} != {base}')
                key = (base, r.get('type'), r.get('category'), r.get('sub_category') or '')
                if key not in WANT:
                    continue
                sid = WANT[key][0]
                m = MONTHS.get(r.get('month'))
                y = r.get('year')
                if not m or not isinstance(y, int) or not 2000 <= y <= 2100:
                    raise ValueError(f'{sid}: 기간 형식 이상 {r.get("year")} {r.get("month")}')
                ym = f'{y:04d}-{m:02d}'
                v = str(r.get('index', '')).strip()
                try:
                    val = float(v)
                except ValueError:
                    errors.append(f'{sid}: {ym} 지수 값 "{v}" 숫자 아님 — 생략')
                    continue
                if (sid, ym) in seen and seen[(sid, ym)] != val:
                    raise ValueError(f'{sid}: {ym} 중복 레코드 값 충돌 {seen[(sid, ym)]} vs {val}')
                seen[(sid, ym)] = val
                if ym >= a.start:
                    obs[sid][ym] = val
                    growth[sid][ym] = r.get('growth_rate')
    except BudgetExceeded:
        print(f'시간 예산 {a.max_seconds}s 소진 — 다시 실행하면 캐시에서 이어서 진행', file=sys.stderr)
        return 2
    except (ValueError, RuntimeError, KeyError, TypeError) as e:
        if not isinstance(e, RuntimeError):
            for c in RAW.glob('*.json'):
                c.unlink()
        print('FATAL', e, '— 기존 출력 보존', file=sys.stderr)
        return 1

    series = {}
    for (base, typ, cat, sub), (sid, label, label_ko) in WANT.items():
        o = obs[sid]
        if len(o) < MIN_OBS:
            errors.append(f'{sid}: 관측 {len(o)}개 < {MIN_OBS} — 제외')
            continue
        keys = sorted(o)
        # 월 연속성 검사(중간 결측은 키 생략 그대로 두되 notes 에 남긴다)
        def mi(k):
            return int(k[:4]) * 12 + int(k[5:]) - 1
        holes = [f'{(i) // 12:04d}-{i % 12 + 1:02d}' for i in range(mi(keys[0]), mi(keys[-1]) + 1)
                 if f'{(i) // 12:04d}-{i % 12 + 1:02d}' not in o]
        notes = [f'MoSPI IIP API getIIPData frequency=Monthly base_year={base}; type="{typ}" category="{cat}"'
                 + (f' sub_category="{sub}"' if sub else '') + '; 원계열(계절조정 없음); 최근 월은 잠정(provisional)치이며 이후 개정']
        if holes:
            notes.append(f'중간 결측 {len(holes)}개월: ' + ', '.join(holes[:12]))
        if base == '2011-12':
            notes.append(f'구기준 계열 — API 상 마지막 월 {keys[-1]}; 이후 월은 2022-23 기준 계열에만 있음(수집 시점 확인)')
        series[sid] = {
            'label': label,
            'label_ko': label_ko,
            'unit': f'index {base}=100',
            'seasonal_adjustment': 'NSA',
            'freq': 'M',
            'agg': 'mean',
            'kind': 'production',
            'geo': 'IN',
            'nic': '27' if 'Electrical' in sub else None,
            'base_year': base,
            'release_lag_days': RELEASE_LAG,
            'source_url': 'https://esankhyiki.mospi.gov.in/macroindicators?product=iip',
            'notes': ' | '.join(notes),
            'obs': {k: o[k] for k in keys},
        }
        if series[sid]['nic'] is None:
            del series[sid]['nic']
    if 'india_iip_27' not in series and 'india_iip_27_b2223' not in series:
        print('핵심 시리즈 누락 — 기존 출력 보존', file=sys.stderr)
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
        'fetch_tool': 'grid/composite/tools/fetch_india_stats.py',
        'source': {'name': 'MoSPI eSankhyiki — Index of Industrial Production API (getIIPData)', 'url': API},
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
