#!/usr/bin/env python3
"""멕시코 INEGI EMIM(월간 제조업 조사) 지수 → data/proxies/mexico_stats.json (grid-composite-proxy/1).

INEGI 데이터 개방(datos abiertos) 파일 emim_indices_nac_csv.zip(토큰 불필요)에서 SCIAN 2018
  · 3353   rama  'Fabricación de equipo de generación y distribución de energía eléctrica'
  · 335312 clase 'Fabricación de equipo y aparatos de distribución de energía eléctrica'(변압기·배전반 포함)
의 지수(2018=100, 원계열)를 뽑는다.
  · inegi_emim_ivfp_3353 / inegi_emim_ivfp_335312 : IVFP_C 생산 물량지수
  · inegi_emim_ivfv_3353 / inegi_emim_ivfv_335312 : IVFV_C 판매 물량지수
  · inegi_emim_ipo_335312                         : IPO_T5 종사자 지수
Prolec GE(몬테레이)·Hammond(몬테레이)·Eaton·Siemens Energy·WEG 멕시코 공장의 생산 경기 프록시.

한계(errors 에 기록): 이 개방 파일은 비정기 갱신(수집 시점 파일 Last-Modified 2025-05-15, 자료 2025-03 까지).
월별 최신치는 BIE API(무료 토큰 필요)에만 있어 쓰지 않는다. 생산액(valor de producción)·품목 수준 자료는
개방 파일에 없다.

(2) 같은 EMIM 의 INEGI 공식 대화형 표(Tabulados interactivos, PxWeb API — 토큰 불필요, 매월 갱신)
    www.inegi.org.mx/app/tabulados/pxwebapi/api  표 EMIM/EMIM_NACIONAL_0
    'Valores absolutos corrientes ... por sector, subsector, rama y clase de actividad económica, datos mensuales'(2018-01~)
  · inegi_emim_vp_3353 / inegi_emim_vp_335312 : Total de valor de producción de los productos elaborados (천 페소, 경상)
  · inegi_emim_vv_3353 / inegi_emim_vv_335312 : Total de valor de ventas de los productos elaborados (천 페소, 경상)
  같은 요청으로 받은 '전년동월비(Variación anual)' 칸과 계산한 전년동월비가 0.06%p 넘게 어긋나면 월 정렬 오류로 보고 실패.
  품목 표(EMIM_ENTIDAD_35/36)는 335312 에 대해 '클래스 합계만 공표'라 변압기 품목 값은 없다.

규칙: 파이썬 stdlib 만 사용, https + 정확한 호스트 허용목록, 요청별 타임아웃, 429/5xx 지수 백오프,
요청 간 간격, 원자료는 data/raw/mexico_stats/ 에 캐시(--max-age-hours 이내면 재사용),
검증 실패 시 기존 출력 보존 + 종료코드 1, 시간 예산 초과 시 종료코드 2(재실행하면 이어서).

사용: python3 fetch_mexico_stats.py [--max-seconds 480] [--max-age-hours 20] [--start 2015-01] [--offline]
"""
import argparse
import csv
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAMILY = 'mexico_stats'
OUT = ROOT / 'data' / 'proxies' / f'{FAMILY}.json'
RAW = ROOT / 'data' / 'raw' / FAMILY
ALLOWED_HOSTS = {'www.inegi.org.mx'}
ZIP_URL = 'https://www.inegi.org.mx/contenidos/programas/emim/2018/datosabiertos/emim_indices_nac_csv.zip'
TIMEOUT = 120
RETRIES = 5
SPACING = 1.0
UA = 'grid-composite-fetch/1 (research; stdlib urllib)'
MIN_OBS = 24
RELEASE_LAG = 42  # 월별 공표(보도자료) 기준 약 6주 — 이 개방 파일 자체는 비정기 갱신
CODES = {
    '3353': ('R', 'tr_indice_ram_mensual_nac_', 'Fabricación de equipo de generación y distribución de energía eléctrica',
             '발전·배전 장비 제조(SCIAN 3353)'),
    '335312': ('C', 'tr_indice_cla_mensual_nac_', 'Fabricación de equipo y aparatos de distribución de energía eléctrica',
               '배전 장비·기기 제조(SCIAN 335312, 변압기·배전반 포함)'),
}
VARS = {  # 변수 → (id 접두, 영문, 한국어, kind)
    'IVFP_C': ('ivfp', 'physical production volume index', '생산 물량지수', 'production'),
    'IVFV_C': ('ivfv', 'physical sales volume index', '판매 물량지수', 'shipments'),
    'IPO_T5': ('ipo', 'total employed personnel index', '종사자 지수', 'production'),
}
WANT = [('3353', 'IVFP_C'), ('3353', 'IVFV_C'), ('335312', 'IVFP_C'), ('335312', 'IVFV_C'), ('335312', 'IPO_T5')]
KNOWN_GAPS = [
    'INEGI BIE(월별 최신치) API 는 무료 토큰이 필요해 쓰지 않음 — 개방 파일(emim_indices_nac_csv.zip)은 비정기 갱신이라 최신 월이 늦다',
    'EMIM 품목(transformadores) 수준 자료 없음: 개방 파일은 지수만, 품목 표(EMIM_ENTIDAD_35/36)는 335312 에 대해 클래스 합계만 공표 — '
    '생산액·판매액은 PxWeb 표 EMIM_NACIONAL_0 의 클래스(335312)·라마(3353) 합계(inegi_emim_vp_*/vv_*)로 수록',
]
# INEGI 대화형 표(PxWeb) — EMIM 월별 절대값(경상가격)
PX_API = 'https://www.inegi.org.mx/app/tabulados/pxwebapi/api'
PX_FILE = 'EMIM/EMIM_NACIONAL_0'
PX_PAGE = 'https://www.inegi.org.mx/app/tabulados/interactivos/?px=EMIM_NACIONAL_0&bd=EMIM'
PX_VARS = {  # 변수 표시문 → (id 접두, 영문, 한국어, kind)
    '-Total de valor de producción de los productos elaborados (Miles de pesos corrientes)':
        ('vp', 'production value of manufactured products', '생산액', 'production'),
    '-Total de valor de ventas de los productos elaborados (Miles de pesos corrientes)':
        ('vv', 'sales value of manufactured products', '판매액', 'shipments'),
}
PX_MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre',
             'Noviembre', 'Diciembre']
PX_MISSING = {'-', '', 'NC', 'ND', 'NA', 'N/E'}


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
        self.last_modified = None

    def get(self, url, cache_name, body=None):
        """GET(또는 body 가 있으면 JSON POST) — 응답을 cache_name 으로 캐시."""
        cache = RAW / cache_name
        meta = cache.with_suffix(cache.suffix + '.lastmod')
        if cache.exists() and (self.offline or time.time() - cache.stat().st_mtime < self.max_age):
            if meta.exists():
                self.last_modified = meta.read_text(encoding='utf-8').strip() or None
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
                if body is None:
                    req = urllib.request.Request(url, headers={'User-Agent': UA})
                else:
                    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
                                                 headers={'User-Agent': UA, 'Content-Type': 'application/json',
                                                          'Accept': 'application/json'}, method='POST')
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                    final = urllib.parse.urlsplit(r.geturl())
                    if final.scheme != 'https' or final.hostname not in ALLOWED_HOSTS:
                        raise RuntimeError(f'허용되지 않은 리다이렉트: {r.geturl()}')
                    raw = r.read()
                    self.last_modified = r.headers.get('Last-Modified')
                self.n_net += 1
                cache.parent.mkdir(parents=True, exist_ok=True)
                tmp = cache.with_suffix(cache.suffix + '.tmp')
                tmp.write_bytes(raw)
                os.replace(tmp, cache)
                meta.write_text(self.last_modified or '', encoding='utf-8')
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


def read_csv(z, name):
    b = z.read(name)
    for enc in ('utf-8-sig', 'cp1252', 'latin-1'):
        try:
            return list(csv.reader(io.StringIO(b.decode(enc))))
        except UnicodeDecodeError:
            continue
    raise ValueError(f'{name}: 인코딩 판별 실패')


def px_num(cell):
    """PxWeb 칸 '3,593,899||' → float, 결측 기호면 None."""
    v = str(cell).split('|', 1)[0].strip().replace(',', '')
    if v in PX_MISSING:
        return None
    return float(v)


def fetch_px(net, start):
    """INEGI 대화형 표 EMIM_NACIONAL_0 → ({(code, 접두): {YYYY-MM: 값}}, 상태 메모). 구조가 다르면 ValueError."""
    meta = json.loads(net.get(f'{PX_API}/tabulado?' + urllib.parse.urlencode({'lang': 'es', 'file': PX_FILE}),
                              'px_emim_nacional_0_meta.json'))
    title = str(meta.get('title', ''))
    if 'Valores absolutos corrientes' not in title or 'datos mensuales' not in title:
        raise ValueError(f'PxWeb 표 제목 변경: {title[:120]}')
    var = {v['code']: v for v in meta.get('variables') or []}
    for k in ('Variable', 'Tipo de dato', 'Sector SCIAN', 'Año', 'Mes'):
        if k not in var:
            raise ValueError(f'PxWeb 차원 {k} 없음 ({list(var)})')

    def pick(dim, pred, n=None):
        hits = [(v, t) for v, t in zip(var[dim]['values'], var[dim]['valueTexts']) if pred(t)]
        if n is not None and len(hits) != n:
            raise ValueError(f'PxWeb {dim}: 기대 {n}개, 찾음 {len(hits)} {hits[:3]}')
        return hits
    vsel = [pick('Variable', lambda t, x=x: t.strip() == x, 1)[0] for x in PX_VARS]
    tsel = pick('Tipo de dato', lambda t: t.strip() in ('Dato', 'Variación anual (Porcentaje)'), 2)
    ssel = [pick('Sector SCIAN', lambda t, c=c: t.strip().split(' ', 1)[0] == c, 1)[0] for c in CODES]
    for (_, t), c in zip(ssel, CODES):
        if CODES[c][2] not in t:
            raise ValueError(f'PxWeb 업종명 변경 {c}: {t}')
    ysel = [(v, t) for v, t in zip(var['Año']['values'], var['Año']['valueTexts']) if t.strip().isdigit() and t.strip() >= start[:4]]
    if [t for _, t in pick('Mes', lambda t: True)] != PX_MONTHS:
        raise ValueError(f'PxWeb 월 차원 변경 {var["Mes"]["valueTexts"]}')
    body = {'showdecimals': None, 'file': PX_FILE, 'lang': 'es', 'heading': ['Año', 'Mes'],
            'stub': ['Variable', 'Tipo de dato', 'Sector SCIAN'], 'agg': None,
            'query': {'response': {'format': 'json-stat', 'params': None}, 'query': [
                {'code': 'Variable', 'variabletype': None, 'selection': {'filter': 'item', 'values': [v for v, _ in vsel]}},
                {'code': 'Tipo de dato', 'variabletype': None, 'selection': {'filter': 'item', 'values': [v for v, _ in tsel]}},
                {'code': 'Sector SCIAN', 'variabletype': None, 'selection': {'filter': 'item', 'values': [v for v, _ in ssel]}},
                {'code': 'Año', 'variabletype': None, 'selection': {'filter': 'item', 'values': [v for v, _ in ysel]}},
                {'code': 'Mes', 'variabletype': None, 'selection': {'filter': 'all', 'values': ['*']}}]}}
    d = json.loads(net.get(f'{PX_API}/datatable', f'px_emim_nacional_0_data_{start[:4]}.json', body=body))
    stub = {s['code']: s['label'] for s in d.get('stub') or []}
    head = {h['code']: h['label'] for h in d.get('heading') or []}
    if [s['code'] for s in d.get('stub') or []] != ['Variable', 'Tipo de dato', 'Sector SCIAN'] or \
            [h['code'] for h in d.get('heading') or []] != ['Año', 'Mes']:
        raise ValueError('PxWeb 응답 축 순서 변경')
    if stub['Variable'] != [t for _, t in vsel] or stub['Sector SCIAN'] != [t for _, t in ssel] or \
            stub['Tipo de dato'] != [t for _, t in tsel] or head['Año'] != [t for _, t in ysel] or head['Mes'] != PX_MONTHS:
        raise ValueError('PxWeb 응답 라벨이 요청과 다름')
    ncol = len(ysel) * 12
    cells = d.get('data') or []
    if d.get('colCount') != ncol or len(cells) != d.get('rowCount', -1) * ncol or d['rowCount'] != len(vsel) * 2 * len(ssel):
        raise ValueError(f'PxWeb 행렬 크기 이상 rows={d.get("rowCount")} cols={d.get("colCount")} n={len(cells)}')
    out, yoy = {}, {}
    row = 0
    for _, vt in vsel:
        for _, tt in tsel:
            for c in CODES:
                vals = cells[row * ncol:(row + 1) * ncol]
                row += 1
                tgt = out if tt == 'Dato' else yoy
                dd = tgt.setdefault((c, PX_VARS[vt][0]), {})
                for i, cell in enumerate(vals):
                    ym = f'{int(ysel[i // 12][1]):04d}-{i % 12 + 1:02d}'
                    x = px_num(cell)
                    if x is not None and ym >= start:
                        dd[ym] = x
    # 월 정렬 검증: 공표 전년동월비 vs 계산값
    n_chk, bad = 0, []
    for key, dd in out.items():
        for ym, g in yoy.get(key, {}).items():
            prev = f'{int(ym[:4]) - 1:04d}{ym[4:]}'
            if ym in dd and prev in dd and dd[prev] > 0:
                n_chk += 1
                calc = (dd[ym] / dd[prev] - 1) * 100
                if abs(calc - g) > 0.06:
                    bad.append((key, ym, round(calc, 2), g))
    if bad or n_chk < 24:
        raise ValueError(f'PxWeb 전년동월비 대조 실패 {len(bad)}/{n_chk}: {bad[:3]}')
    note = re.sub(r'\s+', ' ', str(d.get('notes') or '')).strip()
    status = '; '.join(m.group(0) for m in re.finditer(r'Cifras (?:preliminares|revisadas) a partir de \w+ \d{4}', note))
    return out, n_chk, status, title


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
    obs, status = {}, {}
    try:
        raw = net.get(ZIP_URL, 'emim_indices_nac_csv.zip')
        z = zipfile.ZipFile(io.BytesIO(raw))
        names = z.namelist()
        cat = {r[0].strip(): (r[1].strip(), r[2].strip()) for r in read_csv(z, 'catalogos/tc_actividad.csv')[1:] if len(r) >= 3}
        meta = next((n for n in names if n.startswith('metadatos/') and n.endswith('.txt')), None)
        title = ''
        if meta:
            for line in z.read(meta).decode('utf-8', 'replace').splitlines():
                if line.startswith('title:'):
                    title = line[6:].strip()
                    break
        for code, (clf, prefix, ename, _) in CODES.items():
            if cat.get(code) != (clf, ename):
                raise ValueError(f'카탈로그 변경 {code}: {cat.get(code)}')
            fname = next((n for n in names if n.startswith('conjunto_de_datos/' + prefix) and n.endswith('.csv')), None)
            if not fname:
                raise ValueError(f'{prefix}*.csv 없음')
            rows = read_csv(z, fname)
            head = [h.strip() for h in rows[0]]
            for col in ('CODIGO_ACTIVIDAD', 'ANIO', 'MES', 'CLASIFICADOR_ACTIVIDAD', 'ESTATUS', *VARS):
                if col not in head:
                    raise ValueError(f'{fname}: 열 {col} 없음 ({head[:6]}…)')
            ix = {h: i for i, h in enumerate(head)}
            for r in rows[1:]:
                if r[ix['CODIGO_ACTIVIDAD']].strip() != code:
                    continue
                if r[ix['CLASIFICADOR_ACTIVIDAD']].strip() != clf:
                    raise ValueError(f'{code}: 분류자 불일치 {r[ix["CLASIFICADOR_ACTIVIDAD"]]}')
                y, m = int(r[ix['ANIO']].strip()), int(r[ix['MES']].strip())
                if not 1 <= m <= 12:
                    raise ValueError(f'{code}: 월 이상 {m}')
                ym = f'{y:04d}-{m:02d}'
                if ym < a.start:
                    continue
                for var in VARS:
                    if (code, var) not in WANT:
                        continue
                    v = r[ix[var]].strip()
                    if v in ('', 'NA', 'N/E', '-'):
                        continue
                    d = obs.setdefault((code, var), {})
                    if ym in d:
                        raise ValueError(f'{code} {var}: {ym} 중복')
                    d[ym] = float(v)
                    status.setdefault((code, var), {}).setdefault(r[ix['ESTATUS']].strip(), []).append(ym)
        # (2) 대화형 표(PxWeb) — 생산액·판매액(경상, 천 페소), 매월 갱신
        px_obs, px_checks, px_status, px_title = fetch_px(net, a.start)
    except BudgetExceeded:
        print(f'시간 예산 {a.max_seconds}s 소진 — 다시 실행하면 캐시에서 이어서 진행', file=sys.stderr)
        return 2
    except (ValueError, RuntimeError, KeyError, TypeError, IndexError, zipfile.BadZipFile, StopIteration,
            json.JSONDecodeError) as e:
        if not isinstance(e, RuntimeError):
            for c in list(RAW.glob('*.zip')) + list(RAW.glob('px_*.json')):
                c.unlink()
        print('FATAL', e, '— 기존 출력 보존', file=sys.stderr)
        return 1

    series = {}
    latest = None
    for code, var in WANT:
        o = obs.get((code, var), {})
        pre, en, ko, kind = VARS[var]
        sid = f'inegi_emim_{pre}_{code}'
        if len(o) < MIN_OBS:
            errors.append(f'{sid}: 관측 {len(o)}개 < {MIN_OBS} — 제외')
            continue
        keys = sorted(o)
        latest = max(latest or keys[-1], keys[-1])
        st = status.get((code, var), {})
        prelim = sorted(st.get('Cifras preliminares', []))
        notes = [f'INEGI EMIM datos abiertos {ZIP_URL.rsplit("/", 1)[1]} ({title or "metadatos 없음"}); '
                 f'SCIAN 2018 {code} {CODES[code][2]}; 변수 {var}; Índice base 2018=100, 원계열']
        if prelim:
            notes.append(f'잠정치(Cifras preliminares) {len(prelim)}개월: {prelim[0]}~{prelim[-1]}')
        notes.append('개방 파일은 비정기 갱신 — 최신 월이 늦을 수 있음(BIE API 는 토큰 필요로 미사용)')
        series[sid] = {
            'label': f'Mexico EMIM {en}, SCIAN {code} (2018=100, NSA)',
            'label_ko': f'멕시코 EMIM {CODES[code][3]} {ko} · 원계열 (2018=100)',
            'unit': 'index 2018=100',
            'seasonal_adjustment': 'NSA',
            'freq': 'M',
            'agg': 'mean',
            'kind': kind,
            'geo': 'MX',
            'scian': code,
            'release_lag_days': RELEASE_LAG,
            'source_url': 'https://www.inegi.org.mx/programas/emim/2018/#datos_abiertos',
            'notes': ' | '.join(notes),
            'obs': {k: o[k] for k in keys},
        }
    px_latest = None
    for (code, pre), o in sorted(px_obs.items()):
        en, ko, kind = next((v[1], v[2], v[3]) for v in PX_VARS.values() if v[0] == pre)
        sid = f'inegi_emim_{pre}_{code}'
        if len(o) < MIN_OBS:
            errors.append(f'{sid}: 관측 {len(o)}개 < {MIN_OBS} — 제외')
            continue
        keys = sorted(o)
        px_latest = max(px_latest or keys[-1], keys[-1])
        mi = [int(k[:4]) * 12 + int(k[5:]) for k in keys]
        holes = sum(b - c - 1 for c, b in zip(mi, mi[1:]))
        notes = [f'INEGI 대화형 표(Tabulados interactivos, PxWeb API) {PX_FILE} ({px_title[:110]}…); '
                 f'SCIAN 2018 {code} {CODES[code][2]}; Variable "{next(k for k, v in PX_VARS.items() if v[0] == pre).lstrip("-")}"; '
                 'Tipo de dato=Dato; 경상가격 천 페소(가격 효과 포함, 물량 아님); 원계열',
                 f'월 정렬 검증: 같은 요청의 Variación anual 칸과 계산 전년동월비 대조(생산액·판매액 × 3353·335312 합계 {px_checks}건), 0.06%p 초과 차이 0건',
                 'EMIM 표본은 2025년에 갱신(INEGI 2025-04 안내: 표본 틀 갱신, 설계 모수 유지) — 2025년 이후 전년비 해석 주의']
        if px_status:
            notes.append(f'INEGI 표 주석: {px_status} (최근 월은 이후 개정)')
        if holes:
            notes.append(f'중간 결측 {holes}개월(ND/NC 등 비공개 — 키 생략)')
        series[sid] = {
            'label': f'Mexico EMIM {en}, SCIAN {code} (MXN thousand, current prices, NSA)',
            'label_ko': f'멕시코 EMIM {CODES[code][3]} {ko} · 경상 천 페소 (원계열)',
            'unit': 'MXN thousand (current prices)',
            'currency': 'MXN',
            'seasonal_adjustment': 'NSA',
            'freq': 'M',
            'agg': 'sum',
            'kind': kind,
            'geo': 'MX',
            'scian': code,
            'release_lag_days': RELEASE_LAG,
            'source_url': PX_PAGE,
            'notes': ' | '.join(notes),
            'obs': {k: o[k] for k in keys},
        }
    if 'inegi_emim_ivfp_3353' not in series or 'inegi_emim_vp_335312' not in series:
        print('핵심 시리즈 inegi_emim_ivfp_3353·inegi_emim_vp_335312 누락 — 기존 출력 보존', file=sys.stderr)
        return 1
    stale_before = f'{now.year - 1:04d}-{now.month:02d}'
    if latest and latest < stale_before:
        errors.append(f'개방 파일(지수) 최신 월 {latest} — 수집 시점({now:%Y-%m}) 기준 12개월 넘게 늦음'
                      + (f' (Last-Modified {net.last_modified})' if net.last_modified else '')
                      + ': 지수 시리즈(inegi_emim_ivfp_*/ivfv_*/ipo_*)는 선후행 검정용 이력으로만 쓰고 나우캐스트에는 부적합'
                      + (f' — 최신 월({px_latest})은 PxWeb 생산액·판매액(inegi_emim_vp_*/vv_*)으로' if px_latest else ''))
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
        'fetch_tool': 'grid/composite/tools/fetch_mexico_stats.py',
        'source': {'name': 'INEGI — Encuesta Mensual de la Industria Manufacturera (EMIM, serie 2018): datos abiertos (índices nacionales) + '
                           'Tabulados interactivos EMIM_NACIONAL_0 (valores absolutos corrientes, PxWeb API)',
                   'url': ZIP_URL, 'urls': [ZIP_URL, PX_PAGE, f'{PX_API}/datatable'], 'latest_month_px': px_latest},
        'series': series,
        'errors': sorted(set(errors)),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    json.loads(tmp.read_text(encoding='utf-8'))
    os.replace(tmp, OUT)
    print(f'{OUT.relative_to(ROOT)}: {len(series)} series, latest index {latest}, latest value {px_latest}, network requests {net.n_net}, errors {len(doc["errors"])}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
