#!/usr/bin/env python3
"""중국 국가에너지국(NEA) 월간 전력공업 통계 → data/proxies/china_stats.json (grid-composite-proxy/1).

NEA 가 매달 발표하는 '全国电力工业统计数据'(1-X月 누계) 보도자료에서 전력망 공사 투자 완료액(亿元)을 읽는다.
  · nea_grid_investment_ytd : 电网工程完成投资(2017~2019 명칭 '电网基本建设投资完成额') 1-X월 누계, 원문 그대로 (agg=last)
  · nea_grid_investment_m   : 같은 해 안에서만 누계 차분한 월 값 (agg=sum)
        - 1-2월은 합쳐서 발표 → 2월 키에 2개월 합을 두고 1월은 뺀다(method 기록)
        - 12월 누계 = 연간 보도자료('YYYY年全国电力(工业)统计数据')의 연간값
        - 앞 달 누계가 없으면 그 달 차분은 만들지 않는다(보간 없음), 차분이 0 이하이면(개정 흔적) 버리고 기록
보도자료 목록 출처(모두 NEA 공식):
  · www.nea.gov.cn 新闻发布 목록 JSON(ds_*.json; 2021-05 이후 보도자료)
  · 华中能源监管局 hzj.nea.gov.cn · 湖南能源监管办 hunb.nea.gov.cn '国家能源局动态' 게시판(2017~2023 NEA 보도자료 전재본;
    한쪽에서 표 이미지가 빠진 달을 다른 쪽 HTML 표로 보완)
  · 표가 이미지로만 게시된 달은 사람이 표 이미지를 판독한 값(IMAGE_TRANSCRIPTIONS, 11개월)을 쓰되, 실행 때마다 게시 페이지가
    그 이미지를 여전히 싣는지 확인하고, HTML 표/본문 값이 있으면 HTML 을 우선하며 둘이 다르면 실패 처리한다
    (obs_sources 에 이미지 URL, notes 에 표에 인쇄된 전년동기비와 계산값 대조)
실패·한계(errors 에 기록):
  · 2025年 연간 보도자료(2026-01 발표)부터 표에서 투자 항목 삭제(2025年 연간·2026年 1-2月·1-7月 표 확인) → 마지막 누계 2025년 1-11月
  · 목록에서 보도자료를 찾지 못한 달(2019년 1-5月, 2020년 1-8月, 2024년 1-4月)과 2015-01~2017-03 은 비움
  · NBS 변압기 월간 생산량: 월간 보도자료 주요 제품표에 变压器 없음, data.stats.gov.cn 연결 실패 → nbs_transformer_output 없음

규칙: 파이썬 stdlib 만 사용, https + 정확한 호스트 허용목록, 요청별 타임아웃, 429/5xx/연결끊김 지수 백오프,
요청 간 간격, 원자료는 data/raw/china_stats/ 에 캐시(보도자료 본문 불변, NEA 목록 --max-age-hours, 전재 게시판 목록 30일),
검증 실패 시 기존 출력 보존 + 종료코드 1, 시간 예산 초과 시 종료코드 2(재실행하면 캐시에서 이어서).

사용: python3 fetch_china_stats.py [--max-seconds 480] [--max-age-hours 20] [--start 2015-01] [--offline]
"""
import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAMILY = 'china_stats'
OUT = ROOT / 'data' / 'proxies' / f'{FAMILY}.json'
RAW = ROOT / 'data' / 'raw' / FAMILY
ALLOWED_HOSTS = {'www.nea.gov.cn', 'hzj.nea.gov.cn', 'hunb.nea.gov.cn'}
NEA_XWFB = 'https://www.nea.gov.cn/xwfb/index.htm'
# NEA 지역 감독국의 '国家能源局动态' 게시판 — 2017~2023 NEA 보도자료 전재본(원문 표가 이미지로 빠진 달을 서로 보완)
MIRRORS = {'hzj': 'https://hzj.nea.gov.cn/dtyw/gjnyjdt/', 'hunb': 'https://hunb.nea.gov.cn/dtyw/gjnyjdt/'}
TIMEOUT = 60
RETRIES = 6
SPACING = 1.2
UA = 'Mozilla/5.0 (compatible; grid-composite-fetch/1; research; stdlib urllib)'
MIN_OBS = 24
RELEASE_LAG = 22  # 7월 누계가 8월 20~25일 발표
LIST_MAX_AGE_DAYS = 30  # 미러 게시판은 과거 보도자료 보관용 — 목록 캐시를 길게

# 표/본문에서 전력망 투자 완료액(亿元)
NAME_RE = r'电网(?:基本建设|工程(?:建设)?)(?:投资完成额?|完成投资额?)'
# 표 행: 지표명 | 亿元 | (당월 | 증감 |) 누계 | 증감 — 전재본은 표가 <p> 로 풀려 칸 구분이 없으므로 숫자·'-' 칸만 이어 읽는다
PAT_ROW = re.compile(NAME_RE + r' ?\|? ?亿元((?:[ |]*(?:-?\d[\d,]*(?:\.\d+)?|[-－—](?!\d)))*)')
PAT_TOKEN = re.compile(r'-?\d[\d,]*(?:\.\d+)?|(?<![\d.])[-－—](?![\d])')
PAT_TEXT = re.compile(NAME_RE + r'\s*(?:约|为|达到?)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*亿元')
PAT_NAME = re.compile(NAME_RE)
PAT_TITLE_M = re.compile(r'1\s*[-—–－~至]\s*(\d{1,2})\s*月')
PAT_TITLE_Y = re.compile(r'(20\d{2})\s*年')
PAT_ANNUAL = re.compile(r'(20\d{2})\s*年\s*全国电力(?:工业)?统计数据')
# 표가 이미지로만 게시된 보도자료의 전력망 투자 누계(亿元)와 표에 인쇄된 전년동기비(%) — 2026-09-25 판독.
# (값, 전년동기비, 보도자료 페이지, 표 이미지, 표의 지표명)
IMAGE_TRANSCRIPTIONS = {
    '2018-02': (268.0, -40.1, 'https://hzj.nea.gov.cn/dtyw/gjnyjdt/202309/t20230913_74214.html',
                'http://www.nea.gov.cn/2018-03/20/137052616_15215313953681n.png', '电网基本建设投资完成额'),
    '2018-05': (1414.0, -21.2, 'https://hzj.nea.gov.cn/dtyw/gjnyjdt/202309/t20230913_74288.html',
                'http://www.nea.gov.cn/2018-06/20/137268138_15294879707571n.jpg', '电网工程投资完成'),
    '2019-07': (2021.0, -13.9, 'https://hzj.nea.gov.cn/dtyw/gjnyjdt/202309/t20230913_74548.html',
                'http://www.nea.gov.cn/2019-08/22/138329172_15664608415531n.jpg', '电网工程投资完成'),
    '2019-08': (2378.0, -15.2, 'https://hzj.nea.gov.cn/dtyw/gjnyjdt/202309/t20230913_74571.html',
                'http://www.nea.gov.cn/2019-09/23/138414469_15692083729761n.jpg', '电网工程投资完成'),
    '2019-09': (2953.0, -12.5, 'https://hzj.nea.gov.cn/dtyw/gjnyjdt/202309/t20230913_74591.html',
                'http://www.nea.gov.cn/2019-10/23/138496297_15718209481651n.jpg', '电网工程投资完成'),
    '2020-04': (670.0, -16.5, 'https://hzj.nea.gov.cn/dtyw/gjnyjdt/202309/t20230913_74686.html',
                'http://www.nea.gov.cn/2020-05/21/139075313_15900504592911n.jpg', '电网工程投资完成'),
    '2020-05': (1134.0, -2.0, 'https://hzj.nea.gov.cn/dtyw/gjnyjdt/202309/t20230913_74700.html',
                'http://www.nea.gov.cn/2020-06/22/139157369_15927899386191n.jpg', '电网工程投资完成'),
    '2021-12': (4951.0, 1.1, 'https://www.nea.gov.cn/2022-01/26/c_1310441589.htm',
                'https://www.nea.gov.cn/2022-01/26/1310441589_16431688463391n.jpg', '电网工程建设投资完成额'),
    '2022-12': (5012.0, 2.0, 'https://www.nea.gov.cn/2023-01/18/c_1310691509.htm',
                'https://www.nea.gov.cn/2023-01/18/1310691509_16740024009041n.png', '电网工程建设投资完成额'),
    '2025-07': (3315.0, 12.5, 'https://www.nea.gov.cn/20250823/7e111f0a60ac44438346bd8332db345e/c.html',
                'https://www.nea.gov.cn/20250823/7e111f0a60ac44438346bd8332db345e/202508237e111f0a60ac44438346bd8332db345e_20250823112f576f8f34400ba2bac7b604db2051.jpeg',
                '电网工程投资完成'),
    '2025-11': (5604.0, 5.9, 'https://www.nea.gov.cn/20251226/640306962d7d421b921b902f48a04b47/c.html',
                'https://www.nea.gov.cn/20251226/640306962d7d421b921b902f48a04b47/20251226640306962d7d421b921b902f48a04b47_20251226761d0908196a46928d432c809762a04e.jpg',
                '电网工程投资完成'),
}
DROPPED_FROM = '2025-12'  # 이 달(2025年 연간 보도자료)부터 투자 항목 삭제
KNOWN_GAPS = [
    'NEA 보도자료 표에서 전원·전력망 투자 항목이 2025年 연간(2026-01 발표)부터 빠짐(2025年 연간·2026年 1-2月·1-7月 표 이미지 확인) — 마지막 누계 2025-11',
    '2015-01~2017-03 월간 보도자료는 목록 출처(NEA 新闻发布 JSON, 华中·湖南 监管 전재 게시판)에서 찾지 못함 — 비움',
    'NBS 변압기 월간 생산량: 월간 보도자료(www.stats.gov.cn 2026年8月 规模以上工业增加值) 주요 제품표에 变压器 없음(发电机组만 있음), 전체 제품 데이터베이스 data.stats.gov.cn 은 연결 실패 — nbs_transformer_output 없음',
    '전력망 투자 지표명 변경: 2017~2019 전재본 표는 电网基本建设投资完成额, 이후 电网工程投资完成/电网工程完成投资 — 같은 지표로 보고 잇되 notes 에 월별 명칭 기록',
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

    def get(self, url, cache_name, max_age=None):
        cache = RAW / cache_name
        age = self.max_age if max_age is None else max_age
        if cache.exists() and (self.offline or time.time() - cache.stat().st_mtime < age):
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
                req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9'})
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
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                if attempt + 1 < RETRIES:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RuntimeError(f'네트워크 실패 {url}: {e}') from e
        raise RuntimeError(f'재시도 소진: {url}')


def to_https(url, base):
    u = urllib.parse.urljoin(base, html.unescape(url.strip()))
    s = urllib.parse.urlsplit(u)
    if s.scheme == 'http' and s.hostname in ALLOWED_HOSTS:
        u = urllib.parse.urlunsplit(('https',) + tuple(s)[1:])
    return u


def cache_key(url):
    return 'page_' + hashlib.sha1(url.encode()).hexdigest()[:16] + '.html'


def classify(title, pub):
    """제목·게시일 → (연, 누계 끝 월) 또는 None."""
    t = re.sub(r'<[^>]+>', '', html.unescape(title))
    if '电力' not in t or '统计数据' not in t:
        return None
    m = PAT_ANNUAL.search(t)
    if m and not PAT_TITLE_M.search(t):
        return int(m.group(1)), 12
    m = PAT_TITLE_M.search(t)
    if not m:
        return None
    mon = int(m.group(1))
    if not 2 <= mon <= 11:
        return None
    y = PAT_TITLE_Y.search(t)
    year = int(y.group(1)) if y else (pub.year if pub else None)
    return (year, mon) if year else None


def page_text(raw):
    """HTML → 텍스트. 표 행(</tr>)과 문단만 줄바꿈, 칸은 ' | ' 로 나누고 나머지 공백은 한 칸으로 접는다.
    한자 사이 공백(태그 경계에서 생긴 것)은 지워 지표명이 끊기지 않게 한다."""
    row, par = '\ue000', '\ue001'  # 사설 영역 문자(\s 에 걸리지 않음)
    t = raw.decode('utf-8', 'replace')
    t = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', t, flags=re.S | re.I)
    t = re.sub(r'</tr\s*>', row, t, flags=re.I)
    t = re.sub(r'<(td|th)[^>]*>', ' | ', t, flags=re.I)
    t = re.sub(r'</p\s*>|<br\s*/?>', par, t, flags=re.I)
    t = html.unescape(re.sub(r'<[^>]+>', ' ', t))
    t = re.sub(r'[\s\u3000]+', ' ', t).replace(par, ' ')  # 원문 줄바꿈·문단 경계는 공백으로(행 경계만 남김)
    t = re.sub(r' {2,}', ' ', t)
    t = re.sub(r'(?<=[\u4e00-\u9fff]) (?=[\u4e00-\u9fff])', '', t)
    return re.sub(r' *' + row + ' *', '\n', t)


def extract(raw, year, mon):
    """보도자료 본문 → (값, 지표명, 방식) 또는 (None, 사유, None)."""
    txt = page_text(raw)
    # 본문 기간 확인: '1-X月' 또는 연간
    if mon < 12:
        ms = {int(x) for x in re.findall(r'1\s*[-—–－~至]\s*(\d{1,2})\s*月', txt)}
        if ms and mon not in ms:
            return None, f'본문 기간 {sorted(ms)} ≠ 제목 1-{mon}월', None
    vals = []
    for m in PAT_ROW.finditer(txt):
        toks = PAT_TOKEN.findall(m.group(1))
        # 열 구성: [누계, 증감] 또는 [당월, 증감, 누계, 증감](당월 칸이 '-' 인 경우 포함)
        if len(toks) in (1, 2):
            pick = toks[0]
        elif len(toks) == 4:
            pick = toks[2]
        else:
            return None, f'표 행 열 개수 판독 불가 {toks[:6]}', None
        if not re.fullmatch(r'\d[\d,]*(?:\.\d+)?', pick):
            return None, f'표 누계 칸이 숫자 아님 {pick!r}', None
        vals.append((float(pick.replace(',', '')), 'table'))
    vals += [(float(m.group(1).replace(',', '')), 'text') for m in PAT_TEXT.finditer(txt)]
    names = sorted(set(PAT_NAME.findall(txt)))
    if not vals:
        imgs = re.findall(r'<img[^>]+src="([^"]+\.(?:png|jpe?g))"', raw.decode('utf-8', 'replace'), flags=re.I)
        imgs = [i for i in imgs if 'logo' not in i and 'trs_' not in i]
        return None, ('표가 이미지로만 게시됨(stdlib 판독 불가)' if imgs else '전력망 투자 항목 없음'), None
    distinct = sorted({v for v, _ in vals})
    if len(distinct) > 1:
        # 표와 본문이 다르면(반올림 등) 표 값을 쓰되 차이가 크면 실패로
        tv = [v for v, k in vals if k == 'table']
        if tv and max(distinct) - min(distinct) <= max(1.0, 0.01 * max(distinct)):
            return tv[0], '/'.join(names), 'table'
        return None, f'값 불일치 {distinct}', None
    kinds = {k for _, k in vals}
    return distinct[0], '/'.join(names), ('table' if 'table' in kinds else 'text')


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
    releases = {}  # (y, m) → [(우선순위, url, pubdate, title)]
    list_errors = []
    try:
        # 1) NEA 新闻发布 목록 JSON
        idx = net.get(NEA_XWFB, 'nea_xwfb_index.htm').decode('utf-8', 'replace')
        dss = sorted(set(re.findall(r'datasource:([0-9a-f]{32})', idx)))
        if not dss:
            raise ValueError('NEA 新闻发布 페이지에서 datasource 를 찾지 못함')
        n_items = 0
        for ds in dss:
            raw = net.get(f'https://www.nea.gov.cn/xwfb/ds_{ds}.json', f'nea_ds_{ds}.json')
            d = json.loads(raw)
            for it in d.get('datasource') or []:
                n_items += 1
                pt = str(it.get('publishTime') or '')[:10]
                try:
                    pub = date.fromisoformat(pt)
                except ValueError:
                    pub = None
                title = it.get('title') or it.get('showTitle') or ''
                c = classify(title, pub) or classify(it.get('showTitle') or '', pub)
                url = it.get('publishUrl') or ''
                if not c or not url:
                    continue
                releases.setdefault(c, []).append((0, to_https(url, 'https://www.nea.gov.cn/xwfb/'), pub, re.sub(r'<[^>]+>', '', title)))
        if n_items == 0:
            raise ValueError('NEA 목록 JSON 이 비어 있음')
        # 2) NEA 지역 감독국 전재 게시판(과거분)
        for tag, base in MIRRORS.items():
            first = net.get(base, f'mirror_{tag}_index_0.html', max_age=LIST_MAX_AGE_DAYS * 86400).decode('utf-8', 'replace')
            mc = re.search(r'countPage\s*=\s*Number\("(\d+)"\)', first)
            if not mc:
                list_errors.append(f'{tag} 게시판 쪽수(countPage) 판독 실패 — 첫 쪽만 사용')
            pages = [first]
            for p in range(1, int(mc.group(1)) if mc else 1):
                try:
                    pages.append(net.get(f'{base}index_{p}.html', f'mirror_{tag}_index_{p}.html',
                                         max_age=LIST_MAX_AGE_DAYS * 86400).decode('utf-8', 'replace'))
                except RuntimeError as e:
                    list_errors.append(f'{tag} 게시판 {p}쪽 실패: {e}')
            for pg in pages:
                for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', pg, re.S):
                    inner = m.group(2)
                    title = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', inner)).strip()
                    dm = re.search(r'(\d{4}-\d{2}-\d{2})', inner)
                    pub = date.fromisoformat(dm.group(1)) if dm else None
                    title = re.sub(r'\s*\d{4}-\d{2}-\d{2}\s*$', '', title)
                    c = classify(title, pub)
                    if not c:
                        continue
                    url = to_https(m.group(1), base)
                    host = urllib.parse.urlsplit(url).hostname
                    if host not in ALLOWED_HOSTS:
                        continue
                    releases.setdefault(c, []).append((0 if host == 'www.nea.gov.cn' else 1, url, pub, title))
        # 3) 본문 받기·추출
        ytd, src, names_by, notes_fail = {}, {}, {}, {}
        for (y, mon), cands in sorted(releases.items()):
            ym = f'{y:04d}-{mon:02d}'
            if ym < a.start:
                continue
            got = None
            for pri, url, pub, title in sorted(set(cands), key=lambda x: (x[0], x[1])):
                if pub and mon < 12 and not (0 < (pub - date(y, mon, 28)).days < 75):
                    notes_fail.setdefault(ym, []).append(f'게시일 {pub} 이 기간과 맞지 않음 {url}')
                    continue
                try:
                    raw = net.get(url, cache_key(url), max_age=10 * 365 * 86400)
                except RuntimeError as e:
                    notes_fail.setdefault(ym, []).append(f'본문 실패 {url}: {e}')
                    continue
                v, why, how = extract(raw, y, mon)
                if v is None:
                    notes_fail.setdefault(ym, []).append(f'{why} ({url})')
                    continue
                if got is None:
                    got = (v, why, how, url)
                elif abs(got[0] - v) > 0.5:
                    raise ValueError(f'{ym}: 출처 간 값 불일치 {got[0]} ({got[3]}) vs {v} ({url})')
            if got:
                ytd[ym] = got[0]
                src[ym] = got[3]
                names_by[ym] = got[1]
        # 4) 표가 이미지로만 게시된 달: 사람이 판독한 값(아래 표) — 게시 페이지가 그 이미지를 여전히 싣는지 확인한 뒤에만 사용
        transcribed = {}
        for ym, (v, g, page, img, label) in IMAGE_TRANSCRIPTIONS.items():
            if ym < a.start:
                continue
            try:
                raw = net.get(page, cache_key(page), max_age=10 * 365 * 86400)
            except RuntimeError as e:
                notes_fail.setdefault(ym, []).append(f'판독 대상 페이지 실패 {page}: {e}')
                continue
            if img.rsplit('/', 1)[-1] not in raw.decode('utf-8', 'replace'):
                notes_fail.setdefault(ym, []).append(f'판독한 표 이미지가 페이지에서 사라짐 {page}')
                continue
            if ym in ytd:
                if abs(ytd[ym] - v) > 0.5:
                    raise ValueError(f'{ym}: HTML 값 {ytd[ym]} 과 이미지 판독 값 {v} 불일치')
                continue
            ytd[ym] = v
            src[ym] = f'{page} (표 이미지 {img} 판독)'
            names_by[ym] = label
            transcribed[ym] = g
    except BudgetExceeded:
        print(f'시간 예산 {a.max_seconds}s 소진 — 다시 실행하면 캐시에서 이어서 진행', file=sys.stderr)
        return 2
    except (ValueError, RuntimeError, KeyError, TypeError, json.JSONDecodeError) as e:
        print('FATAL', e, '— 기존 출력 보존', file=sys.stderr)
        return 1

    errors.extend(list_errors)
    late = []
    for ym, fl in sorted(notes_fail.items()):
        if ym in ytd:
            continue
        if ym >= DROPPED_FROM:
            late.append(ym)
            continue
        errors.append(f'{ym} 누계: ' + '; '.join(fl[:2]))
    if late:
        errors.append(f'{", ".join(late)}: 보도자료 표가 이미지이며, 판독 확인한 표(2025年 연간·2026年 1-2月·1-7月)에는 투자 항목 자체가 없음 — 수집 대상 아님')
    # 전년동기비 대조(이미지 판독 값): 표에 인쇄된 증감률과 전년 같은 달 누계로 계산한 증감률
    yoy_checks = []
    for ym, g in sorted(transcribed.items()):
        prev = f'{int(ym[:4]) - 1:04d}{ym[4:]}'
        if prev in ytd:
            calc = (ytd[ym] / ytd[prev] - 1) * 100
            yoy_checks.append(f'{ym} 인쇄 {g:+.1f}% vs 계산 {calc:+.1f}%' + ('' if abs(calc - g) <= 0.6 else ' (차이: 전년 기준 개정 추정)'))
        else:
            yoy_checks.append(f'{ym} 인쇄 {g:+.1f}% (전년 누계 없음)')
    # 누계 단조성(같은 해 안에서 누계가 줄면 개정 흔적) 점검
    keys = sorted(ytd)
    nonmono = [k for k, j in zip(keys, keys[1:]) if k[:4] == j[:4] and ytd[j] < ytd[k]]
    # 월 차분
    monthly, method, dropped = {}, {}, []
    for ym in keys:
        y, mon = int(ym[:4]), int(ym[5:])
        if mon == 2:
            monthly[ym] = ytd[ym]
            method[ym] = 'jan_feb_combined'
            continue
        prev = f'{y:04d}-{mon - 1:02d}'
        if prev in ytd:
            dv = round(ytd[ym] - ytd[prev], 6)
            if dv <= 0:
                dropped.append(f'{ym}({dv:g})')
                continue
            monthly[ym] = dv
            method[ym] = 'ytd_difference'
    missing_months = []
    if keys:
        y0, y1 = int(keys[0][:4]), int(keys[-1][:4])
        for y in range(y0, y1 + 1):
            for mon in range(2, 13):
                ym = f'{y:04d}-{mon:02d}'
                if keys[0] <= ym <= keys[-1] and ym not in ytd:
                    missing_months.append(ym)
    no_release = [ym for ym in missing_months if ym not in notes_fail]
    if no_release:
        errors.append('목록 출처에서 보도자료를 찾지 못한 누계 월: ' + ', '.join(no_release))
    if len(ytd) < MIN_OBS:
        print(f'누계 관측 {len(ytd)}개 < {MIN_OBS} — 기존 출력 보존', file=sys.stderr)
        return 1
    stale_before = f'{now.year - 1:04d}-{now.month:02d}'
    if keys[-1] < stale_before:
        errors.append(f'nea_grid_investment_*: 최신 누계 {keys[-1]} — 12개월 넘게 새 관측 없음(2026년 보도자료에서 항목 삭제)')
    common = ('NEA 월간 보도자료 全国电力工业统计数据 1-X月 누계 표(없으면 본문 문장); 단위 亿元(1억 위안); '
              '1월 단독치는 발표되지 않음(1-2月 합산); 12월 누계 = 연간 보도자료 값')
    name_changes = []
    prev_name = None
    for ym in keys:
        if names_by[ym] != prev_name:
            name_changes.append(f'{ym}~ {names_by[ym]}')
            prev_name = names_by[ym]
    series = {
        'nea_grid_investment_ytd': {
            'label': 'China grid construction investment completed, year-to-date (NEA, CNY 100 million)',
            'label_ko': '중국 전력망 공사 투자 완료액 · 연초 누계 (NEA, 억 위안)',
            'unit': 'CNY 100 million (亿元), year-to-date',
            'freq': 'M',
            'agg': 'last',
            'kind': 'investment',
            'geo': 'CN',
            'release_lag_days': RELEASE_LAG,
            'source_url': 'https://www.nea.gov.cn/xwfb/index.htm',
            'notes': ' | '.join([common, '지표명: ' + '; '.join(name_changes)]
                                + ([f'결측 누계 {len(missing_months)}개월: ' + ', '.join(missing_months[:24]) + (' …' if len(missing_months) > 24 else '')] if missing_months else [])
                                + ([f'같은 해 누계 감소(개정 흔적): {", ".join(nonmono)}'] if nonmono else [])
                                + ([f'표 이미지 판독 {len(transcribed)}개월(obs_sources 에 이미지 URL): ' + '; '.join(yoy_checks)] if transcribed else [])),
            'obs_sources': {k: src[k] for k in keys},
            'obs': {k: ytd[k] for k in keys},
        },
        'nea_grid_investment_m': {
            'label': 'China grid construction investment completed, monthly (derived from NEA YTD by within-year differencing, CNY 100 million)',
            'label_ko': '중국 전력망 공사 투자 완료액 · 월 (NEA 누계의 같은 해 차분, 억 위안; 2월=1~2월 합)',
            'unit': 'CNY 100 million (亿元)',
            'freq': 'M',
            'agg': 'sum',
            'kind': 'investment',
            'geo': 'CN',
            'release_lag_days': RELEASE_LAG,
            'source_url': 'https://www.nea.gov.cn/xwfb/index.htm',
            'method': 'ytd_difference',
            'notes': ' | '.join([common,
                                 'method=ytd_difference: 월값 = 누계(t) − 누계(t−1), 같은 해·연속한 두 달 누계가 모두 있을 때만',
                                 '2월 값 = 1~2월 합산 누계 그대로(1월 키 생략) — 분기 합산 시 1분기는 1월 부재로 3/3 미완결',
                                 '앞 달 누계가 없으면 그 달 월값도 비움(보간 없음)']
                                + ([f'차분이 0 이하라 버린 달: {", ".join(dropped)}'] if dropped else [])),
            'obs_method': {k: method[k] for k in sorted(monthly)},
            'obs': {k: monthly[k] for k in sorted(monthly)},
        },
    }
    if len(monthly) < MIN_OBS:
        errors.append(f'nea_grid_investment_m: 관측 {len(monthly)}개 < {MIN_OBS} — 제외')
        del series['nea_grid_investment_m']
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
        'fetch_tool': 'grid/composite/tools/fetch_china_stats.py',
        'source': {'name': '国家能源局(NEA) 全国电力工业统计数据 월간 보도자료 (www.nea.gov.cn, 华中·湖南 能源监管 전재본)',
                   'url': NEA_XWFB},
        'series': series,
        'errors': sorted(set(errors)),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    json.loads(tmp.read_text(encoding='utf-8'))
    os.replace(tmp, OUT)
    print(f'{OUT.relative_to(ROOT)}: ytd {len(ytd)} ({keys[0]}~{keys[-1]}), monthly {len(monthly)}, '
          f'network requests {net.n_net}, errors {len(doc["errors"])}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
