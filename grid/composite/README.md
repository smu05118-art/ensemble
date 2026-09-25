# 전력기기 피어 컴포짓 — 산일전기 피어 프록시 앙상블

화면: [`grid/composite.html`](../composite.html) · 계약: [`CONTRACT.md`](CONTRACT.md) · 대상: [`spec/peers.json`](spec/peers.json)

산일전기(062040)와 해외·국내 피어(Hammond Power·Eaton·Hubbell·GE Vernova·Powell·Forgent·ABB·Siemens Energy·
Hitachi Energy·Schneider·Legrand·KONČAR·R&S·WEG·Elsewedy·Fortune 등 대만 6사·중국 6사·인도 9사·일본 2사·국내 6사)의
**공식 매출**을 무역·생산·가격 **프록시**로 설명할 수 있는지 검정하고, 프록시가 매출보다 **먼저(선행)** 움직이는지
**같이(동행)** 움직이는지 판정한 뒤, 검증을 통과한 프록시만 rolling-origin 앙상블 컴포짓으로 묶는다.

## 재현

```sh
cd grid/composite
# 1) 실적(타깃) — 회사별 원문 수집 결과가 data/actuals/<ID>.json 에 있다(수집은 에이전트·수작업, 모든 값에 원문 URL).
python3 tools/seed_from_phalanx.py <phalanx>/composite_preview.html   # HPSA·ETN·POWL·FPS 시드
# 2) 프록시 — stdlib 수집기(재실행 가능, data/raw 캐시는 커밋하지 않는다)
python3 tools/fetch_fred.py && python3 tools/fetch_eurostat.py && python3 tools/fetch_statcan.py
python3 tools/fetch_comtrade.py --help                               # 미국 수입·국가별 수출(HS8504 등)
python3 tools/extract_phalanx_trass.py <phalanx>                     # 한국 TRASS(안산·국가·잠정)
# 3) 검사 → 빌드 → 화면
python3 tools/validate_contract.py
python3 tools/build_composite.py            # → out/composite.json
python3 tools/render_page.py                # → grid/composite.html
python3 -m unittest discover -s tools/tests
```

## 방법

| 단계 | 규칙 |
|---|---|
| 정렬 | 결산일 − 14일이 속한 달 = 분기 마지막 달, 3개월 창(반기 6개월). 프록시는 3/3 개월 완결 창만 쓴다. |
| 변환 | 로그 YoY. 타깃은 같은 보고서의 전년 동기 비교값(`prior_year_comparative`)을 분모로 우선. 통화가 바뀐 분기(HRK→EUR)는 비교값 없으면 YoY 를 만들지 않는다. |
| 선후행 | r_k = corr(프록시 YoY_{t−k}, 매출 YoY_t), k = −2…+4 분기. 겹치는 YoY 창의 자기상관은 Bartlett 유효표본 n_eff 로 보정한 단측 p(사전 기대 부호). 회사 안 전체 (프록시×시차)에 BH-FDR, q < 0.10 만 유의. |
| 판정 | 유의 시차 중 부호 조정 상관이 가장 큰 k*. **선행** = k* ≥ 1 이고 r(k*) ≥ r(0) + 0.05 · **후행** = k* < 0 에서 같은 조건 · 그 밖의 유의 = **동행** · 유의 없음 = 무관. |
| 강건성 | 프록시 YoY 전체 이력으로 AR(≤2) 적합 → 두 계열을 같은 필터로 사전백색화한 상관이 90% 단측 임계값(1.645/√n) 이상. 전환점: ±2분기 국지 극값을 짝지은 선행 분기 중앙값. |
| OOS | rolling-origin(확장창, 최소 학습 8분기). 원점 t 에서 **t 이전 분기만으로** 시차 k∈{0…4} 선택 → OLS → t 예측. 기준모형 0YoY(전년 동기 유지)·직전 YoY·학습 평균·AR(1) 과 같은 분기 집합에서 MAE 비교, 최선 기준모형 대비 Diebold–Mariano(HLN). |
| 앙상블 | 원점마다 학습 상관 ≥ 0.3 이고 (과거 OOS 4개 이상이면) 직전 YoY 보다 오차가 작았던 프록시만 동일가중(주)·역MSE(부) 결합. 없으면 직전 YoY 로 대체(비중 표시). |
| 등급 | A = 최선 기준모형 대비 MAE ≤ 0.9 & DM p < 0.10 · B = MAE ≤ 0.9 · C = 0.9~1.0 · F ≥ 1.0 · N = OOS < 8. |
| 공개 | A·B 이고 최근/대상 분기 범위 변경(인수·분할)이 없을 때만 나우캐스트 수치 공개. 구간 = 앙상블 OOS 절대오차의 분할 conformal 80%. |
| 타이트 | 회사 경로(사전등록·공장 소재) 프록시가 강건 유의이고 OOS 가 직전 YoY 를 이긴 경우. |
| 검증된 선행 | 선행 판정 + OOS 에서 학습으로 고른 시차의 최빈값 ≥ 1 + 최선 기준모형보다 오차 작음. |

후보 프록시는 결과를 보기 전에 규칙으로 고정했다 — 수집 단계에서 공장·제품 근거로 사전등록한 경로(`profile.proxy_routes`),
회사별 경로 목록(`ID_OVERRIDES`), 지역 목록(`REGIONAL_CANDIDATES`), 글로벌 목록(`GLOBAL_CANDIDATES`) 순으로 최대 28개.
초과분은 검정하지 않고 화면에 표시한다. 산일전기 비교용 안산 수출(`trass_sanil_ansan_8504212`)은 모든 피어에 진단으로만 넣고
앙상블에는 넣지 않는다.

## 한계

- 현재 수정치 스냅샷으로 회고 검증했다(실시간 빈티지 아님). 동행 프록시의 마지막 달은 실적 발표 전에 공표되지 않을 수 있다.
- 무역·생산 통계는 국가·HS·지역 합계라 회사 출하·점유율이 아니다. 안산시 수출은 산일전기 단독 수치가 아니다.
- 매출 YoY 에는 환율 효과가 섞인다(환산하지 않는다). 인수·분할 분기는 비교 가능성이 떨어진다.
- 여러 후보 중 최선 성적은 불편 추정치가 아니다(탐색적 비교). 등급은 관측 진단이며 투자 신호가 아니다.
