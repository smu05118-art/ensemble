#!/usr/bin/env python3
"""UN Comtrade public preview API -> grid-composite-proxy/1 proxy files.

Families
  us_imports  -> data/proxies/comtrade_us_imports.json
      reporter 842 (USA), flow M, all partners, 12 HS6 (8504 transformers/converters,
      8537 switchboards, 8535 HV breakers), 2015-01..latest.
  exports     -> data/proxies/comtrade_exports.json
      20 reporters, flow X, partners 0/842/124/484, HS 850421/22/23/33/34
      (+853710/853720 for DE IT FR MX CN).

Subcommands
  fetch   download missing/stale responses into data/raw/<family>/ (resumable).
          --max-seconds N stops scheduling new requests after N seconds (exit 3 if
          work remains, so call it again).
  build   build the proxy JSON from the raw cache only (no network). Refuses to write
          (keeps the old file, exit 2) when planned responses are missing, unless
          --allow-partial (missing queries are then listed in "errors").
  status  print cache progress per family.
  run     fetch then build.

Exit codes: 0 ok · 2 build/validation failure (old output kept) · 3 fetch incomplete
(time budget) · 4 some requests failed permanently (see stderr / errors.json).

Stdlib only. https + exact-host allowlist, per-request timeout, exponential backoff on
429/5xx (429 pauses every worker), <=3 concurrent workers with polite spacing.
"""
import argparse
import datetime as dt
import gzip
import http.client
import json
import os
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]            # grid/composite
RAW = ROOT / 'data' / 'raw'
OUT = ROOT / 'data' / 'proxies'
FETCH_TOOL = 'grid/composite/tools/fetch_comtrade.py'
BASE = 'https://comtradeapi.un.org/public/v1/preview/C/M/HS'
REF_PARTNERS = 'https://comtradeapi.un.org/files/v1/app/reference/partnerAreas.json'
ALLOWED_HOSTS = {'comtradeapi.un.org'}
UA = 'grid-composite-proxy-fetcher/1 (research; stdlib urllib)'
PREVIEW_ROW_CAP = 500
START = '2015-01'

HS_LABEL = {
    '850421': ('liquid dielectric transformers <=650 kVA', '액체유전체(유입식) 변압기 ≤650kVA · 배전용'),
    '850422': ('liquid dielectric transformers >650 kVA to 10,000 kVA', '유입식 변압기 650~10,000kVA'),
    '850423': ('liquid dielectric transformers >10,000 kVA', '유입식 변압기 >10,000kVA · 대형 전력용'),
    '850431': ('other transformers <=1 kVA', '기타(건식 등) 변압기 ≤1kVA'),
    '850432': ('other transformers >1 kVA to 16 kVA', '기타(건식 등) 변압기 1~16kVA'),
    '850433': ('other transformers >16 kVA to 500 kVA', '기타(건식·몰드 등) 변압기 16~500kVA'),
    '850434': ('other transformers >500 kVA', '기타(건식·몰드 등) 변압기 >500kVA'),
    '850440': ('static converters', '정지형 변환기(정류기·인버터·UPS 등)'),
    '853710': ('boards/panels for electric control or distribution <=1,000 V', '배전·제어반 ≤1,000V(저압)'),
    '853720': ('boards/panels for electric control or distribution >1,000 V', '배전·제어반 >1,000V(고압 스위치기어)'),
    '853521': ('automatic circuit breakers >1,000 V, <72.5 kV', '자동 회로차단기 1kV 초과·72.5kV 미만'),
    '853529': ('automatic circuit breakers >1,000 V, >=72.5 kV', '자동 회로차단기 72.5kV 이상'),
}
AGG_LABEL = {
    '8504dist': ('850421+850422', 'liquid-filled distribution transformers <=10,000 kVA (850421+850422)',
                 '유입식 배전·중형 변압기 ≤10,000kVA 합계(850421+850422)'),
    '8504dry': ('850433+850434', 'other (dry/cast-resin etc.) transformers >16 kVA (850433+850434)',
                '기타(건식·몰드 등) 변압기 >16kVA 합계(850433+850434)'),
}

# ---------------------------------------------------------------- family specs
US_HS = ['850421', '850422', '850423', '850431', '850432', '850433', '850434', '850440',
         '853710', '853720', '853521', '853529']
US_CODE_GROUPS = [US_HS[0:4], US_HS[4:8], US_HS[8:12]]           # <=5 codes per call
US_ALWAYS = ['410', '484', '124', '490', '156', '699', '392', '276', '40', '76', '792',
             '191', '704', '752', '757', '380', '724']
US_SHARE_MIN = 0.005
US_SHARE_FROM = '2022-01'

EXP_REPORTERS = [  # priority order
    ('KR', '410'), ('MX', '484'), ('CN', '156'), ('IN', '699'), ('JP', '392'), ('DE', '276'),
    ('CA', '124'), ('BR', '76'), ('AT', '40'), ('IT', '380'), ('ES', '724'), ('TR', '792'),
    ('VN', '704'), ('HR', '191'), ('SE', '752'), ('CH', '757'), ('FR', '251'), ('PL', '616'),
    ('TH', '764'), ('EG', '818'),
]
EXP_HS = ['850421', '850422', '850423', '850433', '850434']
EXP_HS_EXTRA = ['853710', '853720']
EXP_EXTRA_REPORTERS = ['DE', 'IT', 'FR', 'MX', 'CN']
EXP_PARTNERS = ['0', '842', '124', '484']
EXP_GROUP_SIZE = 5

ISO2_BY_CODE = {c: i for i, c in EXP_REPORTERS}
ISO2_BY_CODE['842'] = 'US'

NAME_KO = {
    '0': '세계', '842': '미국', '410': '한국', '484': '멕시코', '124': '캐나다', '490': '대만(Other Asia nes)',
    '156': '중국', '699': '인도', '392': '일본', '276': '독일', '40': '오스트리아', '76': '브라질',
    '792': '튀르키예', '191': '크로아티아', '704': '베트남', '752': '스웨덴', '757': '스위스',
    '380': '이탈리아', '724': '스페인', '251': '프랑스', '616': '폴란드', '764': '태국', '818': '이집트',
    '826': '영국', '203': '체코', '348': '헝가리', '620': '포르투갈', '528': '네덜란드', '56': '벨기에',
    '246': '핀란드', '208': '덴마크', '376': '이스라엘', '702': '싱가포르', '344': '홍콩', '608': '필리핀',
    '458': '말레이시아', '360': '인도네시아', '170': '콜롬비아', '188': '코스타리카', '214': '도미니카공화국',
    '222': '엘살바도르', '340': '온두라스', '320': '과테말라', '642': '루마니아', '703': '슬로바키아',
    '688': '세르비아', '788': '튀니지', '504': '모로코', '100': '불가리아', '705': '슬로베니아',
    '372': '아일랜드', '579': '노르웨이', '36': '호주', '32': '아르헨티나', '152': '칠레', '604': '페루',
    '116': '캄보디아', '144': '스리랑카', '586': '파키스탄', '50': '방글라데시', '682': '사우디아라비아',
    '784': '아랍에미리트', '710': '남아프리카공화국', '233': '에스토니아', '440': '리투아니아', '428': '라트비아',
    '554': '뉴질랜드', '643': '러시아', '804': '우크라이나', '112': '벨라루스', '218': '에콰도르',
    '858': '우루과이', '600': '파라과이', '862': '베네수엘라', '591': '파나마', '558': '니카라과',
    '400': '요르단', '422': '레바논', '48': '바레인', '634': '카타르', '414': '쿠웨이트', '512': '오만',
    '818_': '', '470': '몰타', '196': '키프로스', '300': '그리스', '442': '룩셈부르크', '490_': '',
    '899': '기타 지역(Areas nes)', '97': 'EU', '446': '마카오', '104': '미얀마', '418': '라오스',
    '496': '몽골', '398': '카자흐스탄', '860': '우즈베키스탄', '268': '조지아', '51': '아르메니아',
    '31': '아제르바이잔', '70': '보스니아헤르체고비나', '807': '북마케도니아', '499': '몬테네그로',
    '8': '알바니아', '498': '몰도바', '352': '아이슬란드', '484_': '',
}


def iso_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def ym_range(a, b):
    y, m = int(a[:4]), int(a[5:7])
    ye, me = int(b[:4]), int(b[5:7])
    out = []
    while (y, m) <= (ye, me):
        out.append(f'{y:04d}-{m:02d}')
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def prev_month(today=None):
    today = today or dt.date.today()
    y, m = today.year, today.month - 1
    if m == 0:
        y, m = y - 1, 12
    return f'{y:04d}-{m:02d}'


def month_end(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    nxt = dt.date(y + (m == 12), m % 12 + 1, 1)
    return nxt - dt.timedelta(days=1)


def months_between(a, b):
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


# ---------------------------------------------------------------- queries
class Query:
    __slots__ = ('family', 'period', 'reporters', 'codes', 'partners', 'flow')

    def __init__(self, family, period, reporters, codes, partners, flow):
        self.family, self.period, self.flow = family, period, flow
        self.reporters, self.codes = tuple(reporters), tuple(codes)
        self.partners = tuple(partners) if partners else None

    def url(self):
        params = [('reporterCode', ','.join(self.reporters)), ('period', self.period.replace('-', '')),
                  ('cmdCode', ','.join(self.codes)), ('flowCode', self.flow), ('customsCode', 'C00'),
                  ('motCode', '0'), ('partner2Code', '0')]
        if self.partners:
            params.append(('partnerCode', ','.join(self.partners)))
        return BASE + '?' + urllib.parse.urlencode(params, safe=',')

    def name(self):
        p = '-'.join(self.partners) if self.partners else 'all'
        return f"{self.flow}_r{'-'.join(self.reporters)}_c{'-'.join(self.codes)}_p{p}"

    def path(self):
        return RAW / f'comtrade_{self.family}' / self.period / (self.name() + '.json.gz')

    def split_marker(self):
        return RAW / f'comtrade_{self.family}' / self.period / (self.name() + '.split.json')

    def children(self):
        if len(self.codes) > 1:
            h = len(self.codes) // 2
            parts = [(self.reporters, self.codes[:h], self.partners), (self.reporters, self.codes[h:], self.partners)]
        elif len(self.reporters) > 1:
            h = len(self.reporters) // 2
            parts = [(self.reporters[:h], self.codes, self.partners), (self.reporters[h:], self.codes, self.partners)]
        elif self.partners and len(self.partners) > 1:
            h = len(self.partners) // 2
            parts = [(self.reporters, self.codes, self.partners[:h]), (self.reporters, self.codes, self.partners[h:])]
        else:
            return []
        return [Query(self.family, self.period, r, c, p, self.flow) for r, c, p in parts]

    def __repr__(self):
        return f'<{self.family} {self.period} {self.name()}>'


def plan(family, start, end):
    qs = []
    periods = ym_range(start, end)
    if family == 'us_imports':
        for per in periods:
            for grp in US_CODE_GROUPS:
                qs.append(Query(family, per, ['842'], grp, None, 'M'))
    elif family == 'exports':
        codes_by_iso = {i: c for i, c in EXP_REPORTERS}
        groups = [EXP_REPORTERS[i:i + EXP_GROUP_SIZE] for i in range(0, len(EXP_REPORTERS), EXP_GROUP_SIZE)]
        ordered = [[c for _, c in groups[0]], [codes_by_iso[i] for i in EXP_EXTRA_REPORTERS]] + \
                  [[c for _, c in g] for g in groups[1:]]
        for gi, reps in enumerate(ordered):          # group-major = reporter priority order
            codes = EXP_HS_EXTRA if gi == 1 else EXP_HS
            for per in periods:
                qs.append(Query(family, per, reps, codes, EXP_PARTNERS, 'X'))
    else:
        raise ValueError(family)
    return qs


def leaves(q):
    """Resolve split markers recursively (a truncated query was replaced by children)."""
    mk = q.split_marker()
    if mk.exists():
        out = []
        for c in q.children():
            out.extend(leaves(c))
        return out
    return [q]


# ---------------------------------------------------------------- http
class FetchError(Exception):
    pass


def check_url(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme != 'https' or u.hostname not in ALLOWED_HOSTS:
        raise FetchError(f'URL not allowed: {url}')


class Gate:
    """Global spacing between request starts + global pause after 429."""

    def __init__(self, min_interval):
        self.min_interval = min_interval
        self.lock = threading.Lock()
        self.next_ok = 0.0
        self.pause_until = 0.0

    def wait(self):
        while True:
            with self.lock:
                now = time.monotonic()
                t = max(self.next_ok, self.pause_until)
                if now >= t:
                    self.next_ok = now + self.min_interval
                    return
                delay = t - now
            time.sleep(min(delay, 2.0))

    def pause(self, seconds):
        with self.lock:
            self.pause_until = max(self.pause_until, time.monotonic() + seconds)


def http_get(url, gate, timeout=60, tries=7, log=None):
    check_url(url)
    last = None
    attempt = 0
    n429 = 0
    nquota = 0
    while attempt < tries:
        gate.wait()
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                check_url(r.geturl())
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            code = e.code
            try:
                body = e.read()
            except Exception:  # noqa: BLE001
                body = b''
            last = f'HTTP {code} {body[:200]!r}'
            if code == 429 and n429 < 40:
                # rate limited: pause every worker (Retry-After, else exponential), not counted as a try
                n429 += 1
                ra = (e.headers or {}).get('Retry-After')
                base = float(ra) if ra and ra.strip().isdigit() else 5.0
                w = min(300.0, max(base, 1.0) * 2 ** min(n429 - 1, 6))
                if log and (n429 == 1 or n429 % 5 == 0):
                    log(f'429 (x{n429}) -> pausing all workers {w:.0f}s')
                gate.pause(w)
                continue
            if code == 403 and b'quota' in body.lower() and nquota < 6:
                # "Out of call volume quota" is served by some gateway nodes only; other calls keep
                # succeeding, so back off this request (not all workers) and retry.
                nquota += 1
                time.sleep(min(90.0, 5.0 * 2 ** (nquota - 1)))
                continue
            attempt += 1
            if 500 <= code < 600 or code == 429:
                time.sleep(min(120.0, 3.0 * 2 ** attempt))
                continue
            raise FetchError(last)
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError,
                http.client.HTTPException, ssl.SSLError, OSError) as e:
            attempt += 1
            last = f'{type(e).__name__}: {e}'
            time.sleep(min(120.0, 3.0 * 2 ** attempt))
            continue
    raise FetchError(f'gave up after {tries} tries: {last}')


def atomic_write_bytes(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f'.tmp{os.getpid()}.{threading.get_ident()}')
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)


def atomic_write_json(path, obj):
    atomic_write_bytes(path, (json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + '\n').encode('utf-8'))


def read_cache(path):
    with gzip.open(path, 'rb') as f:
        return json.loads(f.read().decode('utf-8'))


def is_stale(q, rec, recent_months, ttl_hours, today):
    """Old periods are immutable enough; recent ones are refreshed after ttl."""
    if months_between(q.period, prev_month(today)) >= recent_months:
        return False
    try:
        t = dt.datetime.fromisoformat(rec['fetched_at'].replace('Z', '+00:00'))
    except Exception:  # noqa: BLE001
        return True
    return (dt.datetime.now(dt.timezone.utc) - t).total_seconds() > ttl_hours * 3600


def fetch_one(q, gate, log):
    """Returns ('ok', n) | ('split', children). Raises FetchError."""
    url = q.url()
    status, body = http_get(url, gate, log=log)
    try:
        doc = json.loads(body.decode('utf-8'))
    except Exception as e:  # noqa: BLE001
        raise FetchError(f'non-JSON response ({e}) {body[:120]!r}')
    if not isinstance(doc, dict) or 'data' not in doc:
        raise FetchError(f'unexpected payload keys {list(doc)[:5] if isinstance(doc, dict) else type(doc)}')
    data = doc.get('data')
    if data is None:
        data = []
    if doc.get('error') and not data:
        raise FetchError(f'API error: {doc.get("error")}')
    if not isinstance(data, list):
        raise FetchError('data is not a list')
    if len(data) >= PREVIEW_ROW_CAP or (isinstance(doc.get('count'), int) and doc['count'] >= PREVIEW_ROW_CAP):
        kids = q.children()
        if not kids:
            raise FetchError(f'truncated at {len(data)} rows and cannot split further')
        atomic_write_json(q.split_marker(), {'reason': f'{len(data)} rows >= preview cap {PREVIEW_ROW_CAP}',
                                             'at': iso_now(), 'children': [k.name() for k in kids]})
        return 'split', kids
    for r in data:  # light sanity check before caching
        if str(r.get('period')) != q.period.replace('-', ''):
            raise FetchError(f'row period {r.get("period")} != {q.period}')
        if str(r.get('reporterCode')) not in q.reporters or r.get('cmdCode') not in q.codes:
            raise FetchError(f'row outside query: reporter {r.get("reporterCode")} cmd {r.get("cmdCode")}')
    rec = {'url': url, 'fetched_at': iso_now(), 'http_status': status, 'count': len(data), 'response': doc}
    atomic_write_bytes(q.path(), gzip.compress(json.dumps(rec, ensure_ascii=False, sort_keys=True).encode('utf-8'), 6))
    return 'ok', len(data)


def cmd_fetch(args, family):
    today = dt.date.today()
    end = args.end or prev_month(today)
    todo = []
    for q0 in plan(family, args.start, end):
        for q in leaves(q0):
            p = q.path()
            if p.exists() and not args.refresh:
                try:
                    rec = read_cache(p)
                    if not is_stale(q, rec, args.recent_months, args.ttl_hours, today):
                        continue
                except Exception:  # noqa: BLE001 — corrupt cache -> refetch
                    pass
            todo.append(q)
    total = len(todo)
    print(f'[{family}] {total} requests to do (periods {args.start}..{end})', flush=True)
    if not total:
        return 0
    gate = Gate(args.spacing)
    t0 = time.monotonic()
    lock = threading.Lock()
    failures = []
    done = [0, 0]

    def log(msg):
        with lock:
            print(f'  [{time.monotonic() - t0:6.0f}s] {msg}', flush=True)

    queue = list(todo)
    workers = max(1, min(3, args.workers))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        inflight = {}
        while queue or inflight:
            while queue and len(inflight) < workers and time.monotonic() - t0 < args.max_seconds:
                q = queue.pop(0)
                inflight[ex.submit(fetch_one, q, gate, log)] = q
            if not inflight:
                break
            fin, _ = wait(list(inflight), return_when=FIRST_COMPLETED)
            for f in fin:
                q = inflight.pop(f)
                try:
                    kind, val = f.result()
                    if kind == 'split':
                        log(f'split {q} -> {len(val)} children')
                        queue[:0] = val
                    else:
                        done[0] += 1
                        done[1] += val
                        if done[0] % 25 == 0:
                            log(f'{done[0]}/{total} done ({done[1]} rows), last {q.period}')
                except FetchError as e:
                    failures.append((q, str(e)))
                    log(f'FAIL {q}: {e}')
    remaining = len(queue)
    err_path = RAW / f'comtrade_{family}' / '_fetch_errors.json'
    prev = {}
    if err_path.exists():
        try:
            prev = json.loads(err_path.read_text(encoding='utf-8'))
        except Exception:  # noqa: BLE001
            prev = {}
    for q, e in failures:
        prev[str(q.path().relative_to(RAW))] = {'error': e, 'at': iso_now(), 'url': q.url()}
    for q in todo:  # clear resolved errors
        k = str(q.path().relative_to(RAW))
        if k in prev and q.path().exists() and not any(fq is q for fq, _ in failures):
            prev.pop(k)
    atomic_write_json(err_path, prev)
    print(f'[{family}] done {done[0]} requests, {done[1]} rows, {len(failures)} failures, '
          f'{remaining} not started (time budget) in {time.monotonic() - t0:.0f}s', flush=True)
    if remaining:
        return 3
    return 4 if failures else 0


# ---------------------------------------------------------------- reference data
def partner_names(gate=None):
    path = RAW / 'comtrade_ref' / 'partnerAreas.json.gz'
    if not path.exists() and gate is not None:
        status, body = http_get(REF_PARTNERS, gate)
        doc = json.loads(body.decode('utf-8-sig'))
        if not doc.get('results'):
            raise FetchError('partnerAreas: empty results')
        atomic_write_bytes(path, gzip.compress(body, 6))
    if not path.exists():
        return {}, 'partner reference file not cached (run fetch)'
    doc = json.loads(gzip.decompress(path.read_bytes()).decode('utf-8-sig'))
    return {str(r['PartnerCode']): r['PartnerDesc'] for r in doc['results']}, None


# ---------------------------------------------------------------- build
class BuildError(Exception):
    pass


def load_rows(family, start, end, allow_partial):
    """Return (rows_by_key, meta, missing, errors)."""
    rows = {}
    meta = {}          # (reporter, year) -> {classificationCode: n}, isOriginal flags
    missing = []
    errors = []
    periods_with_rows = {}
    for q0 in plan(family, start, end):
        for q in leaves(q0):
            p = q.path()
            if not p.exists():
                missing.append(q)
                continue
            try:
                rec = read_cache(p)
                data = rec['response'].get('data') or []
            except Exception as e:  # noqa: BLE001
                raise BuildError(f'corrupt cache {p}: {e}')
            for r in data:
                try:
                    rep = str(int(r['reporterCode']))
                    par = str(int(r['partnerCode']))
                    cmd = str(r['cmdCode'])
                    per = str(r['period'])
                    ym = f'{per[:4]}-{per[4:6]}'
                    flow = r['flowCode']
                    val = r['primaryValue']
                except (KeyError, TypeError, ValueError) as e:
                    raise BuildError(f'bad row in {p}: {e}')
                if ym != q.period or flow != q.flow or cmd not in q.codes or rep not in q.reporters:
                    raise BuildError(f'row does not match query {q}: {rep} {cmd} {ym} {flow}')
                if str(r.get('customsCode')) != 'C00' or int(r.get('motCode', -1)) != 0 or int(r.get('partner2Code', -1)) != 0:
                    continue  # not the total-customs/total-transport/no-2nd-partner slice
                if val is None:
                    continue
                if not isinstance(val, (int, float)) or isinstance(val, bool) or val != val:
                    raise BuildError(f'non-numeric primaryValue in {p}: {val!r}')
                key = (rep, cmd, par, ym)
                orig = bool(r.get('isOriginalClassification'))
                if key in rows and rows[key][0] != float(val):
                    errors.append(f'duplicate row {key}: {rows[key][0]} vs {val} (kept isOriginalClassification=True one)')
                    if not orig:
                        continue
                rows[key] = (float(val), orig, r.get('classificationCode'))
                m = meta.setdefault((rep, ym[:4]), {})
                cc = f"{r.get('classificationCode')}{'' if orig else '(converted)'}"
                m[cc] = m.get(cc, 0) + 1
                periods_with_rows.setdefault(rep, set()).add(ym)
    if missing and not allow_partial:
        raise BuildError(f'{len(missing)} planned responses not in cache (first: {missing[0]!r}); run fetch or pass --allow-partial')
    for q in missing:
        errors.append(f'not fetched: {q.period} {q.name()}')
    return rows, meta, periods_with_rows, errors


def vintage_note(meta, rep):
    by_year = {}
    for (r, y), m in meta.items():
        if r == rep:
            by_year[y] = '/'.join(sorted(m))
    if not by_year:
        return ''
    spans = []
    for y in sorted(by_year):
        if spans and spans[-1][2] == by_year[y]:
            spans[-1][1] = y
        else:
            spans.append([y, y, by_year[y]])
    return 'HS vintage as reported: ' + ', '.join(f'{a}-{b} {c}' if a != b else f'{a} {c}' for a, b, c in spans)


def lag_days(latest_ym, fetched):
    """Upper bound: days from end of the latest available month to the fetch date."""
    return (fetched - month_end(latest_ym)).days


def validate_doc(doc):
    if doc.get('schema') != 'grid-composite-proxy/1':
        raise BuildError('schema')
    if not doc['series']:
        raise BuildError('no series')
    for sid, s in doc['series'].items():
        for k in ('label', 'label_ko', 'unit', 'freq', 'agg', 'kind', 'obs', 'release_lag_days'):
            if k not in s:
                raise BuildError(f'{sid}: missing {k}')
        if not s['obs']:
            raise BuildError(f'{sid}: empty obs')
        for k, v in s['obs'].items():
            if len(k) != 7 or k[4] != '-' or not isinstance(v, float) or v < 0:
                raise BuildError(f'{sid}: bad obs {k}={v!r}')


def write_out(path, doc):
    validate_doc(doc)
    atomic_write_json(path, doc)


def build_us_imports(args):
    fetched = dt.date.today()
    end = args.end or prev_month(fetched)
    rows, meta, pwr, errors = load_rows('us_imports', args.start, end, args.allow_partial)
    names, nerr = partner_names()
    if nerr:
        errors.append(nerr)
    months = sorted(pwr.get('842', ()))
    if not months:
        raise BuildError('no US rows at all')
    latest = months[-1]
    lag = lag_days(latest, fetched)
    world = {}
    by_hs = {}
    for (rep, cmd, par, ym), (v, _, _) in rows.items():
        by_hs.setdefault(cmd, {}).setdefault(par, {})[ym] = v
    vnote = vintage_note(meta, '842')
    # consistency: sum of partners vs World
    for cmd, parts in by_hs.items():
        w = parts.get('0', {})
        for ym, wv in w.items():
            s = sum(parts[p].get(ym, 0.0) for p in parts if p != '0')
            if wv > 0 and abs(s - wv) / wv > 0.01:
                errors.append(f'{cmd} {ym}: sum of partners {s:.0f} differs from World {wv:.0f} by >1%')
    series = {}
    selected = {}
    for cmd in US_HS:
        parts = by_hs.get(cmd)
        if not parts or '0' not in parts:
            errors.append(f'HS {cmd}: no World rows')
            continue
        wsum = sum(v for ym, v in parts['0'].items() if ym >= US_SHARE_FROM)
        sel = {'0'}
        for par, obs in parts.items():
            if par == '0':
                continue
            share = sum(v for ym, v in obs.items() if ym >= US_SHARE_FROM) / wsum if wsum > 0 else 0.0
            if share >= US_SHARE_MIN or par in US_ALWAYS:
                sel.add(par)
        selected[cmd] = sel
        world[cmd] = wsum
        for par in sorted(sel, key=int):
            obs = parts[par]
            share = sum(v for ym, v in obs.items() if ym >= US_SHARE_FROM) / wsum if wsum > 0 else 0.0
            series[f'us_imp_{cmd}_p{par}'] = us_series(cmd, par, obs, names, lag, vnote, share, cmd_label=HS_LABEL[cmd])
    # aggregates
    for agg, (a, b) in {'8504dist': ('850421', '850422'), '8504dry': ('850433', '850434')}.items():
        pa, pb = by_hs.get(a, {}), by_hs.get(b, {})
        pars = selected.get(a, set()) | selected.get(b, set())
        for par in sorted(pars, key=int):
            oa, ob = pa.get(par, {}), pb.get(par, {})
            obs = {ym: oa[ym] + ob[ym] for ym in sorted(set(oa) & set(ob))}
            if not obs:
                errors.append(f'us_imp_{agg}_p{par}: no month with both {a} and {b} present — not emitted')
                continue
            dropped = len(set(oa) ^ set(ob))
            s = us_series(agg, par, obs, names, lag, vnote, None, cmd_label=AGG_LABEL[agg][1:])
            s['hs'] = AGG_LABEL[agg][0]
            s['notes'] = (f'Sum of HS{a}+HS{b}; emitted only for months where BOTH components have a Comtrade row '
                          f'({dropped} month(s) with only one component omitted). ' + s['notes'])
            series[f'us_imp_{agg}_p{par}'] = s
    doc = {
        'schema': 'grid-composite-proxy/1',
        'family': 'comtrade_us_imports',
        'fetched_at': iso_now(),
        'fetch_tool': FETCH_TOOL,
        'source': {'name': 'UN Comtrade public preview API (no key)', 'url': BASE,
                   'query': 'reporterCode=842&flowCode=M&customsCode=C00&motCode=0&partner2Code=0&cmdCode=<HS6 group>&period=<YYYYMM>'},
        'coverage': {'first': months[0], 'last': latest, 'n_months': len(months),
                     'missing_months': [m for m in ym_range(months[0], latest) if m not in set(months)],
                     'selection': f'World + partners with >= {US_SHARE_MIN:.1%} of HS World value over {US_SHARE_FROM}..{latest} + fixed list {",".join(US_ALWAYS)} if present'},
        'series': series,
        'errors': sorted(set(errors)),
    }
    return doc


def us_series(cmd, par, obs, names, lag, vnote, share, cmd_label):
    pname = 'World' if par == '0' else names.get(par, f'partner {par}')
    ko = NAME_KO.get(par) or pname
    en, kol = cmd_label
    hs_txt = cmd if cmd.isdigit() else AGG_LABEL[cmd][0]
    note = ('Comtrade primaryValue (US imports: CIF value, USD) for customsCode C00 / motCode 0 / partner2Code 0. '
            'Months with no Comtrade row are omitted, not zero-filled. '
            f'release_lag_days = days from end of latest available month to fetch date (upper bound; US Census FT900 itself publishes ~35 days after month end). {vnote}.')
    if share is not None and par != '0':
        note += f' Partner share of HS World value {US_SHARE_FROM}..latest: {share:.2%}.'
    if par == '490':
        note += ' Partner 490 "Other Asia, nes" = Taiwan in Comtrade.'
    return {
        'label': f'US imports HS{hs_txt} ({en}) from {pname}',
        'label_ko': f'미국 수입 HS{hs_txt}({kol}) · {ko}{"" if par == "0" else "발"}',
        'unit': 'USD', 'freq': 'M', 'agg': 'sum',
        'kind': 'trade_total' if par == '0' else 'trade_route',
        'geo': 'US', 'hs': hs_txt, 'reporter': '842', 'partner': par, 'flow': 'M',
        'release_lag_days': lag,
        'notes': note,
        'obs': {k: obs[k] for k in sorted(obs)},
    }


def build_exports(args):
    fetched = dt.date.today()
    end = args.end or prev_month(fetched)
    rows, meta, pwr, errors = load_rows('exports', args.start, end, args.allow_partial)
    names, nerr = partner_names()
    if nerr:
        errors.append(nerr)
    all_months = ym_range(args.start, end)
    coverage = {}
    for iso, code in EXP_REPORTERS:
        ms = sorted(pwr.get(code, ()))
        if not ms:
            coverage[iso] = {'reporter': code, 'n_months': 0}
            errors.append(f'{iso} ({code}): no monthly export rows returned for any planned period {args.start}..{end}')
            continue
        gaps = [m for m in ym_range(ms[0], ms[-1]) if m not in set(ms)]
        coverage[iso] = {'reporter': code, 'first': ms[0], 'last': ms[-1], 'n_months': len(ms),
                         'missing_months_inside_span': gaps,
                         'lag_upper_bound_days': lag_days(ms[-1], fetched),
                         'hs_vintage': vintage_note(meta, code)}
        if ms[0] > args.start:
            errors.append(f'{iso} ({code}): monthly data starts {ms[0]} (nothing for {args.start}..{prev_of(ms[0])})')
        if gaps:
            errors.append(f'{iso} ({code}): {len(gaps)} month(s) with no rows inside {ms[0]}..{ms[-1]}: {compress_months(gaps)}')
        if months_between(ms[-1], end) > 0:
            errors.append(f'{iso} ({code}): latest month {ms[-1]} (not yet/never reported {next_of(ms[-1])}..{end})')
    by = {}
    for (rep, cmd, par, ym), (v, _, _) in rows.items():
        by.setdefault((rep, cmd, par), {})[ym] = v
    # consistency: bilateral <= World
    for (rep, cmd, par), obs in by.items():
        if par == '0':
            continue
        w = by.get((rep, cmd, '0'), {})
        for ym, v in obs.items():
            if ym in w and v > w[ym] * 1.001 + 1:
                errors.append(f'{ISO2_BY_CODE.get(rep, rep)} {cmd} {ym}: exports to {par} ({v:.0f}) exceed World ({w[ym]:.0f})')
            if ym not in w:
                errors.append(f'{ISO2_BY_CODE.get(rep, rep)} {cmd} {ym}: partner {par} row present but no World row')
    series = {}
    for (rep, cmd, par), obs in sorted(by.items(), key=lambda kv: (kv[0][0], kv[0][1], int(kv[0][2]))):
        iso = ISO2_BY_CODE[rep]
        cov = coverage[iso]
        pname = 'World' if par == '0' else names.get(par, f'partner {par}')
        rname = names.get(rep, iso)
        en, kol = HS_LABEL[cmd]
        note = (f'Comtrade primaryValue (exports: FOB value, USD) reported by {rname}; customsCode C00 / motCode 0 / partner2Code 0. '
                f'Months with no Comtrade row are omitted, not zero-filled. Reporter monthly coverage {cov["first"]}..{cov["last"]} '
                f'({cov["n_months"]} months with any row'
                + (f'; months with no rows at all: {compress_months(cov["missing_months_inside_span"])}' if cov['missing_months_inside_span'] else '')
                + f'). release_lag_days = days from end of reporter latest month to fetch date (upper bound). {cov["hs_vintage"]}.')
        if rep == '484' and par == '842':
            note += ' Mirror check: compare with us_imp_' + cmd + '_p484 (US-reported imports, CIF).'
        series[f'{iso.lower()}_exp_{cmd}_p{par}'] = {
            'label': f'{rname} exports HS{cmd} ({en}) to {pname}',
            'label_ko': f'{NAME_KO.get(rep, rname)} 수출 HS{cmd}({kol}) → {NAME_KO.get(par, pname)}',
            'unit': 'USD', 'freq': 'M', 'agg': 'sum',
            'kind': 'trade_total' if par == '0' else 'trade_route',
            'geo': iso, 'hs': cmd, 'reporter': rep, 'partner': par, 'flow': 'X',
            'release_lag_days': cov['lag_upper_bound_days'],
            'notes': note,
            'obs': {k: obs[k] for k in sorted(obs)},
        }
    doc = {
        'schema': 'grid-composite-proxy/1',
        'family': 'comtrade_exports',
        'fetched_at': iso_now(),
        'fetch_tool': FETCH_TOOL,
        'source': {'name': 'UN Comtrade public preview API (no key)', 'url': BASE,
                   'query': 'reporterCode=<group>&flowCode=X&partnerCode=0,842,124,484&customsCode=C00&motCode=0&partner2Code=0&cmdCode=<HS6>&period=<YYYYMM>'},
        'coverage': coverage,
        'planned_months': {'first': all_months[0], 'last': all_months[-1]},
        'series': series,
        'errors': sorted(set(errors)),
    }
    return doc


def prev_of(ym):
    y, m = int(ym[:4]), int(ym[5:7]) - 1
    if m == 0:
        y, m = y - 1, 12
    return f'{y:04d}-{m:02d}'


def next_of(ym):
    y, m = int(ym[:4]), int(ym[5:7]) + 1
    if m == 13:
        y, m = y + 1, 1
    return f'{y:04d}-{m:02d}'


def compress_months(ms):
    if not ms:
        return ''
    out, a, b = [], ms[0], ms[0]
    for m in ms[1:]:
        if m == next_of(b):
            b = m
        else:
            out.append(a if a == b else f'{a}..{b}')
            a = b = m
    out.append(a if a == b else f'{a}..{b}')
    return ', '.join(out)


OUT_NAME = {'us_imports': 'comtrade_us_imports.json', 'exports': 'comtrade_exports.json'}
BUILDERS = {'us_imports': build_us_imports, 'exports': build_exports}


def cmd_build(args, family):
    path = OUT / OUT_NAME[family]
    try:
        doc = BUILDERS[family](args)
        write_out(path, doc)
    except BuildError as e:
        print(f'[{family}] BUILD FAILED (kept existing {path.name}): {e}', file=sys.stderr)
        return 2
    n = sum(len(s['obs']) for s in doc['series'].values())
    print(f'[{family}] wrote {path} : {len(doc["series"])} series, {n} obs, {len(doc["errors"])} error notes')
    return 0


def cmd_status(args, family):
    end = args.end or prev_month()
    qs = [q for q0 in plan(family, args.start, end) for q in leaves(q0)]
    have = [q for q in qs if q.path().exists()]
    size = sum(p.stat().st_size for p in (RAW / f'comtrade_{family}').rglob('*') if p.is_file()) if (RAW / f'comtrade_{family}').exists() else 0
    miss = sorted({q.period for q in qs if not q.path().exists()})
    print(f'[{family}] cached {len(have)}/{len(qs)} leaf queries, raw {size / 1e6:.1f} MB; missing periods: {compress_months(miss)}')
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('command', choices=['fetch', 'build', 'status', 'run'])
    ap.add_argument('--family', choices=['us_imports', 'exports', 'all'], default='all')
    ap.add_argument('--start', default=START)
    ap.add_argument('--end', default=None, help='YYYY-MM (default: previous calendar month)')
    ap.add_argument('--max-seconds', type=float, default=480.0)
    ap.add_argument('--workers', type=int, default=3)
    ap.add_argument('--spacing', type=float, default=1.0, help='min seconds between request starts (global)')
    ap.add_argument('--recent-months', type=int, default=6, help='periods this close to today are re-fetched after --ttl-hours')
    ap.add_argument('--ttl-hours', type=float, default=20.0)
    ap.add_argument('--refresh', action='store_true', help='re-fetch everything')
    ap.add_argument('--allow-partial', action='store_true')
    args = ap.parse_args(argv)
    fams = ['us_imports', 'exports'] if args.family == 'all' else [args.family]
    rc = 0
    if args.command in ('fetch', 'run'):
        try:
            partner_names(Gate(args.spacing))
        except (FetchError, ValueError, KeyError) as e:
            print(f'partner reference fetch failed: {e}', file=sys.stderr)
        t_start = time.monotonic()
        budget = args.max_seconds
        for fam in fams:
            args.max_seconds = max(0.0, budget - (time.monotonic() - t_start))
            r = cmd_fetch(args, fam)
            rc = max(rc, r)
            if r == 3:
                break
        args.max_seconds = budget
        if args.command == 'fetch' or rc:
            return rc
    if args.command in ('build', 'run'):
        for fam in fams:
            rc = max(rc, cmd_build(args, fam))
    if args.command == 'status':
        for fam in fams:
            cmd_status(args, fam)
    return rc


if __name__ == '__main__':
    sys.exit(main())
