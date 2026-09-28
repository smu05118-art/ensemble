#!/usr/bin/env python3
"""브라질 IBGE PIM-PF(월간 산업생산 물량지수) → data/proxies/brazil_stats.json (grid-composite-proxy/1).

SIDRA API(https://apisidra.ibge.gov.br/values/…) 표 8888
  'Produção Física Industrial, por seções e atividades industriais' 에서
  CNAE 2.0 3.27 'Fabricação de máquinas, aparelhos e materiais elétricos'(분류 544, 범주 129336) 를 읽는다.
    · ibge_pim_c27     : 변수 12606 PIMPF 지수(2022=100, 계절조정 없음 · 고정기준)
    · ibge_pim_c27_sa  : 변수 12607 PIMPF 지수(2022=100, 계절조정)
WEG(브라질 변압기·모터) 의 국내 생산 경기 프록시. CNAE 27 은 발전기·변압기·모터(27.1)·배전/제어기기(27.3)
외에 가전(27.5)·전선(27.3)·조명(27.4)도 포함하므로 변압기 전용 지표는 아니다(PIM-PF 는 2자리까지만 공표).

규칙: 파이썬 stdlib 만 사용, https + 정확한 호스트 허용목록, 요청별 타임아웃, 429/5xx 지수 백오프,
요청 간 간격, 원자료 응답은 data/raw/brazil_stats/ 에 캐시(--max-age-hours 이내면 재사용),
검증 실패 시 기존 출력 보존 + 종료코드 1, 시간 예산 초과 시 종료코드 2(재실행하면 이어서).

사용: python3 fetch_brazil_stats.py [--max-seconds 480] [--max-age-hours 20] [--start 2015-01] [--offline]
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
FAMILY = 'brazil_stats'
OUT = ROOT / 'data' / 'proxies' / f'{FAMILY}.json'
RAW = ROOT / 'data' / 'raw' / FAMILY
ALLOWED_HOSTS = {'apisidra.ibge.gov.br'}
TIMEOUT = 90
RETRIES = 5
SPACING = 1.0
UA = 'grid-composite-fetch/1 (research; stdlib urllib)'
MIN_OBS = 24
RELEASE_LAG = 38  # 7월분이 9월 초(약 5주 뒤) 공표
TABLE = 8888
CLASS, CATEGORY = 544, 129336
CATEGORY_NAME = '3.27 Fabricação de máquinas, aparelhos e materiais elétricos'
VARS = {  # 변수코드 → (series id, 기대 변수명, SA 여부, 한국어)
    12606: ('ibge_pim_c27', 'PIMPF - Número-índice (2022=100)', 'NSA', '원계열'),
    12607: ('ibge_pim_c27_sa', 'PIMPF - Número-índice com ajuste sazonal (2022=100)', 'SA', '계절조정'),
}
MISSING = {'-', '..', '...', 'X', 'x', ''}


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

    def get(self, url, cache_name):
        cache = RAW / cache_name
        if cache.exists() and (self.offline or time.time() - cache.stat().st_mtime < self.max_age):
            return cache.read_bytes()
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
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                    final = urllib.parse.urlsplit(r.geturl())
                    if final.scheme != 'https' or final.hostname not in ALLOWED_HOSTS:
                        raise RuntimeError(f'허용되지 않은 리다이렉트: {r.geturl()}')
                    raw = r.read()
                self.n_net += 1
                cache.parent.mkdir(parents=True, exist_ok=True)
                tmp = cache.with_suffix(cache.suffix + '.tmp')
                tmp.write_bytes(raw)
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


def parse(raw, start):
    """SIDRA /f/a 응답 → {변수코드: {YYYY-MM: 값}}, 결측 목록, 단위. 구조가 다르면 ValueError."""
    rows = json.loads(raw)
    if not isinstance(rows, list) or len(rows) < 2:
        raise ValueError(f'SIDRA 응답 형식 이상: {str(rows)[:200]}')
    head = rows[0]
    want = {'V': 'Valor', 'D2C': 'Variável (Código)', 'D3C': 'Mês (Código)'}
    for k, v in want.items():
        if head.get(k) != v:
            raise ValueError(f'SIDRA 헤더 변경 {k}={head.get(k)}')
    if not str(head.get('D4C', '')).startswith('Seções e atividades industriais'):
        raise ValueError(f'SIDRA 분류 헤더 변경 {head.get("D4C")}')
    out, missing, units = {}, {}, set()
    for r in rows[1:]:
        vc = int(r['D2C'])
        if vc not in VARS:
            raise ValueError(f'예상 밖 변수 {vc}')
        if r.get('D2N') != VARS[vc][1]:
            raise ValueError(f'변수명 변경 {vc}: {r.get("D2N")}')
        if str(r.get('D4C')) != str(CATEGORY) or r.get('D4N') != CATEGORY_NAME:
            raise ValueError(f'범주 변경 {r.get("D4C")} {r.get("D4N")}')
        if r.get('D1C') != '1':
            raise ValueError(f'지역이 Brasil(1) 아님 {r.get("D1C")}')
        p = r['D3C']
        if len(p) != 6 or not p.isdigit():
            raise ValueError(f'월 코드 이상 {p}')
        ym = f'{p[:4]}-{p[4:]}'
        if ym < start:
            continue
        units.add(r.get('MN'))
        v = str(r.get('V', '')).strip()
        if v in MISSING:
            missing.setdefault(vc, []).append(ym)
            continue
        out.setdefault(vc, {})[ym] = float(v)
    if units - {'Número-índice'}:
        raise ValueError(f'단위 변경 {units}')
    return out, missing


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-seconds', type=float, default=480)
    ap.add_argument('--max-age-hours', type=float, default=20)
    ap.add_argument('--start', default='2015-01')
    ap.add_argument('--offline', action='store_true')
    a = ap.parse_args(argv)
    net = Net(a.max_seconds, a.max_age_hours, a.offline)
    now = datetime.now(timezone.utc)
    end = now.strftime('%Y%m')
    url = (f'https://apisidra.ibge.gov.br/values/t/{TABLE}/n1/all/v/{",".join(str(v) for v in VARS)}'
           f'/p/{a.start.replace("-", "")}-{end}/c{CLASS}/{CATEGORY}/f/a')
    try:
        raw = net.get(url, f't{TABLE}_c{CATEGORY}_{a.start}.json')
        data, missing = parse(raw, a.start)
    except BudgetExceeded:
        print(f'시간 예산 {a.max_seconds}s 소진 — 다시 실행하면 캐시에서 이어서 진행', file=sys.stderr)
        return 2
    except (ValueError, RuntimeError, KeyError, TypeError, json.JSONDecodeError) as e:
        if not isinstance(e, RuntimeError):
            for c in RAW.glob('*.json'):
                c.unlink()
        print('FATAL', e, '— 기존 출력 보존', file=sys.stderr)
        return 1
    errors, series = [], {}
    stale_before = f'{now.year - 1:04d}-{now.month:02d}'
    for vc, (sid, vname, sa, sa_ko) in VARS.items():
        obs = data.get(vc, {})
        if len(obs) < MIN_OBS:
            errors.append(f'{sid}: 관측 {len(obs)}개 < {MIN_OBS} — 제외')
            continue
        keys = sorted(obs)
        if keys[-1] < stale_before:
            errors.append(f'{sid}: 최신 관측 {keys[-1]} — 12개월 넘게 갱신 없음, 제외')
            continue
        notes = [f'SIDRA table {TABLE}, variable {vc} ({vname}), classification C{CLASS} category {CATEGORY} '
                 f'({CATEGORY_NAME}), Brasil; Número-índice base fixa 2022=100']
        if missing.get(vc):
            notes.append(f'값 없음 {len(missing[vc])}개월 키 생략: ' + ', '.join(missing[vc][:12]))
        notes.append('CNAE 27 은 전기기계 전체(변압기·모터·발전기·배전/제어·전선·조명·가전 포함) — 변압기 전용 아님')
        series[sid] = {
            'label': f'Brazil PIM-PF physical production index, CNAE 27 electrical machinery & equipment ({sa}, 2022=100)',
            'label_ko': f'브라질 산업생산지수(PIM-PF) CNAE 27 전기기계·장비 · {sa_ko} (2022=100)',
            'unit': 'index 2022=100',
            'seasonal_adjustment': sa,
            'freq': 'M',
            'agg': 'mean',
            'kind': 'production',
            'geo': 'BR',
            'cnae': '27',
            'release_lag_days': RELEASE_LAG,
            'source_url': f'https://sidra.ibge.gov.br/tabela/{TABLE}',
            'notes': ' | '.join(notes),
            'obs': {k: obs[k] for k in keys},
        }
    if 'ibge_pim_c27' not in series:
        print('핵심 시리즈 ibge_pim_c27 누락 — 기존 출력 보존', file=sys.stderr)
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
        'fetch_tool': 'grid/composite/tools/fetch_brazil_stats.py',
        'source': {'name': 'IBGE SIDRA API — PIM-PF (Pesquisa Industrial Mensal - Produção Física), tabela 8888',
                   'url': 'https://apisidra.ibge.gov.br/values/t/8888'},
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
