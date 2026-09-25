"""grid-composite 엔진 계약 테스트 — 합성 자료로 선행·동행·무관 판정과 look-ahead 부재를 확인한다."""
import math
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_composite as bc  # noqa: E402
import stats_core as sc  # noqa: E402


def month_key(mi):
    return bc.ym_of(mi)


def synth(lead_q=0, noise=0.02, seed=1, n_q=40, proxy_noise=0.02, independent=False):
    """월별 프록시 레벨과 분기 타깃 레벨을 만든다. 타깃 YoY = 프록시 YoY(lead_q 분기 전) + 잡음."""
    rng = random.Random(seed)
    start = 2015 * 12  # 2015-01
    n_m = n_q * 3 + 36
    # 느린 순환 성장률(월) — 로그 레벨 누적
    g = [0.01 * math.sin(2 * math.pi * i / 30.0) + 0.004 for i in range(n_m)]
    lvl = [100.0]
    for i in range(1, n_m):
        lvl.append(lvl[-1] * math.exp(g[i] + rng.gauss(0, proxy_noise)))
    obs = {start + i: lvl[i] for i in range(n_m)}
    proxy = {'id': 'p', 'agg': 'sum', 'obs': obs, 'label_ko': 'p', 'kind': 'trade_total', 'family': 't',
             'first': month_key(start), 'last': month_key(start + n_m - 1), 'unit': 'USD', 'release_lag_days': 40,
             'source': 's', 'notes': ''}
    rng2 = random.Random(seed + 100)
    points = []
    base = {}
    for q in range(n_q):
        end_mi = start + 24 + 3 * q + 2
        src = end_mi - 3 * lead_q
        if independent:
            yoy = rng2.gauss(0.05, 0.1)
        else:
            yoy = bc.proxy_yoy(proxy, src, 3) + rng2.gauss(0, noise)
        prev = base.get(end_mi - 12, 1000.0)
        val = prev * math.exp(yoy)
        base[end_mi] = val
        y, m = divmod(end_mi, 12)
        points.append({'fiscal_key': f'FY{y}Q{m // 3 + 1}', 'period_start': f'{y:04d}-{m - 1:02d}-01',
                       'period_end': f'{y:04d}-{m + 1:02d}-28', 'value': val, 'method': 'direct_reported_quarter',
                       'source_url': 'x', 'locator': 'x'})
    # 앞 4개 분기 기준값(YoY 분모)
    for q in range(4):
        end_mi = start + 24 + 3 * q + 2 - 12
        y, m = divmod(end_mi, 12)
        points.insert(q, {'fiscal_key': f'FY{y}Q{m // 3 + 1}', 'period_start': f'{y:04d}-{m - 1:02d}-01',
                          'period_end': f'{y:04d}-{m + 1:02d}-28', 'value': 1000.0, 'method': 'direct_reported_quarter',
                          'source_url': 'x', 'locator': 'x'})
    doc = {'id': 'T', 'listed': True, 'currency': 'USD', 'unit': 'million', 'primary_target': 'revenue_total',
           'targets': {'revenue_total': {'freq': 'Q', 'scope': 'consolidated', 'points': points}},
           'profile': {'proxy_routes': [{'proxy_hint': 'p', 'why': 'test', 'expected_sign': '+', 'role': 'primary'}]}}
    return doc, proxy


PEER = {'id': 'T', 'name': 'T', 'region': 'Nowhere', 'tier': 'core'}


class EngineTest(unittest.TestCase):
    def run_one(self, **kw):
        doc, proxy = synth(**kw)
        res = bc.analyze_peer(PEER, doc, {'p': proxy}, bc.month_index('2026-09'))
        return res, next(c for c in res['candidates'] if c['id'] == 'p')

    def test_lead_detected(self):
        res, c = self.run_one(lead_q=2, noise=0.01)
        self.assertEqual(c['class'], 'lead', c)
        self.assertEqual(c['k_star'], 2)
        self.assertGreaterEqual(c['oos_lag_mode'], 1)

    def test_coincident_detected(self):
        res, c = self.run_one(lead_q=0, noise=0.01)
        self.assertEqual(c['class'], 'coincident', c)
        self.assertEqual(c['k_star'], 0)
        self.assertLess(res['composite']['eval_ew']['rel_mae_best'], 1.0)

    def test_noise_not_significant(self):
        hits = 0
        for seed in range(8):
            _, c = self.run_one(independent=True, seed=seed)
            hits += c['class'] != 'none'
        self.assertLessEqual(hits, 2, '독립 잡음이 유의로 판정되는 비율이 너무 높다')

    def test_no_lookahead_single_proxy(self):
        doc, proxy = synth(lead_q=1, noise=0.02)
        rows, months = bc.target_quarters(doc, 'revenue_total')
        y = {k: v[0] for k, v in bc.target_yoy(rows).items()}
        xl = bc.proxy_yoy_by_lag(proxy, sorted(y), 3, bc.LEAD_LAGS, 3)
        preds = bc.honest_single_proxy(y, xl, 1, 3)
        cut = sorted(y)[20]
        y2 = {k: (v + 5.0 if k > cut else v) for k, v in y.items()}
        preds2 = bc.honest_single_proxy(y2, xl, 1, 3)
        for t in preds:
            if t <= cut:
                self.assertAlmostEqual(preds[t][0], preds2[t][0], places=12)

    def test_no_lookahead_ensemble(self):
        doc, proxy = synth(lead_q=0, noise=0.02)
        rows, _ = bc.target_quarters(doc, 'revenue_total')
        y = {k: v[0] for k, v in bc.target_yoy(rows).items()}
        xl = bc.proxy_yoy_by_lag(proxy, sorted(y), 3, bc.LEAD_LAGS, 3)
        base = bc.baselines(y, 3)
        cut = sorted(y)[22]
        y2 = {k: (v - 3.0 if k > cut else v) for k, v in y.items()}
        base2 = bc.baselines(y2, 3)
        ew, _, _ = bc.ensemble(y, {'p': bc.honest_single_proxy(y, xl, 1, 3)}, base, {'p': 1})
        ew2, _, _ = bc.ensemble(y2, {'p': bc.honest_single_proxy(y2, xl, 1, 3)}, base2, {'p': 1})
        for t in ew:
            if t <= cut:
                self.assertAlmostEqual(ew[t], ew2[t], places=12)

    def test_end_month_52_53_week(self):
        self.assertEqual(bc.ym_of(bc.end_month_of('2026-01-03')), '2025-12')
        self.assertEqual(bc.ym_of(bc.end_month_of('2026-06-27')), '2026-06')
        self.assertEqual(bc.ym_of(bc.end_month_of('2026-03-31')), '2026-03')

    def test_comparative_preferred(self):
        rows = [{'key': 'a', 'end_mi': 100, 'value': 110.0, 'comparative': None, 'months': 3, 'currency': None},
                {'key': 'b', 'end_mi': 112, 'value': 130.0, 'comparative': 120.0, 'months': 3, 'currency': None}]
        yy = bc.target_yoy(rows)
        self.assertAlmostEqual(yy[112][0], math.log(130 / 120))
        self.assertEqual(yy[112][1], 'comparative')

    def test_currency_break_blocks_yoy(self):
        rows = [{'key': 'a', 'end_mi': 100, 'value': 7.5, 'comparative': None, 'months': 3, 'currency': 'HRK'},
                {'key': 'b', 'end_mi': 112, 'value': 1.1, 'comparative': None, 'months': 3, 'currency': None}]
        self.assertEqual(bc.target_yoy(rows), {})

    def test_partial_window_not_aggregated(self):
        proxy = {'agg': 'sum', 'obs': {bc.month_index('2026-07'): 1.0, bc.month_index('2026-08'): 1.0}}
        self.assertIsNone(bc.window_value(proxy, bc.month_index('2026-09')))

    def test_monthly_lead_detected(self):
        rng = random.Random(7)
        start = 2014 * 12
        n = 150
        g = [0.012 * math.sin(2 * math.pi * i / 26.0) for i in range(n)]
        lvl, lx = [], 100.0
        for i in range(n):
            lx *= math.exp(g[i] + rng.gauss(0, 0.03))
            lvl.append(lx)
        proxy = {'id': 'p', 'agg': 'sum', 'obs': {start + i: lvl[i] for i in range(n)}, 'label_ko': 'p'}
        pts = []
        rev = {}
        for i in range(n):
            m = start + i
            if i < 15:
                rev[m] = 50.0
            else:
                src = bc.proxy_yoy(proxy, m - 3, 1)
                rev[m] = rev[m - 12] * math.exp(src + rng.gauss(0, 0.01))
            pts.append({'month': bc.ym_of(m), 'value': rev[m]})
        doc = {'targets': {'revenue_monthly': {'freq': 'M', 'points': pts}}}
        out = bc.monthly_ccf(doc, {'p': proxy}, ['p'], {'p': {'sign': 1}})
        e = out['proxies'][0]
        self.assertEqual(e['class'], 'lead', e)
        self.assertEqual(e['k_star'], 3)

    def test_break_blocks_prior_point_yoy(self):
        rows = [{'key': 'FY2019Q4', 'end_mi': bc.month_index('2019-12'), 'value': 100.0, 'comparative': None, 'months': 3, 'currency': None},
                {'key': 'FY2020Q4', 'end_mi': bc.month_index('2020-12'), 'value': 20.0, 'comparative': None, 'months': 3, 'currency': None},
                {'key': 'FY2021Q4', 'end_mi': bc.month_index('2021-12'), 'value': 30.0, 'comparative': 25.0, 'months': 3, 'currency': None}]
        brk = [{'date': '2020-01-01', 'type': 'divestiture'}]
        yy = bc.target_yoy(rows, brk, 'revenue_segment')
        self.assertNotIn(bc.month_index('2020-12'), yy)           # 매각을 가로지르는 YoY 는 만들지 않는다
        self.assertIn(bc.month_index('2021-12'), yy)              # 같은 보고서 비교값이 있으면 그대로
        brk2 = [{'date': '2020-01-01', 'type': 'divestiture', 'affects_target': False}]
        self.assertIn(bc.month_index('2020-12'), bc.target_yoy(rows, brk2, 'revenue_segment'))
        brk3 = [{'date': '2020-01-01', 'type': 'divestiture', 'target': 'revenue_total'}]
        self.assertIn(bc.month_index('2020-12'), bc.target_yoy(rows, brk3, 'revenue_segment'))
        brk4 = [{'date': '2019-01-01', 'type': 'acquisition', 'affected_fiscal_keys': ['FY2020Q4']}]
        self.assertNotIn(bc.month_index('2020-12'), bc.target_yoy(rows, brk4, 'revenue_segment'))

    def test_untested_class(self):
        rows = [{'k': k, 'n': 5, 'r': None, 'p': None, 'signed_r': None} for k in bc.LAGS]
        self.assertEqual(bc.classify(rows, 0.1)[0], 'untested')

    def test_grade_counts_only_model_quarters(self):
        y = {i * 3 + 2: 0.1 for i in range(30)}
        base = bc.baselines(y, 3)
        preds = {t: base[t]['last'] for t in base}
        ev = bc.evaluate(y, preds, base, {t: True for t in base})
        self.assertEqual(ev['n_model'], 0)
        self.assertEqual(bc.grade(ev, 30)[0], 'N')

    def test_sanil_proxy_excludes_target_aggregates(self):
        cat = {k: {'obs': {1: 1.0}} for k in ('trass_kr_8504212', 'kr_exp_850422_p0', 'us_imp_850422_p410',
                                              'trass_kr_8504212_exansan', 'fred_IPG3353S', 'trass_sanil_ansan_850421')}
        peer = {'id': 'SANIL_PROXY', 'region': 'Korea'}
        doc = {'profile': {'proxy_routes': [{'proxy_hint': 'us_imp_850422_p410'}, {'proxy_hint': 'trass_sanil_ansan_850421'}]}}
        ids, roles, _, _ = bc.candidate_ids(peer, doc, cat)
        for bad in ('trass_kr_8504212', 'kr_exp_850422_p0', 'us_imp_850422_p410', 'trass_sanil_ansan_850421'):
            self.assertNotIn(bad, ids)
        self.assertIn('trass_kr_8504212_exansan', ids)
        self.assertIn('fred_IPG3353S', ids)

    def test_t_pvalue(self):
        self.assertAlmostEqual(sc.t_sf_two_sided(2.0, 10), 0.0734, places=3)
        self.assertAlmostEqual(sc.t_sf_two_sided(2.228, 10), 0.05, places=3)

    def test_bh(self):
        q = sc.bh_qvalues([0.01, 0.04, 0.03, 0.5])
        self.assertAlmostEqual(q[0], 0.04)
        self.assertAlmostEqual(q[3], 0.5)

    def test_neff_shrinks_with_autocorrelation(self):
        xs = [math.sin(i / 3.0) for i in range(40)]
        ys = [math.sin(i / 3.0 + 0.2) for i in range(40)]
        self.assertLess(sc.n_effective(xs, ys), 20)


if __name__ == '__main__':
    unittest.main()
