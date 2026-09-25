#!/usr/bin/env python3
"""전력기기 피어 컴포짓 빌더 — 프록시 선행성·동행성 검정 + rolling-origin 앙상블.

입력: spec/peers.json · data/actuals/*.json · data/proxies/*.json (CONTRACT.md)
출력: out/composite.json (화면 grid/composite.html 이 읽는다)

방법 요약(README.md 상세):
  1. 회계 분기 → 달력 3개월 창(결산일−14일이 속한 달이 마지막 달). 프록시는 3/3 개월이 모두 있을 때만 집계.
  2. 로그 YoY. 타깃은 같은 보고서의 전년 동기 비교값(prior_year_comparative)을 우선 분모로 쓴다.
  3. 교차상관 r_k (k=−2…+4 분기, k>0 = 프록시가 k 분기 먼저) · 유효표본 n_eff 로 p · 회사 내 BH-FDR ·
     AR 사전백색화 상관(지속성 착시 제거) · 전환점 선행 분기 중앙값.
  4. rolling-origin: 원점 t 마다 t 이전 분기만으로 시차 k∈{0…4} 선택·OLS 적합 → t 예측(정직한 시차 선택).
  5. 앙상블: 원점마다 학습 상관·과거 OOS 성적으로 선별 → 동일가중(주) · 역MSE(부) 결합.
     기준모형: 0YoY(전년 동기 그대로) · 직전 YoY · 학습 평균 · AR(1). 같은 분기 집합에서 비교.
  6. 게이트를 통과한 회사만 현재 분기 나우캐스트 수치를 공개한다(fail-closed).
"""
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stats_core as sc  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
LAGS = [-2, -1, 0, 1, 2, 3, 4]
LEAD_LAGS = [0, 1, 2, 3, 4]
MIN_TRAIN = 8
MIN_OOS = 8
PW_MIN_N = 12  # 사전백색화 상관을 판정에 쓰는 최소 짝 수(분기). 월은 24.
SCREEN_T = 1.0
FDR_Q = 0.10
LEAD_MARGIN = 0.05
MAX_CANDIDATES = 28
# 범위를 바꾸는 구조 변화 유형 — 같은 보고서 비교값이 없는 분기의 YoY 를 이 변화에 걸쳐 만들지 않는다.
SCOPE_BREAK_TYPES = {'divestiture', 'restatement', 'segment_reorg', 'excluded_predecessor_successor_history', 'pending_disposal'}
# 나우캐스트 공개를 막지 않는 유형(매출 범위와 무관)
NON_GATING_BREAK_TYPES = {'capacity_expansion', 'capacity', 'listing', 'ownership_change', 'equity_method_investment'}
ANCHOR_RAW = 'trass_sanil_ansan_8504212'
ANCHOR_SERIES = 'trass_sanil_ansan_8504212_post'
# 산일전기 대미 수출이 분기 1천만 달러를 처음 넘은 2022Q3 부터만 쓴다 — 그 전 YoY 는 신규 고객 진입(램프업) 기저효과라
# 산업 사이클과 무관하다(2018Q1 76만 달러 → 2025Q4 9,630만 달러). 상관 결과를 보기 전 규칙이 아니라 기저효과 확인 후 1회 도입.
ANCHOR_RAMP_START = '2022-07'

# ── 사전 등록 후보(결과를 보기 전에 제품·지역 논리로 고정) ─────────────
GLOBAL_CANDIDATES = [
    'us_imp_8504dist_p0', 'us_imp_850423_p0', 'us_imp_8504dry_p0', 'fred_IPG3353S', 'fred_A35SNO',
    'fred_A35SUO', 'fred_WPU117409', 'fred_TLPWRCONS', 'eurostat_ip_C271_EU27_2020',
]
REGIONAL_CANDIDATES = {
    'Korea': ['trass_kr_8504212', 'us_imp_8504dist_p410', 'us_imp_850423_p410', 'us_imp_850422_p410',
              'us_imp_850421_p410', 'kr_exp_850422_p842', 'kr_exp_850423_p842', 'kr_exp_850423_p0', 'kr_exp_850422_p0'],
    'North America': ['us_imp_8504dist_p484', 'us_imp_8504dry_p484', 'us_imp_8504dry_p124', 'us_imp_850423_p484',
                      'us_imp_853710_p0', 'us_imp_853720_p0', 'statcan_mfg_sales_335', 'statcan_mfg_salesnsa_335311',
                      'statcan_mfg_newordersnsa_335311', 'fred_A35SVS', 'fred_PCU335313335313', 'fred_PROFCONS',
                      'fred_PRPWRCONS', 'inegi_emim_vp_335312', 'mx_exp_850422_p842', 'mx_exp_850423_p842'],
    'Europe': ['eurostat_ip_C2711_DE', 'eurostat_ip_C2711_IT', 'eurostat_ip_C2711_ES', 'eurostat_ip_C2711_FR',
               'eurostat_ip_C2712_EU27_2020', 'eurostat_ip_C27_AT', 'eurostat_ip_C27_SE', 'eurostat_turnover_C27_EU27_2020',
               'eurostat_ppi_C2711_EU27_2020', 'de_exp_850423_p0', 'de_exp_850423_p842', 'se_exp_850423_p0',
               'it_exp_850423_p0', 'es_exp_850423_p0', 'us_imp_850423_p276', 'us_imp_853710_p0', 'us_imp_853720_p0'],
    'Japan': ['meti_transformer_prod_value', 'meti_transformer_nonstd_prod_value', 'meti_transformer_large_prod_value',
              'meti_transformer_std_prod_value', 'meti_switchgear_prod_value', 'meti_gis_prod_value',
              'jema_orders_transformer_q', 'jema_orders_total_q', 'jema_orders_utility_q', 'jp_exp_850423_p0',
              'jp_exp_850422_p0', 'us_imp_850423_p392'],
    'Taiwan': ['us_imp_850423_p490', 'us_imp_8504dist_p490', 'us_imp_850422_p490', 'us_imp_850421_p490',
               'moea_ip_2810', 'moea_pvi_28', 'moea_export_orders_electrical'],
    'China': ['cn_exp_850423_p0', 'cn_exp_850422_p0', 'cn_exp_850421_p0', 'cn_exp_850434_p0', 'cn_exp_850433_p0',
              'nea_grid_investment_q', 'us_imp_8504dry_p156', 'us_imp_850423_p156'],
    'India': ['in_exp_850423_p0', 'in_exp_850422_p0', 'in_exp_850421_p0', 'in_exp_850423_p842', 'in_exp_850422_p842',
              'in_exp_850421_p842', 'us_imp_8504dist_p699', 'us_imp_850423_p699', 'india_iip_27', 'india_iip_capgoods'],
    'Latin America and Middle East': ['br_exp_850423_p0', 'br_exp_850422_p0', 'br_exp_850421_p0', 'br_exp_850423_p842',
                                      'ibge_pim_c27', 'us_imp_850423_p76', 'us_imp_8504dist_p76', 'mx_exp_850422_p842',
                                      'mx_exp_850423_p842', 'eg_exp_850421_p0', 'eg_exp_850422_p0', 'eg_exp_850423_p0',
                                      'tr_exp_850423_p0'],
}
ID_OVERRIDES = {
    'SANIL': ['trass_sanil_ansan_8504212', 'trass_sanil_ansan_850421', 'trass_sanil_ansan_850422', 'kre_8504219010',
              'kre_8504219020'],
    'JERYONG': ['trass_jeryong_gwangjin', 'trass_jeryong_gwangjin_8504219020', 'kre_8504219010', 'kre_8504219020'],
    'KOEI': ['hr_exp_850423_p0', 'hr_exp_850422_p0', 'hr_exp_850421_p0', 'us_imp_850423_p191'],
    'KODT': ['hr_exp_850421_p0', 'hr_exp_850422_p0', 'hr_exp_850423_p0'],
    'RSGN': ['ch_exp_850423_p0', 'pl_exp_850423_p0', 'eurostat_ip_C27_PL'],
    'SWDY': ['eg_exp_850421_p0', 'eg_exp_850422_p0', 'eg_exp_850423_p0'],
    'WEG': ['br_exp_850423_p842', 'br_exp_850422_p842', 'mx_exp_850423_p842', 'ibge_pim_c27'],
    'HPSA': ['statcan_mfg_salesnsa_335311', 'statcan_mfg_newordersnsa_335311', 'statcan_mfg_salesnsa_335311_ON',
             'us_imp_850433_p124', 'us_imp_850434_p124', 'us_imp_850433_p484', 'us_imp_850434_p484'],
    'FORTUNE': ['us_imp_850423_p490', 'us_imp_850422_p490'],
}


# ── 입력 ──────────────────────────────────────────────────────
def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def month_index(ym):
    y, m = ym.split('-')[:2]
    return int(y) * 12 + int(m) - 1


def ym_of(mi):
    return f'{mi // 12:04d}-{mi % 12 + 1:02d}'


def end_month_of(date_str):
    """결산일 − 14일이 속한 달(52/53주 결산의 1월 초 종료를 12월로 돌린다)."""
    y, m, d = (int(v) for v in date_str.split('-'))
    mi = y * 12 + m - 1
    if d <= 14:
        mi -= 1
    return mi


def load_proxies():
    catalog = {}
    for path in sorted((ROOT / 'data' / 'proxies').glob('*.json')):
        doc = load_json(path)
        if doc.get('schema') != 'grid-composite-proxy/1':
            continue
        for sid, s in (doc.get('series') or {}).items():
            freq = s.get('freq')
            if freq == 'M':
                obs = {month_index(k): float(v) for k, v in (s.get('obs') or {}).items()}
                qonly = False
            elif freq == 'Q':
                # 분기 계열은 달력 분기 말 월에만 값을 둔다(3개월 창 = 그 분기). 월 진단에는 쓰지 않는다.
                obs = {int(k[:4]) * 12 + int(k[-1]) * 3 - 1: float(v) for k, v in (s.get('obs') or {}).items()}
                qonly = True
            else:
                continue
            if len(obs) < (8 if qonly else 24):
                continue
            catalog[sid] = {
                'id': sid, 'family': doc.get('family'), 'label': s.get('label'), 'label_ko': s.get('label_ko') or s.get('label'),
                'unit': s.get('unit'), 'agg': s.get('agg'), 'kind': s.get('kind'), 'qonly': qonly,
                'release_lag_days': s.get('release_lag_days'), 'notes': s.get('notes'), 'obs': obs,
                'first': ym_of(min(obs)), 'last': ym_of(max(obs)), 'source': (doc.get('source') or {}).get('name'),
            }
    raw = catalog.get(ANCHOR_RAW)
    if raw:
        cut = month_index(ANCHOR_RAMP_START)
        post = {m: v for m, v in raw['obs'].items() if m >= cut}
        catalog[ANCHOR_SERIES] = dict(raw, id=ANCHOR_SERIES, obs=post, first=ym_of(min(post)), last=ym_of(max(post)),
                                      label_ko='안산시 HS850421·22 수출(램프업 이후 2022-07~, 산일전기 출하 대리)',
                                      notes=(raw.get('notes') or '') + ' 램프업 이후만(2022-07~).')
    kr, an = catalog.get('trass_kr_8504212'), catalog.get(ANCHOR_RAW)
    if kr and an:
        res_obs = {m: kr['obs'][m] - an['obs'][m] for m in kr['obs'] if m in an['obs'] and kr['obs'][m] - an['obs'][m] > 0}
        if len(res_obs) >= 24:
            catalog['trass_kr_8504212_exansan'] = dict(kr, id='trass_kr_8504212_exansan', obs=res_obs,
                                                       label_ko='한국 HS850421·22 수출 − 안산(산일 제외 국내 동업계, TRASS)',
                                                       first=ym_of(min(res_obs)), last=ym_of(max(res_obs)),
                                                       notes='같은 TRASS 원천·단위(천 USD)의 국가 합계에서 안산시 신고분을 뺀 잔차.')
    ytd = catalog.get('nea_grid_investment_ytd')
    if ytd:
        # 누계(YTD) → 분기 유량: 3월 = 1~3월 누계, 그 외 = 누계(m) − 누계(m−3) (같은 해 안에서만)
        q = {}
        for m, v in ytd['obs'].items():
            if m % 3 != 2:
                continue
            if m % 12 == 2:
                q[m] = v
            elif (m - 3) in ytd['obs'] and (m - 3) // 12 == m // 12:
                q[m] = v - ytd['obs'][m - 3]
        if len(q) >= 8:
            catalog['nea_grid_investment_q'] = dict(ytd, id='nea_grid_investment_q', obs=q, qonly=True, agg='sum',
                                                    label_ko='중국 전력망 공사 완료 투자(분기 유량, NEA 누계 차분)',
                                                    first=ym_of(min(q)), last=ym_of(max(q)),
                                                    notes='NEA 누계 발표를 같은 해 안에서 분기 차분. 2025-12 이후 발표에 투자 항목 없음.')
    return catalog


def window_value(proxy, end_mi, months=3, allow_partial=False):
    """프록시 창 집계. 완결(3/3)이 아니면 None — allow_partial 이면 (값, 관측월들) 반환."""
    if proxy.get('qonly'):
        ends = list(range(end_mi, end_mi - months, -3))
        if any(e not in proxy['obs'] for e in ends) or allow_partial:
            return None
        vals = [proxy['obs'][e] for e in ends]
        return sum(vals) if proxy['agg'] == 'sum' else (sum(vals) / len(vals) if proxy['agg'] == 'mean' else vals[0])
    ms = list(range(end_mi - months + 1, end_mi + 1))
    have = [m for m in ms if m in proxy['obs']]
    if len(have) < months and not allow_partial:
        return None
    if not have:
        return None
    vals = [proxy['obs'][m] for m in have]
    agg = proxy['agg']
    if agg == 'sum':
        v = sum(vals)
    elif agg == 'mean':
        v = sum(vals) / len(vals)
    else:
        v = proxy['obs'][max(have)]
    if allow_partial:
        return v, have
    return v


def proxy_yoy(proxy, end_mi, months=3):
    a = window_value(proxy, end_mi, months)
    b = window_value(proxy, end_mi - 12, months)
    if a is None or b is None or a <= 0 or b <= 0:
        return None
    return math.log(a / b)


def proxy_partial_yoy(proxy, end_mi, months=3):
    """부분 관측 YoY — 현재 창에서 관측된 달과 같은 달의 전년 값만 비교한다."""
    cur = window_value(proxy, end_mi, months, allow_partial=True)
    if cur is None:
        return None
    _, have = cur
    prev = [m - 12 for m in have]
    if any(p not in proxy['obs'] for p in prev):
        return None
    agg = proxy['agg']
    cv = [proxy['obs'][m] for m in have]
    pv = [proxy['obs'][m] for m in prev]
    if agg == 'sum':
        a, b = sum(cv), sum(pv)
    elif agg == 'mean':
        a, b = sum(cv) / len(cv), sum(pv) / len(pv)
    else:
        a, b = cv[-1], pv[-1]
    if a <= 0 or b <= 0:
        return None
    return math.log(a / b), [ym_of(m) for m in have]


# ── 타깃 ──────────────────────────────────────────────────────
def target_quarters(doc, tname):
    t = doc['targets'][tname]
    freq = t.get('freq')
    rows = []
    if freq == 'M':
        by_q = {}
        for p in t['points']:
            mi = month_index(p['month'])
            qend = mi - (mi % 3) + 2
            by_q.setdefault(qend, {})[mi] = p['value']
        for qend, months in sorted(by_q.items()):
            if len(months) == 3:
                rows.append({'key': f'{ym_of(qend)}', 'end_mi': qend, 'value': sum(months.values()),
                             'comparative': None, 'months': 3})
        return rows, 3
    months = 6 if freq == 'H' else 3
    for p in t['points']:
        if not p.get('period_end'):
            continue
        rows.append({'key': p['fiscal_key'], 'end_mi': end_month_of(p['period_end']), 'value': p['value'],
                     'comparative': p.get('prior_year_comparative'), 'months': months,
                     'currency': p.get('currency')})
    rows.sort(key=lambda r: r['end_mi'])
    return rows, months


def applies(b, tname):
    """구조 변화가 이 타깃에 해당하는가(target 필드·affects_target=false 주석 반영)."""
    if b.get('affects_target') is False:
        return False
    tg = b.get('target')
    return not tg or tname in str(tg)


def target_yoy(rows, breaks=None, tname=None):
    """로그 YoY. 같은 보고서의 전년 비교값이 있으면 그것을 분모로(동일 범위). 없으면 12개월 전 포인트를 쓰되,
    통화가 다르거나 그 사이에 범위를 바꾸는 구조 변화(매각·재작성·세그먼트 재편, 또는 affected_fiscal_keys 에 든 분기)가
    있으면 YoY 를 만들지 않는다(범위가 다른 두 값을 나누지 않는다)."""
    by_end = {r['end_mi']: r for r in rows}
    out = {}
    for r in rows:
        if r['value'] is None or r['value'] <= 0:
            continue
        base, basis = None, None
        if r.get('comparative'):
            base, basis = r['comparative'], 'comparative'
        else:
            for off in (12, 11, 13):
                prev = by_end.get(r['end_mi'] - off)
                if prev and prev['value'] and prev['value'] > 0 and prev.get('currency') == r.get('currency'):
                    if any(applies(b, tname) and (r['key'] in (b.get('affected_fiscal_keys') or [])
                                                  or (b.get('type') in SCOPE_BREAK_TYPES and b.get('date')
                                                      and prev['end_mi'] < month_index(b['date'][:7]) <= r['end_mi']))
                           for b in (breaks or [])):
                        basis = 'blocked_break'
                        break
                    base, basis = prev['value'], 'prior_point'
                    break
        if base:
            out[r['end_mi']] = (math.log(r['value'] / base), basis)
    return out


# ── 선후행 ────────────────────────────────────────────────────
def aligned(y, x):
    ks = sorted(set(y) & set(x))
    return ks, [x[k] for k in ks], [y[k] for k in ks]


def proxy_yoy_by_lag(proxy, end_mis, months, lags, step):
    out = {}
    for k in lags:
        d = {}
        for e in end_mis:
            v = proxy_yoy(proxy, e - step * k, months)
            if v is not None:
                d[e] = v
        out[k] = d
    return out


def ccf_table(y, xl, sign):
    rows = []
    for k, x in xl.items():
        ks, xs, ys = aligned(y, x)
        n = len(ks)
        r = sc.pearson(xs, ys) if n >= 8 else None
        neff = sc.n_effective(xs, ys) if r is not None else None
        p = sc.corr_pvalue(r, neff) if r is not None else None
        rows.append({'k': k, 'n': n, 'r': r, 'n_eff': neff, 'p': p, 'signed_r': (r * sign) if r is not None else None})
    return rows


def prewhiten(y, proxy, months, step, max_p=2):
    """프록시 YoY 전체 이력으로 AR(≤2) 를 적합하고 같은 필터를 타깃에도 적용한다(Box–Jenkins 사전백색화).
    겹치는 YoY 창이 만든 공통 지속성을 걷어낸 뒤 남는 시차 구조로 선행·동행을 판정한다.
    반환 (xf, yf) — 분기 번호(q = 월 인덱스 // step) 키 사전."""
    if not y or not proxy['obs']:
        return None
    res = min(y) % step
    full = {}
    start = min(proxy['obs']) + 12 + (0 if proxy.get('qonly') else months - 1)
    for e in range(start, max(proxy['obs']) + 1):
        if e % step != res:
            continue
        v = proxy_yoy(proxy, e, months)
        if v is not None:
            full[e // step] = v
    ar = sc.fit_ar_dict(full, max_p)
    if ar is None:
        return None
    return sc.ar_filter(full, ar), sc.ar_filter({m // step: v for m, v in y.items()}, ar)


COVID_Q = (month_index('2020-03') // 3, month_index('2021-06') // 3)  # 팬데믹 급락·기저효과 분기(달력 분기 번호)


def pw_ccf(pw, lags, sign, step=3, min_n=12):
    rows = []
    if pw is None:
        return [{'k': k, 'n': 0, 'r': None, 'p': None, 'signed_r': None, 'r_excovid': None} for k in lags]
    xf, yf = pw
    lo, hi = (COVID_Q[0] * 3) // step, (COVID_Q[1] * 3 + 2) // step

    def in_covid(q):
        return lo <= q <= hi
    for k in lags:
        pairs = [(xf[q - k], v, q) for q, v in yf.items() if (q - k) in xf]
        n = len(pairs)
        xs_, ys_ = [a for a, _, _ in pairs], [b for _, b, _ in pairs]
        r = sc.pearson(xs_, ys_) if n >= min_n else None
        p_one = None
        if r is not None:
            # 사전백색화 뒤에도 남는 계절(겹치는 YoY) 자기상관을 유효표본으로 보정한다(분기 lag≤6, 월 lag≤12).
            neff = sc.n_effective(xs_, ys_, max_lag=max(1, min(12 if step == 1 else 6, n // 3)))
            p2 = sc.corr_pvalue(r, neff)
            p_one = p2 / 2 if r * sign > 0 else 1 - p2 / 2
        ex = [(a, b) for a, b, q in pairs if not in_covid(q) and not in_covid(q - k)]
        r_ex = sc.pearson([a for a, _ in ex], [b for _, b in ex]) if len(ex) >= 8 else None
        rows.append({'k': k, 'n': n, 'r': r, 'p': p_one, 'signed_r': (r * sign) if r is not None else None,
                     'r_excovid': r_ex, 'n_excovid': len(ex)})
    return rows


def turning_point_lead(y, x_lag0, step):
    """타깃·프록시(시차 0) YoY 계열 전환점 비교. 인덱스는 분기 번호."""
    def to_idx(d):
        return {m // step: v for m, v in d.items()}
    ty = sc.turning_points(to_idx(y))
    tx = sc.turning_points(to_idx(x_lag0))
    pairs, extra = sc.match_turning_points(ty, tx)
    leads = [p['lead'] for p in pairs]
    return {'target_tps': len(ty), 'proxy_tps': len(tx), 'matched': len(pairs), 'extra': extra,
            'median_lead': sc.median(leads) if leads else None, 'leads': leads}


def classify(rows, fdr_q):
    """사전 규칙(사전백색화 상관 기준): 유의(BH q<0.10, 기대 부호) 시차 중 부호 조정 상관 최대 k*.
    선행 = k*≥1 이고 r_k* ≥ r_0 + 0.05 · 후행 = k*<0 이고 r_k* ≥ r_0 + 0.05 · 그 외 유의 = 동행.
    검정 가능한 시차가 하나도 없으면 'untested'. (명목 p 단계는 두지 않는다 — 7개 시차 중 하나가 우연히 넘는 비율이 30% 다.)"""
    def pick(sig):
        r0 = next((row['signed_r'] for row in rows if row['k'] == 0 and row['signed_r'] is not None), None)
        best = max(sig, key=lambda r: r['signed_r'])
        k = best['k']
        base = r0 if r0 is not None else -1
        if k >= 1 and best['signed_r'] >= base + LEAD_MARGIN:
            return 'lead', k
        if k < 0 and best['signed_r'] >= base + LEAD_MARGIN:
            return 'lag', k
        return 'coincident', (0 if any(row['k'] == 0 for row in sig) else k)
    if not any(row['signed_r'] is not None for row in rows):
        return 'untested', None, None
    sig = [row for row in rows if row.get('q') is not None and row['q'] < fdr_q and (row['signed_r'] or 0) > 0]
    if sig:
        best = max(sig, key=lambda r: r['signed_r'])
        r0 = next((row['signed_r'] for row in rows if row['k'] == 0 and row['signed_r'] is not None), None)
        if best['k'] != 0 and r0 is None:
            return 'none', best['k'], 'undetermined'  # r(0) 을 못 구해 선행·후행 여유 검사를 할 수 없다
        return pick(sig) + ('fdr',)
    best_any = max((row for row in rows if row['signed_r'] is not None), key=lambda r: r['signed_r'], default=None)
    return 'none', (best_any['k'] if best_any else None), None


# ── rolling-origin ────────────────────────────────────────────
def accel_fit(rows):
    """가속(변화) 모형 ΔYoY_t = b·Δx (원점 통과). rows = [(Δx, Δy)]. 반환 (b, t_b) 또는 None.
    b=0 이면 직전 YoY(지속성)와 같다 — 프록시는 성장률의 '변화'를 설명할 때만 점수를 얻는다."""
    sxx = sum(dx * dx for dx, _ in rows)
    n = len(rows)
    if sxx <= 0 or n < 3:
        return None
    b = sum(dx * dy for dx, dy in rows) / sxx
    rss = sum((dy - b * dx) ** 2 for dx, dy in rows)
    s2 = rss / (n - 1)
    se = math.sqrt(s2 / sxx) if s2 > 0 else 0.0
    return b, (b / se if se > 0 else 0.0)


def accel_rows(y, x, step, before=None):
    """(Δx, Δy) 쌍. Δx = 같은 시차 창의 프록시 YoY 를 한 분기 전 창과 비교."""
    out = []
    for s in sorted(y):
        if before is not None and s >= before:
            break
        if (s - step) in y and s in x and (s - step) in x:
            out.append((x[s] - x[s - step], y[s] - y[s - step]))
    return out


def honest_single_proxy(y, xl, sign, step, lags=LEAD_LAGS, min_train=MIN_TRAIN):
    """가속 모형 단일 프록시 rolling-origin. 원점 t 마다 t 이전 분기만으로 시차 k 를 고르고(b 의 부호 조정 t 최대)
    ŷ_t = y_{t−1} + b·(x_{t−k} − x_{t−1−k}) 로 예측한다. 반환 {t: (pred, k, t_b)}.
    직전 분기 YoY 는 t 예측 시점에 이미 공시돼 있으므로 정보 누수가 아니다."""
    qs = sorted(y)
    preds = {}
    for t in qs:
        prev = y.get(t - step)
        if prev is None:
            continue
        best = None
        for k in lags:
            x = xl.get(k) or {}
            if t not in x or (t - step) not in x:
                continue
            rows = accel_rows(y, x, step, before=t)
            if len(rows) < min_train:
                continue
            fit = accel_fit(rows)
            if fit is None:
                continue
            bcoef, tb = fit
            if best is None or tb * sign > best[0]:
                best = (tb * sign, k, bcoef)
        if best is None:
            continue
        tb, k, bcoef = best
        x = xl[k]
        preds[t] = (prev + bcoef * (x[t] - x[t - step]), k, tb)
    return preds


def baselines(y, step):
    qs = sorted(y)
    out = {}
    for i, t in enumerate(qs):
        prior = [s for s in qs if s < t]
        if len(prior) < MIN_TRAIN:
            continue
        last = y[prior[-1]]
        mean_ = sc.mean([y[s] for s in prior])
        ar_pairs = [(y[s - step], y[s]) for s in prior if (s - step) in y]
        ar = None
        if len(ar_pairs) >= MIN_TRAIN - 1:
            a, b, _ = sc.ols1([p[0] for p in ar_pairs], [p[1] for p in ar_pairs])
            ar = a + b * last
        out[t] = {'zero': 0.0, 'last': last, 'mean': mean_, 'ar1': ar if ar is not None else last}
    return out


def evaluate(y, preds, base, fallback=None):
    ts = [t for t in sorted(preds) if t in base and t in y]
    if not ts:
        return None
    e = [preds[t] - y[t] for t in ts]
    res = {'n': len(ts), 'mae': sc.mae(e), 'rmse': sc.rmse(e),
           'n_model': sum(1 for t in ts if not (fallback or {}).get(t))}
    for b in ('zero', 'last', 'mean', 'ar1'):
        eb = [base[t][b] - y[t] for t in ts]
        res['mae_' + b] = sc.mae(eb)
    best_b = min(('zero', 'last', 'mean', 'ar1'), key=lambda b: res['mae_' + b])
    res['best_baseline'] = best_b
    res['rel_mae_best'] = res['mae'] / res['mae_' + best_b] if res['mae_' + best_b] else None
    res['rel_mae_last'] = res['mae'] / res['mae_last'] if res['mae_last'] else None
    hits = [1 if (preds[t] - base[t]['last']) * (y[t] - base[t]['last']) > 0 else 0 for t in ts]
    res['accel_hit'] = sum(hits) / len(hits)
    eb_best = [base[t][best_b] - y[t] for t in ts]
    stat, p = sc.diebold_mariano(e, eb_best)
    res['dm_stat'], res['dm_p'] = stat, p
    return res


def ensemble(y, singles, base, sign_map):
    """원점마다 선별 → 동일가중(EW)·역MSE(IMSE). singles: {pid: {t: (pred,k,r)}}"""
    ts = sorted(t for t in y if t in base)
    ew, imse, detail = {}, {}, {}
    for t in ts:
        chosen = []
        for pid, preds in singles.items():
            if t not in preds:
                continue
            pred, k, t_train = preds[t]
            if t_train < SCREEN_T:
                continue
            past = [s for s in preds if s < t and s in y and s in base]
            if len(past) >= 4:
                mae_i = sc.mae([preds[s][0] - y[s] for s in past])
                mae_b = sc.mae([base[s]['last'] - y[s] for s in past])
                if mae_i >= mae_b:
                    continue
                mse_i = sum((preds[s][0] - y[s]) ** 2 for s in past) / len(past)
            else:
                mse_i = None
            chosen.append((pid, pred, k, mse_i))
        if not chosen:
            ew[t] = base[t]['last']
            imse[t] = base[t]['last']
            detail[t] = {'fallback': True, 'members': []}
            continue
        ew[t] = sc.mean([c[1] for c in chosen])
        ws = [(1.0 / c[3]) if c[3] else None for c in chosen]
        if all(w is not None for w in ws):
            s = sum(ws)
            imse[t] = sum(w * c[1] for w, c in zip(ws, chosen)) / s
        else:
            imse[t] = ew[t]
        detail[t] = {'fallback': False, 'members': [{'id': c[0], 'k': c[2]} for c in chosen]}
    return ew, imse, detail


def grade(ev, n_hist):
    n_model = None if ev is None else ev.get('n_model', ev['n'])
    if ev is None or n_model < MIN_OOS:
        return 'N', f'프록시가 실제로 쓰인 OOS 분기 {0 if ev is None else n_model}개 < {MIN_OOS}'
    rel = ev['rel_mae_best']
    if rel is None:
        return 'N', '기준모형 오차 0'
    if rel <= 0.9 and ev['dm_p'] is not None and ev['dm_p'] < 0.10:
        return 'A', f'최선 기준모형 대비 MAE {rel:.2f}배 · DM p={ev["dm_p"]:.3f}'
    if rel <= 0.9:
        dm = '–' if ev['dm_p'] is None else f"{ev['dm_p']:.3f}"
        return 'B', f'최선 기준모형 대비 MAE {rel:.2f}배 · DM p={dm}(유의 아님)'
    if rel < 1.0:
        return 'C', f'최선 기준모형 대비 MAE {rel:.2f}배(개선 10% 미만)'
    return 'F', f'최선 기준모형 대비 MAE {rel:.2f}배(개선 없음)'


# ── 회사 단위 ─────────────────────────────────────────────────
def candidate_ids(peer, doc, catalog):
    ids, roles, missing = [], {}, []

    def add(pid, role, sign=1, why=None, ensemble=True):
        if pid in catalog and pid not in roles:
            ids.append(pid)
            roles[pid] = {'role': role, 'sign': sign, 'why': why, 'ensemble': ensemble}
        elif pid not in catalog and role == 'pre_registered' and pid not in missing:
            missing.append(pid)

    for route in ((doc.get('profile') or {}).get('proxy_routes') or []):
        hint = route.get('proxy_hint') or route.get('id')
        sign = -1 if str(route.get('expected_sign', '+')).strip() in ('-', '−', 'negative') else 1
        if hint and route.get('role') != 'wishlist':
            add(hint, 'pre_registered', sign, route.get('why'), ensemble=route.get('role') != 'diagnostic')
    for pid in ID_OVERRIDES.get(peer['id'], []):
        add(pid, 'route')
    for pid in REGIONAL_CANDIDATES.get(peer['region'], []):
        add(pid, 'regional')
    for pid in GLOBAL_CANDIDATES:
        add(pid, 'global')
    if peer['id'] not in ('SANIL', 'SANIL_PROXY'):
        add(ANCHOR_SERIES, 'anchor_diag', ensemble=False)
    if peer['id'] == 'SANIL_PROXY':
        # 타깃(안산 HS850421·22 수출)을 포함하는 계열은 후보에서 뺀다 — 안산 하위 계열, 한국 전체 합계,
        # 한국발 미국 수입 거울 계열(같은 선적의 다른 통계). 대신 '한국 전체 − 안산' 잔차를 쓴다.
        contains = ('trass_sanil_', 'trass_kr_', 'kre_85042190', 'kr_exp_850421_', 'kr_exp_850422_',
                    'us_imp_850421_p410', 'us_imp_850422_p410', 'us_imp_8504dist_p410')
        ids = [i for i in ids if not i.startswith(contains) or i == 'trass_kr_8504212_exansan']
        if 'trass_kr_8504212_exansan' in catalog and 'trass_kr_8504212_exansan' not in ids:
            ids.insert(0, 'trass_kr_8504212_exansan')
            roles['trass_kr_8504212_exansan'] = {'role': 'route', 'sign': 1, 'ensemble': True,
                                                 'why': '한국 HS850421·22 수출 중 안산 외 — 산일 제외 국내 동업계 흐름'}
    keep = ids[:MAX_CANDIDATES]
    if ANCHOR_SERIES in ids and ANCHOR_SERIES not in keep:
        keep.append(ANCHOR_SERIES)
    return keep, roles, [i for i in ids[MAX_CANDIDATES:] if i != ANCHOR_SERIES], missing


def round_dict(d):
    return {k: rnd(v) for k, v in d.items()} if d else d


def rnd(v, n=4):
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return round(v, n)
    return v


TARGET_OVERRIDES = {
    # 연결 매출이 폴리실리콘·석탄·발전·알루미늄에 좌우 — 변압기(전기설비) 제품 반기 매출을 타깃으로 쓴다.
    'TBEA': ('revenue_segment', '연결 매출이 폴리실리콘·석탄 등에 좌우되어 변압기(전기설비) 제품 반기 매출로 고정'),
    # 세그먼트 정의가 2018·2019·2025 에 바뀌어 연결 매출 유지
    'SIEYUAN': ('revenue_total', '제품 세그먼트 정의가 2018·2019·2025 에 바뀌어 연결 매출 유지'),
    # IR 전력기기 구간은 알라바마 공장 제외·2024Q1 배전변압기 재분류(3Q24·4Q24 비교값 혼합 기준)
    'HDHE': ('revenue_total', 'IR 전력기기 구간이 알라바마 공장 제외·2024Q1 재분류로 단절 — 연결 매출 유지'),
}


def choose_target(peer, doc):
    """빌더 규칙(CONTRACT §1): 관련 세그먼트(scope=segment, 분기, 16개 이상)가 있으면 세그먼트, 없으면 파일의 primary_target.
    예외는 TARGET_OVERRIDES 에 사유와 함께 둔다."""
    targets = doc.get('targets') or {}
    if peer['id'] in TARGET_OVERRIDES and TARGET_OVERRIDES[peer['id']][0] in targets:
        return TARGET_OVERRIDES[peer['id']][0], 'override', TARGET_OVERRIDES[peer['id']][1]
    seg = targets.get('revenue_segment')
    if seg and seg.get('scope') == 'segment' and seg.get('freq') == 'Q' and len(seg.get('points') or []) >= 16:
        return 'revenue_segment', 'contract_segment', '관련 세그먼트 분기 16개 이상 — 빌더 규칙(CONTRACT §1)으로 세그먼트 사용'
    return doc.get('primary_target'), 'file_primary', '수집 파일의 primary_target'


def analyze_peer(peer, doc, catalog, asof_mi):
    tname, trule, tnote = choose_target(peer, doc)
    res = {'id': peer['id'], 'name': peer['name'], 'ticker': peer.get('ticker'), 'region': peer['region'],
           'tier': peer['tier'], 'grid_node': peer.get('grid_node'), 'note': peer.get('note'),
           'listed': doc.get('listed', True), 'currency': doc.get('currency'), 'unit': doc.get('unit'),
           'profile': doc.get('profile'), 'structural_breaks': doc.get('structural_breaks') or [],
           'gaps': doc.get('gaps') or [], 'status': 'ok', 'reasons': []}
    if not doc.get('targets') or tname not in (doc.get('targets') or {}):
        res['status'] = 'no_target'
        res['reasons'].append('공시 실적 타깃 없음(비상장·미공시) — 프로필과 경로 프록시만 표시')
        return res
    t = doc['targets'][tname]
    rows, months = target_quarters(doc, tname)
    step = months
    breaks_all = doc.get('structural_breaks') or []
    yy_all = target_yoy(rows, breaks_all, tname)
    yy = dict(yy_all)
    yy_raw = target_yoy(rows, None, tname)  # 구조 변화 규칙이 없을 때와 비교해 막힌 분기를 기록
    y = {k: v[0] for k, v in yy.items()}
    res['target'] = {'lag_unit': 'H' if months == 6 else 'Q','name': tname, 'rule': trule, 'rule_note': tnote, 'file_primary': doc.get('primary_target'),
                     'label_ko': t.get('label_ko'), 'scope': t.get('scope'),
                     'segment_name': t.get('segment_name'), 'freq': t.get('freq'), 'window_months': months,
                     'n_levels': len(rows), 'n_yoy': len(y),
                     'first': rows[0]['key'] if rows else None, 'last': rows[-1]['key'] if rows else None,
                     'yoy_basis_comparative': sum(1 for v in yy.values() if v[1] == 'comparative'),
                     'yoy_blocked_by_break': [r['key'] for r in rows if r['end_mi'] in yy_raw and r['end_mi'] not in yy]}
    res['series'] = [{'key': r['key'], 'm': ym_of(r['end_mi']), 'v': rnd(r['value'], 3),
                      'yoy': rnd(yy[r['end_mi']][0]) if r['end_mi'] in yy else None} for r in rows]
    other = {}
    for oname, ot in doc['targets'].items():
        if oname == tname or ot.get('freq') not in ('Q', 'M'):
            continue
        orows, om = target_quarters(doc, oname)
        oy = target_yoy(orows, breaks_all, oname)
        other[oname] = {'label_ko': ot.get('label_ko'), 'scope': ot.get('scope'), 'freq': ot.get('freq'),
                        'series': [{'key': r['key'], 'm': ym_of(r['end_mi']), 'v': rnd(r['value'], 3),
                                    'yoy': rnd(oy[r['end_mi']][0]) if r['end_mi'] in oy else None} for r in orows]}
    res['other_targets'] = other
    min_hist = max(MIN_TRAIN + 4, PW_MIN_N + 1)
    if len(y) < min_hist:
        res['status'] = 'short_history'
        res['reasons'].append(f'YoY 관측 {len(y)}개 — 선후행 검정 최소 {min_hist}개 미만')
    cand, roles, dropped, missing = candidate_ids(peer, doc, catalog)
    res['candidates_dropped'] = dropped
    res['hints_missing'] = missing
    end_mis = sorted(y)
    last_mi = rows[-1]['end_mi'] if rows else None
    target_mi = last_mi + step if last_mi is not None else None
    res['nowcast_target'] = {'m': ym_of(target_mi) if target_mi else None,
                             'months': [ym_of(m) for m in range(target_mi - months + 1, target_mi + 1)] if target_mi else []}
    per = []
    singles = {}
    for pid in cand:
        pr = catalog[pid]
        sign = roles[pid]['sign']
        xl = proxy_yoy_by_lag(pr, end_mis, months, LAGS, step)
        ccf = ccf_table(y, xl, sign)
        for row in ccf:  # 원계열(동조 크기): n_eff 보정 단측 p — FDR 대상 아님
            if row['p'] is not None:
                row['p'] = row['p'] / 2 if (row['signed_r'] or 0) > 0 else 1 - row['p'] / 2
        pw = pw_ccf(prewhiten(y, pr, months, step), LAGS, sign, step, min_n=PW_MIN_N)
        entry = {'id': pid, 'label_ko': pr['label_ko'], 'role': roles[pid]['role'], 'why': roles[pid]['why'],
                 'in_ensemble': roles[pid]['ensemble'],
                 'sign': sign, 'kind': pr['kind'], 'family': pr['family'], 'first': pr['first'], 'last': pr['last'],
                 'ccf': ccf, 'pw': pw}
        per.append((entry, xl, pr))
        if roles[pid]['ensemble'] and len(y) >= min_hist:
            singles[pid] = honest_single_proxy(y, {k: xl[k] for k in LEAD_LAGS}, sign, step)
    # BH-FDR: 회사 안 모든 (프록시, 시차) 사전백색화 단측 검정(앵커 진단은 따로)
    for group in (lambda e: e['role'] != 'anchor_diag', lambda e: e['role'] == 'anchor_diag'):
        refs = [row for entry, _, _ in per if group(entry) for row in entry['pw'] if row['p'] is not None]
        for row, q in zip(refs, sc.bh_qvalues([row['p'] for row in refs])):
            row['q'] = q
    base = baselines(y, step) if len(y) >= MIN_TRAIN + 1 else {}
    for entry, xl, pr in per:
        cls, kstar, strength = classify(entry['pw'], FDR_Q)
        entry['class'], entry['k_star'], entry['strength'] = cls, kstar, strength
        raw_k = next((row for row in entry['ccf'] if row['k'] == kstar), None) if kstar is not None else None
        pw_k = next((row for row in entry['pw'] if row['k'] == kstar), None) if kstar is not None else None
        # 강건: 원계열 동조 ≥0.3 + 팬데믹 분기를 빼도 사전백색화 상관이 같은 부호로 ≥0.2
        entry['robust'] = bool(cls in ('lead', 'coincident', 'lag') and raw_k and (raw_k['signed_r'] or 0) >= 0.3 and pw_k
                               and pw_k.get('r_excovid') is not None and pw_k['r_excovid'] * entry['sign'] >= 0.2)
        entry['turning'] = turning_point_lead(y, xl[0], step) if xl.get(0) and len(xl[0]) >= 12 else None
        if entry['id'] in singles and base:
            ev = evaluate(y, {t: v[0] for t, v in singles[entry['id']].items()}, base)
            entry['oos'] = ev
            ks = [v[1] for v in singles[entry['id']].values()]
            entry['oos_lag_mode'] = max(set(ks), key=ks.count) if ks else None
        else:
            entry['oos'] = None
        oos = entry.get('oos') or {}
        # 타이트: 회사 경로 프록시 + FDR 유의(사전백색화) + 원계열 동조 ≥0.3 + OOS 가 최선 기준모형을 이김
        entry['tight'] = bool(entry['role'] in ('pre_registered', 'route') and entry['robust']
                              and oos.get('rel_mae_best') is not None and oos['rel_mae_best'] < 1.0)
        rel, dmp = oos.get('rel_mae_best'), oos.get('dm_p')
        base_ok = bool(cls == 'lead' and oos.get('n', 0) >= MIN_OOS and rel is not None and (entry.get('oos_lag_mode') or 0) >= 1)
        # 검증된 선행 = 등급 A 기준(최선 기준모형 대비 MAE ≤0.9 & DM p<0.10). 개선이 있으나 유의하지 않으면 'OOS 우위'로만.
        entry['validated_lead'] = bool(base_ok and rel <= 0.9 and dmp is not None and dmp < 0.10)
        entry['oos_edge_lead'] = bool(base_ok and rel < 1.0 and not entry['validated_lead'])
    res['candidates'] = [compact_candidate(e) for e, _, _ in per]
    # 앙상블
    if singles and base:
        ew, imse, detail = ensemble(y, singles, base, {pid: roles[pid]['sign'] for pid in singles})
        fb = {t: d['fallback'] for t, d in detail.items()}
        ev_ew = evaluate(y, ew, base, fb)
        ev_imse = evaluate(y, imse, base, fb)
        g, why = grade(ev_ew, len(y))
        fallback_share = (sum(1 for d in detail.values() if d['fallback']) / len(detail)) if detail else None
        res['composite'] = {
            'eval_ew': ev_ew, 'eval_imse': ev_imse, 'grade': g, 'grade_reason': why,
            'fallback_share': fallback_share,
            'oos': [{'m': ym_of(t), 'y': rnd(y[t]), 'ew': rnd(ew[t]), 'imse': rnd(imse.get(t)),
                     'last': rnd(base[t]['last']), 'zero': 0.0, 'ar1': rnd(base[t]['ar1']),
                     'members': detail[t]['members'], 'fallback': detail[t]['fallback']}
                    for t in sorted(ew) if t in y],
        }
        res['composite']['eval_ew'] = round_dict(ev_ew)
        res['composite']['eval_imse'] = round_dict(ev_imse)
        # 나우캐스트 전용 앙상블: 지금 시점에 창이 완결된 시차만 쓰는 같은 절차를 rolling-origin 으로 다시 돌려
        # 실제로 공개할 예측기의 등급·오차 구간을 잰다(전체 앙상블 등급을 빌려 쓰지 않는다).
        xl_by = {e['id']: xl for e, xl, _ in per}
        pr_by = {e['id']: pr for e, _, pr in per}
        feas = {}
        for pid in singles:
            ks = [k for k in LEAD_LAGS if proxy_yoy(pr_by[pid], target_mi - step * k, months) is not None
                  and proxy_yoy(pr_by[pid], target_mi - step * (k + 1), months) is not None]
            if ks:
                feas[pid] = ks
        singles_nc = {pid: honest_single_proxy(y, {k: xl_by[pid][k] for k in ks}, roles[pid]['sign'], step, lags=ks)
                      for pid, ks in feas.items()}
        singles_nc = {pid: v for pid, v in singles_nc.items() if v}
        if singles_nc:
            ew_nc, _, det_nc = ensemble(y, singles_nc, base, None)
            ev_nc = evaluate(y, ew_nc, base, {t: d['fallback'] for t, d in det_nc.items()})
            g_nc, why_nc = grade(ev_nc, len(y))
            comp_abs_nc = [abs(ew_nc[t] - y[t]) for t in ew_nc if t in y]
        else:
            ev_nc, g_nc, why_nc, comp_abs_nc = None, 'N', '지금 창이 완결된 프록시 없음', []
        res['composite']['nowcast_eval'] = round_dict(ev_nc) if ev_nc else None
        res['composite']['nowcast_grade'] = g_nc
        res['composite']['nowcast_grade_reason'] = why_nc
        res['nowcast'] = nowcast(doc, y, rows, per, singles_nc, feas, base, g_nc, step, months, target_mi, comp_abs_nc, tname)
    else:
        res['composite'] = None
        res['nowcast'] = None
        if not res['reasons']:
            res['reasons'].append('검정 가능한 후보 프록시 없음')
    res['summary'] = summarize(res)
    return res


def compact_candidate(e):
    out = {k: e.get(k) for k in ('id', 'label_ko', 'role', 'why', 'sign', 'kind', 'family', 'first', 'last', 'class', 'in_ensemble',
                                 'k_star', 'strength', 'robust', 'tight', 'validated_lead', 'oos_edge_lead', 'oos_lag_mode')}
    out['ccf'] = [{'k': r['k'], 'n': r['n'], 'r': rnd(r['r'], 3), 'n_eff': rnd(r['n_eff'], 1), 'p': rnd(r.get('p'), 4)}
                  for r in e['ccf']]
    out['pw'] = [{'k': r['k'], 'n': r['n'], 'r': rnd(r['r'], 3), 'p': rnd(r.get('p'), 4), 'q': rnd(r.get('q'), 4),
                  'rx': rnd(r.get('r_excovid'), 3), 'nx': r.get('n_excovid')} for r in e['pw']]
    tp = e.get('turning')
    out['turning'] = {k: tp[k] for k in ('target_tps', 'proxy_tps', 'matched', 'extra', 'median_lead')} if tp else None
    ev = e.get('oos')
    out['oos'] = {k: rnd(v) for k, v in ev.items()} if ev else None
    return out


def nowcast(doc, y, rows, per, singles, feas, base, g, step, months, target_mi, comp_abs, tname):
    """현재 대상 분기(마지막 실적 다음 분기) 나우캐스트. 창이 완결된 시차만 쓰고(부분 관측 없음),
    등급·구간은 같은 조건의 rolling-origin 앙상블(nowcast_grade)에서 가져온다."""
    if target_mi is None:
        return None
    by_end = {r['end_mi']: r for r in rows}
    out = {'target_m': ym_of(target_mi), 'members': [], 'status': None, 'published': False, 'reasons': [],
           'lag_unit': 'H' if step == 6 else 'Q'}
    prev = y.get(target_mi - step)
    members = []
    for entry, xl, pr in per:
        pid = entry['id']
        if pid not in singles or prev is None:
            continue
        best = None
        for k in feas.get(pid, []):
            rows_ = accel_rows(y, xl.get(k) or {}, step)
            if len(rows_) < MIN_TRAIN:
                continue
            fit = accel_fit(rows_)
            if fit is None:
                continue
            if best is None or fit[1] * entry['sign'] > best[0]:
                best = (fit[1] * entry['sign'], k, fit[0])
        if best is None or best[0] < SCREEN_T:
            continue
        preds = singles[pid]
        past = [s for s in preds if s in base]
        if len(past) >= 4 and sc.mae([preds[s][0] - y[s] for s in past]) >= sc.mae([base[s]['last'] - y[s] for s in past]):
            continue
        bcoef, k = best[2], best[1]
        src_end = target_mi - step * k
        x_now, x_prev = proxy_yoy(pr, src_end, months), proxy_yoy(pr, src_end - step, months)
        if x_now is None or x_prev is None:
            continue
        members.append({'id': pid, 'k': k, 't_full': rnd(best[0], 3), 'x_yoy': rnd(x_now),
                        'pred_yoy': rnd(prev + bcoef * (x_now - x_prev)),
                        'months': [ym_of(m) for m in range(src_end - months + 1, src_end + 1)]})
    out['members'] = members
    if not members:
        out['status'] = 'no_member'
        out['reasons'].append('현재 대상 기간에 창이 완결된 선별 프록시 없음')
        return out
    out['status'] = 'complete'
    yhat = sc.mean([m['pred_yoy'] for m in members])
    out['pred_yoy'] = rnd(yhat)
    halfw = sc.conformal_halfwidth(comp_abs, 0.8)
    out['halfwidth_80'] = rnd(halfw)
    out['interval_yoy'] = [rnd(yhat - halfw), rnd(yhat + halfw)] if halfw is not None else None
    base_row = None
    for off in (12, 11, 13):
        if (target_mi - off) in by_end:
            base_row = by_end[target_mi - off]
            break
    out['base'] = {'key': base_row['key'], 'value': base_row['value']} if base_row else None
    # 레벨 = 전년 동기 값 × exp(ŷ). 최근 비교값이 최초 공시값과 2% 넘게 다르면(재작성) 범위가 달라 레벨을 내지 않는다.
    restated = []
    for r in rows[-6:]:
        pr0 = by_end.get(r['end_mi'] - 12)
        if r.get('comparative') and pr0 and pr0['value']:
            restated.append(r['comparative'] / pr0['value'])
    level_ok = base_row is not None and all(abs(x - 1) <= 0.02 for x in restated)
    if level_ok:
        out['level'] = rnd(base_row['value'] * math.exp(yhat), 3)
        if halfw is not None:
            out['level_interval'] = [rnd(base_row['value'] * math.exp(yhat - halfw), 3),
                                     rnd(base_row['value'] * math.exp(yhat + halfw), 3)]
    elif base_row is not None:
        out['reasons'].append('최근 비교값이 최초 공시와 2% 넘게 달라(재작성) 레벨 환산을 생략')
    out['grade'] = g
    breaks = [b for b in (doc.get('structural_breaks') or []) if b.get('date') and b['date'][:7] >= ym_of(target_mi - 15)
              and applies(b, tname) and b.get('type') not in NON_GATING_BREAK_TYPES]
    out['recent_breaks'] = breaks
    if g not in ('A', 'B'):
        out['reasons'].append(f'나우캐스트 앙상블 등급 {g} — 수치 공개 보류(A·B 만 공개)')
    if breaks:
        out['reasons'].append('최근/대상 기간 구조 변화: ' + '; '.join(str(b.get('type')) + ' ' + str(b.get('date')) for b in breaks))
    out['published'] = (g in ('A', 'B')) and not breaks
    if not out['published']:
        for key in ('pred_yoy', 'interval_yoy', 'level', 'level_interval', 'halfwidth_80'):
            out.pop(key, None)
        for m in members:
            m.pop('pred_yoy', None)
            m.pop('x_yoy', None)
    return out


def summarize(res):
    cands = res.get('candidates') or []
    lead = [c for c in cands if c['class'] == 'lead' and c['role'] != 'anchor_diag']
    coin = [c for c in cands if c['class'] == 'coincident' and c['role'] != 'anchor_diag']
    lag = [c for c in cands if c['class'] == 'lag' and c['role'] != 'anchor_diag']

    def top(lst):
        def key(c):
            rk = next((r['r'] for r in c['pw'] if r['k'] == c['k_star'] and r['r'] is not None), -1)
            return (c.get('validated_lead', False), c.get('robust', False), rk * c['sign'])
        return [c['id'] for c in sorted(lst, key=key, reverse=True)[:3]]
    anchor = next((c for c in cands if c['role'] == 'anchor_diag'), None)
    comp = res.get('composite') or {}
    return {'n_candidates': len([c for c in cands if c['role'] != 'anchor_diag']),
            'n_lead': len(lead), 'n_coincident': len(coin), 'n_lag': len(lag),
            'n_tested': sum(1 for c in cands if c['class'] != 'untested' and c['role'] != 'anchor_diag'),
            'n_untested': sum(1 for c in cands if c['class'] == 'untested' and c['role'] != 'anchor_diag'),
            'n_oos_edge_lead': sum(1 for c in cands if c.get('oos_edge_lead')),
            'n_robust': sum(1 for c in cands if c['robust'] and c['role'] != 'anchor_diag'),
            'n_tight': sum(1 for c in cands if c['tight']), 'n_validated_lead': sum(1 for c in cands if c['validated_lead']),
            'top_lead': top(lead), 'top_coincident': top(coin),
            'anchor_class': anchor['class'] if anchor else None, 'anchor_k': anchor['k_star'] if anchor else None,
            'grade': comp.get('grade')}


# ── 월 타깃(대만 월매출) 진단 ─────────────────────────────────
MONTH_LAGS = list(range(-6, 13))


def monthly_ccf(doc, catalog, cand_ids, roles, min_months=36):
    """월매출 단월 로그 YoY 와 프록시 단월 YoY 를 AR(≤3) 사전백색화한 뒤 k=−6…+12 개월 교차상관.
    분기 판정과 같은 규칙(회사 안 BH-FDR q<0.10, 선행 여유 0.05)으로 선행 개월을 판정한다."""
    t = doc['targets'].get('revenue_monthly')
    if not t:
        return None
    obs = {month_index(p['month']): p['value'] for p in t['points'] if p.get('value') is not None and p['value'] > 0}
    y = {m: math.log(v / obs[m - 12]) for m, v in obs.items() if obs.get(m - 12)}
    if len(y) < min_months:
        return None
    rows_by = []
    for pid in cand_ids:
        pr = catalog[pid]
        sign = roles[pid]['sign']
        pw = pw_ccf(prewhiten(y, pr, 1, 1, max_p=3), MONTH_LAGS, sign, 1, min_n=24)
        raw = {}
        for k in (0,):
            xs = {m: proxy_yoy(pr, m - k, 1) for m in y}
            ks, xv, yv = aligned(y, {m: v for m, v in xs.items() if v is not None})
            raw[k] = sc.pearson(xv, yv) if len(ks) >= 24 else None
        rows_by.append((pid, pr, sign, pw, raw))
    refs = [row for _, _, _, pw, _ in rows_by for row in pw if row['p'] is not None]
    for row, q in zip(refs, sc.bh_qvalues([row['p'] for row in refs])):
        row['q'] = q
    out = []
    for pid, pr, sign, pw, raw in rows_by:
        if not any(r['r'] is not None for r in pw):
            continue
        cls, kstar, strength = classify(pw, FDR_Q)
        out.append({'id': pid, 'label_ko': pr['label_ko'], 'class': cls, 'k_star': kstar, 'strength': strength,
                    'raw_r0': rnd(raw.get(0), 3),
                    'pw': [{'k': r['k'], 'n': r['n'], 'r': rnd(r['r'], 3), 'q': rnd(r.get('q'), 4), 'rx': rnd(r.get('r_excovid'), 3)}
                           for r in pw]})
    order = {'lead': 0, 'coincident': 1, 'lag': 2, 'none': 3, 'untested': 4}
    out.sort(key=lambda e: (order.get(e['class'], 5), -max(((r['r'] or -1) for r in e['pw'] if r['r'] is not None), default=-1)))
    return {'n_months': len(y), 'first': ym_of(min(y)), 'last': ym_of(max(y)), 'lags': MONTH_LAGS, 'proxies': out}


# ── 피어 사이클 지수와 앵커(산일전기) 비교 ───────────────────
def peer_cycle(results, catalog):
    by_q = {}
    for r in results:
        if r.get('status') not in ('ok', 'short_history') or not r.get('series') or r['id'] == 'SANIL':
            continue
        if r.get('target', {}).get('window_months') != 3:
            continue
        for row in r['series']:
            if row['yoy'] is None:
                continue
            mi = month_index(row['m'])
            if mi % 3 != 2:
                continue  # 달력 분기 말 결산만 합친다
            by_q.setdefault(mi, {})[r['id']] = row['yoy']
    index = {m: sc.median(list(v.values())) for m, v in by_q.items() if len(v) >= 5}
    out = {'index': [{'m': ym_of(m), 'median_yoy': rnd(v), 'n': len(by_q[m])} for m, v in sorted(index.items())]}
    anc = catalog.get(ANCHOR_SERIES)
    if anc and index:
        xl = proxy_yoy_by_lag(anc, sorted(index), 3, LAGS, 3)
        out['anchor_vs_index'] = [{'k': row['k'], 'n': row['n'], 'r': rnd(row['r'], 3) if row['n'] >= PW_MIN_N else None,
                                   'p': rnd(row['p'], 4) if row['n'] >= PW_MIN_N else None}
                                  for row in ccf_table(index, xl, 1)]
    return out


def sanil_proxy(catalog, asof_mi):
    """산일전기 출하 대리 분석 — 타깃 = 안산시 HS850421+850422 수출(달력 분기 합, 천 USD).
    공식 매출이 아니므로 화면에 대리 타깃으로 표시하고, 산일전기 DART 매출과의 동조·암묵 환율로 타당성을 보인다."""
    anc = catalog.get(ANCHOR_SERIES)
    anc_raw = catalog.get(ANCHOR_RAW)
    path = ROOT / 'data' / 'actuals' / 'SANIL.json'
    if not anc or not path.exists():
        return None, None
    sanil = load_json(path)
    pts = []
    for e in range(min(anc['obs']) + 2, max(anc['obs']) + 1):
        if e % 3 != 2:
            continue
        v = window_value(anc, e, 3)
        if v is None:
            continue
        y, mo = divmod(e, 12)
        pts.append({'fiscal_key': f'FY{y}Q{mo // 3 + 1}', 'period_start': f'{y:04d}-{mo - 1:02d}-01',
                    'period_end': f'{y:04d}-{mo + 1:02d}-28', 'value': v, 'method': 'sum_of_monthly',
                    'source_url': 'data/proxies/korea_trass.json#' + ANCHOR_SERIES, 'locator': 'TRASS 안산시→전체 월합'})
    prof = dict(sanil.get('profile') or {})
    prof['proxy_routes'] = [r for r in (prof.get('proxy_routes') or [])
                            if not str(r.get('proxy_hint', '')).startswith('trass_sanil_')]
    mpts = [{'month': ym_of(m), 'value': v, 'method': 'direct_reported_month',
             'source_url': 'data/proxies/korea_trass.json#' + ANCHOR_RAW, 'locator': 'TRASS 안산시→전체'}
            for m, v in sorted(anc['obs'].items())]
    doc = {'id': 'SANIL_PROXY', 'listed': True, 'currency': 'USD', 'unit': 'thousand', 'primary_target': 'revenue_total',
           'targets': {'revenue_total': {'freq': 'Q', 'scope': 'proxy_target',
                                         'label_ko': '안산시 HS850421·850422 수출(산일전기 출하 대리 · 공식 매출 아님, 2022-07~)',
                                         'points': pts},
                       'revenue_monthly': {'freq': 'M', 'scope': 'proxy_target', 'points': mpts}},
           'profile': prof, 'structural_breaks': [], 'gaps': []}
    peer = {'id': 'SANIL_PROXY', 'name': '산일전기 출하 대리 · 안산 변압기 수출', 'ticker': '062040 KS', 'region': 'Korea',
            'tier': 'anchor', 'grid_node': 'KGRID_062040',
            'note': '산일전기 상장 전 분기 실적이 없어 공장 소재지(안산시) 유입식 배전변압기 수출을 대리 타깃으로 쓴다.'}
    res = analyze_peer(peer, doc, catalog, asof_mi)
    res['pseudo'] = True
    cand, roles, _, _ = candidate_ids(peer, doc, catalog)
    res['monthly'] = monthly_ccf(doc, catalog, [c for c in cand if not catalog[c].get('qonly')], roles, min_months=30)
    res['ramp_note'] = ('램프업 제외: 안산 수출이 분기 1천만 달러를 처음 넘은 2022Q3 이후만 사용(그 전 YoY 는 신규 고객 진입 기저효과). '
                        '분기 YoY 표본이 짧아 앙상블 등급은 N(표본 부족)이며 월 단위 선후행을 함께 본다.')
    # 타당성: 산일 DART 매출과 YoY 동조, 수출매출(백만원)/안산 수출(천 USD)×1000 = 암묵 원/달러 (안산 전체 이력 사용)
    rdoc = {'targets': {'revenue_total': {'freq': 'Q', 'points': [
        {'fiscal_key': 'x', 'period_end': f'{e // 12:04d}-{e % 12 + 1:02d}-28', 'value': window_value(anc_raw, e, 3)}
        for e in range(min(anc_raw['obs']) + 2, max(anc_raw['obs']) + 1) if e % 3 == 2 and window_value(anc_raw, e, 3)]}}}
    arows, _ = target_quarters(rdoc, 'revenue_total')
    ay = {k: v[0] for k, v in target_yoy(arows).items()}
    alev = {r['end_mi']: r['value'] for r in arows}
    val = {'yoy_pairs': [], 'ratio': []}
    for tname in ('revenue_total', 'revenue_export'):
        if tname not in (sanil.get('targets') or {}):
            continue
        srows, _ = target_quarters(sanil, tname)
        sy = {k: v[0] for k, v in target_yoy(srows).items()}
        ks = sorted(set(sy) & set(ay))
        r = sc.pearson([ay[k] for k in ks], [sy[k] for k in ks]) if len(ks) >= 5 else None
        val['yoy_' + tname] = {'n': len(ks), 'r': rnd(r, 3)}
        if tname == 'revenue_total':
            val['yoy_pairs'] = [{'m': ym_of(k), 'ansan': rnd(ay[k]), 'sanil': rnd(sy[k])} for k in ks]
        fx = catalog.get('fx_krw_per_usd')
        for row in srows:
            e = row['end_mi']
            if e in alev and alev[e] > 0:
                implied = row['value'] * 1000.0 / alev[e]
                fxq = window_value(fx, e, 3) if fx else None
                val['ratio'].append({'target': tname, 'key': row['key'], 'm': ym_of(e), 'implied_krw_per_usd': rnd(implied, 1),
                                     'fx': rnd(fxq, 1), 'share': rnd(implied / fxq, 3) if fxq else None})
    return res, val


def main():
    import datetime as _dt
    asof = _dt.date.today().isoformat()  # 빌드일(데이터 절단 기준이 아님 — 각 계열의 마지막 관측월은 화면에 따로 표시)
    asof_mi = month_index(asof[:7])
    peers = load_json(ROOT / 'spec' / 'peers.json')
    catalog = load_proxies()
    results = []
    missing = []
    for peer in peers['peers']:
        path = ROOT / 'data' / 'actuals' / (peer['id'] + '.json')
        if not path.exists():
            missing.append(peer['id'])
            results.append({'id': peer['id'], 'name': peer['name'], 'ticker': peer.get('ticker'), 'region': peer['region'],
                            'tier': peer['tier'], 'status': 'not_collected', 'reasons': ['실적 파일 없음']})
            continue
        doc = load_json(path)
        res = analyze_peer(peer, doc, catalog, asof_mi)
        if (doc.get('targets') or {}).get('revenue_monthly'):
            cand, roles, _, _ = candidate_ids(peer, doc, catalog)
            res['monthly'] = monthly_ccf(doc, catalog, [c for c in cand if not catalog[c].get('qonly')], roles)
        results.append(res)
    sp, validity = sanil_proxy(catalog, asof_mi)
    if sp:
        idx = next((i for i, r in enumerate(results) if r['id'] == 'SANIL'), -1)
        results.insert(idx + 1, sp)
    used = sorted({c['id'] for r in results for c in (r.get('candidates') or [])} | {ANCHOR_SERIES})
    out = {
        'schema': 'grid-composite-out/1',
        'asof': asof,
        'anchor': peers['anchor'],
        'selection_rule': peers.get('selection_rule'),
        'params': {'pw_min_n': PW_MIN_N, 'lags': LAGS, 'lead_lags': LEAD_LAGS, 'min_train': MIN_TRAIN, 'min_oos': MIN_OOS, 'screen_t': SCREEN_T,
                   'fdr_q': FDR_Q, 'lead_margin': LEAD_MARGIN, 'max_candidates': MAX_CANDIDATES},
        'proxies': {pid: {k: catalog[pid][k] for k in ('label_ko', 'unit', 'agg', 'kind', 'family', 'first', 'last',
                                                      'release_lag_days', 'source', 'notes')} for pid in used},
        'proxy_yoy': {pid: [{'m': ym_of(m), 'yoy': rnd(proxy_yoy(catalog[pid], m, 3))}
                            for m in range(max(min(catalog[pid]['obs']) + (12 if catalog[pid].get('qonly') else 14), month_index('2016-03')),
                                           max(catalog[pid]['obs']) + 1)
                            if m % 3 == 2 and proxy_yoy(catalog[pid], m, 3) is not None] for pid in used},
        'peers': results,
        'peer_cycle': peer_cycle([r for r in results if not r.get('pseudo')], catalog),
        'anchor_validity': validity,
        'missing_actuals': missing,
        'catalog_size': len(catalog),
    }
    path = ROOT / 'out' / 'composite.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':'), sort_keys=True, default=_default) + '\n',
                   encoding='utf-8')
    os.replace(tmp, path)
    n_ok = sum(1 for r in results if r.get('composite'))
    print(f'peers {len(results)} · composite {n_ok} · proxies used {len(used)}/{len(catalog)} · missing {missing}')


def _default(o):
    if isinstance(o, float):
        return rnd(o)
    raise TypeError(type(o))


if __name__ == '__main__':
    main()
