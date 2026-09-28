#!/usr/bin/env python3
"""일본 경제산업성 생산동태통계(METI 生産動態統計) + JEMA 중전기기 수주 → data/proxies/japan_stats.json.

(1) METI 生産動態統計 機械器具月報
    · 조사표 2290 静止電気機械器具: 변압기 품목 0101~0112 (생산 수량·용량 kVA·금액 백만엔, 표준품은 판매·재고도)
    · 조사표 2300 開閉制御装置: 품목 0101~0107 (GIS·특고압/고압 배전반·저압 배전반·분전반·감시제어·기타)
    원자료(모두 METI 공식 게시 파일, 파이썬 stdlib 로 직접 파싱):
      2015~2020  年報 機械統計編 時系列表 h2dcd{YYYY}khc2.xls (BIFF8 — OLE2/BIFF 파서 내장)
      2021~      年報 h2daa{YYYY}k.xlsx '実数表'(월별 열)
      전년 연간보정 h2daa{YYYY}_hosei_jikei.xlsx, 당해 확보(確報) h2daa{YYYYMM}_jikei.xlsx
      참고 시계열 h2daakhc_sanko.xlsx(최근 61개월) — 겹치는 달은 연보와 대조만(우선순위 최하)
    시리즈(합계 = 같은 달 공표 품목값의 합, 한 품목이라도 비공개 'X'·불명이면 그 달은 생략):
      meti_transformer_prod_value   변압기 계(품목 1~12, METI 年報 '変圧器(1～12)' 정의) 생산금액
      meti_transformer_prod_kva     변압기(품목 1~10, 용량 있는 품목) 생산용량 kVA
      meti_transformer_std_*        표준 변압기(1~3: 주상·패드 등 배전용) 생산금액·용량·판매금액·월말재고
      meti_transformer_utility_prod_kva  표준 유입(전력회사용, 1) 생산용량
      meti_transformer_nonstd_*     비표준(4~10: 전력용·특수 설계) 생산금액·용량
      meti_transformer_large_*      비표준 유입 10,000kVA 이상(6~7: 대형 전력용) 생산금액·용량
      meti_switchgear_prod_value    開閉制御装置 계(2300 품목 1~7) 생산금액
      meti_gis_prod_value / meti_hv_switchboard_prod_value  GIS / 특고압·고압 배전반 생산금액
    링크계수(リンク係数, 조사대상 변경에 따른 단층)는 적용하지 않고 notes 에 날짜·값을 남긴다.
(2) JEMA(일본전기공업회) 重電機器受注生産品 受注実績(분기, 회계연도 4월 시작) — 공개 xlsx
      jema_orders_{transformer,breaker,switchgear,total,utility,export}_q  (freq=Q, 달력 분기 키)
    2020년도 1분기(2020-04~06)부터만 공개. 빌더가 월별만 읽는다면 참고용.

규칙: 파이썬 stdlib 만 사용, https + 정확한 호스트 허용목록, 요청별 타임아웃, 429/5xx 지수 백오프,
요청 간 간격, 원자료는 data/raw/japan_stats/ 에 캐시(연보는 불변 캐시, 나머지는 --max-age-hours),
검증 실패 시 기존 출력 보존 + 종료코드 1, 시간 예산 초과 시 종료코드 2(재실행하면 이어서).
METI 는 기본 UA 에 403 을 주므로 'Mozilla/5.0 (compatible; …)' 형식의 식별 가능한 UA 를 쓴다.

사용: python3 fetch_japan_stats.py [--max-seconds 480] [--max-age-hours 20] [--start 2015-01] [--offline]
"""
import argparse
import io
import json
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAMILY = 'japan_stats'
OUT = ROOT / 'data' / 'proxies' / f'{FAMILY}.json'
RAW = ROOT / 'data' / 'raw' / FAMILY
ALLOWED_HOSTS = {'www.meti.go.jp', 'www.jema-net.or.jp'}
METI_ICHIRAN = 'https://www.meti.go.jp/statistics/tyo/seidou/result/ichiran/'
METI_INDEX = METI_ICHIRAN + '08_seidou.html'
METI_OLD_INDEX = METI_ICHIRAN + 'nenpo_2007-2020.html'
JEMA_PAGE = 'https://www.jema-net.or.jp/stat/demand.html'
TIMEOUT = 120
RETRIES = 5
SPACING = 1.5
UA = 'Mozilla/5.0 (compatible; grid-composite-fetch/1; research; stdlib urllib)'
MIN_OBS = 24
MIN_OBS_Q = 12
RELEASE_LAG = 45       # 確報: 7월분이 9월 14일 → 약 45일
RELEASE_LAG_JEMA = 25  # 4~6월분이 7월 23일

# ─────────────────────────── 시리즈 정의 ───────────────────────────
T_ITEMS = [f'{i:04d}' for i in range(101, 113)]  # 2290 0101~0112
SERIES = {
    # id: (조사표, 품목 목록, 아이템 기호, unit, agg, 영문 라벨, 한국어 라벨)
    'meti_transformer_prod_value': ('2290', T_ITEMS, 'C', 'JPY million', 'sum',
                                    'Japan transformer production value, all transformers (METI items 1-12)',
                                    '일본 변압기 생산금액 · 전체(METI 품목 1~12, 계기용 변성기 포함)'),
    'meti_transformer_prod_kva': ('2290', T_ITEMS[:10], 'B', 'kVA', 'sum',
                                  'Japan transformer production capacity, power & distribution transformers (items 1-10)',
                                  '일본 변압기 생산용량 kVA · 전력·배전용(품목 1~10)'),
    'meti_transformer_std_prod_value': ('2290', T_ITEMS[:3], 'C', 'JPY million', 'sum',
                                        'Japan standard (distribution) transformer production value (items 1-3)',
                                        '일본 표준 변압기(배전용 유입·몰드, 품목 1~3) 생산금액'),
    'meti_transformer_std_prod_kva': ('2290', T_ITEMS[:3], 'B', 'kVA', 'sum',
                                      'Japan standard (distribution) transformer production capacity (items 1-3)',
                                      '일본 표준 변압기(배전용, 품목 1~3) 생산용량 kVA'),
    'meti_transformer_std_sales_value': ('2290', T_ITEMS[:3], 'G', 'JPY million', 'sum',
                                         'Japan standard (distribution) transformer sales value (items 1-3)',
                                         '일본 표준 변압기(배전용, 품목 1~3) 판매(출하)금액'),
    'meti_transformer_std_inventory_units': ('2290', T_ITEMS[:3], 'H', 'units', 'last',
                                             'Japan standard (distribution) transformer month-end inventory (items 1-3)',
                                             '일본 표준 변압기(배전용, 품목 1~3) 월말 재고 대수'),
    'meti_transformer_utility_prod_kva': ('2290', T_ITEMS[:1], 'B', 'kVA', 'sum',
                                          'Japan standard oil-immersed transformers for electric utilities, production capacity (item 1)',
                                          '일본 표준 유입 변압기(전력회사용, 품목 1) 생산용량 kVA'),
    'meti_transformer_nonstd_prod_value': ('2290', T_ITEMS[3:10], 'C', 'JPY million', 'sum',
                                           'Japan non-standard (power) transformer production value (items 4-10)',
                                           '일본 비표준(전력용) 변압기(품목 4~10) 생산금액'),
    'meti_transformer_nonstd_prod_kva': ('2290', T_ITEMS[3:10], 'B', 'kVA', 'sum',
                                         'Japan non-standard (power) transformer production capacity (items 4-10)',
                                         '일본 비표준(전력용) 변압기(품목 4~10) 생산용량 kVA'),
    'meti_transformer_large_prod_value': ('2290', T_ITEMS[5:7], 'C', 'JPY million', 'sum',
                                          'Japan oil-immersed power transformers >=10,000 kVA, production value (items 6-7)',
                                          '일본 대형 유입 변압기(10,000kVA 이상, 품목 6~7) 생산금액'),
    'meti_transformer_large_prod_kva': ('2290', T_ITEMS[5:7], 'B', 'kVA', 'sum',
                                        'Japan oil-immersed power transformers >=10,000 kVA, production capacity (items 6-7)',
                                        '일본 대형 유입 변압기(10,000kVA 이상, 품목 6~7) 생산용량 kVA'),
    'meti_switchgear_prod_value': ('2300', [f'{i:04d}' for i in range(101, 108)], 'B', 'JPY million', 'sum',
                                   'Japan switchgear & controlling equipment production value (METI 2300 items 1-7)',
                                   '일본 개폐제어장치(GIS·배전반·분전반·감시제어 등, 품목 1~7) 생산금액'),
    'meti_gis_prod_value': ('2300', ['0101'], 'B', 'JPY million', 'sum',
                            'Japan gas-insulated switchgear production value (METI 2300 item 1)',
                            '일본 가스절연개폐장치(GIS) 생산금액'),
    'meti_hv_switchboard_prod_value': ('2300', ['0102'], 'B', 'JPY million', 'sum',
                                       'Japan extra-high / high-voltage switchboard production value (METI 2300 item 2)',
                                       '일본 특고압·고압 배전반 생산금액'),
}
# 품목명 검증(부분 문자열) — 연보 xlsx·확보·참고 시계열 모두 이 키워드를 포함해야 한다
ITEM_KEYWORDS = {
    ('2290', '0101'): ('変圧器', '電力会社'), ('2290', '0102'): ('変圧器', '以外'), ('2290', '0103'): ('モールド',),
    ('2290', '0104'): ('変圧器', '２０００'), ('2290', '0105'): ('変圧器', '２００１'), ('2290', '0106'): ('変圧器', '１００００'),
    ('2290', '0107'): ('変圧器', '１０００００'), ('2290', '0108'): ('モールド', '２０００'), ('2290', '0109'): ('モールド', '２００１'),
    ('2290', '0110'): ('乾式',), ('2290', '0111'): ('特殊用途',), ('2290', '0112'): ('変成器',),
    ('2300', '0101'): ('ガス絶縁',), ('2300', '0102'): ('高圧', '配電盤'), ('2300', '0103'): ('低圧配電盤',),
    ('2300', '0104'): ('産業用分電盤',), ('2300', '0105'): ('住宅用分電盤',), ('2300', '0106'): ('監視制御',),
    ('2300', '0107'): ('その他', '開閉制御'),
}
# 구 연보(xls) 잎 라벨 키워드(마커 번호 → 품목)
OLD_KEYWORDS = {
    ('2290', '0101'): ('電力会社向',), ('2290', '0102'): ('電力会社向以外',), ('2290', '0103'): ('モールド',),
    ('2290', '0104'): ('2,000kVA以下',), ('2290', '0105'): ('2,001kVA以上', '10,000kVA未満'),
    ('2290', '0106'): ('10,000kVA以上', '100,000kVA未満'), ('2290', '0107'): ('100,000kVA以上',),
    ('2290', '0108'): ('2,000kVA以下',), ('2290', '0109'): ('2,001kVA以上',), ('2290', '0110'): ('その他の乾式',),
    ('2290', '0111'): ('特殊用途',), ('2290', '0112'): ('計器用変成器',),
    ('2300', '0101'): ('ガス絶縁',), ('2300', '0102'): ('特別高圧・高圧配電盤',), ('2300', '0103'): ('低圧配電盤',),
    ('2300', '0104'): ('産業用分電盤',), ('2300', '0105'): ('住宅用分電盤',), ('2300', '0106'): ('監視制御',),
    ('2300', '0107'): ('その他の開閉制御',),
}
# 구 연보(xls) 열 → 통일 아이템 기호
OLD_SYM = {
    '2290': {('生産', '数量'): 'A', ('生産', '容量'): 'B', ('生産', '金額'): 'C', ('受入', '数量'): 'D',
             ('販売', '数量'): 'E', ('販売', '容量'): 'F', ('販売', '金額'): 'G', ('在庫', '数量'): 'H'},
    '2300': {('生産', '数量'): 'A', ('生産', '金額'): 'B'},
}
OLD_SHEET = {'29': '2290', '30': '2300'}
# 구 연보 공표 합계(검증용): (조사표, 마커, 기호) → 합산할 품목
OLD_CHECKS = {
    ('2290', '1-12', 'C'): T_ITEMS, ('2290', '1-3', 'B'): T_ITEMS[:3], ('2290', '1-3', 'C'): T_ITEMS[:3],
    ('2290', '4-10', 'B'): T_ITEMS[3:10], ('2290', '4-10', 'C'): T_ITEMS[3:10], ('2290', '6-7', 'B'): T_ITEMS[5:7],
    ('2300', '1-7', 'B'): [f'{i:04d}' for i in range(101, 108)],
}
JEMA_SERIES = {
    # id: (시트, 행 라벨 열, 라벨 접두, 영문, 한국어)
    'jema_orders_transformer_q': ('製品別_四半期別', 1, '変圧器', 'JEMA heavy electrical equipment orders: transformers',
                                  'JEMA 중전기기 수주액 · 변압기'),
    'jema_orders_breaker_q': ('製品別_四半期別', 1, '遮断器', 'JEMA heavy electrical equipment orders: circuit breakers',
                              'JEMA 중전기기 수주액 · 차단기'),
    'jema_orders_switchgear_q': ('製品別_四半期別', 1, '配電装置', 'JEMA heavy electrical equipment orders: switchgear (distribution equipment)',
                                 'JEMA 중전기기 수주액 · 배전장치'),
    'jema_orders_total_q': ('需要者別_四半期別', 0, '受注額合計', 'JEMA heavy electrical equipment orders: total',
                            'JEMA 중전기기 수주액 · 합계'),
    'jema_orders_utility_q': ('需要者別_四半期別', 3, '電力業', 'JEMA heavy electrical equipment orders: electric utilities',
                              'JEMA 중전기기 수주액 · 전력업(전력회사)'),
    'jema_orders_export_q': ('需要者別_四半期別', 0, '外需', 'JEMA heavy electrical equipment orders: exports',
                             'JEMA 중전기기 수주액 · 외수(수출)'),
}


class BudgetExceeded(Exception):
    pass


# ─────────────────────────── 네트워크 ───────────────────────────
class Net:
    def __init__(self, max_seconds, max_age_hours, offline):
        self.t0 = time.monotonic()
        self.max_seconds = max_seconds
        self.max_age = max_age_hours * 3600
        self.offline = offline
        self.last = 0.0
        self.n_net = 0

    def get(self, url, cache_name, immutable=False):
        cache = RAW / cache_name
        if cache.exists() and (self.offline or immutable or time.time() - cache.stat().st_mtime < self.max_age):
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
                req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'ja,en;q=0.8'})
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


# ─────────────────────────── xlsx (stdlib) ───────────────────────────
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
NSR = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
NSPR = '{http://schemas.openxmlformats.org/package/2006/relationships}'


def _col(ref):
    n = 0
    for ch in ref:
        if 'A' <= ch <= 'Z':
            n = n * 26 + ord(ch) - 64
        else:
            break
    return n - 1


def _si_text(si):
    """공유 문자열 1건 — 후리가나(rPh)는 빼고 본문(t, r/t)만."""
    out = []
    for ch in si:
        if ch.tag == NS + 't':
            out.append(ch.text or '')
        elif ch.tag == NS + 'r':
            t = ch.find(NS + 't')
            if t is not None:
                out.append(t.text or '')
    return ''.join(out)


class Xlsx:
    def __init__(self, data):
        self.z = zipfile.ZipFile(io.BytesIO(data))
        self.ss = []
        if 'xl/sharedStrings.xml' in self.z.namelist():
            for _, el in ET.iterparse(self.z.open('xl/sharedStrings.xml')):
                if el.tag == NS + 'si':
                    self.ss.append(_si_text(el))
                    el.clear()
        wb = ET.fromstring(self.z.read('xl/workbook.xml'))
        rels = ET.fromstring(self.z.read('xl/_rels/workbook.xml.rels'))
        rmap = {r.get('Id'): r.get('Target') for r in rels.iter(NSPR + 'Relationship')}
        self.sheets = {}
        for s in wb.iter(NS + 'sheet'):
            t = rmap[s.get(NSR + 'id')].lstrip('/')
            self.sheets[s.get('name').strip()] = t if t.startswith('xl/') else 'xl/' + t

    def rows(self, name, keep=None, head=6):
        """{행번호: {열: 문자열}} — keep(첫 열 값 집합)이 있으면 머리 head 행 + 첫 열이 keep 인 행만."""
        out = {}
        for _, el in ET.iterparse(self.z.open(self.sheets[name])):
            if el.tag != NS + 'row':
                continue
            r = int(el.get('r'))
            row = {}
            for c in el.findall(NS + 'c'):
                t = c.get('t')
                v = c.find(NS + 'v')
                if t == 's' and v is not None:
                    val = self.ss[int(v.text)]
                elif t == 'inlineStr':
                    val = ''.join(x.text or '' for x in c.iter(NS + 't'))
                elif v is not None:
                    val = v.text or ''
                else:
                    continue
                row[_col(c.get('r'))] = val
            el.clear()
            if keep is None or r <= head or str(row.get(0, '')).strip() in keep:
                out[r] = row
        return out


# ─────────────────────────── xls BIFF8 (stdlib) ───────────────────────────
CFB_MAGIC = b'\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1'
ENDCHAIN = 0xFFFFFFFA


def cfb_stream(data, names=('Workbook', 'Book')):
    if data[:8] != CFB_MAGIC:
        raise ValueError('OLE2(CFB) 서명 아님')
    ssz = 1 << struct.unpack_from('<H', data, 30)[0]
    mssz = 1 << struct.unpack_from('<H', data, 32)[0]
    n_fat, dir_start = struct.unpack_from('<II', data, 44)
    mini_cutoff, minifat_start, n_minifat, difat_start, n_difat = struct.unpack_from('<IIIII', data, 56)
    difat = list(struct.unpack_from('<109I', data, 76))
    per = ssz // 4
    s = difat_start
    for _ in range(n_difat):
        if s >= ENDCHAIN:
            break
        ent = struct.unpack_from(f'<{per}I', data, (s + 1) * ssz)
        difat.extend(ent[:-1])
        s = ent[-1]
    fat = []
    for sec in difat[:n_fat]:
        fat.extend(struct.unpack_from(f'<{per}I', data, (sec + 1) * ssz))

    def chain(start, table, read, size):
        out, seen, s = [], set(), start
        while s < ENDCHAIN:
            if s in seen or s >= len(table):
                raise ValueError('CFB 체인 손상')
            seen.add(s)
            out.append(read(s))
            s = table[s]
        b = b''.join(out)
        return b[:size] if size is not None else b

    def sec(i):
        return data[(i + 1) * ssz:(i + 2) * ssz]

    dirs = chain(dir_start, fat, sec, None)
    entries = []
    for off in range(0, len(dirs) - 127, 128):
        nlen = struct.unpack_from('<H', dirs, off + 64)[0]
        entries.append((dirs[off:off + max(0, nlen - 2)].decode('utf-16le', 'replace'), dirs[off + 66],
                        *struct.unpack_from('<II', dirs, off + 116)))
    root = next(e for e in entries if e[1] == 5)
    for want in names:
        for name, typ, start, size in entries:
            if typ == 2 and name == want:
                if size < mini_cutoff:
                    mf = chain(minifat_start, fat, sec, None) if n_minifat else b''
                    minifat = list(struct.unpack_from(f'<{len(mf) // 4}I', mf, 0))
                    ms = chain(root[2], fat, sec, root[3])
                    return chain(start, minifat, lambda i: ms[i * mssz:(i + 1) * mssz], size)
                return chain(start, fat, sec, size)
    raise ValueError(f'스트림 없음 {names}')


def _rk(v):
    if v & 2:
        num = float(struct.unpack('<i', struct.pack('<I', v & 0xFFFFFFFC))[0] >> 2)
    else:
        num = struct.unpack('<d', struct.pack('<Q', (v & 0xFFFFFFFC) << 32))[0]
    return num / 100.0 if v & 1 else num


def _sst(parts):
    pi, pos = 0, 0

    def take(n):
        nonlocal pi, pos
        out = b''
        while n > 0:
            if pos >= len(parts[pi]):
                pi += 1
                pos = 0
            k = min(n, len(parts[pi]) - pos)
            out += parts[pi][pos:pos + k]
            pos += k
            n -= k
        return out

    take(4)
    n = struct.unpack('<I', take(4))[0]
    out = []
    for _ in range(n):
        if pos >= len(parts[pi]):
            pi += 1
            pos = 0
        nch = struct.unpack('<H', take(2))[0]
        opt = take(1)[0]
        rt = struct.unpack('<H', take(2))[0] if opt & 0x08 else 0
        ph = struct.unpack('<I', take(4))[0] if opt & 0x04 else 0
        s, got = [], 0
        while True:
            d = parts[pi]
            avail = len(d) - pos
            if opt & 0x01:
                k = min(avail // 2, nch - got)
                s.append(d[pos:pos + 2 * k].decode('utf-16le', 'replace'))
                pos += 2 * k
            else:
                k = min(avail, nch - got)
                s.append(d[pos:pos + k].decode('latin-1'))
                pos += k
            got += k
            if got >= nch:
                break
            pi += 1
            opt = (opt & ~0x01) | (parts[pi][0] & 0x01)
            pos = 1
        if rt:
            take(4 * rt)
        if ph:
            take(ph)
        out.append(''.join(s))
    return out


def _xlstr(b, off, lenbytes):
    n = struct.unpack_from('<H' if lenbytes == 2 else '<B', b, off)[0]
    off += lenbytes
    flags = b[off]
    off += 1
    if flags & 0x08:
        off += 2
    if flags & 0x04:
        off += 4
    if flags & 0x01:
        return b[off:off + 2 * n].decode('utf-16le', 'replace')
    return b[off:off + n].decode('latin-1')


def read_xls(data):
    """BIFF8 .xls → {시트명: {(행, 열): str|float}} (수식은 캐시된 결과)."""
    wb = cfb_stream(data)
    recs, pos = [], 0
    while pos + 4 <= len(wb):
        rt, ln = struct.unpack_from('<HH', wb, pos)
        recs.append((pos, rt, wb[pos + 4:pos + 4 + ln]))
        pos += 4 + ln
    if not recs or recs[0][1] != 0x0809 or struct.unpack_from('<H', recs[0][2], 0)[0] != 0x0600:
        raise ValueError('BIFF8 아님')
    idx = {p: k for k, (p, _, _) in enumerate(recs)}
    sheets, sst, k = [], [], 0
    while k < len(recs):
        _, rt, b = recs[k]
        if rt == 0x0085 and b[5] == 0:
            sheets.append((_xlstr(b, 6, 1), struct.unpack_from('<I', b, 0)[0]))
        elif rt == 0x00FC:
            parts = [b]
            while k + 1 < len(recs) and recs[k + 1][1] == 0x003C:
                k += 1
                parts.append(recs[k][2])
            sst = _sst(parts)
        elif rt == 0x000A:
            break
        k += 1
    out = {}
    for name, off in sheets:
        cells, k, pending = {}, idx[off], None
        while k < len(recs):
            _, rt, b = recs[k]
            if rt == 0x000A:
                break
            if rt == 0x00FD:
                r, c, _, i = struct.unpack_from('<HHHI', b, 0)
                cells[(r, c)] = sst[i]
            elif rt == 0x0203:
                r, c, _, v = struct.unpack_from('<HHHd', b, 0)
                cells[(r, c)] = v
            elif rt == 0x027E:
                r, c, _, v = struct.unpack_from('<HHHI', b, 0)
                cells[(r, c)] = _rk(v)
            elif rt == 0x00BD:
                r, c0 = struct.unpack_from('<HH', b, 0)
                for j in range((len(b) - 6) // 6):
                    cells[(r, c0 + j)] = _rk(struct.unpack_from('<I', b, 4 + 6 * j + 2)[0])
            elif rt == 0x0204:
                r, c, _ = struct.unpack_from('<HHH', b, 0)
                cells[(r, c)] = _xlstr(b, 6, 2)
            elif rt == 0x0006:
                r, c, _ = struct.unpack_from('<HHH', b, 0)
                res = b[6:14]
                if res[6:8] == b'\xff\xff':
                    pending = (r, c) if res[0] == 0 else None
                else:
                    cells[(r, c)] = struct.unpack('<d', res)[0]
            elif rt == 0x0207 and pending:
                cells[pending] = _xlstr(b, 0, 2)
                pending = None
            k += 1
        out[name] = cells
    return out


# ─────────────────────────── 값 해석 ───────────────────────────
ZEN = str.maketrans('０１２３４５６７８９～', '0123456789-')


def cell_value(v):
    """숫자면 (float, None), 아니면 (None, 사유)."""
    if isinstance(v, float):
        return v, None
    s = str(v).strip().replace(',', '')
    if s in ('-', '－', '―', '‐'):
        return 0.0, None  # 구 연보 '-' = 実績なし(xlsx 형식은 같은 경우 '0' 으로 표기)
    if s in ('X', 'x', 'Ｘ', 'ｘ'):
        return None, 'X(秘匿)'
    if s.startswith('***') or s == '＊＊＊':
        return None, '***(不詳)'
    if s == '':
        return None, 'blank'
    try:
        return float(s), None
    except ValueError:
        return None, f'비숫자 {s[:10]}'


def parse_old_yearbook(data, year):
    """구 연보(機械統計編 時系列表 xls) 시트 29·30 → {(조사표, 마커, 기호): {YYYY-MM: (값, 사유)}}, 품목명."""
    wb = read_xls(data)
    out, names = {}, {}
    for sheet, form in OLD_SHEET.items():
        if sheet not in wb:
            raise ValueError(f'{year}: 시트 {sheet} 없음')
        cells = wb[sheet]
        rows = {}
        for (r, c), v in cells.items():
            rows.setdefault(r, {})[c] = v
        act_row = next((r for r in sorted(rows) if r < 15 and any(str(v).strip() == '生産(P)' for v in rows[r].values())), None)
        mea_row = next((r for r in sorted(rows) if r < 15 and any(str(v).startswith('金額(') for v in rows[r].values())), None)
        if act_row is None or mea_row is None:
            raise ValueError(f'{year}/{sheet}: 머리 행(生産(P)/金額) 없음')
        ym_cols = sorted({c for r in rows if r <= mea_row for c, v in rows[r].items() if str(v).strip() == '年　　月'})
        if not ym_cols:
            raise ValueError(f'{year}/{sheet}: 年月 열 없음')
        markers = {}
        for r in rows:
            if r >= act_row:
                continue
            for c, v in rows[r].items():
                m = re.fullmatch(r'\s*[（(]([０-９0-9～~]+)[）)]\s*', str(v))
                if m:
                    if c in markers:
                        raise ValueError(f'{year}/{sheet}: 열 {c} 마커 중복')
                    markers[c] = m.group(1).translate(ZEN).replace('~', '-')
        ncol = max(c for r in rows for c in rows[r]) + 1
        # 품목 묶음의 시작 열 = 마커 열 이하에서 가장 가까운 '生産' 열(年月 열을 넘지 않음).
        # (2015 연보는 품목명·마커를 묶음 가운데 열에 적어 두어 마커 열 ≠ 시작 열)
        act_cols = sorted(c for c, v in rows.get(act_row, {}).items() if str(v).strip().startswith('生産'))
        starts = {}
        for cm, mk in markers.items():
            cands = [ac for ac in act_cols if ac <= cm and not any(ac < yc <= cm for yc in ym_cols)]
            if not cands:
                raise ValueError(f'{year}/{sheet}: 마커 {mk}(열 {cm}) 의 生産 시작 열 없음')
            if max(cands) in starts:
                raise ValueError(f'{year}/{sheet}: 시작 열 {max(cands)} 에 마커 {starts[max(cands)]}·{mk} 충돌')
            starts[max(cands)] = mk
        colkey, cur_m, cur_a = {}, None, None
        for c in range(ncol):
            if c in ym_cols:
                cur_m = cur_a = None
                continue
            if c in act_cols:
                cur_m, cur_a = starts.get(c), None
            a = str(rows.get(act_row, {}).get(c, '')).strip()
            if a:
                cur_a = a.split('(')[0]
            meas = str(rows.get(mea_row, {}).get(c, '')).strip()
            if cur_m and cur_a and meas:
                sym = OLD_SYM[form].get((cur_a, meas.split('(')[0]))
                if sym:
                    if (cur_m, sym) in colkey.values():
                        raise ValueError(f'{year}/{sheet}: ({cur_m},{sym}) 열 중복')
                    colkey[c] = (cur_m, sym)
            if c in markers:
                label = ' '.join(str(rows.get(r, {}).get(c, '')).strip() for r in range(0, act_row))
                names[(form, markers[c])] = re.sub(r'\s+', ' ', label).strip()
        lab = ym_cols[0] + 1
        month_rows = {}
        yr_seen = None
        for r in sorted(rows):
            if r <= mea_row:
                continue
            y = str(rows[r].get(ym_cols[0], ''))
            my = re.search(r'(\d{4})\s*年', y) or re.search(r'平成\s*(\d+)\s*年', y)
            if my:
                yr_seen = int(my.group(1)) + (1988 if '平成' in y and len(my.group(1)) <= 2 else 0)
            m = re.match(r'^\s*(\d{1,2})\s*(月)?\s*\(', str(rows[r].get(lab, '')))
            if m:
                mo = int(m.group(1))
                if yr_seen != year:
                    raise ValueError(f'{year}/{sheet}: 월 행 {r} 의 연도 {yr_seen} 불일치')
                if mo in month_rows.values():
                    raise ValueError(f'{year}/{sheet}: {mo}월 행 중복')
                month_rows[r] = mo
                for yc in ym_cols[1:]:
                    other = str(rows[r].get(yc + 1, '')).strip()
                    if other and not other.startswith(str(rows[r].get(lab, '')).strip()[:2].strip()):
                        raise ValueError(f'{year}/{sheet}: 쪽 {yc} 월 라벨 불일치 {other!r}')
        if sorted(month_rows.values()) != list(range(1, 13)):
            raise ValueError(f'{year}/{sheet}: 월 행 12개 아님 {sorted(month_rows.values())}')
        for c, (mk, sym) in colkey.items():
            d = out.setdefault((form, mk, sym), {})
            for r, mo in month_rows.items():
                if c in rows[r]:
                    d[f'{year:04d}-{mo:02d}'] = cell_value(rows[r][c])
    return out, names


def parse_unified(data, sheet_names, forms):
    """통일 형식(연보 xlsx·확보 jikei·참고 sanko) → ({(조사표, 품목, 기호): {YYYY-MM: (값, 사유)}}, 품목명, 링크계수)."""
    x = Xlsx(data)
    real = next((n for n in sheet_names if n in x.sheets), None)
    if not real:
        raise ValueError(f'시트 {sheet_names} 없음 (있는 시트 {list(x.sheets)[:8]})')
    link_name = next((n for n in x.sheets if n in ('リンク係数表', '参考_リンク係数表')), None)
    res = {}
    for which, nm in (('data', real), ('link', link_name)):
        if nm is None:
            continue
        rows = x.rows(nm, keep=set(forms))
        hr = next((r for r in sorted(rows) if r <= 6 and str(rows[r].get(0, '')).startswith('調査票番号')), None)
        if hr is None:
            raise ValueError(f'{nm}: 머리 행(調査票番号) 없음')
        hdr, code = rows[hr], rows.get(hr - 1, {})
        cols = {}
        name_col = next((c for c, v in hdr.items() if str(v).startswith('品目名')), None)
        for c in set(hdr) | set(code):
            m = re.fullmatch(r'(\d{4})00(\d{2})(\d{2})', str(code.get(c, '')).strip())
            if m and m.group(2) == m.group(3) and 1 <= int(m.group(2)) <= 12:
                cols[c] = f'{m.group(1)}-{m.group(2)}'
                continue
            m = re.fullmatch(r'(\d{4})(\d{2})', str(hdr.get(c, '')).strip())
            if m and 1 <= int(m.group(2)) <= 12 and c >= 3:
                cols[c] = f'{m.group(1)}-{m.group(2)}'
        if which == 'data' and (not cols or name_col is None):
            raise ValueError(f'{nm}: 월 열/품목명 열 없음')
        table, names = {}, {}
        for r, row in rows.items():
            if r <= hr or str(row.get(0, '')).strip() not in forms:
                continue
            key = (row[0].strip(), str(row.get(1, '')).strip(), str(row.get(2, '')).strip())
            if name_col is not None:
                names[key[:2]] = str(row.get(name_col, '')).strip()
            d = table.setdefault(key, {})
            for c, ym in cols.items():
                if c in row:
                    d[ym] = cell_value(row[c])
        res[which] = (table, names)
    table, names = res['data']
    links = {}
    if 'link' in res:
        for key, d in res['link'][0].items():
            for ym, (v, _) in d.items():
                if v is not None and v != 0:
                    links.setdefault(key, {})[ym] = v
    return table, names, links


# ─────────────────────────── JEMA ───────────────────────────
Q_ROMAN = {'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4}


def parse_jema(data):
    """JEMA 受注実績 xlsx → {series id: {YYYYQn(달력): 값}}. 회계 1분기(4~6월) = 달력 2분기."""
    x = Xlsx(data)
    out = {}
    for sid, (sheet, lcol, label, _, _) in JEMA_SERIES.items():
        if sheet not in x.sheets:
            raise ValueError(f'JEMA 시트 {sheet} 없음')
        rows = x.rows(sheet)
        fy_row, q_row, h_row = rows.get(1, {}), rows.get(2, {}), rows.get(3, {})
        fys = {c: int(m.group(1)) for c, v in fy_row.items() if (m := re.match(r'(\d{4})年度', str(v).strip()))}
        if not fys:
            raise ValueError(f'JEMA {sheet}: 年度 머리 없음')
        target = [r for r, row in rows.items() if r > 3 and str(row.get(lcol, '')).strip().startswith(label)]
        if len(target) != 1:
            raise ValueError(f'JEMA {sheet}: 행 {label} 을 {len(target)}개 찾음')
        row = rows[target[0]]
        d = out.setdefault(sid, {})
        for c, v in h_row.items():
            if not str(v).startswith('金額'):
                continue
            fy = fys.get(max((k for k in fys if k <= c), default=-1))
            qm = re.search(r'第([ⅠⅡⅢⅣ])四半期', str(q_row.get(c, '')))
            if fy is None or not qm:
                raise ValueError(f'JEMA {sheet}: 열 {c} 연도/분기 판별 실패')
            fq = Q_ROMAN[qm.group(1)]
            y, q = (fy, fq + 1) if fq < 4 else (fy + 1, 1)
            val, why = cell_value(row.get(c, ''))
            if val is not None:
                d[f'{y}Q{q}'] = val
    return out


# ─────────────────────────── 본체 ───────────────────────────
def discover(html, pattern):
    return sorted(set(re.findall(pattern, html)))


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-seconds', type=float, default=480)
    ap.add_argument('--max-age-hours', type=float, default=20)
    ap.add_argument('--start', default='2015-01')
    ap.add_argument('--offline', action='store_true')
    a = ap.parse_args(argv)
    net = Net(a.max_seconds, a.max_age_hours, a.offline)
    now = datetime.now(timezone.utc)
    start_year = int(a.start[:4])
    errors, fatal, notes_global = [], [], {}
    forms = ('2290', '2300')
    layers = []  # (우선순위, 출처 태그, URL, {key: {ym: (v, why)}})
    all_names, old_names, all_links, old_checks = {}, {}, {}, []
    jema = {}
    jema_files = []
    try:
        idx = net.get(METI_INDEX, 'meti_08_seidou.html').decode('utf-8', 'replace')
        old_idx = net.get(METI_OLD_INDEX, 'meti_nenpo_2007-2020.html').decode('utf-8', 'replace')
        kakuho = discover(idx, r'resourceData/08_seidou/kakuho/\d{4,6}/h2daa(\d{6})_jikei\.xlsx')
        if not kakuho:
            raise ValueError('METI 목록에서 확보(確報) 時系列 xlsx 링크를 찾지 못함')
        latest = max(kakuho)
        k_url = re.search(rf'resourceData/08_seidou/kakuho/\d{{4,6}}/h2daa{latest}_jikei\.xlsx', idx).group(0)
        hosei = discover(idx, r'(resourceData/08_seidou/kakuho/\d{4}/h2daa(\d{4})_hosei_jikei\.xlsx)')
        nenpo = discover(idx, r'(resourceData/08_seidou/nenpo/(\d{4})/h2daa\d{4}k\.xlsx)')
        sanko = discover(idx, r'(resourceData/08_seidou/kakuho/h2daakhc_sanko\.xlsx)')
        old = discover(old_idx, r'(resourceData/03_kikai/nenpo/h2dcd(\d{4})khc2\.xls)')
        # 1) 구 연보 xls (2015~2020)
        for path, y in old:
            y = int(y)
            if y < start_year:
                continue
            raw = net.get(METI_ICHIRAN + path, f'nenpo_h2dcd{y}khc2.xls', immutable=True)
            tab, names = parse_old_yearbook(raw, y)
            items = {}
            for (form, mk, sym), d in tab.items():
                if re.fullmatch(r'\d+', mk):
                    items[(form, f'{100 + int(mk):04d}', sym)] = d
            for (form, mk), nm in names.items():
                if re.fullmatch(r'\d+', mk):
                    old_names.setdefault((form, f'{100 + int(mk):04d}'), set()).add(f'{y}: {nm}')
            layers.append((0, f'METI 年報 機械統計編 {y} 時系列表(xls)', METI_ICHIRAN + path, items))
            for (form, mk, sym), comp in OLD_CHECKS.items():
                pub = tab.get((form, mk, sym), {})
                for ym, (pv, _) in pub.items():
                    parts = [items.get((form, it, sym), {}).get(ym, (None, 'missing'))[0] for it in comp]
                    if pv is None or any(p is None for p in parts):
                        continue
                    old_checks.append((form, mk, sym, ym, pv, sum(parts)))
        # 2) 연보 xlsx (2021~)
        for path, y in nenpo:
            y = int(y)
            if y < start_year:
                continue
            raw = net.get(METI_ICHIRAN + path, f'nenpo_h2daa{y}k.xlsx', immutable=True)
            tab, names, links = parse_unified(raw, ['実数表'], forms)
            layers.append((1, f'METI 年報 {y}(xlsx 実数表)', METI_ICHIRAN + path, tab))
            for k, v in names.items():
                all_names.setdefault(k, set()).add(v)
            for k, v in links.items():
                all_links.setdefault(k, {}).update(v)
        # 3) 연간보정 jikei (연보 미발간 해 대비)
        for path, y in hosei:
            raw = net.get(METI_ICHIRAN + path, f'hosei_h2daa{y}.xlsx')
            tab, names, links = parse_unified(raw, ['実数表'], forms)
            layers.append((2, f'METI 確報 {y}年 年間補正 時系列表', METI_ICHIRAN + path, tab))
            for k, v in links.items():
                all_links.setdefault(k, {}).update(v)
        # 4) 당해 확보 jikei
        raw = net.get(METI_ICHIRAN + k_url, f'kakuho_h2daa{latest}_jikei.xlsx')
        tab, names, links = parse_unified(raw, ['実数表'], forms)
        layers.append((3, f'METI 確報 時系列表 {latest[:4]}-{latest[4:]} 公表分', METI_ICHIRAN + k_url, tab))
        for k, v in names.items():
            all_names.setdefault(k, set()).add(v)
        for k, v in links.items():
            all_links.setdefault(k, {}).update(v)
        # 5) 참고 시계열(61개월)
        if sanko:
            raw = net.get(METI_ICHIRAN + sanko[0], 'sanko_h2daakhc.xlsx')
            tab, names, links = parse_unified(raw, ['参考_実数表', '実数表'], forms)
            layers.append((4, 'METI 参考 時系列表(直近61か月)', METI_ICHIRAN + sanko[0], tab))
            for k, v in links.items():
                all_links.setdefault(k, {}).update(v)
        else:
            errors.append('METI 참고 시계열(h2daakhc_sanko.xlsx) 링크 없음 — 연보·확보만 사용')
        # JEMA
        try:
            jhtml = net.get(JEMA_PAGE, 'jema_demand.html').decode('utf-8', 'replace')
            files = discover(jhtml, r'href="(/stat/[^"]+?/((?:\d{4}-\d{4})|(?:\d{2}_\d{2}-\d{2}))jd\.xlsx)"')
            if not files:
                raise ValueError('JEMA 受注実績 xlsx 링크 없음')

            def order(f):  # 오래된 것 → 최신 (최신 파일 값이 덮어쓴다): '2020-2023' → (2020, 0), '26_04-06' → (2026, 4)
                tag = f[1]
                return (int(tag[:4]), 0) if len(tag) == 9 else (2000 + int(tag[:2]), int(tag[3:5]))
            for path, tag in sorted(files, key=order):
                raw = net.get('https://www.jema-net.or.jp' + path, f'jema_{tag}jd.xlsx')
                for sid, d in parse_jema(raw).items():
                    jema.setdefault(sid, {}).update(d)
                jema_files.append(tag)
        except (ValueError, RuntimeError) as e:
            errors.append(f'JEMA 受注実績 수집 실패: {e}')
    except BudgetExceeded:
        print(f'시간 예산 {a.max_seconds}s 소진 — 다시 실행하면 캐시에서 이어서 진행', file=sys.stderr)
        return 2
    except (ValueError, RuntimeError, KeyError, TypeError, IndexError, zipfile.BadZipFile, ET.ParseError, struct.error) as e:
        if not isinstance(e, RuntimeError):
            for c in list(RAW.glob('*.xls')) + list(RAW.glob('*.xlsx')):
                if not c.name.startswith('nenpo_'):
                    c.unlink()
        print('FATAL', e, '— 기존 출력 보존', file=sys.stderr)
        return 1

    # 품목명 검증(통일 형식 품목명, 구 연보 잎 라벨)
    for kwmap, names_by in ((ITEM_KEYWORDS, all_names), (OLD_KEYWORDS, old_names)):
        for (form, item), kws in kwmap.items():
            nms = names_by.get((form, item), set())
            if not nms and names_by is all_names:
                fatal.append(f'{form}-{item}: 품목명 확인 불가(어느 원자료에도 없음)')
                continue
            for nm in nms:
                if not all(k.lower() in nm.lower() for k in kws):
                    fatal.append(f'{form}-{item}: 품목명 {nm!r} 이 기대 키워드 {kws} 와 다름 — 품목 재편 의심')
    # 구 연보: 품목 합 vs 공표 합계
    bad = [(f, m, s, ym, pv, sv) for f, m, s, ym, pv, sv in old_checks if abs(pv - sv) > max(3.0, 0.005 * abs(pv))]
    if old_checks:
        worst = max(old_checks, key=lambda t: abs(t[4] - t[5]) / max(abs(t[4]), 1))
        notes_global['old_check'] = (f'구 연보 품목합 대 공표합계 대조 {len(old_checks)}건, 허용오차(±max(3, 0.5%)) 초과 {len(bad)}건, '
                                     f'최대 차 {worst[0]}({worst[1]}){worst[2]} {worst[3]}: 공표 {worst[4]:.0f} vs 합 {worst[5]:.0f}')
    if len(bad) > max(3, len(old_checks) // 50):
        fatal.append(f'구 연보 품목합이 공표 합계와 {len(bad)}건 불일치 — 열 매핑 오류 의심: {bad[:3]}')
    if fatal:
        for x in fatal:
            print('FATAL', x, file=sys.stderr)
        print('검증 실패 — 기존 출력 보존', file=sys.stderr)
        return 1

    # 층 병합: 우선순위 낮은 번호 먼저, 숫자 값을 가진 첫 출처 채택
    layers.sort(key=lambda t: t[0])
    merged, src_of = {}, {}
    for pri, tag, url, tab in layers:
        for key, d in tab.items():
            m = merged.setdefault(key, {})
            for ym, (v, why) in d.items():
                if ym < a.start:
                    continue
                if ym not in m or (m[ym][0] is None and v is not None):
                    m[ym] = (v, why)
                    src_of[(key, ym)] = pri
    # 연보 vs 참고 시계열 대조(겹치는 달)
    cmp_n, cmp_bad = 0, []
    sanko_tab = next((t for p, _, _, t in layers if p == 4), {})
    for key, d in sanko_tab.items():
        for ym, (v, _) in d.items():
            if ym < a.start or v is None:
                continue
            mv = merged.get(key, {}).get(ym, (None, None))[0]
            if mv is not None and src_of.get((key, ym)) != 4:
                cmp_n += 1
                if abs(mv - v) > 0.5:
                    cmp_bad.append((key, ym, mv, v))
    if cmp_n:
        notes_global['sanko_check'] = f'연보·확보 값과 참고 시계열(61개월) 대조 {cmp_n}건 중 차이 {len(cmp_bad)}건' + (
            f' (예: {cmp_bad[0][0]} {cmp_bad[0][1]} {cmp_bad[0][2]:.0f} vs {cmp_bad[0][3]:.0f})' if cmp_bad else '')

    last_ym = max((ym for d in merged.values() for ym, (v, _) in d.items() if v is not None), default=None)
    series = {}
    for sid, (form, items, sym, unit, agg, label, label_ko) in SERIES.items():
        months = sorted({ym for it in items for ym in merged.get((form, it, sym), {})})
        obs, dropped = {}, []
        for ym in months:
            parts = [merged.get((form, it, sym), {}).get(ym, (None, 'missing')) for it in items]
            if any(p[0] is None for p in parts):
                why = sorted({f'{it}:{p[1]}' for it, p in zip(items, parts) if p[0] is None})
                dropped.append(f'{ym}({",".join(why[:3])})')
                continue
            obs[ym] = float(sum(p[0] for p in parts))
        if len(obs) < MIN_OBS:
            errors.append(f'{sid}: 관측 {len(obs)}개 < {MIN_OBS} — 제외')
            continue
        keys = sorted(obs)
        mi = [int(k[:4]) * 12 + int(k[5:]) for k in keys]
        holes = sum(b - a - 1 for a, b in zip(mi, mi[1:]))
        notes = [f'METI 生産動態統計 調査票 {form} 品目 {items[0]}~{items[-1]} アイテム {sym}'
                 + (' 合計(같은 달 공표 품목값의 합)' if len(items) > 1 else '')
                 + '; 2015~2020 年報 機械統計編 時系列表(xls), 2021~ 年報 xlsx, 이후 確報 時系列表']
        if dropped:
            notes.append(f'비공개/불명 품목 때문에 생략한 달 {len(dropped)}개: ' + ', '.join(dropped[:6]) + (' …' if len(dropped) > 6 else ''))
        if holes:
            notes.append(f'중간 결측 {holes}개월')
        lk = []
        for it in items:
            for ym, v in sorted(all_links.get((form, it, sym), {}).items()):
                lk.append(f'{it}@{ym}={v:.4f}')
        if lk:
            notes.append('リンク係数(단층, 미적용): ' + ', '.join(lk))
        if form == '2290' and 'old_check' in notes_global and sid in ('meti_transformer_prod_value', 'meti_transformer_std_prod_kva'):
            notes.append(notes_global['old_check'])
        if 'sanko_check' in notes_global and sid == 'meti_transformer_prod_value':
            notes.append(notes_global['sanko_check'])
        series[sid] = {
            'label': label,
            'label_ko': label_ko,
            'unit': unit,
            'seasonal_adjustment': 'NSA',
            'freq': 'M',
            'agg': agg,
            'kind': 'production' if sym not in ('E', 'F', 'G') else 'shipments',
            'geo': 'JP',
            'meti_form': form,
            'meti_items': items,
            'meti_item_symbol': sym,
            'release_lag_days': RELEASE_LAG,
            'source_url': METI_INDEX,
            'notes': ' | '.join(notes),
            'obs': {k: obs[k] for k in keys},
        }
    for sid, (sheet, _, label, en, ko) in JEMA_SERIES.items():
        o = jema.get(sid, {})
        if len(o) < MIN_OBS_Q:
            errors.append(f'{sid}: 분기 관측 {len(o)}개 < {MIN_OBS_Q} — 제외')
            continue
        keys = sorted(o)
        series[sid] = {
            'label': en + ' (JPY million, quarterly)',
            'label_ko': ko + ' · 분기 (백만엔)',
            'unit': 'JPY million',
            'freq': 'Q',
            'agg': 'sum',
            'kind': 'orders',
            'geo': 'JP',
            'release_lag_days': RELEASE_LAG_JEMA,
            'source_url': JEMA_PAGE,
            'notes': (f'JEMA 重電機器受注生産品 受注実績 시트 {sheet} 행 "{label}" 金額(百万円); 회계연도 분기를 달력 분기로 옮김'
                      f'(第Ⅰ四半期 4~6월 → Q2 … 第Ⅳ四半期 1~3월 → 다음 해 Q1); 파일 {", ".join(jema_files)} — 최신 파일 값 우선; '
                      '회원사 자주집계(주요 제품만), 2020년도 이전은 미공개'),
            'obs': {k: o[k] for k in keys},
        }
    if 'meti_transformer_prod_value' not in series or 'meti_transformer_prod_kva' not in series:
        print('핵심 시리즈 누락 — 기존 출력 보존', file=sys.stderr)
        return 1
    errors.append('2015~2020 구 연보(xls)의 단층(リンク係数)은 PDF 에만 있어 확인하지 못함 — 2021~ 은 xlsx 링크계수표에서 notes 로 기록')
    try:
        old_doc = json.loads(OUT.read_text(encoding='utf-8'))
        for sid in sorted(set(old_doc.get('series', {})) - set(series)):
            errors.append(f'{sid}: 직전 출력에 있었으나 이번에 수집 안 됨')
    except (OSError, json.JSONDecodeError):
        pass
    doc = {
        'schema': 'grid-composite-proxy/1',
        'family': FAMILY,
        'fetched_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'fetch_tool': 'grid/composite/tools/fetch_japan_stats.py',
        'source': {'name': 'METI 経済産業省生産動態統計(年報・確報 時系列表) + JEMA 重電機器受注生産品 受注実績',
                   'url': METI_INDEX, 'files': sorted({u for _, _, u, _ in layers}), 'latest_month': last_ym},
        'series': series,
        'errors': sorted(set(errors)),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    json.loads(tmp.read_text(encoding='utf-8'))
    os.replace(tmp, OUT)
    lastm = max(max(s['obs']) for s in series.values() if s['freq'] == 'M')
    print(f'{OUT.relative_to(ROOT)}: {len(series)} series, latest {lastm}, network requests {net.n_net}, errors {len(doc["errors"])}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
