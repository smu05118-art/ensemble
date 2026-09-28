"""grid-composite 통계 원시함수 — stdlib 만 사용한다(CI·로컬 무설치 실행).

모든 함수는 None 이 섞이지 않은 순수 리스트를 받는다. 결측 정렬은 호출자가 한다.
"""
import math


def mean(xs):
    return sum(xs) / len(xs)


def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = mean(xs), mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0 or syy <= 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return sxy / math.sqrt(sxx * syy)


def autocorr(xs, lag):
    n = len(xs)
    if lag <= 0:
        return 1.0
    if n - lag < 3:
        return 0.0
    m = mean(xs)
    den = sum((x - m) ** 2 for x in xs)
    if den <= 0:
        return 0.0
    num = sum((xs[i] - m) * (xs[i + lag] - m) for i in range(n - lag))
    return num / den


def n_effective(xs, ys, max_lag=None):
    """Bartlett/Pyper–Peterman 유효표본: 두 계열 자기상관 곱의 합으로 자유도를 줄인다.

    겹치는 YoY(분기 4개 창)는 MA(3) 구조라 명목 n 으로 p 값을 내면 과대평가된다.
    """
    n = len(xs)
    if max_lag is None:
        max_lag = max(1, min(4, n // 4))
    s = 0.0
    for j in range(1, max_lag + 1):
        s += autocorr(xs, j) * autocorr(ys, j)
    denom = 1 + 2 * s
    if denom <= 0:
        return float(n)
    return max(3.0, min(float(n), n / denom))


# ── t 분포 (정규화 불완전 베타) ───────────────────────────────
def _betacf(a, b, x):
    maxit, eps, fpmin = 300, 3e-14, 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    if abs(d) < fpmin:
        d = fpmin
    d = 1.0 / d
    h = d
    for m in range(1, maxit + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < fpmin:
            d = fpmin
        c = 1.0 + aa / c
        if abs(c) < fpmin:
            c = fpmin
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < fpmin:
            d = fpmin
        c = 1.0 + aa / c
        if abs(c) < fpmin:
            c = fpmin
        d = 1.0 / d
        de = d * c
        h *= de
        if abs(de - 1.0) < eps:
            break
    return h


def betai(a, b, x):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    bt = math.exp(lbeta + a * math.log(x) + b * math.log(1.0 - x))
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def t_sf_two_sided(t, df):
    """양측 p 값 P(|T| > |t|)."""
    if df <= 0 or t is None or math.isnan(t):
        return None
    x = df / (df + t * t)
    return betai(df / 2.0, 0.5, x)


def t_sf_one_sided(t, df):
    """단측 p 값 P(T > t)."""
    p2 = t_sf_two_sided(t, df)
    if p2 is None:
        return None
    return p2 / 2.0 if t > 0 else 1.0 - p2 / 2.0


def corr_pvalue(r, n_eff):
    if r is None or n_eff is None or n_eff <= 3:
        return None
    r = max(min(r, 0.999999), -0.999999)
    df = n_eff - 2
    t = r * math.sqrt(df / (1 - r * r))
    return t_sf_two_sided(t, df)


def bh_qvalues(pvals):
    """Benjamini–Hochberg q 값. None 은 None 으로 둔다."""
    idx = [i for i, p in enumerate(pvals) if p is not None]
    m = len(idx)
    q = [None] * len(pvals)
    if not m:
        return q
    order = sorted(idx, key=lambda i: pvals[i])
    prev = 1.0
    for rank in range(m, 0, -1):
        i = order[rank - 1]
        val = min(prev, pvals[i] * m / rank)
        q[i] = val
        prev = val
    return q


# ── 회귀 ──────────────────────────────────────────────────────
def ols1(xs, ys):
    """y = a + b x. 반환 (a, b, resid_sd)."""
    n = len(xs)
    mx, my = mean(xs), mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx <= 0:
        return my, 0.0, None
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    a = my - b * mx
    if n > 2:
        rss = sum((y - a - b * x) ** 2 for x, y in zip(xs, ys))
        sd = math.sqrt(rss / (n - 2))
    else:
        sd = None
    return a, b, sd


def fit_ar(xs, max_p=2):
    """AR(p) 를 OLS 로 적합하고 AIC 로 p∈{1..max_p} 를 고른다. 반환 (const, [phi…])."""
    best = None
    n = len(xs)
    for p in range(1, max_p + 1):
        if n - p < 8:
            break
        rows = [(xs[t - p:t][::-1], xs[t]) for t in range(p, n)]
        coef = _ols_multi([[1.0] + list(r[0]) for r in rows], [r[1] for r in rows])
        if coef is None:
            continue
        rss = sum((y - sum(c * v for c, v in zip(coef, [1.0] + list(xr)))) ** 2 for xr, y in rows)
        m = len(rows)
        if rss <= 0:
            continue
        aic = m * math.log(rss / m) + 2 * (p + 1)
        if best is None or aic < best[0]:
            best = (aic, coef)
    if best is None:
        return None
    return best[1][0], best[1][1:]


def fit_ar_dict(series, max_p=2):
    """{정수 인덱스: 값} 에서 모든 시차가 있는 행만 써서 AR(p) 적합(AIC). 결측 구간을 건너뛴다."""
    best = None
    for p in range(1, max_p + 1):
        rows = []
        for t, v in series.items():
            lagged = [series.get(t - j - 1) for j in range(p)]
            if any(x is None for x in lagged):
                continue
            rows.append(([1.0] + lagged, v))
        if len(rows) < 8 + p:
            break
        coef = _ols_multi([r[0] for r in rows], [r[1] for r in rows])
        if coef is None:
            continue
        rss = sum((y - sum(c * x for c, x in zip(coef, xr))) ** 2 for xr, y in rows)
        if rss <= 0:
            continue
        m = len(rows)
        aic = m * math.log(rss / m) + 2 * (p + 1)
        if best is None or aic < best[0]:
            best = (aic, coef)
    if best is None:
        return None
    return best[1][0], best[1][1:]


def _ols_multi(X, y):
    k = len(X[0])
    xtx = [[sum(r[i] * r[j] for r in X) for j in range(k)] for i in range(k)]
    xty = [sum(r[i] * yy for r, yy in zip(X, y)) for i in range(k)]
    return _solve(xtx, xty)


def ols_full(X, y):
    """다변수 OLS. 반환 (coef, se) — 자유도 부족·특이행렬이면 None."""
    n, k = len(X), len(X[0])
    if n <= k:
        return None
    xtx = [[sum(r[i] * r[j] for r in X) for j in range(k)] for i in range(k)]
    inv = _inverse(xtx)
    if inv is None:
        return None
    xty = [sum(r[i] * yy for r, yy in zip(X, y)) for i in range(k)]
    coef = [sum(inv[i][j] * xty[j] for j in range(k)) for i in range(k)]
    rss = sum((yy - sum(c * v for c, v in zip(coef, r))) ** 2 for r, yy in zip(X, y))
    s2 = rss / (n - k)
    se = [math.sqrt(max(inv[i][i] * s2, 0.0)) for i in range(k)]
    return coef, se


def _inverse(a):
    n = len(a)
    m = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-12:
            return None
        m[col], m[piv] = m[piv], m[col]
        pv = m[col][col]
        m[col] = [v / pv for v in m[col]]
        for r in range(n):
            if r != col:
                f = m[r][col]
                if f:
                    m[r] = [a_ - f * b_ for a_, b_ in zip(m[r], m[col])]
    return [row[n:] for row in m]


def _solve(a, b):
    n = len(a)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-12:
            return None
        m[col], m[piv] = m[piv], m[col]
        for r in range(n):
            if r != col:
                f = m[r][col] / m[col][col]
                for c in range(col, n + 1):
                    m[r][c] -= f * m[col][c]
    return [m[i][n] / m[i][i] for i in range(n)]


def ar_filter(series_by_t, ar):
    """{t: x} 에 AR 필터 x_t − Σ φ_j x_{t−j} 를 적용(연속 인덱스만). 상수항은 무시해도 상관에 영향 없다."""
    const, phis = ar
    out = {}
    for t, x in series_by_t.items():
        lagged = [series_by_t.get(t - j - 1) for j in range(len(phis))]
        if any(v is None for v in lagged):
            continue
        out[t] = x - sum(p * v for p, v in zip(phis, lagged))
    return out


# ── 예측 비교 ─────────────────────────────────────────────────
def mae(errs):
    return sum(abs(e) for e in errs) / len(errs) if errs else None


def rmse(errs):
    return math.sqrt(sum(e * e for e in errs) / len(errs)) if errs else None


def diebold_mariano(e_model, e_base, h=1):
    """절대오차 손실 DM 검정 + Harvey–Leybourne–Newbold 소표본 보정. 단측 p(모형이 더 좋다)."""
    d = [abs(a) - abs(b) for a, b in zip(e_model, e_base)]
    n = len(d)
    if n < 5:
        return None, None
    dbar = mean(d)
    gamma0 = sum((x - dbar) ** 2 for x in d) / n
    var = gamma0
    for k in range(1, h):
        gk = sum((d[i] - dbar) * (d[i - k] - dbar) for i in range(k, n)) / n
        var += 2 * gk
    if var <= 0:
        return None, None
    dm = dbar / math.sqrt(var / n)
    corr = math.sqrt((n + 1 - 2 * h + h * (h - 1) / n) / n)
    stat = dm * corr
    # 모형이 더 좋으면 dbar<0 → 단측 p = P(T < stat)
    p = 1.0 - t_sf_one_sided(stat, n - 1)
    return stat, p


def conformal_halfwidth(abs_errors, coverage=0.8):
    """분할 conformal: |오차| 의 ⌈coverage·(n+1)⌉ 번째 값. 표본이 모자라면 None."""
    n = len(abs_errors)
    k = math.ceil(coverage * (n + 1))
    if n < 4 or k > n:
        return None
    return sorted(abs_errors)[k - 1]


# ── 전환점 ────────────────────────────────────────────────────
def turning_points(series, window=2, min_gap=2):
    """{t: y} 연속 정수 인덱스 계열에서 국면 전환점(peak/trough)을 찾는다.

    ±window 안의 국지 극값만 후보로 보고, 같은 종류가 연속되면 더 극단적인 것을 남기며,
    인접 전환점 간격이 min_gap 보다 짧으면 버린다(Bry–Boschan 단순형).
    """
    ts = sorted(series)
    cand = []
    for i, t in enumerate(ts):
        if i < window or i >= len(ts) - window:
            continue
        seg = [series[ts[j]] for j in range(i - window, i + window + 1)]
        if any(ts[j] != ts[i] - window + (j - (i - window)) for j in range(i - window, i + window + 1)):
            continue  # 인덱스가 끊기면 판정하지 않는다
        y = series[t]
        if y == max(seg) and seg.count(y) == 1:
            cand.append((t, 'P', y))
        elif y == min(seg) and seg.count(y) == 1:
            cand.append((t, 'T', y))
    out = []
    for tp in cand:
        if out and out[-1][1] == tp[1]:
            keep = tp if (tp[1] == 'P' and tp[2] > out[-1][2]) or (tp[1] == 'T' and tp[2] < out[-1][2]) else out[-1]
            out[-1] = keep
            continue
        if out and tp[0] - out[-1][0] < min_gap:
            continue
        out.append(tp)
    return out


def match_turning_points(target_tps, proxy_tps, max_lead=4, max_lag=2):
    """타깃 전환점마다 같은 종류의 프록시 전환점을 [t−max_lead, t+max_lag] 에서 가장 가까운 것으로 짝짓는다.
    lead>0 = 프록시가 먼저 돌았다."""
    used = set()
    pairs = []
    for t, kind, _ in target_tps:
        best = None
        for j, (s, k2, _) in enumerate(proxy_tps):
            if k2 != kind or j in used:
                continue
            lead = t - s
            if -max_lag <= lead <= max_lead and (best is None or abs(lead) < abs(best[1])):
                best = (j, lead)
        if best is not None:
            used.add(best[0])
            pairs.append({'t': t, 'kind': kind, 'lead': best[1]})
    extra = len(proxy_tps) - len(used)
    return pairs, extra


def median(xs):
    s = sorted(xs)
    n = len(s)
    if not n:
        return None
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
