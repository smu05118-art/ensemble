#!/usr/bin/env python3
"""캐나다 통계청(Statistics Canada) 월간 제조업 조사 → data/proxies/statcan.json (grid-composite-proxy/1).

WDS REST(https://www150.statcan.gc.ca/t1/wds/rest) 로 두 표를 읽는다.
  · 16-10-0047-01 제조업 판매·신규수주·수주잔·재고(캐나다 전체)
      NAICS 335(SA·NSA), 3353·335311(전력·배전·특수 변압기)·335315(개폐기·배전반·릴레이) — 세부는 NSA 만 공표
  · 16-10-0048-01 주별 제조업 판매: 온타리오·퀘벡의 335(SA·NSA)·3353·335311(NSA)
      (Hammond Power Solutions 는 온타리오 Guelph·Walkerton 등, 퀘벡에도 공장)
시리즈 ID: statcan_mfg_<지표>_<naics>[_<주>]  — 지표 뒤 'nsa' 는 원계열, 없으면 계절조정.
  지표: sales(판매=출하), neworders(신규수주), unfilled(수주잔), inventory(총재고)
StatCan 품질 코드 F(공표 불가)·비공개로 값이 없는 달은 키를 뺀다. E(주의 요망)는 싣고 notes 에 개수를 남긴다.

규칙: 파이썬 stdlib 만 사용, https + 정확한 호스트 허용목록, 요청별 타임아웃, 429/5xx 지수 백오프,
요청 간 간격, 원자료 응답은 data/raw/statcan/ 에 캐시(--max-age-hours 이내면 재사용),
검증 실패 시 기존 출력 보존 + 종료코드 1, 시간 예산 초과 시 종료코드 2(재실행하면 이어서).

사용: python3 fetch_statcan.py [--max-seconds 480] [--max-age-hours 20] [--start 2015-01] [--offline]
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
OUT = ROOT / 'data' / 'proxies' / 'statcan.json'
RAW = ROOT / 'data' / 'raw' / 'statcan'
FAMILY = 'statcan'
ALLOWED_HOSTS = {'www150.statcan.gc.ca'}
WDS = 'https://www150.statcan.gc.ca/t1/wds/rest/'
TIMEOUT = 90
RETRIES = 5
SPACING = 1.0
UA = 'grid-composite-fetch/1 (research; stdlib urllib)'
MIN_OBS = 24
RELEASE_LAG = 45  # 7월분이 9월 14일 공표 → 약 45일

# 표별 차원 순서: 16100047 = 지역.지표.계절조정.NAICS / 16100048 = 지역.지표.계절조정.NAICS
STATS = {  # 지표 키 → (16100047 지표 memberId, 기대 이름 접두, kind, agg, 한국어, 비고)
    'sales': (1, 'Sales of goods manufactured', 'shipments', 'sum', '판매(출하)', ''),
    'neworders': (2, 'New orders', 'orders', 'sum', '신규수주', ''),
    'unfilled': (3, 'Unfilled orders', 'orders', 'last', '수주잔고(월말)', ''),
    'inventory': (7, 'Total inventory', 'production', 'last', '총재고(월말)', 'kind=production — 계약 kind 열거에 inventory 없음'),
}
NAICS_KO = {'335': '전기장비·가전·부품(NAICS 335)', '3353': '전기장비(NAICS 3353)',
            '335311': '전력·배전·특수 변압기(NAICS 335311)', '335315': '개폐기·배전반·릴레이·산업제어(NAICS 335315)'}
PROV = {'ON': ('Ontario', '온타리오'), 'QC': ('Quebec', '퀘벡')}
# (pid, stat, naics, sa(1=원계열, 2=계절조정), 지역코드 or None)
WANT = []
for _st in STATS:
    WANT.append((16100047, _st, '335', 2, None))
    for _n in ('335', '3353', '335311', '335315'):
        WANT.append((16100047, _st, _n, 1, None))
for _pv in PROV:
    WANT.append((16100048, 'sales', '335', 2, _pv))
    for _n in ('335', '3353', '335311'):
        WANT.append((16100048, 'sales', _n, 1, _pv))
TABLE_URL = {16100047: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1610004701',
             16100048: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1610004801'}
QUALITY = {3: 'A', 4: 'B', 5: 'C', 6: 'D', 7: 'E', 8: 'F'}
# 원천의 구조적 공백 — 사실 그대로 errors 에 남긴다(2026-09-25 WDS 확인).
KNOWN_GAPS = [
    '계절조정(SA) 시계열은 NAICS 335 까지만 공표 — 3353·33531·335311·335315 는 원계열(NSA)만 존재(getSeriesInfoFromCubePidCoord 가 vectorId 0 반환)',
    '16-10-0048-01 에는 캐나다 전체 행이 없음(주·준주만) — 전국 값은 16-10-0047-01 사용',
    '16-10-0048-01 은 판매(출하)만 공표 — 주별 수주·수주잔·재고 없음',
]


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

    def call(self, method, cache_name, body=None, query=None):
        cache = RAW / cache_name
        if cache.exists() and (self.offline or time.time() - cache.stat().st_mtime < self.max_age):
            return json.loads(cache.read_bytes())
        if self.offline:
            raise RuntimeError(f'offline 인데 캐시 없음: {cache_name}')
        if self.max_seconds and time.monotonic() - self.t0 > self.max_seconds:
            raise BudgetExceeded()
        url = WDS + method + (('?' + query) if query else '')
        u = urllib.parse.urlsplit(url)
        if u.scheme != 'https' or u.hostname not in ALLOWED_HOSTS:
            raise RuntimeError(f'허용되지 않은 URL: {url}')
        data = json.dumps(body).encode() if body is not None else None
        delay = 3.0
        for attempt in range(RETRIES):
            wait = SPACING - (time.monotonic() - self.last_req)
            if wait > 0:
                time.sleep(wait)
            self.last_req = time.monotonic()
            try:
                hdr = {'User-Agent': UA, 'Accept': 'application/json'}
                if data is not None:
                    hdr['Content-Type'] = 'application/json'
                req = urllib.request.Request(url, data=data, headers=hdr, method='POST' if data is not None else 'GET')
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
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
            except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
                if attempt + 1 < RETRIES:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RuntimeError(f'네트워크/응답 실패 {url}: {e}') from e
        raise RuntimeError(f'재시도 소진: {url}')


def member_maps(meta, pid):
    """cube 메타 → {차원위치: {이름/분류코드: memberId}} 와 검증."""
    if meta.get('status') != 'SUCCESS':
        raise ValueError(f'{pid}: getCubeMetadata 실패 {str(meta)[:200]}')
    o = meta['object']
    if str(o.get('productId')) != str(pid) or o.get('frequencyCode') != 6:
        raise ValueError(f'{pid}: productId/월별 불일치')
    dims = {d['dimensionPositionId']: d for d in o['dimension']}
    names = [dims[i]['dimensionNameEn'] for i in sorted(dims)]
    if names[:4] != ['Geography', 'Principal statistics', 'Seasonal adjustment',
                     'North American Industry Classification System (NAICS)']:
        raise ValueError(f'{pid}: 차원 구조 변경 {names}')
    geo = {m['memberNameEn']: m['memberId'] for m in dims[1]['member']}
    stat = {m['memberId']: m for m in dims[2]['member']}
    sadj = {m['memberId']: m['memberNameEn'] for m in dims[3]['member']}
    naics = {}
    for m in dims[4]['member']:
        code = m.get('classificationCode')
        if code and not m.get('terminated'):
            naics.setdefault(code, m['memberId'])  # 3353 과 33531 은 이름이 같으므로 코드로 찾는다
    if sadj.get(1) != 'Unadjusted' or sadj.get(2) != 'Seasonally adjusted':
        raise ValueError(f'{pid}: 계절조정 멤버 변경 {sadj}')
    return geo, stat, naics, o


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-seconds', type=float, default=480)
    ap.add_argument('--max-age-hours', type=float, default=20)
    ap.add_argument('--start', default='2015-01')
    ap.add_argument('--offline', action='store_true')
    a = ap.parse_args(argv)
    f = Fetcher(a.max_seconds, a.max_age_hours, a.offline)
    now = datetime.now(timezone.utc)
    series, errors, fatal = {}, list(KNOWN_GAPS), []
    try:
        maps = {}
        for pid in (16100047, 16100048):
            meta = f.call('getCubeMetadata', f'meta_{pid}.json', body=[{'productId': pid}])
            maps[pid] = member_maps(meta[0], pid)
        # 좌표 → 벡터
        coords = []
        for pid, st, naics, sa, prov in WANT:
            geo, stat, nmap, _ = maps[pid]
            gname = 'Canada' if prov is None else PROV[prov][0]
            if gname not in geo:
                fatal.append(f'{pid}: 지역 {gname} 없음')
                continue
            sid_member = STATS[st][0] if pid == 16100047 else 1
            m = stat.get(sid_member)
            if not m or not m['memberNameEn'].startswith(STATS[st][1]):
                fatal.append(f'{pid}: 지표 {st} 멤버 불일치 {m and m["memberNameEn"]}')
                continue
            if naics not in nmap:
                fatal.append(f'{pid}: NAICS {naics} 멤버 없음')
                continue
            coord = f'{geo[gname]}.{sid_member}.{sa}.{nmap[naics]}.0.0.0.0.0.0'
            coords.append((pid, st, naics, sa, prov, coord))
        if fatal:
            raise ValueError('메타 검증 실패')
        body = [{'productId': c[0], 'coordinate': c[5]} for c in coords]
        info = f.call('getSeriesInfoFromCubePidCoord', 'series_info.json', body=body)
        if len(info) != len(coords):
            raise ValueError(f'series info 개수 불일치 {len(info)} != {len(coords)}')
        by_coord = {}
        for r in info:
            o = r.get('object') or {}
            if r.get('status') != 'SUCCESS':
                raise ValueError(f'series info 실패 {str(r)[:200]}')
            by_coord[(int(o.get('productId')), o.get('coordinate'))] = o
        vec = {}
        for c in coords:
            o = by_coord.get((c[0], c[5]))
            if o is None:
                raise ValueError(f'series info 응답에 좌표 없음 {c}')
            if not o.get('vectorId'):
                errors.append(f'{c[0]} {c[5]} ({c[1]}/{c[2]}/{"SA" if c[3] == 2 else "NSA"}/{c[4] or "CA"}): StatCan 에 해당 시계열 없음(세부 NAICS 는 계절조정 미공표)')
                continue
            if o.get('frequencyCode') != 6 or o.get('terminated'):
                raise ValueError(f'{c}: 월별 아님/종료 {o}')
            vec[c] = o
        # 데이터: 기간 범위 조회 (GET, 벡터 25개씩)
        vids = [str(o['vectorId']) for o in vec.values()]
        start = a.start + '-01'
        end = now.strftime('%Y-%m-01')
        points = {}
        for i in range(0, len(vids), 25):
            chunk = vids[i:i + 25]
            q = ('vectorIds=' + ','.join(f'%22{v}%22' for v in chunk) +
                 f'&startRefPeriod={start}&endReferencePeriod={end}')
            res = f.call('getDataFromVectorByReferencePeriodRange', f'data_{a.start}_{i // 25}_{len(vids)}.json', query=q)
            for r in res:
                if r.get('status') != 'SUCCESS':
                    raise ValueError(f'데이터 조회 실패 {str(r)[:200]}')
                o = r['object']
                points[str(o['vectorId'])] = o.get('vectorDataPoint') or []
    except BudgetExceeded:
        print(f'시간 예산 {a.max_seconds}s 소진 — 다시 실행하면 캐시에서 이어서 진행', file=sys.stderr)
        return 2
    except (ValueError, RuntimeError, KeyError, TypeError) as e:
        if not isinstance(e, RuntimeError):  # 응답 구조 문제 → 캐시를 비워 다음 실행에 다시 받게 한다
            for c in RAW.glob('*.json'):
                c.unlink()
        for x in fatal:
            print('FATAL', x, file=sys.stderr)
        print('FATAL', e, '— 기존 출력 보존', file=sys.stderr)
        return 1

    stale_before = f'{now.year - 1:04d}-{now.month:02d}'
    for c, o in vec.items():
        pid, st, naics, sa, prov, coord = c
        vid = str(o['vectorId'])
        sid = f'statcan_mfg_{st}{"" if sa == 2 else "nsa"}_{naics}' + (f'_{prov}' if prov else '')
        obs, qual, dropped = {}, {}, []
        scalars = set()
        for p in points.get(vid, []):
            ym = p['refPer'][:7]
            if ym < a.start:
                continue
            scalars.add(p.get('scalarFactorCode'))
            if p.get('value') is None:
                dropped.append(ym)
                continue
            if not isinstance(p['value'], (int, float)):
                fatal.append(f'{sid}: {ym} 값 숫자 아님')
                break
            obs[ym] = float(p['value'])
            q = QUALITY.get(p.get('statusCode'))
            if q in ('D', 'E'):
                qual.setdefault(q, []).append(ym)
        if scalars - {3}:
            fatal.append(f'{sid}: scalarFactorCode {scalars} — 천 달러(3)가 아님')
            continue
        if len(obs) < MIN_OBS:
            errors.append(f'{sid}: 관측 {len(obs)}개 < {MIN_OBS} (비공개·F 등급) — 제외')
            continue
        keys = sorted(obs)
        if keys[-1] < stale_before:
            errors.append(f'{sid}: 최신 관측 {keys[-1]} — 12개월 넘게 갱신 없음, 제외')
            continue
        _, _, kind, agg, st_ko, st_note = STATS[st]
        notes = [f'StatCan table {str(pid)[:2]}-{str(pid)[2:4]}-{str(pid)[4:]}-01 vector v{vid}, coordinate {coord}; '
                 f'UOM Dollars, scalar thousands; {"Seasonally adjusted" if sa == 2 else "Unadjusted"}']
        if dropped:
            notes.append(f'값 없음(F 등급·비공개) {len(dropped)}개월 키 생략: ' + ', '.join(dropped[:12]) + (' …' if len(dropped) > 12 else ''))
        for qk in ('E', 'D'):
            if qual.get(qk):
                notes.append(f'품질 {qk}({"주의 요망" if qk == "E" else "수용 가능"}) {len(qual[qk])}개월')
        where_ko = '캐나다' if not prov else f'캐나다 {PROV[prov][1]}주'
        series[sid] = {
            'label': o.get('SeriesTitleEn'),
            'label_ko': f'{where_ko} {NAICS_KO[naics]} {st_ko} · {"계절조정" if sa == 2 else "원계열"}',
            'unit': 'CAD thousand',
            'seasonal_adjustment': 'SA' if sa == 2 else 'NSA',
            'freq': 'M',
            'agg': agg,
            'kind': kind,
            'geo': 'CA' if not prov else f'CA-{prov}',
            'naics': naics,
            'release_lag_days': RELEASE_LAG,
            'source_url': TABLE_URL[pid],
            'statcan_vector': f'v{vid}',
            'notes': ' | '.join(notes + ([st_note] if st_note else [])),
            'obs': {k: obs[k] for k in keys},
        }
    if fatal:
        for x in fatal:
            print('FATAL', x, file=sys.stderr)
        print('검증 실패 — 기존 출력 보존', file=sys.stderr)
        return 1
    must = ['statcan_mfg_sales_335', 'statcan_mfg_salesnsa_3353']
    if [m for m in must if m not in series]:
        print('핵심 시리즈 누락 — 기존 출력 보존', file=sys.stderr)
        return 1
    try:
        old = json.loads(OUT.read_text(encoding='utf-8'))
        for sid in sorted(set(old.get('series', {})) - set(series)):
            errors.append(f'{sid}: 직전 출력에 있었으나 이번에 수집 안 됨')
    except (OSError, json.JSONDecodeError):
        pass
    rel = {pid: maps[pid][3].get('releaseTime') for pid in maps}
    doc = {
        'schema': 'grid-composite-proxy/1',
        'family': FAMILY,
        'fetched_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'fetch_tool': 'grid/composite/tools/fetch_statcan.py',
        'source': {'name': 'Statistics Canada Web Data Service — Monthly Survey of Manufacturing (tables 16-10-0047-01, 16-10-0048-01)',
                   'url': WDS, 'release_time': {str(k): v for k, v in rel.items()}},
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
