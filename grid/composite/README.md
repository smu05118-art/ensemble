# 전력기기 피어 컴포짓 — 산일전기 피어 프록시 앙상블

화면: [`grid/composite.html`](../composite.html) · 계약: [`CONTRACT.md`](CONTRACT.md) · 대상: [`spec/peers.json`](spec/peers.json)

산일전기(062040)와 해외·국내 피어(Hammond Power·Eaton·Hubbell·GE Vernova·Powell·Forgent·ABB·Siemens Energy·
Hitachi Energy·Schneider·Legrand·KONČAR·R&S·WEG·Elsewedy·Fortune 등 대만 6사·중국 6사·인도 9사·일본 2사·국내 6사)의
**공식 매출**에 대해 무역·생산·가격 **프록시**가 매출보다 **먼저(선행)** 움직이는지 **같이(동행)** 움직이는지 표본 내에서
판정하고(진단), 이와 별도로 원점마다 학습 구간 선별을 통과한 프록시만 rolling-origin 앙상블 컴포짓으로 묶는다.

## 재현

```sh
cd grid/composite
# 1) 실적(타깃) — 회사별 원문 수집 결과가 data/actuals/<ID>.json 에 있다(수집은 에이전트·수작업, 모든 값에 원문 URL).
python3 tools/seed_from_phalanx.py <phalanx>/composite_preview.html   # HPSA·ETN·POWL·FPS 시드
# 2) 프록시 — stdlib 수집기(재실행 가능, data/raw 캐시는 커밋하지 않는다)
python3 tools/fetch_fred.py && python3 tools/fetch_eurostat.py && python3 tools/fetch_statcan.py
python3 tools/fetch_comtrade.py --help                               # 미국 수입·국가별 수출(HS8504 등)
python3 tools/extract_phalanx_trass.py <phalanx>                     # 한국 TRASS(안산·국가·잠정)
python3 tools/fetch_japan_stats.py; python3 tools/fetch_taiwan_stats.py; python3 tools/fetch_india_stats.py
python3 tools/fetch_brazil_stats.py; python3 tools/fetch_china_stats.py; python3 tools/fetch_mexico_stats.py; python3 tools/fetch_fx.py
# 3) 검사 → 빌드 → 화면
python3 tools/validate_contract.py
python3 tools/build_composite.py            # → out/composite.json
python3 tools/render_page.py                # → grid/composite.html
python3 -m unittest discover -s tools/tests
```

## 방법

| 단계 | 규칙 |
|---|---|
| 타깃 | 공식 분기 매출. 관련 세그먼트(scope=segment, 분기 16개 이상)가 있으면 세그먼트(빌더 규칙, CONTRACT §1). 예외는 `TARGET_OVERRIDES` 에 사유와 함께: TBEA(변압기 반기 매출), Sieyuan·HD현대일렉트릭(연결). |
| 정렬 | 결산일 − 14일이 속한 달 = 분기 마지막 달, 3개월 창(반기 6개월). 프록시는 창의 모든 달이 있을 때만 쓴다. 분기 전용 프록시(JEMA)는 달력 분기 말에 둔다. |
| YoY | 로그 YoY. 같은 보고서의 전년 동기 비교값(`prior_year_comparative`)이 있으면 분모로 우선. 없으면 12개월 전 포인트 — 단 통화가 다르거나, 그 사이에 범위를 바꾸는 구조 변화(`divestiture`·`restatement`·`segment_reorg` 등, 또는 `affected_fiscal_keys` 로 지목된 분기)가 있으면 YoY 를 만들지 않는다. 원문 메모가 타깃 무관이라 밝힌 변화는 `affects_target: false`. |
| 선후행 판정 | 프록시 YoY 전체 이력으로 AR(≤2) 적합 → 프록시·매출 YoY 를 같은 필터로 사전백색화 → r_k (k=−2…+4, 반기 타깃은 반기 단위). 단측 p(사전 기대 부호)는 사전백색화 뒤에도 남는 계절 자기상관을 Bartlett 유효표본 n_eff(분기 lag≤6, 월 lag≤12)로 보정. 회사 안 전체 (프록시×시차)에 BH-FDR(산일 비교 진단은 별도 그룹), q < 0.10 만 유의. 유의 시차 중 부호 조정 상관 최대 k*: **선행** = k* ≥ 1 이고 r(k*) ≥ r(0) + 0.05 · **후행** = k* < 0 에서 같은 조건 · 그 밖 **동행** · 유의 없음 **무관**. 짝이 12개(월 24) 미만인 시차는 검정하지 않고 **검정 불가**, r(0) 을 못 구하면 **판정 보류**. 명목 p 단계는 두지 않는다. |
| 보조 지표 | 원계열 r(Bartlett n_eff 단측 p — 동조 크기, FDR 대상 아님), 팬데믹 제외(2020Q1~2021Q2) 사전백색화 r, 전환점(±2분기 국지 극값, Bry–Boschan 단순형) 선행 중앙값. **강건** = 판정 + 원계열 r(k*) ≥ 0.3 + 팬데믹 제외 r(k*)·부호 ≥ 0.2. |
| OOS | rolling-origin(확장창, 최소 학습 8분기). 원점 t 에서 **t 이전 분기만으로** 시차 k∈{0…4}를 b 의 부호 조정 t 최대로 고르고, 가속 모형 ŷ_t = y_{t−1} + b·(x_{t−k} − x_{t−1−k}) (b 원점 통과 최소제곱)로 예측. b = 0 이면 직전 YoY 와 같다. 기준모형 0YoY·직전 YoY·학습 평균·AR(1) 과 같은 분기 집합에서 MAE, 최선 기준모형 대비 Diebold–Mariano(HLN). |
| 앙상블 | 원점마다 학습 구간 b 의 부호 조정 t ≥ 1.0(`SCREEN_T`)이고 (과거 OOS 4개 이상이면) 직전 YoY 보다 오차가 작았던 프록시만 동일가중(주)·역MSE(부) 결합. 없으면 직전 YoY 로 대체(비중 표시). 구성은 선행·동행 판정과 독립. |
| 등급 | A = 최선 기준모형 대비 MAE ≤ 0.9 & DM p < 0.10 · B = MAE ≤ 0.9 · C = 0.9~1.0 · F ≥ 1.0 · N = 프록시가 실제로 쓰인(대체가 아닌) OOS 분기 < 8. |
| 나우캐스트 | 지금 창이 완결된 시차만 쓰는 같은 절차를 다시 rolling-origin 으로 돌린 **나우캐스트 앙상블**의 등급이 A·B 이고, 최근 12개 OOS 분기에서도 최선 기준모형보다 나으며(안정성 조건), 대상 기간 기준 15개월 안에 타깃에 해당하는 구조 변화(생산능력·상장·지분법 등 매출 범위와 무관한 유형 제외)가 없을 때만 공개. 구간 = 그 앙상블에서 프록시가 실제로 쓰인 OOS 분기 절대오차의 분할 conformal 80%. 최근 비교값이 최초 공시와 2% 넘게 다르면 레벨 환산 생략. 비공개 기업은 예측 수치를 출력하지 않는다. |
| 타이트 | 회사 경로(사전등록·공장 소재 경로) 프록시가 강건하고 OOS 가 최선 기준모형을 이긴(rel_mae_best < 1) 경우. |
| 검증된 선행 | 선행 판정 + OOS 에서 학습으로 고른 시차의 최빈값 ≥ 1 + 등급 A 기준(MAE ≤ 0.9·DM p < 0.10). 개선만 있으면 `oos_edge_lead`(OOS 우위·비유의). |

후보 프록시는 결과를 보기 전에 규칙으로 고정했다 — 수집 단계에서 공장·제품 근거로 사전등록한 경로(`profile.proxy_routes`),
회사별 경로 목록(`ID_OVERRIDES`), 지역 목록(`REGIONAL_CANDIDATES`), 글로벌 목록(`GLOBAL_CANDIDATES`) 순으로 최대 28개.
초과분은 검정하지 않고 화면에 표시한다.

### 산일전기(앵커)

2024년 상장이라 공시 분기 실적이 2023Q1~ 14개뿐이다. 공장 소재지 안산시의 HS850421·850422 수출(TRASS, 천 USD)을
**대리 타깃**(`SANIL_PROXY`)으로 쓰되, 대미 수출이 분기 1천만 달러를 처음 넘은 **2022Q3 이후**만 쓴다(그 전 YoY 는 신규 고객
진입 램프업 기저효과). 타당성: 산일 DART 매출 YoY 와 r = 0.80, 수출 매출 ÷ (안산 수출 × 원/달러) ≈ 0.99~1.28.
안산 수출을 **포함하는** 계열(한국 전체 합계·한국발 미국 수입 거울)은 대리 타깃 후보에서 빼고 `한국 전체 − 안산` 잔차를 쓴다.
미국 전체 수입(`us_imp_*_p0`)은 수요 지표로 남기되 안산 선적이 3.6~11% 섞여 있음을 밝혀 둔다.
모든 피어에는 안산 수출(램프업 이후)을 진단으로만 넣는다(앙상블 제외).

### 변경 기록

1. 초기 4사 진단에서 레벨 회귀·ADL 이 회사 점유율 표류로 직전 YoY 에 크게 져, 사전백색화(변화 성분) 판정과 일관되게 가속 모형으로 1회 고정.
2. 산일 대리 타깃: 램프업 기저효과 확인 후 2022-07 이후로 제한(1회).
3. 독립 감사(방법·독립 재계산·산출물·화면 4관점 + 반박 검증, 2026-09-25) 반영 — 사전백색화 p 의 n_eff 보정, 명목 p 단계 삭제,
   검증된 선행 A 기준, 구조 변화 YoY 차단, 나우캐스트 전용 앙상블 등급, 산일 대리 후보에서 타깃 포함 계열 제외, 반기 시차 단위, HD현대일렉트릭 연결 타깃.
   감사에서 look-ahead 는 발견되지 않았다(원점 절단 재실행이 전 원점에서 동일).
4. 재검증(수정 확인 + 공개 나우캐스트 독립 재계산) 후 — 나우캐스트 공개에 최근 12분기 안정성 조건 추가(과거 구간 우위만으로 공개하지 않음),
   구간을 프록시 사용 분기 오차로 보정, TBEA 2024 품목명 변경을 동일 기준으로 주석. 귀무 모의실험에서 FDR 오탐률 쌍당 0.15~0.4%.

## 한계

- 현재 수정치 스냅샷으로 회고 검증했다(실시간 빈티지 아님). 동행 프록시의 마지막 달은 실적 발표 전에 공표되지 않을 수 있다.
- 무역·생산 통계는 국가·HS·지역 합계라 회사 출하·점유율이 아니다. 안산시 수출은 산일전기 단독 수치가 아니다.
- 매출 YoY 에는 환율 효과가 섞인다(환산하지 않는다). 인수·분할 분기는 비교 가능성이 떨어진다.
- 여러 후보 중 최선 성적은 불편 추정치가 아니다(탐색적 비교). 등급은 관측 진단이며 투자 신호가 아니다.
